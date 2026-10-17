// =============================================================================
// billeteras.js - Lector de billeteras: se pega una direccion PUBLICA, se ven
// sus activos y se importan como posiciones. La cantidad de esas posiciones la
// marca la blockchain (se relee al abrir la app y con "Actualizar"); el coste
// lo pone el usuario o se toma el precio del dia de la importacion.
// La logica pura (que se ha pegado, agrupar, reglas del coste) esta en
// wallet-core.js; el servidor que lee las billeteras es api/wallet.js.
// =============================================================================

// Billeteras leyendose ahora mismo (evita dos lecturas a la vez de la misma).
const walletSyncing = new Set();
// Estado de la hoja abierta (alta o revision de una billetera).
let walletDraft = null;

function getWalletById(walletId) {
  return state.wallets.find((wallet) => wallet.id === walletId) || null;
}

function walletChainLabel(chain) {
  return t(`wallet.chain.${chain}`);
}

function walletDisplayName(wallet) {
  return wallet?.name || walletChainLabel(wallet?.chain || "evm");
}

function walletRows(walletId) {
  return state.rows.filter((row) => row.walletId === walletId);
}

function walletNetworksText(parts) {
  const labels = [...new Set((parts || []).map((part) => WalletCore.NETWORK_LABELS[part.network] || part.network))];
  return labels.join(" · ");
}

// Cantidad de tokens como texto decimal plano (sin "5e-9"), que es lo que
// guardan las filas y lo que entiende parseDecimal.
function walletAmountText(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return "";
  }
  const rounded = Number(n.toPrecision(12));
  if (rounded >= 1e-6) {
    return String(rounded);
  }
  const digits = Math.min(20, Math.ceil(-Math.log10(rounded)) + 12);
  return rounded.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function walletBadgeHtml(row) {
  if (!isWalletRow(row)) {
    return "";
  }
  const wallet = getWalletById(row.walletId);
  if (!wallet) {
    return "";
  }
  return `<span class="wallet-chip" title="${escapeHtml(t("wallet.badgeTitle", { wallet: walletDisplayName(wallet) }))}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M21 12h-5a2 2 0 0 0 0 4h5z"/></svg>${escapeHtml(walletDisplayName(wallet))}</span>`;
}

// Al borrar una posicion de billetera se recuerda que no se quiere: la
// siguiente lectura no la vuelve a proponer como nueva (deshacer lo revierte).
function setWalletKeyIgnored(row, ignored) {
  if (!isWalletRow(row) || !row.walletKey) {
    return;
  }
  const wallet = getWalletById(row.walletId);
  if (!wallet) {
    return;
  }
  const keys = new Set(wallet.ignoredKeys);
  if (ignored) {
    keys.add(row.walletKey);
  } else {
    keys.delete(row.walletKey);
  }
  wallet.ignoredKeys = [...keys].slice(-300);
}

// ── Lectura (servidor propio) ──

function walletError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function walletErrorText(code) {
  const known = ["missing_key", "invalid_address", "rate_limited", "offline", "network", "upstream"];
  return t(`wallet.err.${known.includes(code) ? code : "upstream"}`);
}

