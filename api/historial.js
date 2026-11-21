// =============================================================================
// api/historial.js - Precios pasados de varias monedas de una vez, para
// dibujar el saldo de la cartera en el tiempo (grafico de Inicio).
//
//   GET /api/historial?ids=bitcoin,ethereum&vs=usd&dias=30
//   -> { desde, paso, n, precios: { bitcoin: [n precios], ... }, faltan: [ids] }
//
// Pide a CoinGecko market_chart/range de cada moneda (con la clave del
// servidor, en cabecera) y devuelve todas las series sobre la MISMA rejilla
// de n instantes (desde, desde + paso, ...), listas para sumar: la app hace
// una peticion en vez de una por moneda.
// =============================================================================

const CG_BASE = 'https://api.coingecko.com/api/v3/';
const MAX_IDS = 40;
const DIAS_MAX = 364;          // CoinGecko sirve 365 dias sin plan de pago
const MAX_PUNTOS = 181;        // puntos de la rejilla (el grafico usa ~140)
const CONCURRENCIA = 4;
const TIMEOUT_MS = 10_000;
const PLAZO_MS = 20_000;       // pasado esto no se empieza ninguna peticion mas
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

// Precio pasado = dato fijo: la serie de una URL con desde/hasta concretos no
// cambia. Se guarda en memoria mientras la instancia sigue viva.
const store = new Map();
const MAX_ENTRIES = 400;

function guardar(key, value) {
  if (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(key, value);
}

// Cada cuanto cambia la ventana: con 1 dia CoinGecko da datos cada 5 min; de
// 2 a 90 dias, cada hora; con mas, uno al dia (a las 00:00 UTC).
function cubetaDe(dias) {
  if (dias <= 1) return 10 * MIN;
  if (dias <= 90) return HORA;
  return DIA;
}

function rejillaDe(dias, ahora = Date.now()) {
  const cubeta = cubetaDe(dias);
  const hasta = Math.floor(ahora / cubeta) * cubeta;
  const span = dias * DIA;
  const desde = hasta - span;
  const n = Math.min(MAX_PUNTOS, Math.floor(span / cubeta) + 1);
  return { desde, hasta, paso: span / (n - 1), n, cubeta };
}

const redondear = (p) => Number(p.toPrecision(6));

// Lleva una serie [[ms, precio], ...] a la rejilla: en cada instante, el
// ultimo precio conocido (con medio paso de margen). Si la moneda empezo a
// cotizar despues del inicio, los primeros huecos toman su primer precio.
function remuestrear(prices, desde, paso, n) {
  const serie = (Array.isArray(prices) ? prices : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0)
    .sort((a, b) => a[0] - b[0]);
  if (!serie.length) return null;
  const out = new Array(n).fill(null);
  let k = -1;
  for (let i = 0; i < n; i += 1) {
    const limite = desde + paso * i + paso / 2;
    while (k + 1 < serie.length && serie[k + 1][0] <= limite) k += 1;
    if (k >= 0) out[i] = redondear(serie[k][1]);
  }
  const primero = out.find((v) => v != null) ?? redondear(serie[0][1]);
  for (let i = 0; i < n && out[i] == null; i += 1) out[i] = primero;
  return out;
}

function leerParametros(url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const ids = [...new Set(String(params.get('ids') || '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    // Ids de CoinGecko: letras, numeros, guiones, puntos y guion bajo; empiezan
    // por letra o numero (asi nunca forman ".." como tramo de la ruta).
    .filter((id) => /^[a-z0-9][a-z0-9._-]{0,80}$/.test(id)))]
    .sort()
    .slice(0, MAX_IDS);
  const vs = String(params.get('vs') || 'usd').toLowerCase();
  const dias = Math.round(Number(params.get('dias')));
  if (!ids.length) return { error: 'Faltan las monedas (ids).' };
  if (!/^[a-z]{3}$/.test(vs)) return { error: 'Moneda no valida (vs).' };
  if (!Number.isFinite(dias) || dias < 1) return { error: 'Periodo no valido (dias).' };
  return { ids, vs, dias: Math.min(dias, DIAS_MAX) };
}

async function pedirSerie(id, vs, rejilla, key) {
  // Un poco antes del inicio para tener precio en el primer punto.
  const desde = Math.floor((rejilla.desde - rejilla.cubeta) / 1000);
  const hasta = Math.ceil(rejilla.hasta / 1000);
  const target = `${CG_BASE}coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=${vs}&from=${desde}&to=${hasta}`;
  if (store.has(target)) return { precios: store.get(target) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let respuesta;
  try {
    respuesta = await fetch(target, {
      headers: { accept: 'application/json', ...(key ? { 'x-cg-demo-api-key': key } : {}) },
      signal: controller.signal,
    });
  } catch {
    return { pasajero: true };
  } finally {
    clearTimeout(timer);
  }
  if (respuesta.status === 429) return { pasajero: true, limite: true };
  if (respuesta.status >= 500) return { pasajero: true };
  if (!respuesta.ok) return {}; // 404 y similares: esa moneda no tiene datos
  let data;
  try {
    data = await respuesta.json();
  } catch {
    return { pasajero: true };
  }
  const precios = remuestrear(data?.prices, rejilla.desde, rejilla.paso, rejilla.n);
  if (precios) guardar(target, precios);
  return { precios };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Metodo no permitido. Usa GET.' });
    return;
  }

  const pedido = leerParametros(req.url);
  if (pedido.error) {
    res.statusCode = 400;
    res.json({ error: pedido.error });
    return;
  }

  const key = process.env.COINGECKO_API_KEY;
  const rejilla = rejillaDe(pedido.dias);
  const precios = {};
  const faltan = [];
  let pasajero = false;
  let limite = false;

  // Pocas a la vez: CoinGecko limita las llamadas por minuto. Si salta el
  // limite, el resto no se pide (fallaria igual) y la app lo reintenta luego.
  const cola = [...pedido.ids];
  const plazo = Date.now() + PLAZO_MS;
  async function trabajador() {
    while (cola.length) {
      const id = cola.shift();
      if (limite || Date.now() > plazo) {
        pasajero = true;
        faltan.push(id);
        continue;
      }
      const r = await pedirSerie(id, pedido.vs, rejilla, key);
      if (r.limite) limite = true;
      if (r.pasajero) pasajero = true;
      if (r.precios) precios[id] = r.precios;
      else faltan.push(id);
    }
  }
  // Sin clave, CoinGecko admite muchas menos llamadas por minuto: mas despacio.
  const concurrencia = key ? CONCURRENCIA : 2;
  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length) }, trabajador));

  // Completo: la CDN lo guarda hasta que cambie la ventana. Con huecos por un
  // fallo pasajero no se guarda, para que el siguiente intento lo complete.
  const segundos = Math.min(rejilla.cubeta, HORA) / 1000;
  res.setHeader('Cache-Control', pasajero
    ? 'no-store'
    : `public, max-age=${segundos}, s-maxage=${segundos}, stale-while-revalidate=${segundos}`);
  res.json({
    desde: rejilla.desde,
    paso: rejilla.paso,
    n: rejilla.n,
    precios,
    faltan: faltan.sort(),
    incompleto: pasajero,
  });
}

module.exports = handler;
module.exports._internals = { remuestrear, rejillaDe, leerParametros, cubetaDe };
