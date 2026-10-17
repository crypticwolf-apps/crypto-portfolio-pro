// =============================================================================
// envivo.js - Precios en tiempo real: WebSocket de Binance con Kraken de
// respaldo, y GeckoTerminal para tokens DEX que ningun exchange lista.
// Precedencia: WebSocket > GeckoTerminal > CoinGecko.
// =============================================================================

/* ═══════════════════════════════════════════════════════
   PRECIOS EN VIVO — WebSocket publico de Binance con Kraken
   de reserva. Solo lectura y sin claves: son streams abiertos.
   El feed adelanta precio y variacion de 24h; CoinGecko sigue
   mandando en capitalizacion, ranking, historico y en los
   activos que ningun exchange lista.
   ═══════════════════════════════════════════════════════ */

// Simbolo de exchange de una fila (BTC, ETH...). null si no procede:
// filas sin resolver y estables, cuyo par contra USDT no aporta nada.
function liveSymbolOf(row) {
  // Un token de billetera sin id de CoinGecko no se cotiza por simbolo: solo
  // por su contrato (un "ETH" falso no puede recibir el precio de ETH).
  if (isDexOnlyRow(row)) {
    return null;
  }
  const raw = String(row?.symbol || "").trim().toUpperCase();
  if (!raw || raw.length > 12) {
    return null;
  }
  const symbol = LIVE_SYMBOL_ALIASES[raw] || raw;
  if (LIVE_SKIP_SYMBOLS.has(symbol)) {
    return null;
  }
  return /^[A-Z0-9]+$/.test(symbol) ? symbol : null;
}

// Simbolos unicos del portafolio, en el orden en que aparecen y con tope.
function liveWantedSymbols() {
  const seen = [];
  state.rows.forEach((row) => {
    const symbol = liveSymbolOf(row);
    if (symbol && !seen.includes(symbol)) {
      seen.push(symbol);
    }
  });
  return seen.slice(0, LIVE_MAX_STREAMS);
}

