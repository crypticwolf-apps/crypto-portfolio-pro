// =============================================================================
// historial.js - Saldo de la cartera en el tiempo para el grafico de Inicio
// y precio de una moneda en el tiempo para el grafico de su ficha.
//
// Se reconstruye con los precios pasados de cada moneda (api/historial.js, una
// peticion para todas) y lo que tenias en cada fecha: tus compras y ventas
// registradas y la fecha de compra de cada posicion (sin fecha, se da por
// tenida todo el periodo). Los calculos estan en finance.js (serieSaldo y
// rentabilidadPeriodo), con sus pruebas.
//
// Mientras llegan los datos, o sin conexion, el grafico usa el historial que
// este dispositivo ha ido guardando (state.history), como antes.
// =============================================================================

// Dias que pide cada rango ("todo" se calcula con la primera fecha conocida).
const HIST_SALDO_DIAS = { "1d": 1, "1s": 7, "1m": 30, "3m": 91, "1a": 364 };
const HIST_SALDO_REINTENTO_MS = 2 * 60 * 1000;
// Si CoinGecko corto la respuesta (limite de peticiones) y lo que falta pesa
// mas que esto en la cartera, se espera al reintento en vez de dibujar un
// saldo enganoso.
const HIST_SALDO_MAX_FALTA = 0.1;

const histSaldo = {
  cache: null,                 // { "usd|30": { ids, at, data } } (tambien en localStorage)
  pidiendo: new Set(),
  fallos: new Map(),           // clave -> momento del ultimo fallo
  memo: new WeakMap()          // snapshot -> { clave, serie }
};

// Cada cuanto se renueva: los datos de 1 dia cambian cada 10 minutos; los
// de un ano, una vez al dia.
function histSaldoTtl(dias) {
  if (dias <= 1) return 10 * 60 * 1000;
  if (dias <= 7) return 60 * 60 * 1000;
  if (dias <= 30) return 2 * 60 * 60 * 1000;
  if (dias <= 91) return 6 * 60 * 60 * 1000;
  return 12 * 60 * 60 * 1000;
}

function fechaCompraMs(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!m) {
    return null;
  }
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// "Todo": desde la primera compra, venta o fecha de compra conocida (como
// mucho un ano, lo que da CoinGecko sin plan de pago).
function diasDeRango(range) {
  if (HIST_SALDO_DIAS[range]) {
    return HIST_SALDO_DIAS[range];
  }
  const ids = new Set(state.rows.map((row) => row.id));
  const fechas = [
    ...state.trades.filter((trade) => ids.has(trade.rowId)).map((trade) => Number(trade.at)),
    ...state.rows.map((row) => fechaCompraMs(row.purchaseDate)),
    state.history.length ? new Date(state.history[0].at).getTime() : null
  ].filter((ms) => Number.isFinite(ms) && ms > 0);
  if (!fechas.length) {
    return 364;
  }
  const dias = Math.ceil((Date.now() - Math.min(...fechas)) / (24 * 60 * 60 * 1000)) + 1;
  // En semanas enteras: la misma peticion sirve varios dias seguidos.
  return Math.max(7, Math.min(364, Math.ceil(dias / 7) * 7));
}

function monedasConHistorial() {
  const ids = new Set();
  state.rows.forEach((row) => {
    if (row.coinId && (parseDecimal(row.tokens) > 0 || state.trades.some((trade) => trade.rowId === row.id))) {
      ids.add(String(row.coinId).toLowerCase());
    }
  });
  return [...ids].sort();
}

function leerCacheSaldo() {
  if (!histSaldo.cache) {
    const guardado = readStored(HIST_SALDO_CACHE_KEY);
    histSaldo.cache = guardado && typeof guardado === "object" && !Array.isArray(guardado) ? guardado : {};
  }
  return histSaldo.cache;
}

function guardarCacheSaldo() {
  writeStored(HIST_SALDO_CACHE_KEY, JSON.stringify(histSaldo.cache || {}));
}

function datosValidos(data) {
  return data && Number.isFinite(data.desde) && Number.isFinite(data.paso) && data.paso > 0
    && Number.isInteger(data.n) && data.n >= 2 && data.n <= 400
    && data.precios && typeof data.precios === "object";
}

