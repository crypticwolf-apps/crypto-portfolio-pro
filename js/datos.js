// =============================================================================
// datos.js - Los datos del usuario: carga, migracion y guardado en
// localStorage, creacion de posiciones, metricas por fila, ordenacion,
// historial de precios y conversion de moneda de la cartera.
// =============================================================================

// Migra payloads guardados con esquemas anteriores al actual. Cada paso de
// versión es aditivo: nunca borra datos que no entiende.
function migrateStoredPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const from = Number(payload.schema) || 0;
  if (from >= DATA_SCHEMA_VERSION) return payload;
  // v0 → v1: payloads previos a la versión de esquema; forma compatible,
  // solo se etiqueta. Futuras migraciones se encadenan aquí.
  payload.schema = DATA_SCHEMA_VERSION;
  return payload;
}

function loadState() {
  const payload = migrateStoredPayload(safeParse(localStorage.getItem(STORAGE_KEY)));
  const prefs = safeParse(localStorage.getItem(PREFS_KEY));
  const history = safeParse(localStorage.getItem(HISTORY_KEY));

  state.rows = Array.isArray(payload?.rows) && payload.rows.length
    ? payload.rows.map((row) => createRow(row))
    : DEFAULT_ROWS.map((row) => createRow(row));

  state.activity = Array.isArray(payload?.activity) ? payload.activity.slice(0, MAX_ACTIVITY_ITEMS) : [];
  state.trades = Array.isArray(payload?.trades) ? payload.trades.slice(0, MAX_TRADES) : [];
  state.alerts = Array.isArray(payload?.alerts) ? payload.alerts.slice(0, MAX_ALERTS).map(normalizeAlert).filter(Boolean) : [];
  state.history = Array.isArray(history?.points) ? compactHistoryPoints(history.points) : [];
  const storedTheme = prefs && (prefs.theme === "light" || prefs.theme === "dark") ? prefs.theme : null;
  state.prefs = {
    ...DEFAULT_PREFS,
    ...(prefs && typeof prefs === "object" ? prefs : {})
  };
  // Primer arranque sin elección previa: se adopta la preferencia del sistema
  // (coincide con el script anti-parpadeo del <head>). La elección del usuario,
  // una vez guardada, siempre prevalece.
  if (!storedTheme) {
    state.prefs.theme = (typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  }
  if (!TRANSLATIONS[state.prefs.language]) {
    state.prefs.language = DEFAULT_PREFS.language;
  }
  if (!AUTO_REFRESH_OPTIONS.includes(state.prefs.autoRefreshSec)) {
    // Migración: los intervalos antiguos de 15s/1m pasan a 5 minutos; el
    // resto de valores desconocidos caen al predeterminado (30 minutos).
    const previous = Number(state.prefs.autoRefreshSec);
    state.prefs.autoRefreshSec = Number.isFinite(previous) && previous > 0 && previous < 300
      ? 300
      : DEFAULT_PREFS.autoRefreshSec;
  }
  state.prefs.hideBalance = Boolean(state.prefs.hideBalance);
  // El panel de filtros se retiró de Posiciones: los filtros guardados de
  // versiones anteriores se descartan para que nunca oculten posiciones sin
  // que exista una forma de restablecerlos. La búsqueda rápida sigue activa.
  if (state.prefs.filters) {
    state.prefs.filters = null;
  }
  if (state.prefs.plan && typeof state.prefs.plan === "object") {
    // Solo se conservan los datos del simulador TP (el rebalanceo se retiró).
    state.plan = {
      tp: state.prefs.plan.tp || {},
      tpAll: state.prefs.plan.tpAll || state.plan.tpAll
    };
  }
  // Migración segura: la pestaña activa "portfolio" antigua ya no existe.
  if (state.prefs.activeTab === "portfolio") {
    state.prefs.activeTab = "home";
  }
  // Migración: la antigua pestaña "portfolio" (posiciones) ahora vive dentro
  // de "home" (Portafolio); cualquier valor desconocido cae a "home".
  if (state.prefs.activeTab === "portfolio") {
    state.prefs.activeTab = "home";
  }
  state.prefs.activeTab = APP_TABS.includes(state.prefs.activeTab) ? state.prefs.activeTab : "home";
  // Preferencia nueva: quien ya tuviera ajustes guardados entra con el feed
  // en vivo activado, que es el comportamiento por defecto.
  state.prefs.livePrices = state.prefs.livePrices !== false;
  state.prefs.portfolioName = sanitizePortfolioNameInput(state.prefs.portfolioName);
  state.prefs.chartRange = resolveChartRange(state.prefs.chartRange);

  dom.currencySelect.value = state.prefs.currency;
  if (dom.livePricesSelect) {
    dom.livePricesSelect.value = state.prefs.livePrices ? "on" : "off";
  }
  dom.autoRefreshSelect.value = String(state.prefs.autoRefreshSec);
  dom.portfolioNameInput.value = getPortfolioName();
  setDefaultMessages();

  // Los precios persistidos conservan su fecha real: la etiqueta de última
  // sincronización refleja cuándo se obtuvieron, no cuándo se abrió la app.
  const lastPersistedSync = state.rows
    .map((row) => row.lastPriceAt)
    .filter(Boolean)
    .sort()
    .pop();
  if (lastPersistedSync) {
    state.lastSyncLabel = t("status.lastSync", {
      time: formatDateTime(new Date(lastPersistedSync))
    });
    state.lastRefreshAt = new Date(lastPersistedSync).getTime() || 0;
  }

  loadMarketCache();
  loadMarketsListCache();
}

function loadMarketCache() {
  const cached = safeParse(localStorage.getItem(MARKET_CACHE_KEY));
  if (!cached || typeof cached !== "object") {
    return;
  }

  // Los precios cacheados solo valen si son de la misma moneda base.
  if (cached.currency === state.prefs.currency) {
    state.market.btc = cached.btc || null;
    state.market.eth = cached.eth || null;
    state.market.globalUpdatedAt = cached.globalUpdatedAt || null;
    state.market.btcDominance = Number.isFinite(cached.btcDominance) ? cached.btcDominance : null;
  }
  state.market.fearGreed = cached.fearGreed || null;
  state.market.fearGreedUpdatedAt = cached.fearGreedUpdatedAt || null;
}

function persistMarketCache() {
  try {
    localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({
      currency: state.prefs.currency,
      btc: state.market.btc,
      eth: state.market.eth,
      btcDominance: state.market.btcDominance,
      globalUpdatedAt: state.market.globalUpdatedAt,
      fearGreed: state.market.fearGreed,
      fearGreedUpdatedAt: state.market.fearGreedUpdatedAt
    }));
  } catch {
    // Cuota llena: los widgets siguen funcionando solo en memoria.
  }
}

