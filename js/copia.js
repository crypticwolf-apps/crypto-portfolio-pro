// =============================================================================
// copia.js - Copia de seguridad completa: un archivo con todo lo que la app
// guarda en este dispositivo (posiciones, compras y ventas, alertas,
// billeteras, plan, historial y ajustes), para guardarlo aparte o pasarlo a
// otro movil u ordenador. La clave de CoinStats NO va dentro: es un secreto y
// se queda solo en este dispositivo.
//
// Restaurar reemplaza todo lo de este dispositivo por la copia (con aviso) y
// recarga la app, que la lee igual que si la hubiera guardado ella.
// Un aviso en Inicio recuerda hacer copia si hace mucho de la ultima.
// =============================================================================

const COPIA_FORMATO = "crypto-portfolio-pro-copia";
const COPIA_VERSION = 1;
const COPIA_AVISO_DIAS = 30;      // sin copia desde hace mas de esto: aviso en Inicio
const COPIA_PRIMER_AVISO_DIAS = 7; // sin ninguna copia: aviso tras una semana de uso
const COPIA_POSPONER_DIAS = 7;    // "Mas tarde"
const COPIA_MAX_BYTES = 20 * 1024 * 1024;
const DIA_MS = 24 * 60 * 60 * 1000;

function contarCopia(cartera) {
  const filas = Array.isArray(cartera?.rows) ? cartera.rows : [];
  return {
    posiciones: filas.filter((row) => row && (String(row.crypto || "").trim() || parseDecimal(row.investment) > 0 || parseDecimal(row.tokens) > 0)).length,
    operaciones: Array.isArray(cartera?.trades) ? cartera.trades.length : 0,
    alertas: Array.isArray(cartera?.alerts) ? cartera.alerts.length : 0,
    billeteras: Array.isArray(cartera?.wallets) ? cartera.wallets.length : 0
  };
}

function crearCopia() {
  const cartera = datosParaGuardar();
  return {
    formato: COPIA_FORMATO,
    version: COPIA_VERSION,
    creada: new Date().toISOString(),
    resumen: contarCopia(cartera),
    datos: {
      cartera,
      ajustes: { ...state.prefs },
      historial: { points: compactHistoryPoints(state.history) }
    }
  };
}

function guardarCopia() {
  const copia = crearCopia();
  const nombre = `crypto-portfolio-pro-copia-${formatFileDate(new Date())}.json`;
  downloadTextFile(nombre, JSON.stringify(copia), "application/json");
  state.prefs.copiaUltima = Date.now();
  state.prefs.copiaPospuesta = 0;
  savePreferences();
  pintarCopia();
  showToast(t("copia.guardadaTitulo"), t("copia.guardadaTexto", { n: copia.resumen.posiciones, ops: copia.resumen.operaciones }), "positive");
}

// Comprueba que el archivo es una copia de esta app que se puede leer. Lanza
// un Error con el texto para el usuario si no.
function validarCopia(copia) {
  const esObjeto = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!esObjeto(copia) || copia.formato !== COPIA_FORMATO) {
    throw new Error(t("copia.noEsCopia"));
  }
  if (!(Number(copia.version) >= 1)) {
    throw new Error(t("copia.noEsCopia"));
  }
  if (Number(copia.version) > COPIA_VERSION) {
    throw new Error(t("copia.masNueva"));
  }
  const datos = copia.datos;
  if (!esObjeto(datos) || !esObjeto(datos.cartera) || !Array.isArray(datos.cartera.rows)) {
    throw new Error(t("copia.danada"));
  }
  if (datos.ajustes != null && !esObjeto(datos.ajustes)) {
    throw new Error(t("copia.danada"));
  }
  if (datos.historial != null && !(esObjeto(datos.historial) && Array.isArray(datos.historial.points))) {
    throw new Error(t("copia.danada"));
  }
  return copia;
}

async function leerArchivoCopia(file) {
  if (file.size > COPIA_MAX_BYTES) {
    throw new Error(t("copia.demasiadoGrande"));
  }
  let copia;
  try {
    copia = JSON.parse(await file.text());
  } catch {
    throw new Error(t("copia.noEsCopia"));
  }
  return validarCopia(copia);
}

