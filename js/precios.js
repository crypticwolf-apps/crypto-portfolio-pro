// =============================================================================
// precios.js - Refresco de precios de la cartera desde CoinGecko (todas las
// filas o una), datos globales de mercado y refresco automatico.
// =============================================================================

function getAutoRefreshLabel(seconds) {
  if (seconds === 300) {
    return "5m";
  }
  if (seconds === 1800) {
    return "30m";
  }
  if (seconds === 3600) {
    return "1h";
  }
  if (seconds === 86400) {
    return "24h";
  }
  return `${seconds}s`;
}

function isAutoRefreshAllowed() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }

  if (!state.prefs.autoRefreshSec) {
    return;
  }

  state.autoRefreshTimer = window.setInterval(() => {
    if (!isAutoRefreshAllowed()) return;
    refreshAllPrices({ silentWhenEmpty: true, force: false, reason: "auto" });
  }, state.prefs.autoRefreshSec * 1000);
}

function clearSearchTimer(rowId) {
  const timerId = state.searchTimers.get(rowId);
  if (timerId) {
    window.clearTimeout(timerId);
    state.searchTimers.delete(rowId);
  }
}

function clearBlurTimer(rowId) {
  const timerId = state.blurTimers.get(rowId);
  if (timerId) {
    window.clearTimeout(timerId);
    state.blurTimers.delete(rowId);
  }
}

function clearTimersForRow(rowId) {
  clearSearchTimer(rowId);
  clearBlurTimer(rowId);
}

function clearAllTimers() {
  state.searchTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.blurTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.searchTimers.clear();
  state.blurTimers.clear();
}

async function resolveBestMatchForRow(rowId) {
  const row = getRowById(rowId);
  if (!row || !row.crypto.trim()) {
    return;
  }

  // Already resolved (e.g. user picked from suggestions)
  if (row.coinId) {
    return;
  }

  try {
    const coins = row.suggestions.length ? row.suggestions : await searchCoins(row.crypto);
    const best = chooseBestCoinMatch(row.crypto, coins);

    if (!best) {
      row.priceStatus = "not_found";
      row.priceMessage = t("row.notFound");
      row.suggestionsOpen = false;
      updateLiveRowUi(row.id);
      return;
    }

    await applyCoinSelection(rowId, best, { fetchPrice: true });
  } catch (error) {
    row.priceStatus = "error";
    row.priceMessage = t("status.apiError");
    row.suggestionsOpen = false;
    updateLiveRowUi(row.id);
  }
}

async function applyCoinSelection(rowId, coin, options = {}) {
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  row.coinId = coin.id;
  row.resolvedName = coin.name;
  row.symbol = String(coin.symbol || "").toUpperCase();
  row.crypto = row.symbol || coin.name;
  row.image = coin.thumb || coin.image || row.image || "";
  row.suggestions = [];
  row.suggestionsOpen = false;
  row.priceStatus = "loading";
  row.priceMessage = t("row.querying");
  updateLiveRowUi(rowId);

  if (options.fetchPrice) {
    await refreshSingleRow(rowId, false);
  }

  scheduleAutosave();
}

async function refreshSingleRow(rowId, force) {
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  if (!row.coinId && row.crypto.trim()) {
    await resolveBestMatchForRow(rowId);
    return;
  }

  if (!row.coinId) {
    return;
  }

  if (isOffline()) {
    setApiState("offline", t("status.offlineMeta"));
    showToast(t("alerts.offlineTitle"), t("alerts.offlineText"), "warning");
    return;
  }

  try {
    setLoader(true, `${t("buttons.refresh")} ${assetDisplayName(row)}...`);
    setApiState("syncing", `${t("row.querying")} ${assetDisplayName(row)} / CoinGecko`);
    const marketMap = await fetchMarketData([row.coinId], { force });
    const market = marketMap.get(row.coinId);
    if (!market) {
      throw new Error(t("row.noPrice"));
    }

    const previousPrice = row.currentPrice;
    applyMarketDataToRow(row, market);
    maybeFireTpAlerts(row, previousPrice);
    updateLiveRowUi(rowId);
    if (market.__fromCache) {
      // El service worker sirvió datos cacheados: no se registra histórico
      // nuevo ni se presenta la respuesta como sincronización en tiempo real.
      persistState(false);
      setApiState("offline", t("status.offlineMeta"));
    } else {
      appendPortfolioHistory();
      persistState(false);
      setApiState("connected", t("status.lastSyncLong", { time: formatClock(new Date()) }));
    }
  } catch (error) {
    row.priceStatus = "error";
    row.priceMessage = t("status.apiError");
    updateLiveRowUi(rowId);
    setApiState("error", t("status.apiError"));
  } finally {
    setLoader(false);
  }
}

