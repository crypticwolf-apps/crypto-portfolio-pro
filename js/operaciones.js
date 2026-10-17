// =============================================================================
// operaciones.js - Compras y ventas: hoja de operacion, registro, PnL
// realizado y edicion o borrado de operaciones (revierte su efecto exacto).
// =============================================================================

/* ── Compra/venta simplificada (sin libro de operaciones) ──
   Compra: suma tokens e inversión y recalcula el coste medio.
   Venta:  resta tokens manteniendo el coste medio (reduce la base). */
function openTradeSheet(mode, preselectRowId = null) {
  const sheet = document.getElementById("tradeSheet");
  if (!sheet) {
    return;
  }
  // Posiciones candidatas: las que ya tienen activo definido.
  const positions = state.rows.filter((row) => row.crypto.trim());

  if (mode === "sell" && !state.editingTradeId && !positions.filter((r) => parseDecimal(r.tokens) > 0).length) {
    showToast(t("trade.noPositionsTitle"), t("trade.noPositionsText"), "warning");
    return;
  }

  const titleKey = mode === "buy" ? "fab.buy" : mode === "sell" ? "fab.sell" : "fab.alert";
  // Al editar una venta se incluye siempre su propia posicion, aunque haya
  // quedado a cero: es la que se va a recalcular.
  const editando = state.editingTradeId
    ? state.trades.find((item) => item.id === state.editingTradeId)
    : null;
  const options = (mode === "sell"
    ? positions.filter((r) => parseDecimal(r.tokens) > 0 || r.id === editando?.rowId)
    : positions)
    .map((row) => `<option value="${row.id}">${escapeHtml(assetDisplayName(row))}</option>`)
    .join("");

  // Compra/venta por IMPORTE de dinero: los tokens se calculan solos con el
  // precio de la operación y se muestran únicamente como dato informativo.
  const amountLabel = mode === "sell" ? t("trade.amountSell") : t("trade.amountBuy");
  const today = new Date().toISOString().slice(0, 10);
  // En venta: atajos para retirar un % del valor de la posición o venderla entera.
  const sellQuick = mode === "sell"
    ? `<div class="trade-quick" role="group" aria-label="${escapeHtml(t("trade.sellQuickAria"))}">
         ${[25, 50, 100].map((p) => `<button type="button" class="chip-preset" data-trade-pct="${p}">${p === 100 ? escapeHtml(t("trade.sellAll")) : p + "%"}</button>`).join("")}
       </div>`
    : "";
  const amountBlock = mode === "alert"
    ? ""
    : `
      <div class="editor-grid-2">
        <label class="editor-field">
          <span>${escapeHtml(amountLabel)}</span>
          <input type="text" inputmode="decimal" data-trade-field="amount" placeholder="0.00" />
        </label>
        <label class="editor-field">
          <span>${escapeHtml(t("trade.price"))}</span>
          <input type="text" inputmode="decimal" data-trade-field="price" placeholder="0.00" />
        </label>
      </div>
      ${sellQuick}
      <div class="editor-grid-2">
        <label class="editor-field">
          <span>${escapeHtml(t("trade.date"))}</span>
          <input type="date" data-trade-field="date" value="${today}" max="${today}" />
        </label>
        <label class="editor-field">
          <span>${escapeHtml(t("trade.fee"))}</span>
          <input type="text" inputmode="decimal" data-trade-field="fee" placeholder="0.00" />
        </label>
      </div>
      <label class="editor-field">
        <span>${escapeHtml(t("trade.notes"))}</span>
        <input type="text" data-trade-field="note" maxlength="140" placeholder="${escapeHtml(t("trade.notesPlaceholder"))}" />
      </label>
      <p class="editor-secondary trade-calc" data-trade-role="preview"></p>
    `;

  const alertBlock = mode === "alert"
    ? `
      <div class="alert-kind" role="group" aria-label="${escapeHtml(t("alertsPanel.kindAria"))}">
        <button type="button" class="alert-kind-chip is-active" data-alert-kind="tp1">TP1</button>
        <button type="button" class="alert-kind-chip" data-alert-kind="tp2">TP2</button>
        <button type="button" class="alert-kind-chip" data-alert-kind="tp3">TP3</button>
        <button type="button" class="alert-kind-chip" data-alert-kind="price">${escapeHtml(t("alertsPanel.kindPrice"))}</button>
      </div>
      <label class="editor-field alert-price-field" hidden>
        <span data-alert-price-label>${escapeHtml(t("alertsPanel.priceLabel"))}</span>
        <input type="text" inputmode="decimal" data-trade-field="alertPrice" placeholder="0.00" />
      </label>
      <div class="alert-tp-suggest" data-alert-suggest hidden></div>
      <p class="editor-secondary" data-alert-hint></p>
    `
    : "";

  const optionsHtml = mode === "alert"
    ? `<option value="${ALERT_SCOPE_ALL}">${escapeHtml(t("alertsPanel.allAssets"))}</option>${options}`
    : options;

  sheet.innerHTML = `
    <div class="editor-backdrop" data-trade-close></div>
    <form class="editor-panel" data-trade-mode="${mode}" role="dialog" aria-modal="true">
      <header class="editor-head">
        <div class="editor-grip" aria-hidden="true"></div>
        <div class="editor-title-row">
          <h2>${escapeHtml(t(titleKey))}</h2>
          <button type="button" class="icon-circle-btn" data-trade-close aria-label="${escapeHtml(t("buttons.close"))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </header>
      <div class="editor-body">
        <label class="editor-field">
          <span>${escapeHtml(t("trade.asset"))}</span>
          <select data-trade-field="rowId">${optionsHtml || `<option value="">--</option>`}</select>
        </label>
        ${amountBlock}
        ${alertBlock}
      </div>
      <footer class="editor-foot">
        <button type="button" class="ghost-btn" data-trade-close>${escapeHtml(t("buttons.cancel"))}</button>
        <button type="submit" class="primary-btn">${escapeHtml(t("trade.confirm"))}</button>
      </footer>
    </form>
  `;

  sheet.hidden = false;
  document.body.classList.add("editor-open");

  const select = sheet.querySelector("[data-trade-field='rowId']");
  if (mode === "alert") {
    if (!preselectRowId && select?.options.length > 1) {
      select.selectedIndex = 1;
    }
    bindAlertSheet(sheet, select);
  }
  const priceInput = sheet.querySelector("[data-trade-field='price']");
  const dateInput = sheet.querySelector("[data-trade-field='date']");
  if (preselectRowId && select?.querySelector(`option[value="${preselectRowId}"]`)) {
    select.value = preselectRowId;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const syncPrice = () => {
    const row = getRowById(select.value);
    if (row && priceInput && !priceInput.value) {
      priceInput.value = row.currentPrice > 0 ? formatEditableNumber(row.currentPrice) : "";
    }
    updateTradePreview(sheet);
  };

  // Autocompletar el precio con el de la FECHA elegida. Si el usuario pone una
  // fecha pasada, se pide el precio histórico de ese día (vía proxy con clave) y
  // se rellena; si es hoy, se usa el precio actual. Cada disparo lleva un token
  // para que, si se cambia la fecha varias veces seguidas, gane el último.
  let histToken = 0;
  const applyPriceForDate = async () => {
    const row = getRowById(select.value);
    if (!row || !priceInput) return;
    const iso = dateInput?.value || todayIso;

    if (iso >= todayIso || !row.coinId) {
      // Hoy (o sin id de moneda): precio actual, sin llamar al histórico.
      if (priceInput.dataset.autofill === "hist") priceInput.value = "";
      delete priceInput.dataset.autofill;
      syncPrice();
      return;
    }

    const token = ++histToken;
    const prev = priceInput.value;
    priceInput.value = "";
    priceInput.placeholder = "…";
    const price = await fetchHistoricalPrice(row.coinId, iso, state.prefs.currency);
    if (token !== histToken) return; // llegó una petición más nueva
    priceInput.placeholder = "";
    if (price != null) {
      priceInput.value = formatEditableNumber(price);
      priceInput.dataset.autofill = "hist";
    } else {
      // Sin dato histórico (falta clave, activo o fecha sin cobertura): se
      // devuelve lo que hubiera y el usuario lo introduce a mano.
      priceInput.value = prev;
      delete priceInput.dataset.autofill;
    }
    updateTradePreview(sheet);
  };

  select?.addEventListener("change", () => {
    if (priceInput) { priceInput.value = ""; delete priceInput.dataset.autofill; }
    applyPriceForDate();
  });
  dateInput?.addEventListener("change", applyPriceForDate);
  syncPrice();

  sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-trade-close]")) {
      closeTradeSheet();
      return;
    }
    // Venta rápida: rellena el importe con un % del valor actual de la posición.
    const pctBtn = event.target.closest("[data-trade-pct]");
    if (pctBtn) {
      const row = getRowById(select.value);
      const price = parseDecimal(priceInput?.value) || (row && row.currentPrice > 0 ? row.currentPrice : 0);
      const held = row ? parseDecimal(row.tokens) : 0;
      const pct = Number(pctBtn.dataset.tradePct) / 100;
      const amountField = sheet.querySelector("[data-trade-field='amount']");
      if (amountField && held > 0 && price > 0) {
        amountField.value = formatEditableNumber(held * pct * price);
        updateTradePreview(sheet);
      }
    }
  });
  sheet.addEventListener("input", () => updateTradePreview(sheet));
  sheet.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    confirmTrade(sheet);
  });
}

