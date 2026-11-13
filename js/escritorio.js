// =============================================================================
// escritorio.js - Version de escritorio (desde 1100 px): toda la app en una
// pagina, sin pestanas, en bandas a todo el ancho:
//   cabecera ............ saludo, nombre, acciones rapidas y botones (con Ajustes)
//   saldo ............... saldo + grafico | resumen de hoy + rendimiento
//   posiciones .......... todos los activos (la tabla)
//   analisis ............ en una linea: distribucion y comparativa | mejores y
//                         peores | mercado y categorias
//   operaciones ......... compras y ventas
//   plan ................ el plan de salida, repartido a lo ancho
//   noticias ............ en bloques; las primeras filas y "Ver todas"
// Ajustes se abre en un panel lateral. Al estrechar la ventana cada pieza
// vuelve a su sitio de la version movil (una marca guarda donde estaba).
// =============================================================================

const ESC_FILAS_NOTICIAS = 2;  // filas de noticias a la vista antes de "Ver todas"
const ESC_HUECO_BLOQUES = 12;  // separacion en las rejillas de bloques (px)
const ESC_ANCHO_ACTIVO = 340;  // ancho minimo de un activo del Plan (px)
const ESC_ANCHO_NOTICIA = 300; // ancho minimo de una noticia (px)

const escEstado = {
  activo: false,
  ajustesAbiertos: false,
  noticiasCompletas: false,
  marcas: new Map(),           // pieza -> comentario en su sitio de movil
  volverFoco: null,
  observador: null
};

function modoEscritorio() {
  return escEstado.activo;
}

// En la cabecera de escritorio ya esta el engranaje de Ajustes: el atajo ⚙
// del movil (que abre el menu de acciones) pasa a llamarse "Mas acciones".
const ESC_ICONO_MAS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
function escBotonMas(escritorio) {
  const boton = document.getElementById("quickAddBtn");
  if (!boton) {
    return;
  }
  if (escritorio && !boton.dataset.htmlMovil) {
    boton.dataset.htmlMovil = boton.innerHTML;
    boton.innerHTML = `<span class="accion-icono">${ESC_ICONO_MAS}</span><span data-i18n="buttons.moreActions">${escapeHtml(t("buttons.moreActions"))}</span>`;
  } else if (!escritorio && boton.dataset.htmlMovil) {
    boton.innerHTML = boton.dataset.htmlMovil;
    delete boton.dataset.htmlMovil;
  }
}

// Cada pieza y el hueco de la pagina de escritorio al que va (en orden).
function escPiezas() {
  const panel = (id) => document.getElementById(id)?.closest(".panel");
  return [
    [document.querySelector(".inicio-cabecera"), "cabecera"],
    [document.getElementById("mainValueCard"), "saldo"],
    [document.querySelector('[data-bloque="grafico"]'), "saldo"],
    // Acciones rapidas: en la cabecera fija, siempre a mano.
    [document.querySelector('[data-bloque="acciones"]'), "acciones"],
    [document.getElementById("summaryGrid"), "lateral"],
    [document.querySelector(".analytics-summary-panel"), "lateral"],
    [document.querySelector(".seccion-escritorio .table-panel"), "posiciones"],
    [panel("analyticsDonut"), "analisis1"],
    [panel("analyticsCompare"), "analisis1"],
    [panel("insightsRankingsGrid"), "analisis2"],
    [document.querySelector('[data-bloque="mercado"]'), "analisis3"],
    [panel("analyticsCategory"), "analisis3"],
    [panel("analyticsActivityStats"), "operaciones"],
    [document.querySelector('.tab-section[data-tab="plan"]'), "plan"],
    [document.querySelector('.tab-section[data-tab="news"]'), "noticias"]
  ].filter(([nodo]) => nodo);
}

function escMover(nodo, destino) {
  if (!nodo || !destino) {
    return;
  }
  if (!escEstado.marcas.has(nodo)) {
    const marca = document.createComment("sitio en movil");
    nodo.before(marca);
    escEstado.marcas.set(nodo, marca);
  }
  destino.appendChild(nodo);
}

function escDevolverTodo() {
  escEstado.marcas.forEach((marca, nodo) => {
    if (marca.isConnected) {
      marca.replaceWith(nodo);
    }
  });
  escEstado.marcas.clear();
}

function bindEscritorio() {
  document.getElementById("escAjustesBtn")?.addEventListener("click", () => abrirAjustes());
  document.getElementById("escAjustesCerrar")?.addEventListener("click", () => cerrarAjustes());
  document.getElementById("escVelo")?.addEventListener("click", () => cerrarAjustes());
  // La ficha de un activo es un panel lateral: pulsar fuera la cierra.
  document.getElementById("escVeloFicha")?.addEventListener("click", () => closeAssetDetail());
  document.getElementById("escNoticiasMas")?.addEventListener("click", () => {
    escEstado.noticiasCompletas = !escEstado.noticiasCompletas;
    escAjustarNoticias();
  });

  // Al cambiar el ancho cambia cuantas noticias caben por fila.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!escEstado.activo) {
      return;
    }
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      escAjustarNoticias();
      escAjustarPlan();
    }, 150);
  });

  // El grafico del saldo llena el alto de su tarjeta: si cambia, se redibuja.
  if (typeof ResizeObserver === "function") {
    let alto = 0;
    escEstado.observador = new ResizeObserver(([entrada]) => {
      const nuevo = Math.round(entrada.contentRect.height);
      if (escEstado.activo && nuevo && Math.abs(nuevo - alto) > 2) {
        alto = nuevo;
        window.requestAnimationFrame(() => renderHomeChart());
      }
    });
  }
}