async function refreshAllPrices({ silentWhenEmpty = false, force = false, reason = "manual" } = {}) {
  // Prevent overlapping refresh calls
  if (state.syncing && reason === "auto") {
    return;
  }

  if (isOffline()) {
    setApiState("offline", t("status.offlineMeta"));
    if (reason === "manual") {
      showToast(t("alerts.offlineTitle"), t("alerts.offlineText"), "warning");
    }
    return;
  }

  const refreshRequestId = ++state.refreshRequestId;

  const actionableRows = state.rows.filter((row) => row.coinId || row.crypto.trim());

  if (!actionableRows.length) {
    if (!silentWhenEmpty) {
      showToast(t("alerts.noAssetsTitle"), t("alerts.noAssetsText"), "warning");
    }
    return;
  }

  state.syncing = true;
  setLoader(true, t("loader.syncMarket"));
  setApiState("syncing", t("alerts.refreshAll", { count: actionableRows.length }));

  actionableRows.forEach((row) => {
    if (row.crypto.trim()) {
      row.priceStatus = "loading";
      row.priceMessage = t("status.syncing");
    }
  });
  renderTableBody();

  try {
    const unresolvedRows = actionableRows.filter((row) => !row.coinId && row.crypto.trim());
    const resolved = await Promise.all(
      unresolvedRows.map(async (row) => ({
        rowId: row.id,
        coin: chooseBestCoinMatch(row.crypto, await searchCoins(row.crypto))
      }))
    );
    if (refreshRequestId !== state.refreshRequestId) {
      return;
    }

    resolved.forEach(({ rowId, coin }) => {
      const row = getRowById(rowId);
      if (!row) {
        return;
      }

      if (!coin) {
        row.priceStatus = "not_found";
        row.priceMessage = t("row.notFound");
        row.currentPrice = null;
        row.priceChange24h = null;
        return;
      }

      row.coinId = coin.id;
      row.resolvedName = coin.name;
      row.symbol = String(coin.symbol || "").toUpperCase();
      row.image = coin.thumb || coin.image || row.image;
      row.crypto = row.symbol || coin.name;
    });

    // BTC y ETH viajan siempre en la misma petición agrupada: alimentan los
    // widgets de Mercado aunque no estén en la cartera (cero llamadas extra).
    const ids = [...new Set([
      ...state.rows.map((row) => row.coinId).filter(Boolean),
      "bitcoin",
      "ethereum"
    ])];
    const marketMap = await fetchMarketData(ids, { force });
    if (refreshRequestId !== state.refreshRequestId) {
      return;
    }

    state.rows.forEach((row) => {
      if (!row.coinId) {
        return;
      }

      const market = marketMap.get(row.coinId);
      if (!market) {
        row.currentPrice = null;
        row.priceChange24h = null;
        row.priceStatus = "error";
        row.priceMessage = t("row.noPrice");
        return;
      }

      const previousPrice = row.currentPrice;
      applyMarketDataToRow(row, market);
      maybeFireTpAlerts(row, previousPrice);
    });

    const servedFromCache = [...marketMap.values()].some((market) => market && market.__fromCache);

    updateGlobalMarketFromMap(marketMap, servedFromCache);

    if (!servedFromCache) {
      appendPortfolioHistory();
      state.lastRefreshAt = Date.now();
      // Dominancia y miedo/codicia se refrescan aparte con sus propias cachés.
      refreshMarketExtras();
    }
    renderAll();
    persistState(false);

    if (servedFromCache) {
      // Datos entregados por la caché del service worker (red caída aunque
      // navigator.onLine diga lo contrario): se etiquetan como sin conexión.
      setApiState("offline", t("status.offlineMeta"));
      if (reason === "manual") {
        showToast(t("alerts.offlineTitle"), t("alerts.offlineText"), "warning");
      }
    } else {
      setApiState("connected", t("status.lastSyncLong", { time: formatClock(new Date()) }));
      if (reason === "manual") {
        pushActivity(t("alerts.priceUpdatedTitle"), t("alerts.priceUpdatedText"), "positive");
      }
    }
  } catch (error) {
    if (refreshRequestId !== state.refreshRequestId) {
      return;
    }

    state.rows.forEach((row) => {
      if (row.priceStatus === "loading") {
        row.priceStatus = "error";
        row.priceMessage = t("status.apiError");
      }
    });
    renderAll();
    setApiState("error", t("status.apiError"));
    if (reason === "manual") {
      showToast(t("alerts.refreshFailedTitle"), t("alerts.refreshFailedText"), "negative");
    }
  } finally {
    if (refreshRequestId === state.refreshRequestId) {
      state.syncing = false;
      setLoader(false);
      // Con los simbolos ya resueltos se ajusta la suscripcion en vivo.
      syncLivePrices();
      checkAlerts();
    }
  }
}

// Extrae BTC/ETH del mapa de mercados para los widgets de Inicio.
function updateGlobalMarketFromMap(marketMap, fromCache) {
  const pick = (id) => {
    const item = marketMap.get(id);
    if (!item || !Number.isFinite(item.current_price)) {
      return null;
    }
    return {
      price: item.current_price,
      change24h: Number.isFinite(item.price_change_percentage_24h)
        ? item.price_change_percentage_24h
        : null,
      image: item.image || ""
    };
  };

  const btc = pick("bitcoin");
  const eth = pick("ethereum");
  if (btc) {
    state.market.btc = btc;
  }
  if (eth) {
    state.market.eth = eth;
  }
  if ((btc || eth) && !fromCache) {
    state.market.globalUpdatedAt = new Date().toISOString();
  }
  persistMarketCache();
}