function updateTradePreview(sheet) {
  const preview = sheet.querySelector("[data-trade-role='preview']");
  if (!preview) {
    return;
  }
  const mode = sheet.querySelector("form")?.dataset.tradeMode;
  const amount = parseDecimal(sheet.querySelector("[data-trade-field='amount']")?.value);
  const price = parseDecimal(sheet.querySelector("[data-trade-field='price']")?.value);
  const fee = parseDecimal(sheet.querySelector("[data-trade-field='fee']")?.value);
  const row = getRowById(sheet.querySelector("[data-trade-field='rowId']")?.value);
  const symbol = row ? String(row.symbol || row.crypto || "").toUpperCase() : "";
  if (!(amount > 0 && price > 0)) {
    preview.textContent = "";
    return;
  }
  let tokens = amount / price;
  let capped = "";
  const parts = [];
  if (mode === "sell" && row) {
    const held = parseDecimal(row.tokens);
    const invested = parseDecimal(row.investment);
    const avgCost = held > 0 ? invested / held : 0;
    if (tokens > held + 1e-9) {
      tokens = held;
      capped = ` · ${t("trade.sellCapped")}`;
    }
    const pctOfPos = held > 0 ? (tokens / held) * 100 : 0;
    const realized = avgCost > 0 ? tokens * (price - avgCost) - fee : null;
    parts.push(`${t("trade.pctOfPosition")}: <strong>${pctOfPos.toFixed(1)}%</strong>`);
    if (realized != null) {
      parts.push(`${t("trade.realizedEst")}: <strong class="${toneClass(realized)}">${escapeHtml(maskedSignedCurrency(realized))}</strong>`);
    }
  }
  const tokensLine = `${escapeHtml(t("trade.calcTokens"))}: <strong>${escapeHtml(formatNumber(tokens, tokens >= 1 ? 6 : 8))} ${escapeHtml(symbol)}</strong>${escapeHtml(capped)}`;
  preview.innerHTML = [tokensLine, ...parts].join(" · ");
}