async function fetchWalletHoldings(chain, address) {
  if (isOffline()) {
    throw walletError("offline");
  }
  const url = `${WALLET_PROXY}?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
  } catch {
    throw walletError("network");
  } finally {
    window.clearTimeout(timer);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw walletError(body?.error || (response.status === 503 ? "missing_key" : "upstream"));
  }
  if (!body || !Array.isArray(body.assets)) {
    throw walletError("upstream");
  }
  return body;
}

// Precio en la moneda base de cada activo agrupado: CoinGecko para lo que
// conoce (mismo precio que el resto de la cartera) y el precio por contrato
// de Alchemy, convertido, para lo que no.
async function priceHoldings(holdings) {
  const ids = holdings.map((holding) => holding.coinId).filter(Boolean);
  let market = new Map();
  if (ids.length) {
    try {
      market = await fetchMarketData(ids);
    } catch {
      market = new Map();
    }
  }
  let usdRate = liveConversionRate();
  if (usdRate === null && holdings.some((holding) => !holding.coinId || !market.has(holding.coinId))) {
    try {
      usdRate = await fetchCurrencyConversionRate("usd", state.prefs.currency);
    } catch {
      usdRate = null;
    }
  }
  return holdings.map((holding) => {
    const info = holding.coinId ? market.get(holding.coinId) : null;
    let price = typeof info?.current_price === "number" ? info.current_price : null;
    if (price === null && holding.priceUsd > 0 && Number.isFinite(usdRate) && usdRate > 0) {
      price = holding.priceUsd * usdRate;
    }
    const value = price !== null ? price * holding.amount : null;
    return {
      ...holding,
      market: info || null,
      symbol: String(info?.symbol || holding.symbol || "").toUpperCase(),
      name: info?.name || holding.name || holding.symbol,
      logo: info?.image || holding.logo || "",
      price,
      value,
      visible: WalletCore.isHoldingVisible(value)
    };
  });
}

// ── Hoja de alta / revision ──

function openWalletSheet(walletId = null) {
  const sheet = document.getElementById("walletSheet");
  if (!sheet) {
    return;
  }
  const wallet = walletId ? getWalletById(walletId) : null;
  if (!wallet && state.wallets.length >= MAX_WALLETS) {
    showToast(t("wallet.limitTitle"), t("wallet.limitText", { n: MAX_WALLETS }), "warning");
    return;
  }
  walletDraft = wallet
    ? { mode: "review", walletId: wallet.id, chain: wallet.chain, address: wallet.address, name: wallet.name, step: "loading", holdings: [], costMode: "manual", showHidden: false, failedNetworks: [], error: "", detect: null }
    : { mode: "new", walletId: null, chain: "", address: "", name: "", step: "input", holdings: [], costMode: "manual", showHidden: false, failedNetworks: [], error: "", detect: null };
  sheet.hidden = false;
  document.body.classList.add("editor-open");
  renderWalletSheet();
  if (wallet) {
    loadWalletPreview();
  } else if (!isMobileViewport()) {
    window.setTimeout(() => sheet.querySelector("[data-wallet-field='address']")?.focus({ preventScroll: true }), 260);
  }
}

function closeWalletSheet() {
  const sheet = document.getElementById("walletSheet");
  if (!sheet || sheet.hidden) {
    return;
  }
  walletDraft = null;
  sheet.classList.add("is-closing");
  window.setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("is-closing");
    sheet.innerHTML = "";
    if (!state.editorRowId && document.getElementById("tradeSheet")?.hidden !== false) {
      document.body.classList.remove("editor-open");
    }
  }, 200);
}

function walletDetectHtml(detect) {
  if (!detect || detect.kind === "empty") {
    return `<p class="wallet-detect" data-wallet-role="detect">${escapeHtml(t("wallet.detect.empty"))}</p>`;
  }
  const danger = detect.kind === "seed" || detect.kind === "privateKey";
  const ok = ["evm", "solana", "bitcoin"].includes(detect.kind);
  const tone = danger ? "is-danger" : ok ? "is-ok" : "is-warn";
  return `<p class="wallet-detect ${tone}" data-wallet-role="detect" role="${danger ? "alert" : "status"}">${escapeHtml(t(`wallet.detect.${detect.kind}`))}</p>`;
}

function walletHoldingHtml(holding) {
  const linked = holding.linked;
  const avatar = holding.logo
    ? `<img src="${escapeHtml(holding.logo)}" alt="" loading="lazy" />`
    : `<span>${escapeHtml((holding.symbol || "?").slice(0, 3))}</span>`;
  const amount = formatNumber(holding.amount, holding.amount >= 1 ? 4 : 8);
  const value = holding.value !== null ? maskedCurrency(holding.value) : "--";
  const note = linked
    ? t("wallet.alreadyIn")
    : !holding.coinId
      ? t("wallet.unlisted")
      : walletNetworksText(holding.parts);
  return `
    <li class="wallet-asset ${linked ? "is-linked" : ""}" ${holding.visible || linked ? "" : "data-wallet-hidden"}>
      <label class="wallet-asset-row">
        <input type="checkbox" data-wallet-pick="${escapeHtml(holding.key)}" ${holding.checked ? "checked" : ""} ${linked ? "disabled" : ""} />
        <span class="asset-avatar wallet-asset-avatar">${avatar}</span>
        <span class="wallet-asset-id">
          <strong>${escapeHtml(holding.name || holding.symbol)}</strong>
          <small>${escapeHtml(holding.symbol)} · ${escapeHtml(note)}</small>
        </span>
        <span class="wallet-asset-val">
          <strong class="money">${escapeHtml(value)}</strong>
          <small>${escapeHtml(amount)}</small>
        </span>
      </label>
    </li>`;
}

function renderWalletSheet() {
  const sheet = document.getElementById("walletSheet");
  if (!sheet || !walletDraft) {
    return;
  }
  const d = walletDraft;
  const title = d.mode === "review" ? t("wallet.reviewTitle") : t("wallet.addTitle");
  let body = "";
  let foot = "";

  if (d.step === "input") {
    const canRead = d.detect && ["evm", "solana", "bitcoin"].includes(d.detect.kind);
    body = `
      <p class="wallet-safety">${escapeHtml(t("wallet.safety"))}</p>
      <label class="editor-field">
        <span>${escapeHtml(t("wallet.addressLabel"))}</span>
        <textarea data-wallet-field="address" rows="2" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="0x… · bc1… · ${escapeHtml(t("wallet.chain.solana"))}">${escapeHtml(d.address)}</textarea>
      </label>
      ${walletDetectHtml(d.detect)}
      <label class="editor-field">
        <span>${escapeHtml(t("wallet.nameLabel"))}</span>
        <input type="text" data-wallet-field="name" maxlength="40" value="${escapeHtml(d.name)}" placeholder="${escapeHtml(t("wallet.namePlaceholder"))}" />
      </label>
      ${d.error ? `<p class="wallet-detect is-danger" role="alert">${escapeHtml(walletErrorText(d.error))}</p>` : ""}`;
    foot = `
      <button type="button" class="ghost-btn" data-wallet-close>${escapeHtml(t("buttons.cancel"))}</button>
      <button type="submit" class="primary-btn" data-wallet-read ${canRead ? "" : "disabled"}>${escapeHtml(t("wallet.read"))}</button>`;
  } else if (d.step === "loading") {
    body = `<p class="wallet-loading" role="status"><span class="wallet-spinner" aria-hidden="true"></span>${escapeHtml(t("wallet.reading", { chain: walletChainLabel(d.chain) }))}</p>`;
    foot = `<button type="button" class="ghost-btn" data-wallet-close>${escapeHtml(t("buttons.cancel"))}</button>`;
  } else if (d.step === "error") {
    body = `<p class="wallet-detect is-danger" role="alert">${escapeHtml(walletErrorText(d.error))}</p>`;
    foot = `
      <button type="button" class="ghost-btn" data-wallet-close>${escapeHtml(t("buttons.close"))}</button>
      <button type="button" class="primary-btn" data-wallet-retry>${escapeHtml(t("wallet.retry"))}</button>`;
  } else {
    const shown = d.holdings.filter((h) => h.visible || h.linked);
    const hidden = d.holdings.filter((h) => !h.visible && !h.linked);
    const picked = d.holdings.filter((h) => h.checked && !h.linked);
    const total = picked.reduce((sum, h) => sum + (h.value || 0), 0);
    const failed = d.failedNetworks.map((n) => WalletCore.NETWORK_LABELS[n] || n).join(", ");
    body = `
      <p class="wallet-summary"><strong>${escapeHtml(walletChainLabel(d.chain))}</strong> · <code>${escapeHtml(WalletCore.shortAddress(d.address))}</code></p>
      ${failed ? `<p class="wallet-detect is-warn" role="status">${escapeHtml(t("wallet.partial", { networks: failed }))}</p>` : ""}
      ${d.holdings.length
        ? `<ul class="wallet-assets" role="list" data-show-hidden="${d.showHidden ? "1" : "0"}">
            ${shown.map(walletHoldingHtml).join("")}
            ${hidden.map(walletHoldingHtml).join("")}
          </ul>
          ${!shown.length && hidden.length ? `<p class="editor-secondary">${escapeHtml(t("wallet.onlyHidden"))}</p>` : ""}
          ${hidden.length ? `<button type="button" class="wallet-toggle-hidden" data-wallet-toggle-hidden>${escapeHtml(t(d.showHidden ? "wallet.hideHidden" : "wallet.showHidden", { n: hidden.length }))}</button>` : ""}`
        : `<p class="movers-empty">${escapeHtml(t("wallet.empty"))}</p>`}
      ${picked.length ? `
      <p class="wallet-total">${escapeHtml(t("wallet.selectedValue", { n: picked.length }))} <strong class="money">${escapeHtml(maskedCurrency(total))}</strong></p>
      <div class="wallet-cost" role="radiogroup" aria-label="${escapeHtml(t("wallet.costLabel"))}">
        <span>${escapeHtml(t("wallet.costLabel"))}</span>
        <button type="button" class="alert-kind-chip ${d.costMode === "manual" ? "is-active" : ""}" data-wallet-cost="manual" role="radio" aria-checked="${d.costMode === "manual"}">${escapeHtml(t("wallet.costManual"))}</button>
        <button type="button" class="alert-kind-chip ${d.costMode === "today" ? "is-active" : ""}" data-wallet-cost="today" role="radio" aria-checked="${d.costMode === "today"}">${escapeHtml(t("wallet.costToday"))}</button>
        <small>${escapeHtml(t(d.costMode === "today" ? "wallet.costTodayHint" : "wallet.costManualHint"))}</small>
      </div>` : ""}
      ${d.mode === "new" ? `<p class="editor-secondary">${escapeHtml(t("wallet.syncNote"))}</p>` : ""}`;
    const label = picked.length
      ? t("wallet.importN", { n: picked.length })
      : d.mode === "review" ? t("wallet.saveReview") : t("wallet.saveEmpty");
    foot = `
      <button type="button" class="ghost-btn" ${d.mode === "new" ? "data-wallet-back" : "data-wallet-close"}>${escapeHtml(t(d.mode === "new" ? "wallet.back" : "buttons.cancel"))}</button>
      <button type="submit" class="primary-btn" data-wallet-import>${escapeHtml(label)}</button>`;
  }

  sheet.innerHTML = `
    <div class="editor-backdrop" data-wallet-close></div>
    <form class="editor-panel wallet-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" data-wallet-step="${d.step}">
      <header class="editor-head">
        <div class="editor-grip" aria-hidden="true"></div>
        <div class="editor-title-row">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="icon-circle-btn" data-wallet-close aria-label="${escapeHtml(t("buttons.close"))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </header>
      <div class="editor-body">${body}</div>
      <footer class="editor-foot">${foot}</footer>
    </form>`;
}

function handleWalletAddressInput(input) {
  if (!walletDraft) {
    return;
  }
  const detect = WalletCore.classifyWalletInput(input.value);
  walletDraft.error = "";
  if (detect.kind === "seed" || detect.kind === "privateKey") {
    // Se borra en el acto: una frase semilla o una clave privada no se queda
    // ni en el campo ni en ningun sitio de la app.
    input.value = "";
    walletDraft.address = "";
  } else {
    walletDraft.address = input.value.trim();
  }
  walletDraft.detect = detect;
  walletDraft.chain = ["evm", "solana", "bitcoin"].includes(detect.kind) ? detect.kind : "";
  const sheet = document.getElementById("walletSheet");
  sheet?.querySelector("[data-wallet-role='detect']")?.replaceWith(
    document.createRange().createContextualFragment(walletDetectHtml(detect))
  );
  const readBtn = sheet?.querySelector("[data-wallet-read]");
  if (readBtn) {
    readBtn.disabled = !walletDraft.chain;
  }
  const nameInput = sheet?.querySelector("[data-wallet-field='name']");
  if (nameInput && walletDraft.chain) {
    nameInput.placeholder = suggestWalletName(walletDraft.chain);
  }
}

function suggestWalletName(chain) {
  const base = walletChainLabel(chain);
  const names = new Set(state.wallets.map((wallet) => walletDisplayName(wallet)));
  if (!names.has(base)) {
    return base;
  }
  let n = 2;
  while (names.has(`${base} ${n}`)) {
    n += 1;
  }
  return `${base} ${n}`;
}

async function loadWalletPreview() {
  const d = walletDraft;
  if (!d) {
    return;
  }
  d.step = "loading";
  renderWalletSheet();
  try {
    const data = await fetchWalletHoldings(d.chain, d.address);
    if (walletDraft !== d) {
      return; // la hoja se cerro o se abrio otra
    }
    const priced = await priceHoldings(WalletCore.aggregateHoldings(data.assets));
    if (walletDraft !== d) {
      return;
    }
    const wallet = d.walletId ? getWalletById(d.walletId) : null;
    const linkedKeys = new Set(wallet ? walletRows(wallet.id).map((row) => row.walletKey) : []);
    const ignored = new Set(wallet?.ignoredKeys || []);
    d.holdings = priced
      .map((holding) => {
        const linked = linkedKeys.has(holding.key);
        // Lo que se dejo fuera a proposito no vuelve marcado ni a la vista.
        const visible = holding.visible && !ignored.has(holding.key);
        return { ...holding, linked, visible, checked: !linked && visible };
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    d.address = data.address || d.address;
    d.failedNetworks = Array.isArray(data.failedNetworks) ? data.failedNetworks : [];
    d.step = "preview";
  } catch (error) {
    if (walletDraft !== d) {
      return;
    }
    d.error = error.code || "upstream";
    // En el alta se vuelve al formulario con el aviso; en revision, pantalla
    // de error con "Reintentar".
    d.step = d.mode === "new" && d.error === "invalid_address" ? "input" : "error";
  }
  renderWalletSheet();
}

function handleWalletSubmit() {
  const d = walletDraft;
  if (!d) {
    return;
  }
  if (d.step === "input") {
    if (!d.chain) {
      return;
    }
    const duplicate = state.wallets.find((wallet) => wallet.chain === d.chain && wallet.address.toLowerCase() === d.address.toLowerCase());
    if (duplicate) {
      showToast(t("wallet.duplicateTitle"), t("wallet.duplicateText", { wallet: walletDisplayName(duplicate) }), "neutral");
      closeWalletSheet();
      window.setTimeout(() => openWalletSheet(duplicate.id), 220);
      return;
    }
    const nameInput = document.querySelector("#walletSheet [data-wallet-field='name']");
    d.name = String(nameInput?.value || "").trim().slice(0, 40) || suggestWalletName(d.chain);
    loadWalletPreview();
    return;
  }
  if (d.step === "preview") {
    importWalletDraft();
  }
}

function importWalletDraft() {
  const d = walletDraft;
  let wallet = d.walletId ? getWalletById(d.walletId) : null;
  const isNew = !wallet;
  if (isNew) {
    wallet = normalizeWallet({
      id: `wallet-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: d.name,
      chain: d.chain,
      address: d.address,
      createdAt: Date.now()
    });
    state.wallets.push(wallet);
  }

  const picked = d.holdings.filter((h) => h.checked && !h.linked);
  // Lo que no se marca queda como "no lo quiero" para no proponerlo cada vez.
  const ignored = new Set(wallet.ignoredKeys);
  d.holdings.forEach((h) => {
    if (h.linked) {
      return;
    }
    if (h.checked) {
      ignored.delete(h.key);
    } else {
      ignored.add(h.key);
    }
  });
  wallet.ignoredKeys = [...ignored].slice(-300);

  // Filas vacias de relleno (una cartera sin nada guarda una en blanco).
  if (picked.length) {
    state.rows = state.rows.filter((row) => row.crypto.trim() || String(row.tokens).trim() || String(row.investment).trim());
  }

  picked.forEach((h) => {
    // Al precio de hoy, redondeado A LA BAJA al centimo: asi arranca en
    // +0,00 y no en un "-0,00" rojo por el redondeo.
    const raw = WalletCore.initialInvestment(d.costMode, h.amount, h.price);
    const investment = raw !== null && raw >= 1 ? Math.floor(raw * 100) / 100 : raw;
    const row = createRow({
      crypto: h.symbol || h.name,
      coinId: h.coinId || "",
      resolvedName: h.name,
      symbol: h.symbol,
      image: h.logo || "",
      tokens: walletAmountText(h.amount),
      investment: investment ? formatEditableNumber(investment) : "",
      entryPrice: investment ? formatEditableNumber(investment / h.amount) : "",
      derivedField: investment ? "entryPrice" : "",
      purchaseDate: new Date().toISOString().slice(0, 10),
      dexNetwork: h.dexNetwork,
      dexAddress: h.dexAddress,
      walletId: wallet.id,
      walletKey: h.key,
      walletParts: h.parts,
      currentPrice: h.price,
      priceSource: h.price !== null && !h.market ? "alchemy" : null,
      priceStatus: h.price !== null ? "success" : "idle",
      lastPriceAt: h.price !== null ? new Date().toISOString() : null
    });
    if (h.market) {
      applyMarketDataToRow(row, h.market);
    }
    state.rows.push(row);
  });
  if (!state.rows.length) {
    state.rows.push(createRow());
  }

  wallet.syncedAt = Date.now();
  wallet.status = "ok";
  wallet.errorCode = "";
  wallet.failedNetworks = d.failedNetworks.slice(0, 12);
  wallet.pendingNew = 0;

  closeWalletSheet();
  renderAll();
  renderWalletsPanel();
  persistState(false);
  syncLivePrices();
  if (picked.some((h) => !h.coinId)) {
    refreshDexPrices({ rows: state.rows.filter(isDexOnlyRow), force: true }).catch(() => {});
  }
  pushActivity(t("wallet.importedTitle"), t("wallet.importedText", { n: picked.length, wallet: walletDisplayName(wallet) }), "positive");
  showToast(
    isNew ? t("wallet.importedTitle") : t("wallet.reviewedTitle"),
    t("wallet.importedText", { n: picked.length, wallet: walletDisplayName(wallet) }),
    "positive"
  );
}

