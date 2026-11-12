// =============================================================================
// graficos.js - Puntos del historial (filtro por rango y muestreo), rangos de
// tiempo y carga diferida de Chart.js (solo para el grafico del PDF). La
// distribucion de Analitica es un anillo SVG propio (analitica.js).
// =============================================================================

async function ensureChartJs() {
  if (typeof window.Chart !== "undefined") return window.Chart;
  await loadExternalScript(CHART_JS_URL);
  return window.Chart;
}

function resolveChartRange(range) {
  if (range === "1m") {
    return "1h";
  }
  return CHART_RANGE_WINDOWS[range] ? range : DEFAULT_PREFS.chartRange;
}

function renderChartsVisibility() {
  // El panel del grafico de evolucion se retiro de Analitica; el resto de
  // graficos (dona de distribucion) no depende de este control.
  dom.chartsPanel?.classList.toggle("hidden", !state.prefs.showCharts);
  if (dom.toggleChartsBtn) {
    dom.toggleChartsBtn.textContent = state.prefs.showCharts ? t("buttons.hideCharts") : t("buttons.showCharts");
  }
  renderChartRangeControl();
}

function renderChartRangeControl() {
  if (!dom.lineRangeControl) {
    return;
  }

  const activeRange = resolveChartRange(state.prefs.chartRange);
  dom.lineRangeControl.querySelectorAll("[data-range]").forEach((button) => {
    const isActive = button.dataset.range === activeRange;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function handleChartRangeClick(event) {
  const button = event.target.closest("[data-range]");
  if (!button) {
    return;
  }

  const nextRange = resolveChartRange(button.dataset.range);
  if (nextRange === state.prefs.chartRange) {
    return;
  }

  state.prefs.chartRange = nextRange;
  savePreferences();
  renderChartRangeControl();
  renderDashboardOnly();
  updateSaveMessage(t("charts.rangeUpdated"));
}

function toggleCharts() {
  state.prefs.showCharts = !state.prefs.showCharts;
  savePreferences();
  renderChartsVisibility();

  if (state.prefs.showCharts) {
    window.requestAnimationFrame(() => renderDashboardOnly());
  }
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

/* ── Efecto 3D para los gráficos del panel (plugins propios, sin dependencias) ──
   Chart.js no soporta 3D nativo. La dona se achata verticalmente vía transform
   del canvas y se extruye dibujando las paredes laterales; la línea proyecta
   una cinta de profundidad detrás del trazo. */
const PIE3D_SQUASH = 0.62;
const PIE3D_DEPTH = 14;

// Distribucion de Analitica: anillo SVG (renderAnalyticsDonut, en
// analitica.js). Chart.js ya solo se carga para el grafico del PDF.
function updateCharts(snapshot) {
  renderAnalyticsDonut(snapshot);
}
