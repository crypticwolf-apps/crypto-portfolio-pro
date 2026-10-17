// =============================================================================
// red.js - Peticiones a CoinGecko: proxy propio con respaldo directo, limitador
// de ritmo, reintentos, busqueda de monedas, precio historico por fecha y tipo
// de cambio entre monedas.
// =============================================================================

async function searchCoins(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  const cached = state.searchCache.get(normalized);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return cached.value;
  }

  const url = `${COINGECKO_BASE}search?query=${encodeURIComponent(query.trim())}`;
  const payload = await fetchJson(url);
  const coins = Array.isArray(payload.coins) ? payload.coins : [];
  const normalizedCoins = coins.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    thumb: coin.thumb,
    market_cap_rank: coin.market_cap_rank
  }));

  state.searchCache.set(normalized, { at: Date.now(), value: normalizedCoins });
  return normalizedCoins;
}

function chooseBestCoinMatch(query, coins) {
  if (!Array.isArray(coins) || !coins.length) {
    return null;
  }

  const normalizedQuery = normalizeSearchText(query);
  const byMarketCap = (a, b) => {
    const rankA = Number.isFinite(a.market_cap_rank) ? a.market_cap_rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.market_cap_rank) ? b.market_cap_rank : Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  };

  // CoinGecko returns many low-rank memecoins that hijack popular symbols
  // (e.g., a coin with symbol "ETHEREUM" or name "Solana" colliding with the
  // real chain). Pool all exact matches across symbol/name/id and pick the
  // one with the best market_cap_rank.
  const exactMatches = coins.filter((coin) =>
    normalizeSearchText(coin.symbol) === normalizedQuery ||
    normalizeSearchText(coin.name) === normalizedQuery ||
    normalizeSearchText(coin.id) === normalizedQuery
  );
  if (exactMatches.length) {
    return [...exactMatches].sort(byMarketCap)[0];
  }

  const startsWithName = coins.find((coin) =>
    normalizeSearchText(coin.name).startsWith(normalizedQuery)
  );
  if (startsWithName) {
    return startsWithName;
  }

  const startsWithSymbol = coins.find((coin) =>
    normalizeSearchText(coin.symbol).startsWith(normalizedQuery)
  );
  if (startsWithSymbol) {
    return startsWithSymbol;
  }

  return [...coins].sort((a, b) => {
    const rankA = Number.isFinite(a.market_cap_rank) ? a.market_cap_rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.market_cap_rank) ? b.market_cap_rank : Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  })[0];
}

async function fetchMarketData(ids, { force = false } = {}) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const currency = state.prefs.currency;
  const results = new Map();
  const staleIds = [];

  uniqueIds.forEach((id) => {
    const cacheKey = `${currency}:${id}`;
    const cached = state.priceCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < PRICE_CACHE_TTL) {
      results.set(id, cached.value);
    } else {
      staleIds.push(id);
    }
  });

  if (staleIds.length) {
    const url = `${COINGECKO_BASE}coins/markets?vs_currency=${encodeURIComponent(currency)}&ids=${encodeURIComponent(staleIds.join(","))}&sparkline=false&price_change_percentage=24h&per_page=250`;
    const payload = await fetchJson(url);
    const rows = Array.isArray(payload) ? payload : [];
    const fromSwCache = Boolean(payload?.__swFallback);

    rows.forEach((item) => {
      if (fromSwCache) {
        // Respuesta de la caché del SW: se marca y no se guarda con sello
        // fresco en priceCache, para reintentar en cuanto haya red.
        item.__fromCache = true;
      } else {
        const cacheKey = `${currency}:${item.id}`;
        state.priceCache.set(cacheKey, { at: Date.now(), value: item });
      }
      results.set(item.id, item);
    });
  }

  return results;
}

async function fetchJsonDirect(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    // El service worker marca con este header las respuestas rescatadas de su
    // caché cuando la red falla; el flag permite no tratarlas como frescas.
    if (response.headers.get("X-SW-Fallback") === "1" && data && typeof data === "object") {
      try {
        Object.defineProperty(data, "__swFallback", { value: true });
      } catch {
        // Payload no extensible: se ignora y se trata como respuesta normal.
      }
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJson(url) {
  // Deduplicate identical in-flight requests
  const cacheKey = url + "|" + state.prefs.currency;
  if (state.pendingFetches.has(cacheKey)) {
    return state.pendingFetches.get(cacheKey);
  }

  const promise = fetchJsonWithRetry(url);
  state.pendingFetches.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    state.pendingFetches.delete(cacheKey);
  }
}

// FIFO queue + sliding-window rate limiter. Each acquire() resolves once
// the call is allowed under both: (a) RATE_LIMIT_MAX_CALLS per minute,
// (b) min gap between back-to-back calls. Cooperates with backoff below.
const rateLimiter = (() => {
  const recent = [];
  const queue = [];
  let lastCallAt = 0;
  let pumping = false;

  function nextDelay() {
    const now = Date.now();
    while (recent.length && now - recent[0] >= RATE_LIMIT_WINDOW_MS) {
      recent.shift();
    }
    const gapWait = Math.max(0, RATE_LIMIT_MIN_GAP_MS - (now - lastCallAt));
    if (recent.length < RATE_LIMIT_MAX_CALLS) {
      return gapWait;
    }
    return Math.max(gapWait, RATE_LIMIT_WINDOW_MS - (now - recent[0]) + 5);
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const wait = nextDelay();
      if (wait > 0) {
        await new Promise((r) => window.setTimeout(r, wait));
        continue;
      }
      const resolve = queue.shift();
      const stamp = Date.now();
      recent.push(stamp);
      lastCallAt = stamp;
      resolve();
    }
    pumping = false;
  }

  return {
    acquire() {
      return new Promise((resolve) => {
        queue.push(resolve);
        pump();
      });
    },
    penalty(ms) {
      // Defer the next allowed slot by `ms`. We push lastCallAt forward
      // (not recent[]) so the sliding window self-clears normally — pushing
      // a future timestamp into recent[] would poison the window since
      // `now - future` is never >= RATE_LIMIT_WINDOW_MS until the stamp ages.
      const wait = Math.max(0, ms);
      lastCallAt = Math.max(lastCallAt, Date.now() + wait);
    }
  };
})();