// ── Sincronizacion ──

/**
 * Vuelve a leer una billetera y ajusta sus posiciones (wallet-core.js decide
 * el coste). Dos protecciones contra fallos del proveedor:
 *   · una red que no respondio no toca las posiciones que viven en ella;
 *   · si la billetera aparece VACIA de golpe, en automatico no se cambia nada
 *     y a mano se pide confirmacion (un fallo no debe borrar costes).
 */
async function syncWallet(walletId, { manual = false } = {}) {
  const wallet = getWalletById(walletId);
  if (!wallet || walletSyncing.has(walletId)) {
    return;
  }
  walletSyncing.add(walletId);
  renderWalletsPanel();
  try {
    const data = await fetchWalletHoldings(wallet.chain, wallet.address);
    const holdings = WalletCore.aggregateHoldings(data.assets);
    const byKey = new Map(holdings.map((holding) => [holding.key, holding]));
    const failed = new Set(Array.isArray(data.failedNetworks) ? data.failedNetworks : []);
    const rows = walletRows(walletId);

    const holdingRows = rows.filter((row) => parseDecimal(row.tokens) > 0);
    if (!holdings.length && holdingRows.length && !failed.size) {
      if (!manual || !window.confirm(t("wallet.emptyConfirm", { wallet: walletDisplayName(wallet) }))) {
        wallet.status = "error";
        wallet.errorCode = "emptyCheck";
        return;
      }
    }

    let changed = 0;
    rows.forEach((row) => {
      if ((row.walletParts || []).some((part) => failed.has(part.network))) {
        return;
      }
      const holding = byKey.get(row.walletKey);
      const hasCost = String(row.investment ?? "").trim() !== "";
      const result = WalletCore.syncPosition({
        oldTokens: parseDecimal(row.tokens),
        investment: hasCost ? parseDecimal(row.investment) : null,
        newTokens: holding ? holding.amount : 0,
        priceNow: row.currentPrice
      });
      row.walletParts = holding ? holding.parts : [];
      if (result.change === "same") {
        return;
      }
      changed += 1;
      row.tokens = result.tokens > 0 ? walletAmountText(result.tokens) : "";
      const cost = result.tokens > 0 && result.investment !== null ? result.investment : null;
      row.investment = cost !== null ? formatEditableNumber(cost) : "";
      row.entryPrice = cost !== null && cost > 0 ? formatEditableNumber(cost / result.tokens) : "";
      row.derivedField = row.entryPrice ? "entryPrice" : "";
    });

    // Activos con valor que aun no estan en la cartera ni se descartaron.
    const linked = new Set(rows.map((row) => row.walletKey));
    const ignored = new Set(wallet.ignoredKeys);
    const candidates = holdings.filter((holding) => !linked.has(holding.key) && !ignored.has(holding.key));
    let pending = 0;
    if (candidates.length) {
      const priced = await priceHoldings(candidates);
      pending = priced.filter((holding) => holding.visible).length;
    }

    wallet.syncedAt = Date.now();
    wallet.status = "ok";
    wallet.errorCode = "";
    wallet.failedNetworks = [...failed].slice(0, 12);
    wallet.pendingNew = pending;
    if (changed) {
      renderAll();
      syncLivePrices();
    }
    persistState(false);
    if (manual) {
      showToast(
        t("wallet.syncedTitle"),
        changed ? t("wallet.syncedChanged", { n: changed }) : t("wallet.syncedSame"),
        "positive"
      );
    }
  } catch (error) {
    wallet.status = "error";
    wallet.errorCode = error.code || "upstream";
    persistState(false);
    if (manual) {
      showToast(t("wallet.syncFailedTitle"), walletErrorText(wallet.errorCode), "negative");
    }
  } finally {
    walletSyncing.delete(walletId);
    renderWalletsPanel();
  }
}

