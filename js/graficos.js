// =============================================================================
// graficos.js - Muestreo de puntos del historial, la capa tactil de los
// graficos de area (Inicio y ficha: valor y fecha al tocar o pasar el raton)
// y la carga diferida de Chart.js (solo para el grafico del PDF). La
// distribucion de Analitica es un anillo SVG propio (analitica.js).
// =============================================================================

async function ensureChartJs() {
  if (typeof window.Chart !== "undefined") return window.Chart;
  await loadExternalScript(CHART_JS_URL);
  return window.Chart;
}

// El histórico puede tener miles de puntos; para el gráfico basta una muestra.
function downsampleHistoryPoints(points, maxPoints = 480) {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = Math.ceil(points.length / maxPoints);
  const sampled = points.filter((_, index) => index % stride === 0);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
}

// Distribucion de Analitica: anillo SVG (renderAnalyticsDonut, en
// analitica.js). Chart.js ya solo se carga para el grafico del PDF.
function updateCharts(snapshot) {
  renderAnalyticsDonut(snapshot);
}

// ── Graficos que se pueden tocar ──
// Tocando y arrastrando (o pasando el raton, o con las flechas del teclado)
// aparece una linea vertical con el punto y una etiqueta con el valor y la
// fecha de ese momento. Mientras se mira, el grafico no se redibuja (los
// precios en vivo lo moverian bajo el dedo): se redibuja al soltar.
const GRAFICO_TACTIL_MS = 2500; // en tactil, la etiqueta sigue a la vista tras soltar
const graficosTactiles = new WeakMap(); // caja -> estado

// grafico: lo que devuelve areaChartSvg. opciones.valor(punto) da el texto
// del valor; opciones.extra(punto, primero) un dato opcional (por ejemplo el
// cambio desde el inicio del periodo, como { texto, tono }).
function dibujarGrafico(box, grafico, opciones = {}) {
  const estado = estadoGraficoTactil(box);
  if (estado.indice != null) {
    estado.pendiente = () => dibujarGrafico(box, grafico, opciones);
    return;
  }
  box.innerHTML = grafico.html;
  estado.grafico = grafico;
  estado.opciones = opciones;
}

function estadoGraficoTactil(box) {
  let estado = graficosTactiles.get(box);
  if (estado) {
    return estado;
  }
  estado = { grafico: null, opciones: {}, indice: null, pendiente: null, temporizador: null };
  graficosTactiles.set(box, estado);
  box.classList.add("es-tactil");
  box.tabIndex = 0;
  box.setAttribute("aria-label", t("grafico.ayuda"));

  const desdePuntero = (event) => {
    const svg = box.querySelector("svg");
    const g = estado.grafico;
    if (!svg || !g) {
      return null;
    }
    const caja = svg.getBoundingClientRect();
    if (!caja.width) {
      return null;
    }
    const x = ((event.clientX - caja.left) / caja.width) * g.width;
    let mejor = 0;
    g.xy.forEach((p, i) => {
      if (Math.abs(p[0] - x) < Math.abs(g.xy[mejor][0] - x)) {
        mejor = i;
      }
    });
    return mejor;
  };
  const mover = (event) => {
    const indice = desdePuntero(event);
    if (indice != null) {
      window.clearTimeout(estado.temporizador);
      mostrarCursorGrafico(box, estado, indice);
    }
  };

  box.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    mover(event);
  });
  box.addEventListener("pointermove", (event) => {
    // Con raton basta pasar por encima; en tactil, solo con el dedo puesto.
    if (event.pointerType === "mouse" || estado.indice != null) {
      mover(event);
    }
  });
  box.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      ocultarCursorGrafico(box, estado);
    }
  });
  box.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "mouse") {
      window.clearTimeout(estado.temporizador);
      estado.temporizador = window.setTimeout(() => ocultarCursorGrafico(box, estado), GRAFICO_TACTIL_MS);
    }
  });
  // Deslizar en vertical es desplazar la pagina: el navegador cancela el gesto.
  box.addEventListener("pointercancel", () => ocultarCursorGrafico(box, estado));
  box.addEventListener("keydown", (event) => {
    const total = estado.grafico?.xy.length || 0;
    if (!total || !box.querySelector("svg")) {
      return;
    }
    const actual = estado.indice ?? total - 1;
    const destino = {
      ArrowLeft: Math.max(0, actual - 1),
      ArrowRight: Math.min(total - 1, actual + 1),
      Home: 0,
      End: total - 1
    }[event.key];
    if (destino != null) {
      event.preventDefault();
      mostrarCursorGrafico(box, estado, destino);
    } else if (event.key === "Escape" && estado.indice != null) {
      ocultarCursorGrafico(box, estado);
    }
  });
  box.addEventListener("blur", () => ocultarCursorGrafico(box, estado));
  return estado;
}