function closeTradeSheet() {
  const sheet = document.getElementById("tradeSheet");
  if (!sheet) {
    return;
  }
  // Cancelar deja la operacion original intacta: solo se olvida la edicion.
  state.editingTradeId = null;
  state.editingAlertId = null;
  sheet.classList.add("is-closing");
  window.setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("is-closing");
    sheet.innerHTML = "";
    if (!state.editorRowId) {
      document.body.classList.remove("editor-open");
    }
  }, 200);
}

// Registra una operación estructurada (compra/venta) para PnL realizado
// y analítica de actividad. `realized` solo aplica a ventas.
function recordTrade(entry) {
  state.trades.unshift({
    id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    ...entry
  });
  if (state.trades.length > MAX_TRADES) state.trades.length = MAX_TRADES;
}

// PnL realizado acumulado (suma de las ventas registradas).
function getRealizedPnl() {
  return state.trades.reduce((s, tr) => s + (tr.type === "sell" && Number.isFinite(tr.realized) ? tr.realized : 0), 0);
}

// Agregado mensual de compras/ventas para la analítica de actividad.
function getMonthlyTradeStats(monthsBack = 6) {
  const now = new Date();
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(UI_LOCALES[state.prefs.language] || "es-ES", { month: "short", year: "2-digit" }), buys: 0, sells: 0, buyCount: 0, sellCount: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  state.trades.forEach((tr) => {
    const d = new Date(tr.at);
    const m = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (!m) return;
    if (tr.type === "buy") { m.buys += tr.amount || 0; m.buyCount += 1; }
    else if (tr.type === "sell") { m.sells += tr.amount || 0; m.sellCount += 1; }
  });
  return months;
}