// Conversion USD -> moneda base. Los pares del feed cotizan contra USDT/USD,
// asi que en euros hace falta el cambio ya cacheado; sin el no se arranca el
// feed (mejor el precio de CoinGecko que una cifra convertida a ojo).
function liveConversionRate() {
  const currency = String(state.prefs.currency || "usd").toLowerCase();
  if (currency === "usd") {
    return 1;
  }
  const rate = getCachedCurrencyConversionRate("usd", currency);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function readLivePairsCache() {
  const parsed = safeParse(localStorage.getItem(LIVE_PAIRS_CACHE_KEY));
  if (!parsed || !Array.isArray(parsed.pairs)) {
    return null;
  }
  if (Date.now() - Number(parsed.at || 0) > LIVE_PAIRS_TTL) {
    return null;
  }
  return new Set(parsed.pairs);
}

// Pares USDT que Binance lista de verdad. Una sola llamada al dia: sin esta
// comprobacion un simbolo inexistente tumbaria la conexion entera.
async function loadBinancePairs() {
  if (state.live.knownPairs) {
    return state.live.knownPairs;
  }
  const cached = readLivePairsCache();
  if (cached && cached.size) {
    state.live.knownPairs = cached;
    return cached;
  }

  const response = await fetchJsonDirect(LIVE_BINANCE_PAIRS_URL, 8000);
  const pairs = (Array.isArray(response) ? response : [])
    .map((item) => String(item?.symbol || ""))
    .filter((symbol) => symbol.endsWith("USDT"));
  if (!pairs.length) {
    throw new Error("sin pares");
  }

  const set = new Set(pairs);
  state.live.knownPairs = set;
  try {
    localStorage.setItem(LIVE_PAIRS_CACHE_KEY, JSON.stringify({ at: Date.now(), pairs }));
  } catch {
    // Sin espacio en localStorage: se sigue con la lista en memoria.
  }
  return set;
}

function setLiveStatus(status, provider = state.live.provider) {
  state.live.status = status;
  state.live.provider = status === "off" ? null : provider;
  renderLiveIndicator();
  // Si el panel de diagnostico esta a la vista, que refleje el cambio al
  // momento: es donde se mira cuando los precios no llegan.
  if (state.prefs.activeTab === "more") {
    renderDiagnostics();
  }
}

// Etiqueta del proveedor tal y como se muestra al usuario.
function liveProviderLabel() {
  return state.live.provider === "kraken" ? "Kraken" : "Binance";
}

function isLiveActive() {
  return state.live.status === "live";
}

// ── Ciclo de vida de la conexion ──

function startLivePrices() {
  if (!state.prefs.livePrices || isOffline() || typeof WebSocket !== "function") {
    return;
  }
  if (document.visibilityState === "hidden") {
    return;
  }
  if (state.live.socket || state.live.reconnectTimer) {
    return;
  }
  if (!liveWantedSymbols().length) {
    return;
  }
  // En euros hace falta el cambio cacheado; si no esta, se pide y se reintenta.
  if (liveConversionRate() === null) {
    fetchCurrencyConversionRate("usd", state.prefs.currency)
      .then(() => startLivePrices())
      .catch(() => {});
    return;
  }
  openLiveSocket(state.live.triedBinance && state.live.provider === "kraken" ? "kraken" : "binance");
  startDexPolling();
}

function stopLivePrices() {
  const live = state.live;
  window.clearTimeout(live.handshakeTimer);
  window.clearTimeout(live.reconnectTimer);
  window.clearTimeout(live.flushTimer);
  live.handshakeTimer = null;
  live.reconnectTimer = null;
  live.flushTimer = null;
  live.pending.clear();

  const socket = live.socket;
  live.socket = null;
  if (socket) {
    // Se desarman los manejadores antes de cerrar: un onclose tardio no debe
    // disparar la reconexion de una conexion que ya hemos descartado.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Cerrar un socket que aun negocia lanza en algunos navegadores.
    }
  }
  live.pairs = [];
  live.symbols = [];
  live.covered = [];
  stopDexPolling();
  setLiveStatus("off");
}

// Recalcula la suscripcion: solo reconecta si la lista de simbolos cambio.
function syncLivePrices() {
  if (!state.prefs.livePrices) {
    if (state.live.status !== "off") {
      stopLivePrices();
    }
    return;
  }
  const wanted = liveWantedSymbols();
  const current = state.live.symbols;
  const same = wanted.length === current.length && wanted.every((symbol, i) => symbol === current[i]);
  if (state.live.socket && same) {
    return;
  }
  stopLivePrices();
  startLivePrices();
}

function openLiveSocket(provider) {
  const symbols = liveWantedSymbols();
  if (!symbols.length) {
    return;
  }

  if (provider === "binance") {
    state.live.triedBinance = true;
    loadBinancePairs()
      .then((known) => {
        const pairs = symbols.map((symbol) => `${symbol}USDT`).filter((pair) => known.has(pair));
        if (!pairs.length) {
          // Ningun activo del portafolio cotiza en Binance: se prueba Kraken.
          openLiveSocket("kraken");
          return;
        }
        const streams = pairs.map((pair) => `${pair.toLowerCase()}@miniTicker`).join("/");
        connectLiveSocket("binance", `${LIVE_BINANCE_WS}?streams=${streams}`, symbols, pairs);
      })
      .catch(() => {
        // Binance no responde (bloqueo regional o corte): se pasa a Kraken.
        openLiveSocket("kraken");
      });
    return;
  }

  connectLiveSocket("kraken", LIVE_KRAKEN_WS, symbols, symbols.map((symbol) => `${symbol}/USD`));
}

