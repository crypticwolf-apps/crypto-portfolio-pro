// =============================================================================
// mercados.js - Ranking general de mercado: descarga, limpieza (sin wrapped ni
// monedas sin volumen), ordenacion y tarjetas.
// =============================================================================

// Blocklist de activos que no aportan a una tabla general de mercado:
// stablecoins y derivados envueltos/tokenizados/con staking líquido.
const WRAPPED_SYMBOLS = new Set([
  "WBTC", "WETH", "WEETH", "WSTETH", "STETH", "RETH", "CBETH", "WBETH",
  "SWETH", "OSETH", "ANKRETH", "SFRXETH", "FRXETH", "MSOL", "JITOSOL",
  "BSOL", "WBNB", "WMATIC", "WAVAX", "WHYPE", "SOLVBTC", "LBTC", "CBBTC",
  "TBTC", "RENBTC", "BNSOL", "SUSDE", "SUSDS", "SDAI", "BUIDL", "USDY"
]);
const WRAPPED_NAME_RE = /wrapped|staked|restaked|liquid staking|tokenized|bridged|\bheloc\b|treasury|t-?bill|money market|savings dai/i;

// Volumen 24h mínimo (en moneda base) para considerar un activo con liquidez real.
const MARKETS_MIN_VOLUME = 1000000;
// Capitalización mínima: descarta micro-caps irrelevantes para una tabla general.
const MARKETS_MIN_CAP = 10000000;

// Sanea una variación %: descarta valores no finitos o desorbitados (glitches de
// datos de tokens recién listados, p. ej. +112.000.000%), que se muestran como "--".
function saneChangePct(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 100000 ? n : NaN;
}

// ¿El activo es relevante para la tabla general de mercado?
function isRelevantMarketCoin(c) {
  if (!c) return false;
  if (!(Number(c.price) > 0)) return false;                 // sin precio real
  if (!(Number(c.marketCap) >= MARKETS_MIN_CAP)) return false; // sin capitalización válida/relevante
  if (!(Number(c.volume) >= MARKETS_MIN_VOLUME)) return false; // volumen nulo/insignificante
  const symbol = String(c.symbol || "").toUpperCase();
  if (STABLE_SYMBOLS.has(symbol)) return false;             // stablecoins
  if (WRAPPED_SYMBOLS.has(symbol)) return false;            // envueltos / staking líquido
  if (WRAPPED_NAME_RE.test(String(c.name || ""))) return false; // nombres engañosos/tokenizados
  return true;
}

// Lista depurada: relevantes, sin duplicados por símbolo (se queda el de mayor cap).
function getCleanMarketsList() {
  const seen = new Map();
  for (const c of state.marketsList) {
    if (!isRelevantMarketCoin(c)) continue;
    const key = String(c.symbol || c.id).toUpperCase();
    const prev = seen.get(key);
    if (!prev || (Number(c.marketCap) || 0) > (Number(prev.marketCap) || 0)) {
      seen.set(key, c);
    }
  }
  return [...seen.values()];
}