function confirmTrade(sheet) {
  const mode = sheet.querySelector("form").dataset.tradeMode;
  const seleccion = sheet.querySelector("[data-trade-field='rowId']").value;

  // Las alertas se resuelven aparte: pueden no apuntar a una fila concreta
  // ("Todos los activos" y el valor total del portafolio no la tienen).
  if (mode === "alert") {
    confirmAlert(sheet, seleccion);
    return;
  }

  const row = getRowById(seleccion);
  if (!row) {
    return;
  }

  // Entrada única: IMPORTE de dinero. Los tokens se derivan con el precio.
  // Se admite además comisión opcional y fecha de la operación.
  const amount = parseDecimal(sheet.querySelector("[data-trade-field='amount']").value);
  const price = parseDecimal(sheet.querySelector("[data-trade-field='price']").value);
  const fee = parseDecimal(sheet.querySelector("[data-trade-field='fee']")?.value);
  const dateStr = sheet.querySelector("[data-trade-field='date']")?.value;
  const note = String(sheet.querySelector("[data-trade-field='note']")?.value || "").slice(0, 140);
  // Fecha válida (no futura); si falta o es inválida se usa el momento actual.
  let at = Date.now();
  if (dateStr) {
    const parsed = new Date(dateStr + "T12:00:00").getTime();
    if (Number.isFinite(parsed)) at = Math.min(parsed, Date.now());
  }
  if (!(amount > 0)) {
    showToast(t("trade.invalidTitle"), t("trade.invalidText"), "warning");
    return;
  }
  if (!(price > 0)) {
    showToast(t("trade.invalidTitle"), t("trade.invalidPrice"), "warning");
    return;
  }

  // Edicion: se retira la operacion original y se deshace su efecto antes de
  // aplicar la nueva, para que la posicion no acumule las dos.
  if (state.editingTradeId) {
    const indice = state.trades.findIndex((item) => item.id === state.editingTradeId);
    if (indice >= 0) {
      revertTradeEffect(state.trades[indice]);
      state.trades.splice(indice, 1);
    }
    state.editingTradeId = null;
  }

  const curTokens = parseDecimal(row.tokens);
  const curInvestment = parseDecimal(row.investment);

  if (mode === "buy") {
    // Única fuente de verdad de los cálculos: CryptoFinance (finance.js).
    const r = CryptoFinance.buy({ amount, price, fee, curTokens, curInvestment });
    row.tokens = formatEditableNumber(r.newTokens);
    row.investment = formatEditableNumber(r.newInvestment);
    row.entryPrice = r.newTokens > 0 ? formatEditableNumber(r.entryPrice) : "";
    row.derivedField = "";
    if (!row.purchaseDate && dateStr) row.purchaseDate = dateStr;
    recordTrade({ type: "buy", rowId: row.id, symbol: row.symbol || row.crypto, tokens: r.addTokens, price, amount: r.addInvestment, fee, at, note });
    finishTrade(row, t("trade.buySaved", { tokens: formatNumber(r.addTokens, 6), asset: assetDisplayName(row) }));
  } else {
    const r = CryptoFinance.sell({ amount, price, fee, curTokens, curInvestment });
    if (!r.ok) {
      showToast(t("trade.invalidTitle"), t("trade.noPositionsText"), "warning");
      return;
    }
    row.tokens = r.newTokens > 0 ? formatEditableNumber(r.newTokens) : "";
    row.investment = r.newTokens > 0 ? formatEditableNumber(r.newInvestment) : "";
    row.entryPrice = r.newTokens > 0 ? formatEditableNumber(r.entryPrice) : "";
    row.derivedField = "";
    recordTrade({
      type: "sell", rowId: row.id, symbol: row.symbol || row.crypto,
      tokens: r.soldTokens, price, amount: r.grossProceeds, fee, at, note,
      realized: r.realized
    });
    finishTrade(row, t("trade.sellSaved", { tokens: formatNumber(r.soldTokens, 6), asset: assetDisplayName(row) }));
  }
}