// Pide los precios del rango si no estan o han caducado. No bloquea: cuando
// llegan, se repinta el saldo.
function pedirHistorialSaldo(range) {
  const vs = state.prefs.currency;
  const dias = diasDeRango(range);
  const ids = monedasConHistorial();
  if (!ids.length || isOffline()) {
    return;
  }
  const hueco = `${vs}|${dias}`;
  const clave = `${hueco}|${ids.join(",")}`;
  const entrada = leerCacheSaldo()[hueco];
  const caduca = entrada?.incompleto ? HIST_SALDO_REINTENTO_MS : histSaldoTtl(dias);
  if (entrada && entrada.ids === ids.join(",") && Date.now() - entrada.at < caduca) {
    return;
  }
  if (histSaldo.pidiendo.has(clave) || Date.now() - (histSaldo.fallos.get(clave) || 0) < HIST_SALDO_REINTENTO_MS) {
    return;
  }
  histSaldo.pidiendo.add(clave);
  const url = `${HISTORIAL_PROXY}?ids=${encodeURIComponent(ids.join(","))}&vs=${encodeURIComponent(vs)}&dias=${dias}`;
  fetchJsonDirect(url, 25000)
    .then((data) => {
      if (!datosValidos(data)) {
        throw new Error("historial no valido");
      }
      leerCacheSaldo()[hueco] = {
        ids: ids.join(","),
        at: Date.now(),
        incompleto: Boolean(data.incompleto),
        data: { desde: data.desde, paso: data.paso, n: data.n, precios: data.precios }
      };
      guardarCacheSaldo();
      histSaldo.fallos.delete(clave);
      if (state.prefs.currency === vs && diasDeRango(state.prefs.homeRange) === dias) {
        renderDashboardOnly();
      }
    })
    .catch(() => {
      histSaldo.fallos.set(clave, Date.now());
      histSaldo.pidiendo.delete(clave);
      renderHomeChart();
    })
    .finally(() => {
      histSaldo.pidiendo.delete(clave);
    });
}

function posicionesParaHistorial(snapshot, precios) {
  const movimientosPorFila = new Map();
  state.trades.forEach((trade) => {
    const cantidad = parseDecimal(trade.tokens);
    const at = Number(trade.at);
    if (!(cantidad > 0) || !Number.isFinite(at)) {
      return;
    }
    const lista = movimientosPorFila.get(trade.rowId) || [];
    lista.push({ at, cantidad: trade.type === "sell" ? -cantidad : cantidad });
    movimientosPorFila.set(trade.rowId, lista);
  });
  return snapshot.items
    .map(({ row, metrics }) => {
      const movimientos = movimientosPorFila.get(row.id) || [];
      if (!(metrics.tokens > 0) && !movimientos.length) {
        return null;
      }
      const serie = row.coinId ? precios[String(row.coinId).toLowerCase()] : null;
      return {
        cantidad: metrics.tokens,
        desde: fechaCompraMs(row.purchaseDate),
        movimientos,
        precios: Array.isArray(serie) ? serie : null,
        precioActual: metrics.currentPrice
      };
    })
    .filter(Boolean);
}

// Coste de cada posicion para la linea de lo invertido: lo de hoy, la fecha
// de compra y el coste de cada compra (+) y de lo vendido en cada venta (-).
function costesParaHistorial(snapshot) {
  const porFila = new Map();
  state.trades.forEach((trade) => {
    const at = Number(trade.at);
    const importe = Number(trade.amount);
    if (!Number.isFinite(at) || !(importe > 0)) {
      return;
    }
    let coste = importe;
    if (trade.type === "sell") {
      // Lo que costaba lo vendido = ingresos - comision - beneficio realizado.
      const realizado = Number(trade.realized);
      coste = -(Number.isFinite(realizado) ? importe - (Number(trade.fee) || 0) - realizado : importe);
    }
    const lista = porFila.get(trade.rowId) || [];
    lista.push({ at, coste });
    porFila.set(trade.rowId, lista);
  });
  return snapshot.items
    .filter(({ metrics, row }) => metrics.investment > 0 || porFila.has(row.id))
    .map(({ row, metrics }) => ({
      inversion: metrics.investment,
      desde: fechaCompraMs(row.purchaseDate),
      costes: porFila.get(row.id) || []
    }));
}

// Serie del saldo para un rango: { puntos: [{ at, value }], flujos }, o null
// si aun no hay precios pasados (entonces manda el historial guardado).
// Hay una peticion del saldo pasado en camino (Inicio pinta su esqueleto).
function historialSaldoCargando() {
  return histSaldo.pidiendo.size > 0;
}

function serieSaldoDelRango(range, snapshot) {
  pedirHistorialSaldo(range);
  const hueco = `${state.prefs.currency}|${diasDeRango(range)}`;
  const entrada = leerCacheSaldo()[hueco];
  if (!entrada || !datosValidos(entrada.data)) {
    return null;
  }
  const clave = `${hueco}|${entrada.at}`;
  const memo = histSaldo.memo.get(snapshot);
  if (memo && memo.clave === clave) {
    return memo.serie;
  }
  const { desde, paso, n, precios } = entrada.data;
  if (entrada.incompleto) {
    const total = snapshot.totals.currentValue;
    const falta = snapshot.items
      .filter(({ row }) => row.coinId && !precios[String(row.coinId).toLowerCase()])
      .reduce((sum, { metrics }) => sum + (metrics.currentValue > 0 ? metrics.currentValue : 0), 0);
    if (total > 0 && falta / total > HIST_SALDO_MAX_FALTA) {
      histSaldo.memo.set(snapshot, { clave, serie: null });
      return null;
    }
  }
  const { puntos, flujos } = CryptoFinance.serieSaldo({
    desde,
    paso,
    n,
    posiciones: posicionesParaHistorial(snapshot, precios),
    ahora: Date.now(),
    valorAhora: snapshot.totals.currentValue
  });
  // El grafico empieza cuando empieza la cartera: fuera los puntos a cero del
  // principio (y el dinero que entro hasta ese momento, que ya esta dentro).
  const primero = puntos.findIndex((point) => point.value > 0);
  const serie = primero < 0 || puntos.length - primero < 2
    ? null
    : {
        puntos: puntos.slice(primero),
        flujos: flujos.filter((flujo) => flujo.at > puntos[primero].at)
      };
  if (serie) {
    // Lo invertido (coste) en cada instante, para la segunda linea del grafico.
    serie.invertido = CryptoFinance.serieInvertido(costesParaHistorial(snapshot), serie.puntos.map((p) => p.at));
  }
  histSaldo.memo.set(snapshot, { clave, serie });
  return serie;
}