async function handleBaseCurrencyChange(nextCurrency) {
  const normalizedNextCurrency = String(nextCurrency || "").toLowerCase();
  const previousCurrency = String(state.prefs.currency || "").toLowerCase();

  if (!CURRENCY_META[normalizedNextCurrency]) {
    dom.currencySelect.value = previousCurrency || DEFAULT_PREFS.currency;
    return;
  }

  if (normalizedNextCurrency === previousCurrency) {
    dom.currencySelect.value = normalizedNextCurrency;
    return;
  }

  const currencySwitchId = ++state.currencySwitchId;

  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }

  try {
    const conversionRate = await fetchCurrencyConversionRate(previousCurrency, normalizedNextCurrency);
    if (currencySwitchId !== state.currencySwitchId) {
      return;
    }

    applyCurrencyConversionToPortfolio(previousCurrency, normalizedNextCurrency, conversionRate);

    // Los widgets de mercado guardan precios en la moneda base anterior:
    // se convierten al vuelo y el próximo refresco los trae ya nativos.
    if (state.market.btc?.price) {
      state.market.btc = { ...state.market.btc, price: convertNumericAmount(state.market.btc.price, conversionRate) };
    }
    if (state.market.eth?.price) {
      state.market.eth = { ...state.market.eth, price: convertNumericAmount(state.market.eth.price, conversionRate) };
    }

    // El ranking de mercado está en la moneda anterior: se invalida para que
    // se vuelva a pedir en la nueva al abrir Mercados.
    state.marketsList = [];
    state.marketsListAt = 0;
    state.prefs.currency = normalizedNextCurrency;
    dom.currencySelect.value = normalizedNextCurrency;
    persistMarketCache();
    savePreferences();

    updateSaveMessage(t("alerts.baseCurrencyUpdated"));
    pushActivity(
      t("alerts.baseCurrencyActivityTitle"),
      t("alerts.baseCurrencyActivityText", { currency: normalizedNextCurrency.toUpperCase() }),
      "neutral"
    );

    state.priceCache.clear();
    state.rows.forEach((row) => {
      if (row.crypto.trim()) {
        row.priceStatus = "loading";
        row.priceMessage = t("status.syncing");
      }
    });

    renderTableBody();
    renderDashboardOnly();
    scheduleAutosave();

    stopLivePrices();
    await refreshAllPrices({ silentWhenEmpty: true, force: true, reason: "currency-change" });
    startLivePrices();
  } catch (error) {
    dom.currencySelect.value = previousCurrency || DEFAULT_PREFS.currency;
    showToast(t("alerts.refreshFailedTitle"), t("alerts.refreshFailedText"), "negative");
  } finally {
    if (currencySwitchId === state.currencySwitchId) {
      startAutoRefresh();
    }
  }
}