function finishTrade(row, message) {
  persistState(true);
  renderAll();
  pushActivity(t("trade.activityTitle"), message, "neutral");
  showToast(t("editor.savedTitle"), message, "positive");
  closeTradeSheet();
  if (state.detailRowId === row.id) {
    renderAssetDetail();
  }
}

/* ═══════════════════════════════════════════════════════
   REGISTRO DE COMPRAS Y VENTAS — lista editable.
   Cada operacion modifico la posicion cuando se creo, asi
   que al borrarla o editarla hay que deshacer su efecto:
   con el modelo de coste medio la vuelta atras es exacta.
   ═══════════════════════════════════════════════════════ */

function renderTradesLog() {
  const box = document.getElementById("tradesLog");
  if (!box) {
    return;
  }
  if (!state.trades.length) {
    box.innerHTML = "";
    return;
  }

  const visibles = state.trades.slice(0, tradesLogLimit);
  box.innerHTML = `
    <h3 class="trades-log-title">${escapeHtml(t("trades.logTitle"))}</h3>
    <ul class="trades-log-list" role="list">
      ${visibles.map((trade) => tradeLogItemHtml(trade)).join("")}
    </ul>
    ${state.trades.length > visibles.length
      ? `<button class="ghost-btn trades-log-more" type="button" data-trades-more>${escapeHtml(t("trades.showMore"))}</button>`
      : ""}
  `;
}

function tradeLogItemHtml(trade) {
  const esCompra = trade.type === "buy";
  const row = getRowById(trade.rowId);
  const nombre = row ? assetDisplayName(row) : (trade.symbol || "--");
  const fecha = new Date(trade.at);
  const tokens = Number.isFinite(trade.tokens) ? formatNumber(trade.tokens, trade.tokens >= 1 ? 4 : 8) : "--";
  const precio = Number.isFinite(trade.price) && trade.price > 0
    ? formatCurrency(trade.price, getPriceDigits(trade.price))
    : "--";
  return `
    <li class="trade-item ${esCompra ? "is-buy" : "is-sell"}" data-trade-id="${escapeHtml(trade.id)}">
      <span class="trade-item-tag">${escapeHtml(esCompra ? t("trades.buy") : t("trades.sell"))}</span>
      <span class="trade-item-main">
        <strong>${escapeHtml(nombre)}</strong>
        <small>${escapeHtml(tokens)} · ${escapeHtml(precio)} · ${escapeHtml(formatDateShort(fecha))}</small>
      </span>
      <span class="trade-item-amount ${esCompra ? "" : "positive"}">${maskedCurrency(trade.amount || 0)}</span>
      <span class="trade-item-actions">
        <button class="icon-circle-btn" type="button" data-trade-edit="${escapeHtml(trade.id)}" aria-label="${escapeHtml(t("buttons.edit"))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="icon-circle-btn" type="button" data-trade-delete="${escapeHtml(trade.id)}" aria-label="${escapeHtml(t("buttons.delete"))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </span>
    </li>
  `;
}