// Sin proxy CORS: api.coingecko.com sirve cabeceras CORS correctas y los
// proxies públicos gratuitos (corsproxy.io, allorigins...) están caídos o
// bloqueados (403/500). Cada intento contra un proxy muerto quemaba un hueco
// del rate limiter y retrasaba el reintento útil.
async function fetchJsonWithRetry(url) {
  let lastError;
  let backoff = BACKOFF_BASE_MS;
  let triedDirect = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rateLimiter.acquire();
    try {
      return await fetchJsonDirect(url, FETCH_TIMEOUT);
    } catch (err) {
      lastError = err;
      const status = Number((/HTTP\s+(\d+)/.exec(err?.message || ""))?.[1]);
      if (status === 429 || status === 418) {
        // Rate limit: backoff exponencial con jitter y se reintenta.
        const jitter = Math.floor(Math.random() * 400);
        const wait = Math.min(BACKOFF_MAX_MS, backoff) + jitter;
        rateLimiter.penalty(wait);
        await new Promise((r) => window.setTimeout(r, wait));
        backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
      } else if (!triedDirect && !status && url.startsWith(COINGECKO_PROXY)) {
        // El proxy está CAÍDO (error de red/timeout, sin código HTTP): se
        // reintenta UNA vez contra CoinGecko directo para no dejar la app sin
        // datos. Se pierde la clave y la caché compartida, pero sigue viva.
        // Un 4xx del proxy (p. ej. 401 por falta de clave) NO dispara esto:
        // es una respuesta legítima que ir directo tampoco arreglaría.
        triedDirect = true;
        url = COINGECKO_DIRECT + url.slice(COINGECKO_PROXY.length);
      } else if (attempt >= 1) {
        // Error de red/HTTP no recuperable tras un reintento: se propaga.
        break;
      }
    }
  }
  throw lastError;
}

// --- Precio histórico por fecha (coste de adquisición) ----------------------
// CoinGecko /coins/{id}/history da el precio de un día concreto, pero requiere
// clave: por eso va SIEMPRE por el proxy (la clave vive en el servidor). El
// precio de un día pasado NO cambia nunca, así que se cachea de forma
// PERMANENTE en localStorage y no se vuelve a pedir jamás.
const HIST_PRICE_CACHE_KEY = "crypto-portfolio-histprice-v1";