function createRow(partial = {}) {
  state.rowCounter += 1;

  const row = {
    id: partial.id || `row-${Date.now()}-${state.rowCounter}`,
    crypto: String(partial.crypto || ""),
    coinId: String(partial.coinId || ""),
    resolvedName: String(partial.resolvedName || ""),
    symbol: String(partial.symbol || ""),
    image: String(partial.image || ""),
    investment: sanitizeNumericInput(String(partial.investment ?? "")),
    tokens: sanitizeNumericInput(String(partial.tokens ?? "")),
    entryPrice: sanitizeNumericInput(String(partial.entryPrice ?? "")),
    tp1: sanitizeNumericInput(String(partial.tp1 ?? "")),
    tp2: sanitizeNumericInput(String(partial.tp2 ?? "")),
    tp3: sanitizeNumericInput(String(partial.tp3 ?? "")),
    currentPrice: typeof partial.currentPrice === "number" ? partial.currentPrice : null,
    priceChange24h: typeof partial.priceChange24h === "number" ? partial.priceChange24h : null,
    priceStatus: partial.priceStatus || "idle",
    priceMessage: partial.priceMessage || "",
    lastPriceAt: partial.lastPriceAt || null,
    priceHistory: compactRowPriceHistory(Array.isArray(partial.priceHistory) ? partial.priceHistory : []),
    favorite: Boolean(partial.favorite),
    pinned: Boolean(partial.pinned),
    derivedField: TRIAD_FIELDS.includes(partial.derivedField) ? partial.derivedField : "",
    marketCap: Number.isFinite(partial.marketCap) ? partial.marketCap : null,
    marketCapRank: Number.isFinite(partial.marketCapRank) ? partial.marketCapRank : null,
    marketCapUpdatedAt: partial.marketCapUpdatedAt || null,
    // Extremos y volumen del dia + de que fuente salio el ultimo precio.
    high24h: Number.isFinite(partial.high24h) ? partial.high24h : null,
    low24h: Number.isFinite(partial.low24h) ? partial.low24h : null,
    volume24h: Number.isFinite(partial.volume24h) ? partial.volume24h : null,
    priceSource: partial.priceSource || null,
    // Token DEX: red + contrato, para no confundir simbolos repetidos.
    dexNetwork: partial.dexNetwork || null,
    dexAddress: partial.dexAddress || null,
    dexCheckedAt: partial.dexCheckedAt || null,
    note: String(partial.note || ""),
    purchaseDate: String(partial.purchaseDate || ""),
    personalLabel: String(partial.personalLabel || ""),
    suggestions: [],
    suggestionsOpen: false,
    lookupNonce: 0,
    alertsFired: {
      tp1: Boolean(partial.alertsFired?.tp1),
      tp2: Boolean(partial.alertsFired?.tp2),
      tp3: Boolean(partial.alertsFired?.tp3)
    }
  };

  seedRowPriceHistory(row);
  return row;
}