async function syncStaleWallets() {
  const stale = state.wallets.filter((wallet) => Date.now() - Number(wallet.syncedAt || 0) > WALLET_STALE_MS);
  for (const wallet of stale) {
    // Una a una: el proveedor gratuito agradece no recibir rafagas.
    await syncWallet(wallet.id, { manual: false });
  }
}

async function syncAllWallets() {
  for (const wallet of [...state.wallets]) {
    await syncWallet(wallet.id, { manual: false });
  }
  showToast(t("wallet.syncedTitle"), t("wallet.syncedAll", { n: state.wallets.length }), "positive");
}

function renameWallet(walletId) {
  const wallet = getWalletById(walletId);
  if (!wallet) {
    return;
  }
  const next = window.prompt(t("wallet.renamePrompt"), walletDisplayName(wallet));
  if (next === null) {
    return;
  }
  wallet.name = String(next).trim().slice(0, 40) || suggestWalletName(wallet.chain);
  persistState(false);
  renderAll();
  renderWalletsPanel();
}

function removeWallet(walletId) {
  const wallet = getWalletById(walletId);
  if (!wallet) {
    return;
  }
  const rows = walletRows(walletId);
  if (!window.confirm(t("wallet.deleteConfirm", { wallet: walletDisplayName(wallet), n: rows.length }))) {
    return;
  }
  const removed = new Set(rows.map((row) => row.id));
  state.rows = state.rows.filter((row) => !removed.has(row.id));
  // Las alertas de esas posiciones se quedarian sin activo: fuera tambien.
  state.alerts = state.alerts.filter((alert) => !(alert.scope === "asset" && removed.has(alert.rowId)));
  state.wallets = state.wallets.filter((item) => item.id !== walletId);
  removed.forEach((rowId) => {
    clearTimersForRow(rowId);
    state.expandedCards.delete(rowId);
  });
  if (removed.has(state.detailRowId)) {
    closeAssetDetail();
  }
  if (!state.rows.length) {
    state.rows.push(createRow());
  }
  persistState(false);
  renderAll();
  renderWalletsPanel();
  renderAlertsPanel();
  syncLivePrices();
  showToast(t("wallet.deletedTitle"), t("wallet.deletedText", { wallet: walletDisplayName(wallet), n: rows.length }), "neutral");
}