// Escribe la copia en el dispositivo y recarga. Si no cabe, deja todo como
// estaba.
function aplicarCopia(copia) {
  const claves = [STORAGE_KEY, PREFS_KEY, HISTORY_KEY];
  const antes = new Map();
  claves.forEach((clave) => {
    try {
      antes.set(clave, localStorage.getItem(clave));
    } catch {
      antes.set(clave, null);
    }
  });
  const creada = new Date(copia.creada).getTime();
  const ajustes = {
    ...(copia.datos.ajustes || {}),
    // Lo de este dispositivo coincide con la copia: cuenta como copia hecha.
    copiaUltima: Number.isFinite(creada) ? creada : Date.now(),
    copiaPospuesta: 0
  };
  // A partir de aqui nada de lo que hay en memoria se guarda.
  state.restaurando = true;
  window.clearTimeout(state.autosaveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copia.datos.cartera));
    localStorage.setItem(PREFS_KEY, JSON.stringify(ajustes));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(copia.datos.historial || { points: [] }));
  } catch {
    antes.forEach((valor, clave) => {
      try {
        if (valor == null) {
          localStorage.removeItem(clave);
        } else {
          localStorage.setItem(clave, valor);
        }
      } catch {
        // Sin almacenamiento: no se puede hacer nada mas.
      }
    });
    state.restaurando = false;
    throw new Error(t("copia.sinEspacio"));
  }
  // Los precios pasados del grafico eran de la cartera anterior.
  try {
    localStorage.removeItem(HIST_SALDO_CACHE_KEY);
  } catch {
    // Es solo una cache.
  }
  window.location.reload();
}

async function restaurarCopia(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  try {
    const copia = await leerArchivoCopia(file);
    const r = copia.resumen && typeof copia.resumen === "object" ? copia.resumen : contarCopia(copia.datos.cartera);
    const fecha = Number.isFinite(new Date(copia.creada).getTime())
      ? formatDateTime(new Date(copia.creada))
      : "--";
    const ok = window.confirm(t("copia.confirmar", {
      fecha,
      n: Number(r.posiciones) || 0,
      ops: Number(r.operaciones) || 0
    }));
    if (!ok) {
      return;
    }
    aplicarCopia(copia);
  } catch (error) {
    showToast(t("copia.errorTitulo"), error.message || t("copia.noEsCopia"), "negative");
  }
}

// ── Aviso en Inicio y estado en Ajustes ──

function diasDesde(ms) {
  return Math.floor((Date.now() - ms) / DIA_MS);
}

// Hay algo que perder: alguna posicion con dinero o cantidad.
function hayDatosQueGuardar() {
  return state.rows.some((row) => parseDecimal(row.investment) > 0 || parseDecimal(row.tokens) > 0);
}

function debeAvisarCopia() {
  const prefs = state.prefs;
  if (!hayDatosQueGuardar() || Date.now() < (Number(prefs.copiaPospuesta) || 0)) {
    return false;
  }
  const ultima = Number(prefs.copiaUltima) || 0;
  if (ultima) {
    return diasDesde(ultima) >= COPIA_AVISO_DIAS;
  }
  // Nunca se ha hecho: se espera a una semana de uso (el historial guardado
  // dice desde cuando se usa la app en este dispositivo).
  const primero = state.history.length ? new Date(state.history[0].at).getTime() : Date.now();
  return diasDesde(primero) >= COPIA_PRIMER_AVISO_DIAS;
}

function textoUltimaCopia() {
  const ultima = Number(state.prefs.copiaUltima) || 0;
  if (!ultima) {
    return t("copia.nunca");
  }
  const dias = diasDesde(ultima);
  if (dias <= 0) {
    return t("copia.ultimaHoy");
  }
  return dias === 1 ? t("copia.ultimaAyer") : t("copia.ultimaDias", { n: dias });
}

function pintarCopia() {
  const estado = document.getElementById("copiaEstado");
  if (estado) {
    estado.textContent = textoUltimaCopia();
  }
  const aviso = document.getElementById("avisoCopia");
  if (!aviso) {
    return;
  }
  const mostrar = debeAvisarCopia();
  aviso.hidden = !mostrar;
  if (mostrar) {
    const ultima = Number(state.prefs.copiaUltima) || 0;
    document.getElementById("avisoCopiaTexto").textContent = ultima
      ? t("copia.avisoViejo", { n: diasDesde(ultima) })
      : t("copia.avisoNunca");
  }
}

function posponerCopia() {
  state.prefs.copiaPospuesta = Date.now() + COPIA_POSPONER_DIAS * DIA_MS;
  savePreferences();
  pintarCopia();
}

function bindCopia() {
  document.getElementById("copiaGuardarBtn")?.addEventListener("click", guardarCopia);
  const archivo = document.getElementById("copiaArchivo");
  document.getElementById("copiaRestaurarBtn")?.addEventListener("click", () => archivo?.click());
  archivo?.addEventListener("change", restaurarCopia);
  document.getElementById("avisoCopia")?.addEventListener("click", (event) => {
    const accion = event.target.closest("[data-copia]")?.dataset.copia;
    if (accion === "guardar") {
      guardarCopia();
    } else if (accion === "posponer") {
      posponerCopia();
    }
  });
  pintarCopia();
}