function convertStoredCurrencyInput(value, conversionRate) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  const numericValue = parseDecimal(rawValue);
  if (!Number.isFinite(numericValue)) {
    return rawValue;
  }

  if (numericValue === 0) {
    return rawValue;
  }

  return formatEditableNumber(numericValue * conversionRate);
}

function convertNumericAmount(value, conversionRate, digits = 8) {
  if (!Number.isFinite(value)) {
    return value;
  }

  const normalizedRate = Number(conversionRate);
  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) {
    return value;
  }

  return Number((value * normalizedRate).toFixed(digits));
}

function applyCurrencyConversionToPortfolio(fromCurrency, toCurrency, conversionRate) {
  if (!Number.isFinite(conversionRate) || conversionRate <= 0 || fromCurrency === toCurrency) {
    return;
  }

  state.rows.forEach((row) => {
    row.investment = convertStoredCurrencyInput(row.investment, conversionRate);
    row.entryPrice = convertStoredCurrencyInput(row.entryPrice, conversionRate);
    row.tp1 = convertStoredCurrencyInput(row.tp1, conversionRate);
    row.tp2 = convertStoredCurrencyInput(row.tp2, conversionRate);
    row.tp3 = convertStoredCurrencyInput(row.tp3, conversionRate);

    if (typeof row.currentPrice === "number") {
      row.currentPrice = convertNumericAmount(row.currentPrice, conversionRate);
    }

    if (Number.isFinite(row.marketCap)) {
      row.marketCap = convertNumericAmount(row.marketCap, conversionRate, 0);
    }

    if (Array.isArray(row.priceHistory) && row.priceHistory.length) {
      row.priceHistory = compactRowPriceHistory(
        row.priceHistory.map((point) => ({
          ...point,
          price: convertNumericAmount(Number(point.price || 0), conversionRate)
        }))
      );
    }
  });

  state.history = compactHistoryPoints(
    state.history.map((point) => {
      if (point.currency !== fromCurrency) {
        return point;
      }

      return {
        ...point,
        currency: toCurrency,
        total: convertNumericAmount(Number(point.total || 0), conversionRate, 2)
      };
    })
  );

  persistHistory();
}

function getSortedRows() {
  const items = state.rows.map((row, index) => ({
    row,
    index,
    metrics: computeRowMetrics(row)
  }));

  items.sort((a, b) => compareRows(a, b));
  return items.map((item) => item.row);
}

function compareRows(a, b) {
  if (a.row.pinned !== b.row.pinned) {
    return a.row.pinned ? -1 : 1;
  }

  const direction = state.prefs.sortDir === "desc" ? -1 : 1;
  const valueA = sortValueFor(a, state.prefs.sortBy);
  const valueB = sortValueFor(b, state.prefs.sortBy);

  // Los activos sin dato (p. ej. sin capitalización) van siempre al final,
  // sea cual sea la dirección del orden.
  const missingA = valueA === undefined || valueA === null
    || (typeof valueA === "number" && !Number.isFinite(valueA));
  const missingB = valueB === undefined || valueB === null
    || (typeof valueB === "number" && !Number.isFinite(valueB));
  if (missingA !== missingB) {
    return missingA ? 1 : -1;
  }

  if (typeof valueA === "string" || typeof valueB === "string") {
    const normalizedA = String(valueA || "");
    const normalizedB = String(valueB || "");
    const result = normalizedA.localeCompare(normalizedB, "es", { sensitivity: "base" });
    if (result !== 0) {
      return result * direction;
    }
  } else if (valueA !== valueB) {
    return ((valueA || 0) - (valueB || 0)) * direction;
  }

  return a.index - b.index;
}