// ── Panel de Ajustes ──

function walletStatusText(wallet, rows) {
  if (walletSyncing.has(wallet.id)) {
    return t("wallet.syncing");
  }
  if (wallet.status === "error") {
    return wallet.errorCode === "emptyCheck" ? t("wallet.emptyCheck") : walletErrorText(wallet.errorCode);
  }
  const value = rows.reduce((sum, row) => sum + (computeRowMetrics(row).currentValue || 0), 0);
  const when = wallet.syncedAt ? formatRelativeTime(wallet.syncedAt) : "--";
  return t("wallet.itemMeta", { n: rows.length, value: maskedCurrency(value), when });
}

function renderWalletsPanel() {
  const box = document.getElementById("walletsList");
  if (!box) {
    return;
  }
  const syncAllBtn = document.getElementById("syncWalletsBtn");
  if (syncAllBtn) {
    syncAllBtn.hidden = state.wallets.length < 2;
  }
  if (!state.wallets.length) {
    box.innerHTML = `<p class="movers-empty">${escapeHtml(t("walletsPanel.empty"))}</p>`;
    return;
  }
  box.innerHTML = `
    <ul class="alerts-list wallets-list" role="list">
      ${state.wallets.map((wallet) => {
        const rows = walletRows(wallet.id);
        const busy = walletSyncing.has(wallet.id);
        return `
        <li class="alert-item wallet-item ${wallet.status === "error" ? "is-error" : ""}" data-wallet-id="${escapeHtml(wallet.id)}">
          <button type="button" class="alert-item-main wallet-item-main" data-wallet-review="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(t("wallet.reviewAria", { wallet: walletDisplayName(wallet) }))}">
            <strong>${escapeHtml(walletDisplayName(wallet))}</strong>
            <small>${escapeHtml(walletChainLabel(wallet.chain))} · ${escapeHtml(WalletCore.shortAddress(wallet.address))}</small>
            <small class="wallet-item-status">${escapeHtml(walletStatusText(wallet, rows))}</small>
            ${wallet.pendingNew > 0 ? `<small class="wallet-item-new">${escapeHtml(t("wallet.pendingNew", { n: wallet.pendingNew }))}</small>` : ""}
          </button>
          <span class="alert-item-actions">
            <button class="icon-circle-btn ${busy ? "is-spinning" : ""}" type="button" data-wallet-sync="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(t("wallet.syncOne"))}" ${busy ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></svg>
            </button>
            <button class="icon-circle-btn" type="button" data-wallet-rename="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(t("wallet.rename"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button class="icon-circle-btn" type="button" data-wallet-delete="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(t("wallet.delete"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </span>
        </li>`;
      }).join("")}
    </ul>`;
}

// ── Eventos ──

function bindWallets() {
  const sheet = document.getElementById("walletSheet");
  if (sheet) {
    sheet.addEventListener("click", (event) => {
      if (event.target.closest("[data-wallet-close]")) {
        closeWalletSheet();
        return;
      }
      if (event.target.closest("[data-wallet-back]") && walletDraft) {
        walletDraft.step = "input";
        walletDraft.error = "";
        renderWalletSheet();
        return;
      }
      if (event.target.closest("[data-wallet-retry]")) {
        loadWalletPreview();
        return;
      }
      if (event.target.closest("[data-wallet-toggle-hidden]") && walletDraft) {
        walletDraft.showHidden = !walletDraft.showHidden;
        renderWalletSheet();
        return;
      }
      const cost = event.target.closest("[data-wallet-cost]");
      if (cost && walletDraft) {
        walletDraft.costMode = cost.dataset.walletCost === "today" ? "today" : "manual";
        renderWalletSheet();
      }
    });
    sheet.addEventListener("input", (event) => {
      if (event.target.matches("[data-wallet-field='address']")) {
        handleWalletAddressInput(event.target);
      } else if (event.target.matches("[data-wallet-field='name']") && walletDraft) {
        walletDraft.name = event.target.value;
      }
    });
    sheet.addEventListener("change", (event) => {
      const pick = event.target.closest("[data-wallet-pick]");
      if (!pick || !walletDraft) {
        return;
      }
      const holding = walletDraft.holdings.find((h) => h.key === pick.dataset.walletPick);
      if (holding) {
        holding.checked = pick.checked;
        // Se repinta para actualizar el total y el boton (sin perder la lista).
        const scroll = sheet.querySelector(".editor-body")?.scrollTop || 0;
        renderWalletSheet();
        const body = sheet.querySelector(".editor-body");
        if (body) {
          body.scrollTop = scroll;
        }
      }
    });
    sheet.addEventListener("submit", (event) => {
      event.preventDefault();
      handleWalletSubmit();
    });
  }

  document.getElementById("walletsList")?.addEventListener("click", (event) => {
    const sync = event.target.closest("[data-wallet-sync]");
    if (sync) {
      syncWallet(sync.dataset.walletSync, { manual: true });
      return;
    }
    const rename = event.target.closest("[data-wallet-rename]");
    if (rename) {
      renameWallet(rename.dataset.walletRename);
      return;
    }
    const remove = event.target.closest("[data-wallet-delete]");
    if (remove) {
      removeWallet(remove.dataset.walletDelete);
      return;
    }
    const review = event.target.closest("[data-wallet-review]");
    if (review) {
      openWalletSheet(review.dataset.walletReview);
    }
  });
  document.getElementById("addWalletBtn")?.addEventListener("click", () => openWalletSheet());
  document.getElementById("syncWalletsBtn")?.addEventListener("click", () => syncAllWallets());
}