function formatDateShort(date) {
  try {
    return date.toLocaleDateString(UI_LOCALES[state.prefs.language] || "es-ES", { day: "2-digit", month: "short" });
  } catch {
    return "--";
  }
}

// Deshace en la posicion el efecto de una operacion ya registrada.
// Compra: se restan los tokens y el coste que sumo.
// Venta: se devuelven los tokens y su coste de entonces, que se deduce del
// realizado guardado (realizado = tokens * (precio - coste medio) - comision).
function revertTradeEffect(trade) {
  const row = getRowById(trade.rowId);
  if (!row) {
    // La posicion ya no existe: solo se retira el registro.
    return true;
  }
  const curTokens = parseDecimal(row.tokens);
  const curInvestment = parseDecimal(row.investment);
  const tokens = Number.isFinite(trade.tokens) ? trade.tokens : 0;
  let newTokens;
  let newInvestment;

  if (trade.type === "buy") {
    newTokens = Math.max(0, curTokens - tokens);
    newInvestment = Math.max(0, curInvestment - (trade.amount || 0));
  } else {
    const costBasis = Math.max(0, (trade.amount || 0) - (trade.realized || 0) - (trade.fee || 0));
    newTokens = curTokens + tokens;
    newInvestment = curInvestment + costBasis;
  }

  row.tokens = newTokens > 0 ? formatEditableNumber(newTokens) : "";
  row.investment = newTokens > 0 ? formatEditableNumber(newInvestment) : "";
  row.entryPrice = newTokens > 0 ? formatEditableNumber(newInvestment / newTokens) : "";
  row.derivedField = "";
  return true;
}

// Editar = reabrir la hoja de compra/venta con los datos de la operacion.
// Al confirmar se deshace la original y se aplica la nueva, para que la
// posicion no acumule el efecto de las dos.
function openTradeEdit(tradeId) {
  const trade = state.trades.find((item) => item.id === tradeId);
  if (!trade) {
    return;
  }
  if (!getRowById(trade.rowId)) {
    showToast(t("trades.noRowTitle"), t("trades.noRowText"), "warning");
    return;
  }

  state.editingTradeId = tradeId;
  openTradeSheet(trade.type, trade.rowId);

  const sheet = document.getElementById("tradeSheet");
  if (!sheet) {
    return;
  }
  const set = (campo, valor) => {
    const nodo = sheet.querySelector(`[data-trade-field='${campo}']`);
    if (nodo && valor != null && valor !== "") {
      nodo.value = valor;
    }
  };
  set("amount", formatEditableNumber(trade.amount || 0));
  set("price", formatEditableNumber(trade.price || 0));
  if (trade.fee) {
    set("fee", formatEditableNumber(trade.fee));
  }
  set("note", trade.note || "");
  const fecha = new Date(trade.at);
  if (Number.isFinite(fecha.getTime())) {
    set("date", fecha.toISOString().slice(0, 10));
  }
  updateTradePreview(sheet);
}

function deleteTrade(tradeId) {
  const index = state.trades.findIndex((trade) => trade.id === tradeId);
  if (index < 0) {
    return;
  }
  const trade = state.trades[index];
  const row = getRowById(trade.rowId);
  const nombre = row ? assetDisplayName(row) : (trade.symbol || "--");
  const aviso = t("trades.confirmDelete", {
    tipo: trade.type === "buy" ? t("trades.buy") : t("trades.sell"),
    asset: nombre,
    amount: formatCurrency(trade.amount || 0)
  });
  if (!window.confirm(aviso)) {
    return;
  }

  revertTradeEffect(trade);
  state.trades.splice(index, 1);
  persistState(true);
  renderAll();
  pushActivity(t("trades.deletedTitle"), aviso, "neutral");
  showToast(t("trades.deletedTitle"), t("trades.deletedText"), "positive");
}