function sortValueFor(item, key) {
  switch (key) {
    case "favorite":
      return item.row.favorite ? 1 : 0;
    case "asset":
      return assetDisplayName(item.row);
    case "investment":
      return item.metrics.investment;
    case "tokens":
      return item.metrics.tokens;
    case "entryPrice":
      return item.metrics.entryPrice;
    case "currentPrice":
      return item.metrics.currentPrice;
    case "currentValue":
      return item.metrics.currentValue;
    case "pnlUsd":
      return item.metrics.pnlUsd;
    case "pnlPct":
      return item.metrics.pnlPct;
    case "roiPct":
      return item.metrics.roiPct;
    case "tp1":
      return item.metrics.tp1;
    case "tp2":
      return item.metrics.tp2;
    case "tp3":
      return item.metrics.tp3;
    case "tpSignal":
      return getTpStatus(item.metrics).score;
    case "change24h":
      return Number.isFinite(item.row.priceChange24h) ? item.row.priceChange24h : undefined;
    case "marketCap":
      return Number.isFinite(item.row.marketCap) ? item.row.marketCap : undefined;
    case "marketCapRank":
      return Number.isFinite(item.row.marketCapRank) ? item.row.marketCapRank : undefined;
    case "nextTp":
      return getNextTpDistancePct(item.metrics);
    default:
      return item.index;
  }
}

// Distancia porcentual al siguiente TP pendiente (undefined si no aplica).
function getNextTpDistancePct(metrics) {
  if (!(metrics.currentPrice > 0)) {
    return undefined;
  }
  const targets = [metrics.tp1, metrics.tp2, metrics.tp3].filter((value) => value > 0);
  const next = targets.find((value) => metrics.currentPrice < value);
  return next ? (next / metrics.currentPrice - 1) * 100 : undefined;
}

function buildSnapshot() {
  const items = state.rows.map((row) => ({
    row,
    metrics: computeRowMetrics(row)
  }));

  const totals = items.reduce(
    (accumulator, item) => {
      accumulator.investment += item.metrics.investment;
      accumulator.tokens += item.metrics.tokens;
      accumulator.currentValue += item.metrics.currentValue;
      accumulator.tp1 += item.metrics.tp1Value;
      accumulator.tp2 += item.metrics.tp2Value;
      accumulator.tp3 += item.metrics.tp3Value;
      return accumulator;
    },
    { investment: 0, tokens: 0, currentValue: 0, tp1: 0, tp2: 0, tp3: 0 }
  );

  const validItems = items.filter((item) => item.metrics.investment > 0 || item.metrics.currentValue > 0);
  const connectedCount = items.filter((item) => item.metrics.currentPrice > 0).length;
  const reachedTargets = items.filter((item) => getTpStatus(item.metrics).tone === "good").length;
  const favoriteCount = items.filter((item) => item.row.favorite).length;
  const byPnl = [...validItems].sort((a, b) => b.metrics.pnlPct - a.metrics.pnlPct);

  return {
    items,
    totals,
    bestAsset: byPnl[0] || null,
    worstAsset: byPnl[byPnl.length - 1] || null,
    connectedCount,
    reachedTargets,
    favoriteCount
  };
}

function computeRowMetrics(row) {
  const sig = `${row.investment}|${row.tokens}|${row.entryPrice}|${row.tp1}|${row.tp2}|${row.tp3}|${row.currentPrice}`;
  const hit = rowMetricsMemo.get(row);
  if (hit && hit.sig === sig) return hit.metrics;
  const metrics = computeRowMetricsUncached(row);
  rowMetricsMemo.set(row, { sig, metrics });
  return metrics;
}

