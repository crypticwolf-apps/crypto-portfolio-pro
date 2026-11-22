// =============================================================================
// infomoneda.js - Datos ampliados de una moneda para su ficha, de CoinGecko
// (/coins/{id}, una sola peticion): maximo y minimo historicos, valoracion
// totalmente diluida, suministro (en circulacion, total y maximo),
// categorias, descripcion y enlaces oficiales.
//
// Se guardan en el dispositivo (una entrada por moneda, las ultimas 40) y se
// renuevan cada hora; sin conexion se ensena lo guardado. La descripcion de
// CoinGecko viene en HTML: aqui se queda solo el texto. Los enlaces solo se
// aceptan si son https.
// =============================================================================

const INFO_MONEDA_TTL = 60 * 60 * 1000;
const INFO_MONEDA_REINTENTO = 2 * 60 * 1000;
const INFO_MONEDA_MAX = 40;
const INFO_MONEDA_DESCRIPCION_MAX = 900; // caracteres de descripcion guardados

const infoMoneda = { cache: null, pidiendo: new Set(), fallos: new Map(), descripcionAbierta: false };

function leerCacheInfoMoneda() {
  if (!infoMoneda.cache) {
    const guardado = readStored(INFO_MONEDA_CACHE_KEY);
    infoMoneda.cache = guardado && typeof guardado === "object" && !Array.isArray(guardado) ? guardado : {};
  }
  return infoMoneda.cache;
}

function guardarCacheInfoMoneda() {
  const cache = leerCacheInfoMoneda();
  Object.keys(cache)
    .sort((a, b) => cache[b].at - cache[a].at)
    .slice(INFO_MONEDA_MAX)
    .forEach((clave) => delete cache[clave]);
  writeStored(INFO_MONEDA_CACHE_KEY, JSON.stringify(cache));
}

// Solo enlaces https con forma de URL (nada de javascript: ni similares).
function enlaceSeguro(valor) {
  try {
    const url = new URL(String(valor || "").trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// HTML de CoinGecko -> texto plano, recortado en una frase entera.
function textoDescripcion(html) {
  if (!html) {
    return "";
  }
  let texto = "";
  try {
    texto = new DOMParser().parseFromString(String(html), "text/html").body.textContent || "";
  } catch {
    texto = String(html).replace(/<[^>]*>/g, " ");
  }
  texto = texto.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (texto.length <= INFO_MONEDA_DESCRIPCION_MAX) {
    return texto;
  }
  const corte = texto.slice(0, INFO_MONEDA_DESCRIPCION_MAX);
  const fin = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf(".\n"));
  return `${fin > 200 ? corte.slice(0, fin + 1) : corte.trimEnd()}…`;
}

// Por moneda (usd, eur...): { usd: 69000, eur: 63000 } -> solo numeros.
function porMoneda(objeto) {
  const out = {};
  Object.entries(objeto && typeof objeto === "object" ? objeto : {}).forEach(([clave, valor]) => {
    if (Number.isFinite(valor)) {
      out[clave] = valor;
    }
  });
  return out;
}

function extraerInfoMoneda(data) {
  const md = data?.market_data || {};
  const links = data?.links || {};
  const numero = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const descripcionEs = textoDescripcion(data?.description?.es);
  const descripcion = descripcionEs || textoDescripcion(data?.description?.en);
  const enlaces = [
    ["web", (links.homepage || []).find((u) => enlaceSeguro(u))],
    ["whitepaper", links.whitepaper],
    ["explorador", (links.blockchain_site || []).find((u) => enlaceSeguro(u))],
    ["x", links.twitter_screen_name ? `https://x.com/${encodeURIComponent(links.twitter_screen_name)}` : null],
    ["reddit", links.subreddit_url],
    ["github", (links.repos_url?.github || []).find((u) => enlaceSeguro(u))],
    ["telegram", links.telegram_channel_identifier ? `https://t.me/${encodeURIComponent(links.telegram_channel_identifier)}` : null]
  ]
    .map(([tipo, url]) => ({ tipo, url: enlaceSeguro(url) }))
    .filter((enlace) => enlace.url);
  return {
    at: Date.now(),
    ath: porMoneda(md.ath),
    athFecha: md.ath_date && typeof md.ath_date === "object" ? md.ath_date : {},
    atl: porMoneda(md.atl),
    atlFecha: md.atl_date && typeof md.atl_date === "object" ? md.atl_date : {},
    fdv: porMoneda(md.fully_diluted_valuation),
    circulante: numero(md.circulating_supply),
    total: numero(md.total_supply),
    maximo: numero(md.max_supply),
    categorias: (Array.isArray(data?.categories) ? data.categories : [])
      .filter((c) => typeof c === "string" && c.trim())
      .slice(0, 6),
    descripcion,
    descripcionEnIngles: Boolean(descripcion) && !descripcionEs,
    enlaces,
    lanzamiento: /^\d{4}-\d{2}-\d{2}$/.test(String(data?.genesis_date || "")) ? data.genesis_date : null,
    algoritmo: typeof data?.hashing_algorithm === "string" && data.hashing_algorithm.trim() ? data.hashing_algorithm.trim() : null
  };
}

// Pide los datos si no estan o han caducado; al llegar se repinta la ficha.
function pedirInfoMoneda(row) {
  const id = String(row?.coinId || "").toLowerCase();
  if (!id || isOffline()) {
    return;
  }
  const entrada = leerCacheInfoMoneda()[id];
  if (entrada && Date.now() - entrada.at < INFO_MONEDA_TTL) {
    return;
  }
  if (infoMoneda.pidiendo.has(id) || Date.now() - (infoMoneda.fallos.get(id) || 0) < INFO_MONEDA_REINTENTO) {
    return;
  }
  infoMoneda.pidiendo.add(id);
  fetchJson(`${COINGECKO_BASE}coins/${encodeURIComponent(id)}?localization=true&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`)
    .then((data) => {
      if (!data || typeof data !== "object" || data.error) {
        throw new Error("sin datos");
      }
      leerCacheInfoMoneda()[id] = extraerInfoMoneda(data);
      guardarCacheInfoMoneda();
      infoMoneda.fallos.delete(id);
      if (getRowById(state.detailRowId)?.coinId?.toLowerCase() === id) {
        repintarFichaInfo();
      }
    })
    .catch(() => {
      infoMoneda.fallos.set(id, Date.now());
    })
    .finally(() => {
      infoMoneda.pidiendo.delete(id);
    });
}

function infoDeMoneda(row) {
  const id = String(row?.coinId || "").toLowerCase();
  return id ? leerCacheInfoMoneda()[id] || null : null;
}