function connectLiveSocket(provider, url, symbols, pairs) {
  let socket;
  try {
    socket = new WebSocket(url);
  } catch {
    handleLiveFailure(provider);
    return;
  }

  const live = state.live;
  live.socket = socket;
  live.symbols = symbols;
  live.pairs = pairs;
  // Simbolos que este proveedor sirve realmente: en Binance son los pares
  // que existen, no todos los del portafolio.
  live.covered = provider === "binance"
    ? pairs.map((pair) => pair.replace(/USDT$/, ""))
    : pairs.map((pair) => pair.split("/")[0]);
  setLiveStatus("connecting", provider);

  // Si no llega un solo dato en el plazo, el proveedor no sirve.
  window.clearTimeout(live.handshakeTimer);
  live.handshakeTimer = window.setTimeout(() => {
    if (live.socket === socket && live.status !== "live") {
      handleLiveFailure(provider);
    }
  }, LIVE_HANDSHAKE_MS);

  socket.onopen = () => {
    if (provider === "kraken") {
      // Kraken v2 responde a cada par por separado: los que no existen
      // devuelven success:false y no tumban el resto de la suscripcion.
      socket.send(JSON.stringify({
        method: "subscribe",
        params: { channel: "ticker", symbol: pairs }
      }));
    }
  };

  socket.onmessage = (event) => {
    if (live.socket !== socket) {
      return;
    }
    handleLiveMessage(provider, event.data);
  };

  socket.onerror = () => {
    if (live.socket === socket) {
      handleLiveFailure(provider);
    }
  };

  socket.onclose = () => {
    if (live.socket === socket) {
      handleLiveFailure(provider);
    }
  };
}

// Un fallo antes del primer dato descarta el proveedor y prueba el otro; si
// ya estaba sirviendo, se reconecta con el mismo y espera creciente.
function handleLiveFailure(provider) {
  const live = state.live;
  const wasLive = live.status === "live";
  const socket = live.socket;
  live.socket = null;
  window.clearTimeout(live.handshakeTimer);
  live.handshakeTimer = null;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Ya estaba cerrandose.
    }
  }

  if (!state.prefs.livePrices || isOffline() || document.visibilityState === "hidden") {
    setLiveStatus("off");
    return;
  }

  live.covered = [];
  const nextProvider = wasLive ? provider : provider === "binance" ? "kraken" : "binance";
  if (!wasLive && provider === "kraken") {
    // Los dos proveedores han fallado: se deja de insistir de inmediato y se
    // reintenta con espera larga; CoinGecko sigue dando precios mientras.
    live.retries += 1;
  } else if (wasLive) {
    live.retries = 0;
  }

  setLiveStatus("retry", nextProvider);
  const delay = Math.min(LIVE_RECONNECT_BASE * 2 ** live.retries, LIVE_RECONNECT_MAX);
  window.clearTimeout(live.reconnectTimer);
  live.reconnectTimer = window.setTimeout(() => {
    live.reconnectTimer = null;
    if (!wasLive) {
      live.retries += 1;
    }
    openLiveSocket(nextProvider);
  }, wasLive ? LIVE_RECONNECT_BASE : delay);
}

function handleLiveMessage(provider, raw) {
  const payload = safeParse(raw);
  if (!payload) {
    return;
  }

  if (provider === "binance") {
    const data = payload.data || payload;
    if (data?.e !== "24hrMiniTicker") {
      return;
    }
    const pair = String(data.s || "");
    if (!pair.endsWith("USDT")) {
      return;
    }
    const price = Number(data.c);
    const open = Number(data.o);
    applyLiveTick(pair.slice(0, -4), {
      price,
      changePct: open > 0 ? ((price - open) / open) * 100 : null,
      high24h: finiteOrNull(data.h),
      low24h: finiteOrNull(data.l),
      volume24h: finiteOrNull(data.q),
      source: "binance"
    });
    return;
  }

  if (payload.channel !== "ticker" || !Array.isArray(payload.data)) {
    return;
  }
  payload.data.forEach((item) => {
    const symbol = String(item?.symbol || "").split("/")[0];
    if (!symbol) {
      return;
    }
    applyLiveTick(symbol, {
      price: Number(item.last),
      changePct: finiteOrNull(item.change_pct),
      high24h: finiteOrNull(item.high),
      low24h: finiteOrNull(item.low),
      // Kraken da el volumen en unidades del activo, no en dinero.
      volume24h: Number.isFinite(Number(item.volume)) && Number(item.last) > 0
        ? Number(item.volume) * Number(item.last)
        : null,
      source: "kraken"
    });
  });
}