// Dominancia BTC (CoinGecko /global, TTL 60s) y miedo/codicia
// (Alternative.me, TTL 45min). Nunca dos peticiones simultáneas; si la red
// falla se conserva el último dato guardado.
let marketExtrasInFlight = false;
async function refreshMarketExtras(force = false) {
  if (marketExtrasInFlight || isOffline()) {
    return;
  }
  if (typeof document !== "undefined" && document.hidden) {
    return;
  }

  marketExtrasInFlight = true;
  state.market.loading = true;
  try {
    const now = Date.now();

    const dominanceFresh = state.market.globalUpdatedAt
      && Number.isFinite(state.market.btcDominance)
      && now - new Date(state.market.globalUpdatedAt).getTime() < DOMINANCE_TTL;
    if (force || !dominanceFresh) {
      try {
        const payload = await fetchJson(`${COINGECKO_BASE}global`);
        const dominance = Number(payload?.data?.market_cap_percentage?.btc);
        if (Number.isFinite(dominance) && !payload?.__swFallback) {
          state.market.btcDominance = dominance;
          state.market.globalUpdatedAt = new Date().toISOString();
          state.market.error = null;
        }
      } catch {
        state.market.error = "global";
      }
    }

    const fngAge = state.market.fearGreedUpdatedAt
      ? now - new Date(state.market.fearGreedUpdatedAt).getTime()
      : Infinity;
    if (fngAge >= FNG_TTL) {
      try {
        const payload = await fetchJsonDirect(FNG_URL, FETCH_TIMEOUT);
        const item = payload?.data?.[0];
        const value = Number(item?.value);
        if (Number.isFinite(value)) {
          state.market.fearGreed = {
            value,
            classification: String(item?.value_classification || ""),
            timestamp: Number(item?.timestamp) || null,
            timeUntilUpdate: Number(item?.time_until_update) || null
          };
          state.market.fearGreedUpdatedAt = new Date().toISOString();
        }
      } catch {
        // Sin red hacia Alternative.me: se muestra el último dato guardado.
      }
    }

    persistMarketCache();
    renderMarketSection();
  } finally {
    state.market.loading = false;
    marketExtrasInFlight = false;
  }
}

function applyMarketDataToRow(row, market) {
  // Orden de prioridad del precio: WebSocket > GeckoTerminal > CoinGecko.
  // Si hay un precio en vivo reciente se conserva y de CoinGecko solo se
  // toman los datos que el streaming no da (capitalizacion, ranking, logo).
  const fresherQuote = freshQuoteFor(row);
  if (!fresherQuote) {
    row.currentPrice = typeof market.current_price === "number" ? market.current_price : null;
    row.priceSource = "coingecko";
    row.priceChange24h =
      typeof market.price_change_percentage_24h === "number"
        ? market.price_change_percentage_24h
        : null;
  }
  if (row.high24h == null || !fresherQuote) {
    row.high24h = finiteOrNull(market.high_24h);
  }
  if (row.low24h == null || !fresherQuote) {
    row.low24h = finiteOrNull(market.low_24h);
  }
  if (row.volume24h == null || !fresherQuote) {
    row.volume24h = finiteOrNull(market.total_volume);
  }
  row.image = market.image || row.image;
  row.symbol = String(market.symbol || row.symbol || "").toUpperCase();
  row.resolvedName = market.name || row.resolvedName;
  row.priceStatus = row.currentPrice !== null ? "success" : "error";
  row.priceMessage = row.currentPrice !== null ? "" : t("row.noPrice");
  if (fresherQuote) {
    // El precio vivo ya puso su propia marca de tiempo y procedencia.
    row.suggestions = [];
    row.suggestionsOpen = false;
    if (Number.isFinite(market.market_cap)) {
      row.marketCap = market.market_cap;
      row.marketCapUpdatedAt = new Date().toISOString();
    }
    if (Number.isFinite(market.market_cap_rank)) {
      row.marketCapRank = market.market_cap_rank;
    }
    return;
  }
  if (market.__fromCache) {
    // Precio cacheado: se conserva la fecha original de la sincronización
    // para no presentarlo como precio en tiempo real.
    row.lastPriceAt = row.lastPriceAt || null;
  } else {
    row.lastPriceAt = new Date().toISOString();
    if (Number.isFinite(market.market_cap)) {
      row.marketCap = market.market_cap;
      row.marketCapUpdatedAt = row.lastPriceAt;
    }
    if (Number.isFinite(market.market_cap_rank)) {
      row.marketCapRank = market.market_cap_rank;
    }
    appendRowPriceHistory(row);
  }
  row.suggestions = [];
  row.suggestionsOpen = false;
}
