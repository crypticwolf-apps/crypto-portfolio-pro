// =============================================================================
// buscador.js - Buscador de monedas al anadir o editar una posicion.
//
// Para que sea fluido:
//   - Resultados al instante, en cada letra, de un indice guardado en el
//     dispositivo: las 250 monedas principales de CoinGecko (se renueva una
//     vez al dia) y las que ya tienes en la cartera.
//   - Para el resto, CoinGecko /search por el proxy propio, sin pasar por la
//     cola de los precios (que espera 2,5 s entre peticiones). Solo cuenta la
//     ultima busqueda: la anterior se cancela y una respuesta vieja nunca
//     pisa a una nueva.
//   - Con el campo vacio, las mas populares.
// Orden: simbolo exacto, nombre exacto, empieza por..., contiene...; a
// igualdad, la de mayor capitalizacion.
// =============================================================================

const BUSCADOR_INDICE_TTL = 24 * 60 * 60 * 1000;
const BUSCADOR_REMOTO_TTL = 5 * 60 * 1000;
const BUSCADOR_TIMEOUT_MS = 8000;
const BUSCADOR_MAX = 8;

const buscador = { indice: null, cargando: false, controlador: null, remotos: new Map() };

function monedaDeBuscador(coin) {
  return {
    id: String(coin.id),
    name: String(coin.name || coin.id),
    symbol: String(coin.symbol || "").toLowerCase(),
    thumb: String(coin.thumb || coin.image || ""),
    market_cap_rank: Number.isFinite(coin.market_cap_rank) ? coin.market_cap_rank : null
  };
}

function leerIndiceMonedas() {
  if (!buscador.indice) {
    const guardado = readStored(BUSCADOR_INDICE_KEY);
    buscador.indice = guardado && Array.isArray(guardado.monedas)
      ? { at: Number(guardado.at) || 0, monedas: guardado.monedas.filter((m) => m && m.id).map(monedaDeBuscador) }
      : { at: 0, monedas: [] };
  }
  return buscador.indice;
}

// Peticion directa al proxy propio, sin la cola de los precios (que deja 2,5 s
// entre peticiones): el buscador tiene que responder ya. El proxy cachea y
// lleva la clave, asi que unas pocas seguidas no le cuestan a CoinGecko.
async function pedirAlProxy(ruta, controlador = new AbortController()) {
  const temporizador = window.setTimeout(() => controlador.abort(), BUSCADOR_TIMEOUT_MS);
  try {
    const respuesta = await fetch(`${COINGECKO_BASE}${ruta}`, { headers: { accept: "application/json" }, signal: controlador.signal });
    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }
    return await respuesta.json();
  } finally {
    window.clearTimeout(temporizador);
  }
}

// Las 250 principales, una vez al dia y en segundo plano.
function cargarIndiceMonedas() {
  const indice = leerIndiceMonedas();
  if (buscador.cargando || isOffline() || (indice.monedas.length && Date.now() - indice.at < BUSCADOR_INDICE_TTL)) {
    return;
  }
  buscador.cargando = true;
  pedirAlProxy("coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false")
    .then((lista) => {
      if (!Array.isArray(lista) || !lista.length) {
        return;
      }
      // La imagen pequena de CoinGecko basta para la lista (y pesa menos).
      const monedas = lista
        .filter((coin) => coin && coin.id)
        .map((coin) => monedaDeBuscador({ ...coin, thumb: String(coin.image || "").replace("/large/", "/small/") }));
      buscador.indice = { at: Date.now(), monedas };
      writeStored(BUSCADOR_INDICE_KEY, JSON.stringify(buscador.indice));
      refrescarSugerenciasAbiertas();
    })
    .catch(() => {})
    .finally(() => {
      buscador.cargando = false;
    });
}

// Las de tu cartera, aunque no esten entre las 250 principales.
function monedasDeLaCartera() {
  return state.rows
    .filter((row) => row.coinId)
    .map((row) => monedaDeBuscador({
      id: row.coinId,
      name: row.resolvedName || row.crypto,
      symbol: row.symbol,
      thumb: row.image,
      market_cap_rank: Number.isFinite(row.marketCapRank) ? row.marketCapRank : null
    }));
}

// Cuanto se parece una moneda a lo buscado (menos es mejor; null = nada).
function puntuarMoneda(coin, q) {
  const simbolo = normalizeSearchText(coin.symbol);
  const nombre = normalizeSearchText(coin.name);
  const id = coin.id;
  if (simbolo === q) return 0;
  if (nombre === q || id === q) return 1;
  if (simbolo.startsWith(q)) return 2;
  if (nombre.startsWith(q) || id.startsWith(q)) return 3;
  if (nombre.split(/[\s.-]+/).some((palabra) => palabra.startsWith(q))) return 4;
  if (nombre.includes(q) || simbolo.includes(q) || id.includes(q)) return 5;
  return null;
}

function ordenarMonedas(q, monedas) {
  const rango = (coin) => (Number.isFinite(coin.market_cap_rank) ? coin.market_cap_rank : Number.MAX_SAFE_INTEGER);
  const vistas = new Set();
  return monedas
    .filter((coin) => !vistas.has(coin.id) && vistas.add(coin.id))
    .map((coin) => ({ coin, nota: puntuarMoneda(coin, q) }))
    .filter((x) => x.nota != null)
    .sort((a, b) => a.nota - b.nota || rango(a.coin) - rango(b.coin))
    .map((x) => x.coin);
}

// Al instante, sin red. Con el campo vacio: las mas populares.
function buscarLocal(texto) {
  const q = normalizeSearchText(texto);
  const todas = [...monedasDeLaCartera(), ...leerIndiceMonedas().monedas];
  if (!q) {
    const vistas = new Set();
    return leerIndiceMonedas().monedas
      .filter((coin) => !vistas.has(coin.id) && vistas.add(coin.id))
      .slice(0, BUSCADOR_MAX);
  }
  return ordenarMonedas(q, todas).slice(0, BUSCADOR_MAX);
}

// CoinGecko /search por el proxy, sin cola y cancelando la anterior.
async function buscarRemoto(texto) {
  const q = normalizeSearchText(texto);
  if (q.length < 2 || isOffline()) {
    return [];
  }
  const guardado = buscador.remotos.get(q);
  if (guardado && Date.now() - guardado.at < BUSCADOR_REMOTO_TTL) {
    return guardado.monedas;
  }
  buscador.controlador?.abort();
  const controlador = new AbortController();
  buscador.controlador = controlador;
  try {
    const data = await pedirAlProxy(`search?query=${encodeURIComponent(texto.trim())}`, controlador);
    const monedas = (Array.isArray(data?.coins) ? data.coins : []).slice(0, 25).map(monedaDeBuscador);
    buscador.remotos.set(q, { at: Date.now(), monedas });
    return monedas;
  } finally {
    if (buscador.controlador === controlador) {
      buscador.controlador = null;
    }
  }
}

function mezclarMonedas(texto, locales, remotas) {
  return ordenarMonedas(normalizeSearchText(texto), [...locales, ...remotas]).slice(0, BUSCADOR_MAX);
}

// Nombre o simbolo con lo buscado resaltado (sin HTML de fuera).
function resaltarBusqueda(texto, buscado) {
  const original = String(texto || "");
  const q = String(buscado || "").trim().toLowerCase();
  const i = q ? original.toLowerCase().indexOf(q) : -1;
  if (i < 0) {
    return escapeHtml(original);
  }
  return `${escapeHtml(original.slice(0, i))}<mark>${escapeHtml(original.slice(i, i + q.length))}</mark>${escapeHtml(original.slice(i + q.length))}`;
}