// Ultimo dato vivo de una fila si sigue siendo reciente. Es lo que decide
// la prioridad frente al sondeo periodico de CoinGecko.
function freshQuoteFor(row) {
  const symbol = liveSymbolOf(row);
  if (!symbol) {
    return null;
  }
  const entry = state.live.book.get(symbol);
  if (!entry || Date.now() - entry.at > LIVE_QUOTE_FRESH_MS) {
    return null;
  }
  return entry;
}

// Numero utilizable o null. Nunca 0 de relleno: un dato que no existe se
// muestra como "--", no como un cero que parece real.
function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyLiveTick(symbol, quote) {
  if (!(quote?.price > 0)) {
    return;
  }
  const live = state.live;
  live.lastTickAt = Date.now();
  if (live.status !== "live") {
    window.clearTimeout(live.handshakeTimer);
    live.handshakeTimer = null;
    live.retries = 0;
    setLiveStatus("live");
  }
  const entry = { ...quote, at: Date.now() };
  live.book.set(symbol, entry);
  live.pending.set(symbol, entry);
  scheduleLiveFlush();
}

// Los mensajes llegan por segundo y por par: se acumulan y se vuelca un solo
// repintado cada LIVE_FLUSH_MS para no castigar el movil.
function scheduleLiveFlush() {
  if (state.live.flushTimer) {
    return;
  }
  state.live.flushTimer = window.setTimeout(() => {
    state.live.flushTimer = null;
    flushLivePrices();
  }, LIVE_FLUSH_MS);
}

function flushLivePrices() {
  const live = state.live;
  if (!live.pending.size) {
    return;
  }
  const rate = liveConversionRate();
  const ticks = new Map(live.pending);
  live.pending.clear();
  if (rate === null) {
    return;
  }

  const stamp = new Date().toISOString();
  state.rows.forEach((row) => {
    const symbol = liveSymbolOf(row);
    if (!symbol) {
      return;
    }
    const tick = ticks.get(symbol);
    if (!tick) {
      return;
    }
    const price = tick.price * rate;
    const previousPrice = row.currentPrice;
    // Precio identico: no se toca el DOM (miniTicker emite cada segundo
    // aunque no haya cambiado nada).
    if (previousPrice === price && row.priceStatus === "success") {
      return;
    }
    row.currentPrice = price;
    if (Number.isFinite(tick.changePct)) {
      row.priceChange24h = tick.changePct;
    }
    // Extremos y volumen del dia tal cual los da el exchange (en su moneda).
    row.high24h = Number.isFinite(tick.high24h) ? tick.high24h * rate : row.high24h ?? null;
    row.low24h = Number.isFinite(tick.low24h) ? tick.low24h * rate : row.low24h ?? null;
    row.volume24h = Number.isFinite(tick.volume24h) ? tick.volume24h * rate : row.volume24h ?? null;
    row.priceSource = tick.source;
    row.priceStatus = "success";
    row.priceMessage = "";
    row.lastPriceAt = stamp;
    // Los objetivos TP tambien se vigilan en vivo (alertsFired evita repetir).
    maybeFireTpAlerts(row, previousPrice);
    // Solo se repintan las celdas de precio, con destello segun la direccion;
    // reescribir la fila entera cada segundo cortaria gestos y animaciones.
    updateRowPriceCells(row.id, previousPrice > 0 ? Math.sign(price - previousPrice) : 0);
  });

  state.lastRefreshAt = Date.now();
  checkAlerts();
  scheduleDashboardRefresh();
  renderLiveIndicator();
}