// Al pasar a pantalla ancha.
function activarEscritorio() {
  const raiz = document.getElementById("escritorio");
  if (escEstado.activo || !raiz) {
    return;
  }
  escEstado.activo = true;
  raiz.hidden = false;
  document.body.classList.add("es-escritorio");
  escPiezas().forEach(([nodo, hueco]) => {
    const destino = hueco === "acciones"
      ? raiz.querySelector(".esc-cabecera .inicio-cabecera")
      : raiz.querySelector(`[data-esc-hueco="${hueco}"]`);
    escMover(nodo, destino);
  });
  escBotonMas(true);
  updateStickyBarVisibility();

  // Todo esta a la vista: se pinta lo que en movil esperaba a su pestana.
  renderTableBody();
  renderDashboardOnly();
  renderPlan();
  renderNews();
  fetchNews(false);
  if (dom.graficoSaldo && escEstado.observador) {
    escEstado.observador.observe(dom.graficoSaldo);
  }
  renderHomeChart();
  refitAmounts();
}

// Al volver a pantalla estrecha: cada pieza a su sitio y manda la pestana.
function desactivarEscritorio() {
  if (!escEstado.activo) {
    return;
  }
  cerrarAjustes({ devolverFoco: false });
  escEstado.observador?.disconnect();
  escDevolverTodo();
  escBotonMas(false);
  document.getElementById("escritorio").hidden = true;
  document.body.classList.remove("es-escritorio");
  escEstado.activo = false;
  escAjustarNoticias();
  applyHomeBlocks();
  renderHomeChart();
  setActiveTab(state.prefs.activeTab);
}

function cambioDeAncho() {
  if (MQ_ESCRITORIO?.matches) {
    activarEscritorio();
  } else {
    desactivarEscritorio();
  }
  pintarPendientes();
}

// Cuantos bloques caben por fila en una caja.
function escCabenPorFila(caja, minAncho) {
  const ancho = caja.clientWidth || 0;
  return Math.max(1, Math.floor((ancho + ESC_HUECO_BLOQUES) / (minAncho + ESC_HUECO_BLOQUES)));
}

// Activos del Plan: tantos por fila como para que las filas salgan parejas
// (6 activos con sitio para 5 van 3 y 3, no 5 y 1).
function escAjustarPlan() {
  const caja = document.querySelector(".escritorio .tp-activos");
  if (!escEstado.activo || !caja) {
    return;
  }
  const n = caja.children.length;
  const max = escCabenPorFila(caja, ESC_ANCHO_ACTIVO);
  const filas = Math.max(1, Math.ceil(n / max));
  caja.style.setProperty("--cols", String(Math.max(1, Math.ceil(n / filas))));
}

// Noticias en bloques: a la vista, las primeras filas (tantas noticias como
// quepan por fila); "Ver todas" ensena el resto.
function escAjustarNoticias() {
  const lista = document.getElementById("newsList");
  const boton = document.getElementById("escNoticiasMas");
  if (!lista || !boton) {
    return;
  }
  const items = [...lista.querySelectorAll(":scope > .news-card:not(.is-skeleton)")];
  if (!escEstado.activo) {
    items.forEach((item) => { item.hidden = false; });
    boton.hidden = true;
    return;
  }
  const porFila = escCabenPorFila(lista, ESC_ANCHO_NOTICIA);
  lista.style.setProperty("--cols", String(porFila));
  const aLaVista = porFila * ESC_FILAS_NOTICIAS;
  const limite = escEstado.noticiasCompletas ? Infinity : aLaVista;
  items.forEach((item, i) => { item.hidden = i >= limite; });
  boton.hidden = items.length <= aLaVista;
  boton.textContent = escEstado.noticiasCompletas
    ? t("news.verMenos")
    : t("news.verTodas", { n: items.length });
}

// Plan al dia en escritorio (en movil se pinta al abrir su pestana). No se
// repinta mientras se escribe en uno de sus campos.
function escRepintarPlan() {
  if (!escEstado.activo) {
    return;
  }
  const plan = document.getElementById("planContent");
  if (plan && plan.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    return;
  }
  renderPlan();
}

// ── Ajustes en panel lateral ──
function abrirAjustes() {
  if (!escEstado.activo) {
    setActiveTab("more");
    return;
  }
  const panel = document.getElementById("ajustesSeccion");
  if (!panel || escEstado.ajustesAbiertos) {
    return;
  }
  escEstado.ajustesAbiertos = true;
  escEstado.volverFoco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderDiagnostics();
  renderAlertsPanel();
  renderWalletsPanel();
  renderAppearanceControls();
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.scrollTop = 0;
  document.body.classList.add("ajustes-abierto");
  document.getElementById("escVelo").hidden = false;
  document.getElementById("escAjustesBtn")?.setAttribute("aria-expanded", "true");
  document.getElementById("escAjustesCerrar")?.focus({ preventScroll: true });
}

function cerrarAjustes({ devolverFoco = true } = {}) {
  if (!escEstado.ajustesAbiertos) {
    return;
  }
  escEstado.ajustesAbiertos = false;
  const panel = document.getElementById("ajustesSeccion");
  panel?.removeAttribute("role");
  panel?.removeAttribute("aria-modal");
  document.body.classList.remove("ajustes-abierto");
  document.getElementById("escVelo").hidden = true;
  document.getElementById("escAjustesBtn")?.setAttribute("aria-expanded", "false");
  if (devolverFoco && escEstado.volverFoco?.isConnected) {
    escEstado.volverFoco.focus({ preventScroll: true });
  }
  escEstado.volverFoco = null;
}