function formatoFechaGrafico(at, span) {
  const opciones = span <= 100 * 24 * 60 * 60 * 1000
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" };
  try {
    return intlFormatter("date", getUiLocale(), opciones).format(new Date(at));
  } catch {
    return new Date(at).toLocaleString();
  }
}

function mostrarCursorGrafico(box, estado, indice) {
  const g = estado.grafico;
  const svg = box.querySelector("svg");
  if (!g || !svg || !g.puntos[indice]) {
    return;
  }
  estado.indice = indice;
  const [x, y] = g.xy[indice];
  const ns = "http://www.w3.org/2000/svg";
  let linea = svg.querySelector(".grafico-cursor-linea");
  let punto = svg.querySelector(".grafico-cursor-punto");
  if (!linea) {
    linea = document.createElementNS(ns, "line");
    linea.setAttribute("class", "grafico-cursor-linea");
    punto = document.createElementNS(ns, "circle");
    punto.setAttribute("class", "grafico-cursor-punto");
    punto.setAttribute("r", "5");
    svg.append(linea, punto);
  }
  linea.setAttribute("x1", x.toFixed(1));
  linea.setAttribute("x2", x.toFixed(1));
  linea.setAttribute("y1", "0");
  linea.setAttribute("y2", String(g.height));
  punto.setAttribute("cx", x.toFixed(1));
  punto.setAttribute("cy", y.toFixed(1));
  box.classList.add("con-cursor");

  let etiqueta = box.querySelector(".grafico-etiqueta");
  if (!etiqueta) {
    etiqueta = document.createElement("div");
    etiqueta.className = "grafico-etiqueta";
    etiqueta.setAttribute("role", "status");
    etiqueta.setAttribute("aria-live", "polite");
    box.appendChild(etiqueta);
  }
  const p = g.puntos[indice];
  const primero = g.puntos[0];
  const span = g.puntos[g.puntos.length - 1].at - primero.at;
  const valor = estado.opciones.valor ? estado.opciones.valor(p) : String(p.value);
  const extra = estado.opciones.extra ? estado.opciones.extra(p, primero) : null;
  etiqueta.innerHTML = `
    <strong>${escapeHtml(valor)}${extra ? ` <span class="${escapeHtml(extra.tono || "")}">${escapeHtml(extra.texto)}</span>` : ""}</strong>
    <small>${escapeHtml(formatoFechaGrafico(p.at, span))}</small>`;
  // La etiqueta va al lado de la linea (a la derecha en la mitad izquierda y
  // al reves), sin salirse de la caja.
  const escala = svg.getBoundingClientRect().width / g.width || 1;
  const xPx = x * escala;
  const ancho = etiqueta.offsetWidth;
  const anchoCaja = box.clientWidth;
  const izquierda = xPx < anchoCaja / 2 ? xPx + 10 : xPx - 10 - ancho;
  etiqueta.style.left = `${Math.max(0, Math.min(anchoCaja - ancho, izquierda))}px`;
}

function ocultarCursorGrafico(box, estado) {
  window.clearTimeout(estado.temporizador);
  if (estado.indice == null) {
    return;
  }
  estado.indice = null;
  box.classList.remove("con-cursor");
  box.querySelector(".grafico-etiqueta")?.remove();
  box.querySelectorAll(".grafico-cursor-linea, .grafico-cursor-punto").forEach((el) => el.remove());
  const pendiente = estado.pendiente;
  estado.pendiente = null;
  if (pendiente) {
    pendiente();
  }
}