// Aviso discreto en Inicio: sustituye el "actualizado hace X" mientras el
// feed esta sirviendo, para que se vea de donde sale el precio.
// Actualiza solo las celdas que cambian con un tick y marca la direccion
// para el destello. Trabaja sobre la fila de la tabla y sobre la tarjeta
// movil sin reconstruir ninguna de las dos.
function updateRowPriceCells(rowId, direction) {
  const row = getRowById(rowId);
  if (!row) {
    return;
  }
  const metrics = computeRowMetrics(row);
  const containers = [
    dom.tableBody?.querySelector(`tr[data-row-id="${rowId}"]`),
    document.querySelector(`[data-card-row="${rowId}"]`)
  ].filter(Boolean);
  if (!containers.length) {
    scheduleDashboardRefresh();
    return;
  }

  const priceText = metrics.currentPrice > 0
    ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice))
    : "--";
  const changeValue = Number.isFinite(row.priceChange24h) ? row.priceChange24h : null;

  containers.forEach((container) => {
    const set = (role, apply) => {
      const node = container.querySelector(`[data-role='${role}']`);
      if (node) {
        apply(node);
      }
    };
    set("rowPrice", (node) => {
      node.textContent = priceText;
      flashPriceNode(node, direction);
    });
    set("rowChange", (node) => {
      const suffix = node.querySelector("small") ? "<small> 24h</small>" : "";
      node.innerHTML = `${changeValue === null ? "--" : formatSignedPercent(changeValue)}${suffix}`;
      node.className = `${container.matches("tr") ? "numeric" : "amc-24h"} ${toneClass(changeValue || 0)}`;
    });
    set("rowValue", (node) => { node.textContent = maskedCurrency(metrics.currentValue); });
    set("rowPnlAbs", (node) => {
      node.textContent = maskedSignedCurrency(metrics.pnlUsd);
      node.className = `money ${toneClass(metrics.pnlUsd)}`;
    });
    set("rowPnlPct", (node) => {
      node.textContent = formatPercent(metrics.pnlPct);
      node.className = `numeric ${toneClass(metrics.pnlPct)}`;
    });
  });

  // El editor y el detalle abiertos siguen el mismo dato.
  if (state.editorRowId === rowId) {
    refreshEditorLiveData();
  }
  if (state.detailRowId === rowId) {
    renderAssetDetail();
  }
}

// Destello corto en la celda de precio: verde si sube, rojo si baja. Se
// reinicia la animacion en cada tick sin acumular clases ni listeners.
function flashPriceNode(node, direction) {
  if (!direction) {
    return;
  }
  node.classList.remove("price-up", "price-down");
  // Forzar reflow reinicia la animacion cuando los ticks se encadenan.
  void node.offsetWidth;
  node.classList.add(direction > 0 ? "price-up" : "price-down");
}

// Estado del feed en vivo en una linea, para el panel de diagnostico.
function liveStatusLabel() {
  if (!state.prefs.livePrices) {
    return t("diag.liveOff");
  }
  const provider = liveProviderLabel();
  if (state.live.status === "live") {
    return `${t("diag.liveOk")} (${provider})`;
  }
  if (state.live.status === "connecting") {
    return `${t("diag.liveConnecting")} (${provider})`;
  }
  if (state.live.status === "retry") {
    return `${t("diag.liveRetry")} (${provider})`;
  }
  return t("diag.liveDown");
}

// Nombre legible de la fuente del ultimo precio de una fila.
function priceSourceLabel(row) {
  if (row.priceSource === "binance") {
    return "Binance";
  }
  if (row.priceSource === "kraken") {
    return "Kraken";
  }
  if (row.priceSource === "geckoterminal") {
    return "GeckoTerminal";
  }
  if (row.priceSource === "coingecko") {
    return "CoinGecko";
  }
  if (row.priceSource === "alchemy") {
    // Precio que trajo la lectura de la billetera, hasta que llegue el de
    // GeckoTerminal por contrato.
    return "Alchemy";
  }
  return "--";
}