function computeRowMetricsUncached(row) {
  const investment = parseDecimal(row.investment);
  const tokens = parseDecimal(row.tokens);
  const manualEntryPrice = parseDecimal(row.entryPrice);
  const entryPrice = manualEntryPrice || (investment > 0 && tokens > 0 ? investment / tokens : 0);
  const entrySource = manualEntryPrice > 0 ? "manual" : entryPrice > 0 ? "derived" : "none";
  const tp1 = parseDecimal(row.tp1);
  const tp2 = parseDecimal(row.tp2);
  const tp3 = parseDecimal(row.tp3);
  const currentPrice = typeof row.currentPrice === "number" ? row.currentPrice : 0;
  const currentValue = tokens * currentPrice;
  const tp1Value = tokens * tp1;
  const tp2Value = tokens * tp2;
  const tp3Value = tokens * tp3;
  const pnlUsd = currentValue - investment;
  const pnlPct = investment > 0 ? (pnlUsd / investment) * 100 : 0;
  const roiPct = entryPrice > 0 && currentPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  return {
    investment,
    tokens,
    entryPrice,
    entrySource,
    tp1,
    tp2,
    tp3,
    tp1Value,
    tp2Value,
    tp3Value,
    currentPrice,
    currentValue,
    pnlUsd,
    pnlPct,
    roiPct
  };
}

function getEntryDisplayValue(row, metrics) {
  if (row.entryPrice) {
    return row.entryPrice;
  }

  if (metrics.entrySource === "derived" && metrics.entryPrice > 0) {
    return formatEditableNumber(metrics.entryPrice);
  }

  return "";
}

function getTpStatus(metrics) {
  const targets = [
    { label: "TP1", value: metrics.tp1 },
    { label: "TP2", value: metrics.tp2 },
    { label: "TP3", value: metrics.tp3 }
  ].filter((target) => target.value > 0);

  if (!metrics.currentPrice) {
    return { tone: "warn", label: t("row.noPriceStatus"), score: -2 };
  }

  if (!targets.length) {
    return { tone: "warn", label: t("row.noTarget"), score: -1 };
  }

  const reached = targets.filter((target) => metrics.currentPrice >= target.value);
  if (reached.length) {
    const lastReached = reached[reached.length - 1];
    return { tone: "good", label: t("row.targetReached", { target: lastReached.label }), score: 10 + reached.length };
  }

  const nextTarget = targets.find((target) => metrics.currentPrice < target.value);
  const ratio = nextTarget ? metrics.currentPrice / nextTarget.value : 0;

  if (ratio >= 0.92) {
    return { tone: "warn", label: t("row.nearTarget", { target: nextTarget.label }), score: 3 + ratio };
  }

  return { tone: "error", label: t("row.farTarget", { target: nextTarget.label }), score: ratio };
}

function getRowById(rowId) {
  return state.rows.find((row) => row.id === rowId);
}