/** Convierte una fecha ISO (YYYY-MM-DD) al formato DD-MM-YYYY de CoinGecko. */
function toCoinGeckoDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function readHistPriceCache() {
  const parsed = safeParse(localStorage.getItem(HIST_PRICE_CACHE_KEY));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function writeHistPriceCache(store) {
  try {
    localStorage.setItem(HIST_PRICE_CACHE_KEY, JSON.stringify(store));
  } catch {
    // Almacenamiento lleno o no disponible: se ignora, es solo una caché.
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
// CoinGecko sirve market_chart de los últimos 365 días SIN clave; más atrás
// exige clave. Se deja un margen para no rozar el límite.
const KEYLESS_HISTORY_DAYS = 360;

/** Precio del punto de una serie [ms, precio] más cercano a un instante. */
function nearestPrice(prices, targetMs) {
  let best = null;
  let bestGap = Infinity;
  for (const point of prices) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const gap = Math.abs(point[0] - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = point[1];
    }
  }
  // Solo se acepta si el punto está a menos de ~2 días del objetivo.
  if (best == null || bestGap > 2 * DAY_MS) return null;
  return typeof best === "number" && Number.isFinite(best) && best > 0 ? best : null;
}

/**
 * Precio de un activo en una fecha concreta, en la moneda dada.
 *
 * Dos vías, según la antigüedad:
 *   - Últimos ~360 días → `market_chart/range`, que funciona SIN clave. El
 *     autocompletado sirve ya para compras recientes sin configurar nada.
 *   - Más atrás → `coins/{id}/history`, que requiere la clave demo en el proxy.
 *
 * Devuelve `null` si no se puede obtener (sin clave para fechas antiguas, activo
 * sin id, fecha futura o sin cobertura). NUNCA inventa un valor. El resultado
 * (incluido el "no había dato") se cachea PERMANENTE: un precio pasado no cambia.
 */
async function fetchHistoricalPrice(coinId, isoDate, currency) {
  const cgDate = toCoinGeckoDate(isoDate);
  if (!coinId || !cgDate) return null;
  const cur = String(currency || "usd").toLowerCase();

  const cacheStore = readHistPriceCache();
  const cacheKey = `${coinId}:${cgDate}:${cur}`;
  if (Object.prototype.hasOwnProperty.call(cacheStore, cacheKey)) {
    const cached = cacheStore[cacheKey];
    return typeof cached === "number" ? cached : null; // null cacheado = no había dato
  }

  const targetMs = new Date(`${isoDate}T12:00:00Z`).getTime();
  if (!Number.isFinite(targetMs) || targetMs > Date.now()) return null;
  const ageDays = (Date.now() - targetMs) / DAY_MS;

  let price = null;
  try {
    if (ageDays <= KEYLESS_HISTORY_DAYS) {
      // Ventana de ±1,5 días para asegurar puntos alrededor del objetivo.
      const from = Math.floor((targetMs - 1.5 * DAY_MS) / 1000);
      const to = Math.ceil((targetMs + 1.5 * DAY_MS) / 1000);
      const url = `${COINGECKO_BASE}coins/${encodeURIComponent(coinId)}/market_chart/range?vs_currency=${encodeURIComponent(cur)}&from=${from}&to=${to}`;
      const data = await fetchJson(url);
      price = nearestPrice(data?.prices || [], targetMs);
    } else {
      const url = `${COINGECKO_BASE}coins/${encodeURIComponent(coinId)}/history?date=${cgDate}&localization=false`;
      const data = await fetchJson(url);
      const value = data?.market_data?.current_price?.[cur];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) price = value;
    }
  } catch {
    // 401 (sin clave para fechas antiguas), 404 o red: no disponible.
    return null;
  }

  cacheStore[cacheKey] = price;
  writeHistPriceCache(cacheStore);
  return price;
}

function getFxCacheKey(fromCurrency, toCurrency) {
  return `${String(fromCurrency || "").toLowerCase()}:${String(toCurrency || "").toLowerCase()}`;
}

function readFxRateCacheStore() {
  const parsed = safeParse(localStorage.getItem(FX_RATE_CACHE_KEY));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function getCachedCurrencyConversionRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  const cacheKey = getFxCacheKey(fromCurrency, toCurrency);
  const inMemory = state.fxRateCache.get(cacheKey);
  if (inMemory && Date.now() - inMemory.at < FX_RATE_TTL && Number.isFinite(inMemory.rate) && inMemory.rate > 0) {
    return inMemory.rate;
  }

  const store = readFxRateCacheStore();
  const stored = store[cacheKey];
  if (stored && Date.now() - Number(stored.at || 0) < FX_RATE_TTL && Number.isFinite(stored.rate) && stored.rate > 0) {
    const normalizedRate = Number(stored.rate);
    state.fxRateCache.set(cacheKey, { at: Number(stored.at), rate: normalizedRate });
    return normalizedRate;
  }

  return null;
}

function cacheCurrencyConversionRate(fromCurrency, toCurrency, rate) {
  if (!Number.isFinite(rate) || rate <= 0) {
    return;
  }

  const now = Date.now();
  const normalizedRate = Number(rate);
  const directKey = getFxCacheKey(fromCurrency, toCurrency);
  const inverseKey = getFxCacheKey(toCurrency, fromCurrency);

  state.fxRateCache.set(directKey, { at: now, rate: normalizedRate });
  state.fxRateCache.set(inverseKey, { at: now, rate: 1 / normalizedRate });

  const store = readFxRateCacheStore();
  store[directKey] = { at: now, rate: normalizedRate };
  store[inverseKey] = { at: now, rate: 1 / normalizedRate };
  localStorage.setItem(FX_RATE_CACHE_KEY, JSON.stringify(store));
}

async function fetchCurrencyConversionRate(fromCurrency, toCurrency) {
  const from = String(fromCurrency || "").toLowerCase();
  const to = String(toCurrency || "").toLowerCase();
  if (from === to) {
    return 1;
  }

  const cachedRate = getCachedCurrencyConversionRate(from, to);
  if (cachedRate) {
    return cachedRate;
  }

  const url = `${COINGECKO_BASE}simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(`${from},${to}`)}`;
  const payload = await fetchJson(url);
  const sourceValue = Number(payload?.bitcoin?.[from]);
  const targetValue = Number(payload?.bitcoin?.[to]);
  const rate = sourceValue > 0 && targetValue > 0 ? targetValue / sourceValue : NaN;

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Unable to resolve FX rate");
  }

  cacheCurrencyConversionRate(from, to, rate);
  return rate;
}