function mainUpdatedLabel() {
  if (isLiveActive()) {
    return t("live.now", { source: liveProviderLabel() });
  }
  return state.lastRefreshAt
    ? t("home.updatedAgo", { time: formatRelativeTime(state.lastRefreshAt) })
    : t("status.noSyncYet");
}

function renderLiveIndicator() {
  const active = isLiveActive();
  document.body.dataset.live = active ? "on" : "off";
  if (dom.liveDot) {
    dom.liveDot.hidden = !active;
  }
  if (dom.mainUpdated) {
    dom.mainUpdated.textContent = mainUpdatedLabel();
  }
}

/* ═══════════════════════════════════════════════════════
   GECKOTERMINAL — precio de tokens DEX que no cotizan en
   ningun exchange central. Se identifica el token por RED +
   CONTRATO, nunca por el ticker: hay decenas de tokens que
   comparten simbolo y el precio equivocado seria peor que
   no tener precio.
   ═══════════════════════════════════════════════════════ */

function readDexContractCache() {
  const parsed = safeParse(localStorage.getItem(DEX_CONTRACT_CACHE_KEY));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function writeDexContractCache(store) {
  try {
    localStorage.setItem(DEX_CONTRACT_CACHE_KEY, JSON.stringify(store));
  } catch {
    // Sin espacio: se seguira resolviendo en memoria mientras dure la sesion.
  }
}

// Red + contrato de un activo, a partir de la ficha de CoinGecko. Se cachea
// un dia: un contrato no cambia nunca, solo aparece la primera vez.
async function resolveDexContract(row) {
  if (row.dexNetwork && row.dexAddress) {
    return { network: row.dexNetwork, address: row.dexAddress };
  }
  if (!row.coinId) {
    return null;
  }

  const store = readDexContractCache();
  const cached = store[row.coinId];
  if (cached && Date.now() - Number(cached.at || 0) < DEX_CONTRACT_TTL) {
    // "none" cachea tambien el resultado negativo: sin contrato conocido no
    // hay que volver a preguntar por el mismo activo cada media hora.
    if (cached.network === "none") {
      return null;
    }
    row.dexNetwork = cached.network;
    row.dexAddress = cached.address;
    return { network: cached.network, address: cached.address };
  }

  const payload = await fetchJson(
    `${COINGECKO_BASE}coins/${encodeURIComponent(row.coinId)}` +
    "?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false"
  );
  const platforms = payload?.platforms && typeof payload.platforms === "object" ? payload.platforms : {};
  let found = null;
  Object.entries(platforms).forEach(([platform, address]) => {
    if (found || !address) {
      return;
    }
    const network = DEX_NETWORKS[platform];
    if (network) {
      found = { network, address: String(address) };
    }
  });

  store[row.coinId] = found
    ? { at: Date.now(), network: found.network, address: found.address }
    : { at: Date.now(), network: "none" };
  writeDexContractCache(store);

  if (found) {
    row.dexNetwork = found.network;
    row.dexAddress = found.address;
  }
  return found;
}

// Filas que necesitan GeckoTerminal: las que el streaming no cubre. Si el
// activo ya llega por WebSocket no se toca, que es mas rapido y gratis.
function dexCandidateRows() {
  return state.rows.filter((row) => {
    if (!isDexOnlyRow(row) && (!row.coinId || !row.crypto.trim())) {
      return false;
    }
    const symbol = liveSymbolOf(row);
    // Cubierto por el streaming (o con tick reciente): no hace falta DEX.
    if (symbol && state.live.covered.includes(symbol)) {
      return false;
    }
    return !freshQuoteFor(row);
  });
}

// Un ciclo de precios DEX: resuelve contratos pendientes y pide en lote los
// tokens de cada red (endpoint multi, hasta 30 direcciones por llamada).
// rows + force: ciclo puntual para esas filas aunque el feed en vivo este
// apagado (los tokens de billetera sin CoinGecko no tienen otro precio).
async function refreshDexPrices({ rows = null, force = false } = {}) {
  if (isOffline() || (!force && (!state.prefs.livePrices || document.visibilityState === "hidden"))) {
    return;
  }
  const candidates = rows || dexCandidateRows();
  if (!candidates.length) {
    return;
  }

  const byNetwork = new Map();
  let lookups = 0;
  for (const row of candidates) {
    const alreadyKnown = Boolean(row.dexNetwork && row.dexAddress);
    if (!alreadyKnown && lookups >= 3) {
      continue;
    }
    let contract = null;
    try {
      if (!alreadyKnown) {
        lookups += 1;
      }
      contract = await resolveDexContract(row);
    } catch {
      contract = null;
    }
    if (!contract) {
      continue;
    }
    const list = byNetwork.get(contract.network) || [];
    if (list.length < GECKOTERMINAL_BATCH) {
      list.push({ row, address: contract.address });
    }
    byNetwork.set(contract.network, list);
  }

  for (const [network, entries] of byNetwork) {
    const addresses = entries.map((entry) => entry.address).join(",");
    let payload = null;
    try {
      payload = await fetchJsonDirect(
        `${GECKOTERMINAL_BASE}networks/${encodeURIComponent(network)}/tokens/multi/${encodeURIComponent(addresses)}`,
        8000
      );
    } catch {
      continue;
    }

    const items = Array.isArray(payload?.data) ? payload.data : [];
    items.forEach((item) => {
      const attributes = item?.attributes || {};
      const address = String(attributes.address || "").toLowerCase();
      const match = entries.find((entry) => entry.address.toLowerCase() === address);
      if (!match) {
        return;
      }
      applyDexQuote(match.row, attributes);
    });
  }
}

function applyDexQuote(row, attributes) {
  const price = finiteOrNull(attributes.price_usd);
  if (!(price > 0)) {
    return;
  }
  const rate = liveConversionRate();
  if (rate === null) {
    return;
  }

  const previousPrice = row.currentPrice;
  const converted = price * rate;
  // El streaming manda: si hay tick reciente del mismo activo no se pisa.
  if (freshQuoteFor(row)) {
    return;
  }
  if (previousPrice === converted && row.priceStatus === "success" && row.priceSource === "geckoterminal") {
    return;
  }

  row.currentPrice = converted;
  const volume = finiteOrNull(attributes.volume_usd?.h24);
  row.volume24h = volume === null ? row.volume24h ?? null : volume * rate;
  const marketCap = finiteOrNull(attributes.market_cap_usd) ?? finiteOrNull(attributes.fdv_usd);
  if (marketCap !== null) {
    row.marketCap = marketCap * rate;
    row.marketCapUpdatedAt = new Date().toISOString();
  }
  row.priceSource = "geckoterminal";
  row.priceStatus = "success";
  row.priceMessage = "";
  row.lastPriceAt = new Date().toISOString();
  row.dexCheckedAt = new Date().toISOString();

  maybeFireTpAlerts(row, previousPrice);
  updateRowPriceCells(row.id, previousPrice > 0 ? Math.sign(converted - previousPrice) : 0);
  scheduleDashboardRefresh();
}

function startDexPolling() {
  if (dexPollTimer) {
    return;
  }
  // Primera pasada temprana: el usuario con memecoins no espera 30 s a ver
  // su precio. Se deja margen para que el WebSocket diga a que esta suscrito.
  window.clearTimeout(dexFirstPassTimer);
  dexFirstPassTimer = window.setTimeout(() => {
    refreshDexPrices().catch(() => {});
  }, 3000);
  dexPollTimer = window.setInterval(() => {
    refreshDexPrices().catch(() => {});
  }, GECKOTERMINAL_POLL_MS);
}

function stopDexPolling() {
  window.clearTimeout(dexFirstPassTimer);
  dexFirstPassTimer = null;
  if (dexPollTimer) {
    window.clearInterval(dexPollTimer);
    dexPollTimer = null;
  }
}