// Top por capitalización (CoinGecko /coins/markets). Network-first con
// caché en localStorage (TTL 5 min) y sin peticiones simultáneas.
async function fetchTopMarkets(force = false) {
  if (state.marketsLoading) {
    return;
  }
  const fresh = Date.now() - state.marketsListAt < MARKETS_LIST_TTL;
  if (!force && fresh && state.marketsList.length) {
    return;
  }
  if (isOffline()) {
    return;
  }

  state.marketsLoading = true;
  renderMarketsRanking();
  try {
    const currency = state.prefs.currency;
    // 250 activos, con variación 1h/24h/7d, sparkline 7d y máximo histórico.
    const url = `${COINGECKO_BASE}coins/markets?vs_currency=${encodeURIComponent(currency)}&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
    const payload = await fetchJson(url);
    const rows = Array.isArray(payload) ? payload : [];
    if (rows.length && !payload.__swFallback) {
      state.marketsList = rows.map((item) => ({
        id: item.id,
        symbol: String(item.symbol || "").toUpperCase(),
        name: item.name,
        image: item.image || "",
        price: Number(item.current_price),
        change1h: saneChangePct(item.price_change_percentage_1h_in_currency),
        change24h: saneChangePct(item.price_change_percentage_24h_in_currency ?? item.price_change_percentage_24h),
        change7d: saneChangePct(item.price_change_percentage_7d_in_currency),
        marketCap: Number(item.market_cap),
        volume: Number(item.total_volume),
        rank: Number(item.market_cap_rank),
        ath: Number(item.ath),
        athChangePct: saneChangePct(item.ath_change_percentage),
        spark: Array.isArray(item.sparkline_in_7d?.price) ? item.sparkline_in_7d.price : null
      }));
      state.marketsListAt = Date.now();
      state.marketsListCurrency = currency;
      persistMarketsList();
    }
  } catch {
    // Sin red o límite: se conserva la última lista cacheada.
  } finally {
    state.marketsLoading = false;
    if (state.prefs.activeTab === "markets") {
      renderMarketsRanking();
    }
  }
}

function persistMarketsList() {
  try {
    localStorage.setItem(MARKETS_LIST_KEY, JSON.stringify({
      at: state.marketsListAt,
      currency: state.marketsListCurrency,
      coins: state.marketsList
    }));
  } catch {
    // Cuota: la lista sigue en memoria durante la sesión.
  }
}

function loadMarketsListCache() {
  const cached = safeParse(localStorage.getItem(MARKETS_LIST_KEY));
  if (cached && Array.isArray(cached.coins) && cached.currency === state.prefs.currency) {
    state.marketsList = cached.coins;
    state.marketsListAt = Number(cached.at) || 0;
    state.marketsListCurrency = cached.currency;
  }
}

// Vista de la tabla: lista depurada + búsqueda + orden por columna.
function getMarketsView() {
  const query = normalizeSearchText(state.marketsQuery || "");
  let list = getCleanMarketsList();
  if (query) {
    list = list.filter((c) =>
      normalizeSearchText(c.name).includes(query) || normalizeSearchText(c.symbol).includes(query)
    );
  }
  const { key, dir } = state.marketsSort || { key: "marketCap", dir: "desc" };
  return sortMarketsList(list, key, dir);
}

// Ordena por la clave indicada; los valores no numéricos van siempre al final.
function sortMarketsList(list, key, dir) {
  const s = dir === "asc" ? 1 : -1;
  const arr = [...list];
  arr.sort((a, b) => {
    if (key === "asset") {
      return s * String(a.name || "").localeCompare(String(b.name || ""), "es");
    }
    const av = a[key];
    const bv = b[key];
    const aok = Number.isFinite(av);
    const bok = Number.isFinite(bv);
    if (!aok && !bok) return 0;
    if (!aok) return 1;
    if (!bok) return -1;
    return s * (av - bv);
  });
  return arr;
}

// Mini-gráfico de rendimiento (sparkline de 7 días) coloreado por tendencia.
function marketSparkline(spark, tone) {
  if (!Array.isArray(spark) || spark.length < 2) {
    return `<span class="mk-spark-empty">--</span>`;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of spark) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const W = 80;
  const H = 24;
  const step = W / (spark.length - 1);
  const points = spark
    .map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(" ");
  return `<svg class="mk-spark ${tone}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>`;
}

// Etiquetas de las columnas/criterios ordenables (compartidas escritorio+móvil).
const MARKET_SORT_KEYS = [
  { key: "marketCap", labelKey: "markets.colCap" },
  { key: "price", labelKey: "markets.colPrice" },
  { key: "change1h", labelKey: "markets.col1h" },
  { key: "change24h", labelKey: "markets.col24h" },
  { key: "change7d", labelKey: "markets.col7d" },
  { key: "volume", labelKey: "markets.colVol" },
  { key: "athChangePct", labelKey: "markets.colAthDist" }
];

function renderMarketsRanking() {
  const box = document.getElementById("marketsRanking");
  const pag = document.getElementById("marketsPagination");
  const loadMore = document.getElementById("marketsLoadMore");
  const sortBox = document.getElementById("marketsMobileSort");
  if (!box) {
    return;
  }
  renderMarketsMobileSort(sortBox);
  renderMarketsMeta();

  if (!state.marketsList.length) {
    box.innerHTML = state.marketsLoading
      ? `<div class="markets-skeleton">${Array.from({ length: 8 }).map(() => '<span class="skeleton-line w70"></span>').join("")}</div>`
      : `<div class="detail-empty">${escapeHtml(isOffline() ? t("status.offlineMeta") : t("home.noData"))}</div>`;
    if (pag) pag.innerHTML = "";
    if (loadMore) loadMore.innerHTML = "";
    return;
  }

  const view = getMarketsView();
  const ownedIds = new Set(state.rows.map((r) => r.coinId).filter(Boolean));

  if (!view.length) {
    box.innerHTML = `<div class="detail-empty">${escapeHtml(t("markets.noResults"))}</div>`;
    if (pag) pag.innerHTML = "";
    if (loadMore) loadMore.innerHTML = "";
    return;
  }

  // ── Escritorio: tabla paginada ──
  const totalPages = Math.max(1, Math.ceil(view.length / MARKETS_PAGE_SIZE));
  if (state.marketsPage > totalPages) {
    state.marketsPage = 1;
  }
  const start = (state.marketsPage - 1) * MARKETS_PAGE_SIZE;
  const pageItems = view.slice(start, start + MARKETS_PAGE_SIZE);

  const { key: sortKey, dir: sortDir } = state.marketsSort;
  const arrow = sortDir === "asc" ? "▲" : "▼";
  const th = (label, key, cls) => {
    const active = key === sortKey;
    return `<th class="${cls} mk-sortable${active ? " is-sorted" : ""}" data-market-sort="${key}"${active ? ` aria-sort="${sortDir === "asc" ? "ascending" : "descending"}"` : ""}><span>${escapeHtml(label)}${active ? ` <em class="mk-arrow">${arrow}</em>` : ""}</span></th>`;
  };
  const tableRows = pageItems.map((c) => {
    const tone1 = toneClass(c.change1h);
    const tone24 = toneClass(c.change24h);
    const tone7 = toneClass(c.change7d);
    const perfTone = Number.isFinite(c.change7d) ? tone7 : tone24;
    // Distancia al máximo histórico (ath_change_percentage es negativo o 0).
    const athDist = Number.isFinite(c.athChangePct) ? c.athChangePct : null;
    return `
    <tr class="mk-row" data-market-coin="${escapeHtml(c.id)}" tabindex="0">
      <td class="mk-rank">${Number.isFinite(c.rank) ? c.rank : "–"}</td>
      <td class="mk-asset">
        <span class="asset-avatar">${c.image ? `<img src="${escapeHtml(c.image)}" alt="" width="28" height="28" loading="lazy" />` : `<span>${escapeHtml(c.symbol.slice(0, 3))}</span>`}</span>
        <span class="mk-name"><strong>${escapeHtml(c.name)}${ownedIds.has(c.id) ? ' <em class="rank-owned">●</em>' : ""}</strong><small>${escapeHtml(c.symbol)}</small></span>
      </td>
      <td class="mk-price num">${escapeHtml(formatCurrency(c.price, getPriceDigits(c.price)))}</td>
      <td class="mk-1h num ${tone1}">${Number.isFinite(c.change1h) ? formatSignedPercent(c.change1h) : "--"}</td>
      <td class="mk-24 num ${tone24}">${Number.isFinite(c.change24h) ? formatSignedPercent(c.change24h) : "--"}</td>
      <td class="mk-7d num ${tone7}">${Number.isFinite(c.change7d) ? formatSignedPercent(c.change7d) : "--"}</td>
      <td class="mk-cap num">${Number.isFinite(c.marketCap) ? formatCompactCurrency(c.marketCap) : "--"}</td>
      <td class="mk-vol num">${Number.isFinite(c.volume) ? formatCompactCurrency(c.volume) : "--"}</td>
      <td class="mk-ath num" title="${Number.isFinite(c.ath) ? escapeHtml(formatCurrency(c.ath, getPriceDigits(c.ath))) : ""}">${athDist != null ? formatSignedPercent(athDist) : "--"}</td>
      <td class="mk-perf">${marketSparkline(c.spark, perfTone)}</td>
    </tr>`;
  }).join("");

  // ── Móvil: tarjetas con "Cargar más" (misma vista ordenada) ──
  const mobileCount = Math.min(state.marketsMobileLimit, view.length);
  const mobileItems = view.slice(0, mobileCount);
  const cards = mobileItems.map((c) => marketCardHtml(c, ownedIds)).join("");

  box.innerHTML = `
    <div class="markets-table-wrap market-desktop-table">
      <table class="markets-table">
        <thead>
          <tr>
            <th class="mk-rank">#</th>
            ${th(t("markets.colAsset"), "asset", "mk-asset")}
            ${th(t("markets.colPrice"), "price", "mk-price")}
            ${th(t("markets.col1h"), "change1h", "mk-1h")}
            ${th(t("markets.col24h"), "change24h", "mk-24")}
            ${th(t("markets.col7d"), "change7d", "mk-7d")}
            ${th(t("markets.colCap"), "marketCap", "mk-cap")}
            ${th(t("markets.colVol"), "volume", "mk-vol")}
            ${th(t("markets.colAthDist"), "athChangePct", "mk-ath")}
            <th class="mk-perf">${escapeHtml(t("markets.colPerf"))}</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="market-mobile-list">${cards}</div>`;

  // Paginación de escritorio.
  if (pag) {
    pag.innerHTML = totalPages <= 1 ? "" : `
      <button class="pag-btn" type="button" data-markets-page="prev" ${state.marketsPage <= 1 ? "disabled" : ""} aria-label="${escapeHtml(t("markets.prevPage"))}">‹</button>
      <span class="pag-info">${state.marketsPage} / ${totalPages}</span>
      <button class="pag-btn" type="button" data-markets-page="next" ${state.marketsPage >= totalPages ? "disabled" : ""} aria-label="${escapeHtml(t("markets.nextPage"))}">›</button>`;
  }
  // "Cargar más" de móvil.
  if (loadMore) {
    loadMore.innerHTML = mobileCount < view.length
      ? `<button class="ghost-btn markets-loadmore-btn" type="button" data-markets-loadmore>${escapeHtml(t("markets.loadMore"))} (${mobileCount}/${view.length})</button>`
      : "";
  }
}

// Tarjeta de mercado para móvil: cabecera compacta + detalle desplegable.
// Cerrada muestra lo esencial (ranking, logo, nombre, precio, 24h, cap).
// Al tocar se despliega el resto (1h, 7d, volumen, ATH y distancia).
function marketCardHtml(c, ownedIds) {
  const tone24 = toneClass(c.change24h);
  const tone1 = toneClass(c.change1h);
  const tone7 = toneClass(c.change7d);
  const owned = ownedIds.has(c.id);
  const expanded = state.expandedMarket.has(c.id);
  const bodyId = `mmc-${c.id}`;
  const athDist = Number.isFinite(c.athChangePct) ? formatSignedPercent(c.athChangePct) : "--";
  const athPrice = Number.isFinite(c.ath) ? formatCurrency(c.ath, getPriceDigits(c.ath)) : "--";
  return `
    <div class="market-mobile-item ${expanded ? "is-expanded" : ""}" data-market-card="${escapeHtml(c.id)}">
      <button class="mmi-head" type="button" data-market-toggle="${escapeHtml(c.id)}" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${bodyId}">
        <span class="mmi-rank">${Number.isFinite(c.rank) ? "#" + c.rank : "–"}</span>
        <span class="asset-avatar">${c.image ? `<img src="${escapeHtml(c.image)}" alt="" width="30" height="30" loading="lazy" />` : `<span>${escapeHtml(c.symbol.slice(0, 3))}</span>`}</span>
        <span class="mmi-id"><strong>${escapeHtml(c.name)}${owned ? ' <em class="rank-owned">●</em>' : ""}</strong><small>${escapeHtml(c.symbol)}</small></span>
        <span class="mmi-main">
          <strong class="num">${escapeHtml(formatCurrency(c.price, getPriceDigits(c.price)))}</strong>
          <span class="num ${tone24}">${Number.isFinite(c.change24h) ? formatSignedPercent(c.change24h) : "--"} · ${Number.isFinite(c.marketCap) ? formatCompactCurrency(c.marketCap) : "--"}</span>
        </span>
        <svg class="mmi-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="mmi-body" id="${bodyId}">
        <div class="mmi-body-inner">
          <dl class="mmi-grid">
            <div><dt>${escapeHtml(t("markets.col1h"))}</dt><dd class="num ${tone1}">${Number.isFinite(c.change1h) ? formatSignedPercent(c.change1h) : "--"}</dd></div>
            <div><dt>${escapeHtml(t("markets.col7d"))}</dt><dd class="num ${tone7}">${Number.isFinite(c.change7d) ? formatSignedPercent(c.change7d) : "--"}</dd></div>
            <div><dt>${escapeHtml(t("markets.colVol"))}</dt><dd class="num">${Number.isFinite(c.volume) ? formatCompactCurrency(c.volume) : "--"}</dd></div>
            <div><dt>${escapeHtml(t("markets.ath"))}</dt><dd class="num">${escapeHtml(athPrice)}</dd></div>
            <div><dt>${escapeHtml(t("markets.colAthDist"))}</dt><dd class="num ${toneClass(c.athChangePct)}">${athDist}</dd></div>
          </dl>
          <button class="ghost-btn mmi-open" type="button" data-market-open="${escapeHtml(c.id)}">${escapeHtml(owned ? t("markets.openDetail") : t("markets.addToPortfolio"))}</button>
        </div>
      </div>
    </div>`;
}

// Control de orden para móvil (mismos criterios y estado que las cabeceras).
function renderMarketsMobileSort(sortBox) {
  if (!sortBox) return;
  const { key, dir } = state.marketsSort || { key: "marketCap", dir: "desc" };
  const options = MARKET_SORT_KEYS
    .map((o) => `<option value="${o.key}" ${o.key === key ? "selected" : ""}>${escapeHtml(t(o.labelKey))}</option>`)
    .join("");
  sortBox.innerHTML = `
    <label class="mms-field" for="marketsSortSelect">
      <span>${escapeHtml(t("table.sortBy"))}</span>
      <select id="marketsSortSelect">${options}</select>
    </label>
    <button type="button" class="ghost-btn mms-dir" id="marketsSortDir" aria-label="${escapeHtml(dir === "desc" ? t("table.sortDesc") : t("table.sortAsc"))}" title="${escapeHtml(dir === "desc" ? t("table.sortDesc") : t("table.sortAsc"))}">${dir === "desc" ? "↓" : "↑"}</button>`;
}

// Barra de estado del mercado: última sincronización, aviso de caché y
// botón de actualización manual (no bloquea la pantalla).
function renderMarketsMeta() {
  const box = document.getElementById("marketsMeta");
  if (!box) return;
  const hasData = state.marketsList.length > 0;
  const cached = hasData && state.marketsListAt > 0 && (Date.now() - state.marketsListAt >= MARKETS_LIST_TTL);
  let syncText;
  if (state.marketsLoading) syncText = t("status.syncing");
  else if (state.marketsListAt) syncText = t("markets.lastSync", { time: formatRelativeTime(state.marketsListAt) });
  else syncText = t("status.syncManual");
  const cachedNote = cached && !state.marketsLoading ? ` · ${t("markets.cached")}` : "";
  box.innerHTML = `
    <span class="mm-sync ${cached && !state.marketsLoading ? "is-cached" : ""}">${escapeHtml(syncText)}${escapeHtml(cachedNote)}</span>
    <button class="ghost-btn markets-refresh-btn" type="button" id="marketsRefreshBtn" ${state.marketsLoading ? "disabled" : ""}>
      ${escapeHtml(state.marketsLoading ? t("status.syncing") : t("markets.refresh"))}
    </button>`;
}

function toggleMarketCard(coinId, toggleBtn) {
  const card = document.querySelector(`.market-mobile-item[data-market-card="${coinId}"]`);
  if (!card) return;
  const expanded = card.classList.toggle("is-expanded");
  if (expanded) state.expandedMarket.add(coinId);
  else state.expandedMarket.delete(coinId);
  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function setMarketsSort(key, dir) {
  const cur = state.marketsSort || { key: "marketCap", dir: "desc" };
  state.marketsSort = key
    ? { key, dir: dir || (cur.key === key ? (cur.dir === "asc" ? "desc" : "asc") : (key === "asset" ? "asc" : "desc")) }
    : { key: cur.key, dir };
  state.marketsPage = 1;
  renderMarketsRanking();
}

function bindMarkets() {
  const search = document.getElementById("marketsSearchInput");
  if (search) {
    search.addEventListener("input", (event) => {
      state.marketsQuery = event.target.value;
      state.marketsPage = 1;
      state.marketsMobileLimit = 20;
      renderMarketsRanking();
    });
  }
  const pag = document.getElementById("marketsPagination");
  if (pag) {
    pag.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-markets-page]");
      if (!btn) return;
      state.marketsPage += btn.dataset.marketsPage === "next" ? 1 : -1;
      renderMarketsRanking();
      document.getElementById("marketsRanking")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  // Cargar más (móvil).
  const loadMore = document.getElementById("marketsLoadMore");
  if (loadMore) {
    loadMore.addEventListener("click", (event) => {
      if (event.target.closest("[data-markets-loadmore]")) {
        state.marketsMobileLimit += 20;
        renderMarketsRanking();
      }
    });
  }
  // Actualización manual (no bloquea la pantalla; conserva datos previos).
  const meta = document.getElementById("marketsMeta");
  if (meta) {
    meta.addEventListener("click", (event) => {
      if (event.target.closest("#marketsRefreshBtn")) {
        fetchTopMarkets(true);
      }
    });
  }
  // Control de orden móvil (delegado, el contenido se re-renderiza).
  const sortBox = document.getElementById("marketsMobileSort");
  if (sortBox) {
    sortBox.addEventListener("change", (event) => {
      if (event.target.id === "marketsSortSelect") {
        // Cambiar de criterio arranca en descendente (numérico).
        setMarketsSort(event.target.value, "desc");
      }
    });
    sortBox.addEventListener("click", (event) => {
      if (event.target.closest("#marketsSortDir")) {
        const cur = state.marketsSort;
        setMarketsSort(cur.key, cur.dir === "asc" ? "desc" : "asc");
      }
    });
  }
  const ranking = document.getElementById("marketsRanking");
  if (ranking) {
    ranking.addEventListener("click", (event) => {
      // Orden por columna (escritorio): alterna asc/desc en la columna pulsada.
      const sortCell = event.target.closest("[data-market-sort]");
      if (sortCell) {
        setMarketsSort(sortCell.dataset.marketSort);
        return;
      }
      // Móvil: abrir/añadir desde el botón del detalle desplegado.
      const openBtn = event.target.closest("[data-market-open]");
      if (openBtn) {
        handleMarketCoinTap(openBtn.dataset.marketOpen);
        return;
      }
      // Móvil: desplegar/plegar la tarjeta.
      const toggle = event.target.closest("[data-market-toggle]");
      if (toggle) {
        toggleMarketCard(toggle.dataset.marketToggle, toggle);
        return;
      }
      // Escritorio: tocar la fila abre el detalle o añade el activo.
      const coinRow = event.target.closest("[data-market-coin]");
      if (coinRow) {
        handleMarketCoinTap(coinRow.dataset.marketCoin);
      }
    });
    ranking.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const coinRow = event.target.closest("[data-market-coin]");
      if (coinRow) {
        event.preventDefault();
        handleMarketCoinTap(coinRow.dataset.marketCoin);
      }
    });
  }
}

// Tocar una moneda del ranking: si está en cartera abre su detalle; si no,
// ofrece añadirla al portafolio (crea posición precargada y abre el editor).
function handleMarketCoinTap(coinId) {
  const owned = state.rows.find((r) => r.coinId === coinId);
  if (owned) {
    openAssetDetail(owned.id);
    return;
  }
  const coin = state.marketsList.find((c) => c.id === coinId);
  if (!coin) {
    return;
  }
  if (!window.confirm(t("markets.addConfirm", { asset: coin.name }))) {
    return;
  }
  const row = createRow({
    crypto: coin.symbol || coin.name,
    coinId: coin.id,
    resolvedName: coin.name,
    symbol: coin.symbol,
    image: coin.image,
    currentPrice: coin.price,
    priceChange24h: coin.change24h,
    marketCap: coin.marketCap,
    marketCapRank: coin.rank,
    priceStatus: "success",
    lastPriceAt: new Date().toISOString()
  });
  state.rows.push(row);
  renderAll();
  scheduleAutosave();
  pushActivity(t("alerts.newPositionTitle"), t("markets.addedText", { asset: coin.name }), "neutral");
  setActiveTab("home");
  openPositionEditor(row.id);
}