// ── Precio de una moneda en el tiempo (grafico de la ficha) ──
// Mismo servicio (api/historial.js) con una sola moneda. Sin datos (sin
// conexion, token sin CoinGecko), la ficha usa los precios que la app ha ido
// guardando de esa posicion.
const FICHA_DIAS = { "1d": 1, "1w": 7, "1mo": 30, "3mo": 91, "1y": 364 };
const HIST_FICHA_MAX = 30; // monedas y rangos guardados como mucho

const histFicha = { cache: null, pidiendo: new Set(), fallos: new Map() };

// "Total": desde la fecha de compra o la primera operacion de la posicion
// (como mucho un ano); sin ninguna, el ultimo ano.
function diasDeFicha(row, rango) {
  if (FICHA_DIAS[rango]) {
    return FICHA_DIAS[rango];
  }
  const fechas = [
    fechaCompraMs(row.purchaseDate),
    ...state.trades.filter((trade) => trade.rowId === row.id).map((trade) => Number(trade.at))
  ].filter((ms) => Number.isFinite(ms) && ms > 0);
  if (!fechas.length) {
    return 364;
  }
  const dias = Math.ceil((Date.now() - Math.min(...fechas)) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(7, Math.min(364, Math.ceil(dias / 7) * 7));
}

function leerCacheFicha() {
  if (!histFicha.cache) {
    const guardado = readStored(HIST_FICHA_CACHE_KEY);
    histFicha.cache = guardado && typeof guardado === "object" && !Array.isArray(guardado) ? guardado : {};
  }
  return histFicha.cache;
}

function guardarCacheFicha() {
  const cache = leerCacheFicha();
  // Solo las mas recientes: cada entrada son unos 180 precios.
  const claves = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
  claves.slice(HIST_FICHA_MAX).forEach((clave) => delete cache[clave]);
  writeStored(HIST_FICHA_CACHE_KEY, JSON.stringify(cache));
}

function claveFicha(row, rango) {
  const coinId = String(row.coinId || "").toLowerCase();
  return coinId ? `${coinId}|${state.prefs.currency}|${diasDeFicha(row, rango)}` : "";
}

function pedirHistorialFicha(row, rango) {
  const clave = claveFicha(row, rango);
  if (!clave || isOffline()) {
    return;
  }
  const [coinId, vs, dias] = clave.split("|");
  const entrada = leerCacheFicha()[clave];
  if (entrada && Date.now() - entrada.at < histSaldoTtl(Number(dias))) {
    return;
  }
  if (histFicha.pidiendo.has(clave) || Date.now() - (histFicha.fallos.get(clave) || 0) < HIST_SALDO_REINTENTO_MS) {
    return;
  }
  histFicha.pidiendo.add(clave);
  const url = `${HISTORIAL_PROXY}?ids=${encodeURIComponent(coinId)}&vs=${encodeURIComponent(vs)}&dias=${dias}`;
  fetchJsonDirect(url, 25000)
    .then((data) => {
      const precios = datosValidos(data) ? data.precios[coinId] : null;
      if (!Array.isArray(precios) || precios.length !== data.n) {
        throw new Error("sin precios");
      }
      leerCacheFicha()[clave] = { at: Date.now(), desde: data.desde, paso: data.paso, precios };
      guardarCacheFicha();
      histFicha.fallos.delete(clave);
      if (state.detailRowId === row.id && claveFicha(row, state.detailRange) === clave) {
        repintarFichaConHistorial();
      }
    })
    .catch(() => {
      histFicha.fallos.set(clave, Date.now());
    })
    .finally(() => {
      histFicha.pidiendo.delete(clave);
    });
}

// Precios del rango: [{ at, value }] o null si aun no han llegado.
function serieFicha(row, rango) {
  pedirHistorialFicha(row, rango);
  const entrada = leerCacheFicha()[claveFicha(row, rango)];
  if (!entrada || !Array.isArray(entrada.precios) || !Number.isFinite(entrada.desde) || !(entrada.paso > 0)) {
    return null;
  }
  const puntos = entrada.precios
    .map((value, i) => ({ at: entrada.desde + entrada.paso * i, value: Number(value) }))
    .filter((point) => point.value > 0);
  return puntos.length >= 2 ? puntos : null;
}
