// =============================================================================
// graficos.js - Muestreo de puntos del historial y carga diferida de Chart.js
// (solo para el grafico del PDF). La distribucion de Analitica es un anillo
// SVG propio (analitica.js).
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