function compactRowPriceHistory(points) {
  const now = Date.now();
  const normalized = points
    .filter((point) => point && Number.isFinite(point.price) && point.at && Number.isFinite(new Date(point.at).getTime()))
    .map((point) => ({
      at: new Date(point.at).toISOString(),
      price: Number(point.price)
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const keep = [];
  const seenBuckets = new Set();

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const point = normalized[index];
    const pointAt = new Date(point.at).getTime();
    const age = now - pointAt;
    let bucketSize = 5 * 60 * 1000;

    if (age > 24 * 60 * 60 * 1000 && age <= 7 * 24 * 60 * 60 * 1000) {
      bucketSize = 60 * 60 * 1000;
    } else if (age > 7 * 24 * 60 * 60 * 1000 && age <= 30 * 24 * 60 * 60 * 1000) {
      bucketSize = 6 * 60 * 60 * 1000;
    } else if (age > 30 * 24 * 60 * 60 * 1000) {
      bucketSize = 24 * 60 * 60 * 1000;
    }

    const bucketKey = `${bucketSize}:${Math.floor(pointAt / bucketSize)}`;
    if (seenBuckets.has(bucketKey)) {
      continue;
    }

    keep.push(point);
    seenBuckets.add(bucketKey);
  }

  return keep.reverse().slice(-MAX_ROW_HISTORY_POINTS);
}

function seedRowPriceHistory(row) {
  if (!row || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0 || row.priceHistory.length) {
    return;
  }

  const currentAt = row.lastPriceAt && Number.isFinite(new Date(row.lastPriceAt).getTime())
    ? new Date(row.lastPriceAt)
    : new Date();

  const seededPoints = [];

  if (Number.isFinite(row.priceChange24h)) {
    const ratio = 1 + row.priceChange24h / 100;
    if (ratio > 0) {
      const previousPrice = row.currentPrice / ratio;
      if (Number.isFinite(previousPrice) && previousPrice > 0) {
        seededPoints.push({
          at: new Date(currentAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          price: Number(previousPrice)
        });
      }
    }
  }

  seededPoints.push({
    at: currentAt.toISOString(),
    price: Number(row.currentPrice)
  });

  row.priceHistory = compactRowPriceHistory(seededPoints);
}

function appendRowPriceHistory(row) {
  if (!row || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0) {
    return;
  }

  if (!row.priceHistory.length) {
    seedRowPriceHistory(row);
    if (row.priceHistory.length >= 2) {
      return;
    }
  }

  const point = {
    at: row.lastPriceAt || new Date().toISOString(),
    price: Number(row.currentPrice)
  };

  const lastPoint = row.priceHistory[row.priceHistory.length - 1];
  if (
    lastPoint &&
    Math.abs(new Date(point.at).getTime() - new Date(lastPoint.at).getTime()) < 20 * 1000
  ) {
    row.priceHistory[row.priceHistory.length - 1] = point;
  } else {
    row.priceHistory.push(point);
  }

  row.priceHistory = compactRowPriceHistory(row.priceHistory);
}

function compactHistoryPoints(points) {
  const now = Date.now();
  const normalized = points
    .filter((point) => point && point.at && Number.isFinite(new Date(point.at).getTime()))
    .map((point) => ({
      at: new Date(point.at).toISOString(),
      currency: point.currency || state.prefs.currency,
      total: Number(point.total || 0)
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const keep = [];
  const seenBuckets = new Set();

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const point = normalized[index];
    const pointAt = new Date(point.at).getTime();
    const age = now - pointAt;
    let bucketSize = 60 * 1000;

    if (age > 6 * 60 * 60 * 1000 && age <= 24 * 60 * 60 * 1000) {
      bucketSize = 5 * 60 * 1000;
    } else if (age > 24 * 60 * 60 * 1000 && age <= 7 * 24 * 60 * 60 * 1000) {
      bucketSize = 30 * 60 * 1000;
    } else if (age > 7 * 24 * 60 * 60 * 1000 && age <= 30 * 24 * 60 * 60 * 1000) {
      bucketSize = 2 * 60 * 60 * 1000;
    } else if (age > 30 * 24 * 60 * 60 * 1000 && age <= 180 * 24 * 60 * 60 * 1000) {
      bucketSize = 12 * 60 * 60 * 1000;
    } else if (age > 180 * 24 * 60 * 60 * 1000) {
      bucketSize = 24 * 60 * 60 * 1000;
    }

    const bucketKey = `${point.currency}:${bucketSize}:${Math.floor(pointAt / bucketSize)}`;
    if (seenBuckets.has(bucketKey)) {
      continue;
    }

    keep.push(point);
    seenBuckets.add(bucketKey);
  }

  return keep.reverse().slice(-MAX_HISTORY_POINTS);
}

function appendPortfolioHistory() {
  const snapshot = buildSnapshot();
  if (snapshot.totals.currentValue <= 0) {
    return;
  }

  const point = {
    at: new Date().toISOString(),
    currency: state.prefs.currency,
    total: Number(snapshot.totals.currentValue.toFixed(2))
  };

  const lastPoint = state.history[state.history.length - 1];
  if (
    lastPoint &&
    lastPoint.currency === point.currency &&
    Date.now() - new Date(lastPoint.at).getTime() < 20 * 1000
  ) {
    state.history[state.history.length - 1] = point;
  } else {
    state.history.push(point);
  }

  state.history = compactHistoryPoints(state.history);
  persistHistory();
}

function scheduleAutosave() {
  if (state.autosaveTimer) {
    window.clearTimeout(state.autosaveTimer);
  }

  updateSaveMessage(t("alerts.pendingChanges"));
  state.autosaveTimer = window.setTimeout(() => {
    persistState(false);
  }, AUTOSAVE_DELAY);
}

function persistState(manual) {
  try {
    const payload = {
      // Versión de esquema: permite migrar datos antiguos si cambia la forma.
      schema: DATA_SCHEMA_VERSION,
      savedAt: Date.now(),
      rows: state.rows.map((row) => ({
        id: row.id,
        crypto: row.crypto,
        coinId: row.coinId,
        resolvedName: row.resolvedName,
        symbol: row.symbol,
        image: row.image,
        investment: row.investment,
        tokens: row.tokens,
        entryPrice: row.entryPrice,
        tp1: row.tp1,
        tp2: row.tp2,
        tp3: row.tp3,
        currentPrice: row.currentPrice,
        priceChange24h: row.priceChange24h,
        priceStatus: row.priceStatus,
        priceMessage: row.priceMessage,
        lastPriceAt: row.lastPriceAt,
        priceHistory: row.priceHistory,
        favorite: row.favorite,
        pinned: row.pinned,
        derivedField: row.derivedField,
        marketCap: row.marketCap,
        marketCapRank: row.marketCapRank,
        marketCapUpdatedAt: row.marketCapUpdatedAt,
        note: row.note,
        purchaseDate: row.purchaseDate,
        personalLabel: row.personalLabel,
        alertsFired: row.alertsFired
      })),
      activity: state.activity.slice(0, MAX_ACTIVITY_ITEMS),
      trades: state.trades.slice(0, MAX_TRADES),
      alerts: state.alerts.slice(0, MAX_ALERTS)
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    savePreferences();
    persistHistory();
    updateSaveMessage(
      t("alerts.savedAt", {
        mode: manual ? t("alerts.savedManual") : t("alerts.savedAuto"),
        time: formatClock(new Date())
      })
    );
  } catch (error) {
    showToast(t("status.apiError"), t("alerts.saveFailedText"), "negative");
  }
}

function savePreferences() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
}

// History payload can reach ~480 KB; stringify+setItem is synchronous and was
// running on every successful refresh. Coalesce writes into idle time so the
// main thread stays free for INP.
let historyWriteHandle = null;
const idleSchedule = (cb) =>
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(cb, { timeout: 2000 })
    : window.setTimeout(cb, 250);
const idleCancel = (h) =>
  typeof window.cancelIdleCallback === "function"
    ? window.cancelIdleCallback(h)
    : window.clearTimeout(h);

function persistHistory() {
  if (historyWriteHandle != null) idleCancel(historyWriteHandle);
  historyWriteHandle = idleSchedule(() => {
    historyWriteHandle = null;
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify({ points: compactHistoryPoints(state.history) })
      );
    } catch {
      // Quota or serialization failure — keep app running, drop write silently.
    }
  });
}

function pushActivity(title, detail, tone = "neutral") {
  state.activity.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title,
    detail,
    tone,
    at: new Date().toISOString()
  });
  state.activity = state.activity.slice(0, MAX_ACTIVITY_ITEMS);
  renderActivityIfChanged();
  scheduleAutosave();
}
