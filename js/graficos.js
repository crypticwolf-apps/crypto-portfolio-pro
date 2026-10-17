// =============================================================================
// graficos.js - Graficos con Chart.js (carga diferida): evolucion, tarta 3D,
// rangos de tiempo y preparacion de los puntos del historial.
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

// Defer Chart.js download until the charts panel is actually about to show.
function observeChartsPanelForLazyLoad() {
  if (!state.prefs.showCharts) return;
  if (typeof window.IntersectionObserver === "undefined") {
    // Fallback: fetch immediately but async, off the critical path.
    window.setTimeout(() => ensureChartJs().catch(() => {}), 800);
    return;
  }
  const panel = document.getElementById("chartsPanel");
  if (!panel) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        io.disconnect();
        ensureChartJs().then(() => {
          // Trigger first paint of charts now that the lib is ready.
          updateCharts(buildSnapshot());
        }).catch(() => {});
        break;
      }
    }
  }, { rootMargin: "200px 0px" });
  io.observe(panel);
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
    window.requestAnimationFrame(() => {
      renderDashboardOnly();
      state.charts.pie?.resize();
      state.charts.line?.resize();
    });
  }
}

function getRangeFilteredHistoryPoints(snapshot) {
  const now = Date.now();
  const range = resolveChartRange(state.prefs.chartRange);
  const rangeWindow = CHART_RANGE_WINDOWS[range] ?? CHART_RANGE_WINDOWS.total;
  const filtered = state.history.filter((point) => {
    if (point.currency !== state.prefs.currency) {
      return false;
    }

    if (!Number.isFinite(new Date(point.at).getTime())) {
      return false;
    }

    if (!Number.isFinite(rangeWindow)) {
      return true;
    }

    return now - new Date(point.at).getTime() <= rangeWindow;
  });

  if (filtered.length) {
    return filtered;
  }

  return snapshot.totals.currentValue > 0
    ? [{ at: new Date().toISOString(), total: snapshot.totals.currentValue, currency: state.prefs.currency }]
    : [];
}

// El formato de la etiqueta depende del periodo REAL que cubren los datos,
// no del rango elegido: con rango "1 semana" pero datos de un solo día se
// mostraban "10 jun, 10 jun, 10 jun..." repetidos. Con el periodo real corto
// se muestran horas; al crecer el histórico aparecen días/meses solos.
function formatHistoryLabel(date, spanMs, forceTime = false) {
  const HOURS_26 = 26 * 60 * 60 * 1000;
  const DAYS_8 = 8 * 24 * 60 * 60 * 1000;
  const DAYS_200 = 200 * 24 * 60 * 60 * 1000;
  let options;

  if (spanMs <= HOURS_26) {
    options = { hour: "2-digit", minute: "2-digit" };
  } else if (spanMs <= DAYS_8) {
    options = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  } else if (spanMs <= DAYS_200) {
    options = forceTime
      ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" };
  } else {
    options = forceTime
      ? { day: "2-digit", month: "short", year: "2-digit" }
      : { month: "short", year: "2-digit" };
  }

  return new Intl.DateTimeFormat(getUiLocale(), options).format(date);
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

// Etiquetas del eje X: solo ~N ticks repartidos, con desambiguación si dos
// etiquetas consecutivas saldrían iguales (se les añade la hora).
function buildLineTickLabels(points) {
  const count = points.length;
  if (!count) {
    return [];
  }

  const spanMs = new Date(points[count - 1].at).getTime() - new Date(points[0].at).getTime();
  const stride = Math.max(1, Math.ceil(count / getLineTickLimit()));
  let previousLabel = "";

  return points.map((point, index) => {
    if (index % stride !== 0) {
      return "";
    }

    const date = new Date(point.at);
    let label = formatHistoryLabel(date, spanMs);
    if (label === previousLabel) {
      label = formatHistoryLabel(date, spanMs, true);
    }
    previousLabel = label;
    return label;
  });
}

function getLineTickLimit() {
  const range = resolveChartRange(state.prefs.chartRange);

  let limit = 8;
  if (range === "1m" || range === "1d") {
    limit = 6;
  } else if (range === "1w" || range === "1mo") {
    limit = 7;
  }

  // En pantallas estrechas caben menos etiquetas sin amontonarse.
  if (typeof window !== "undefined" && window.innerWidth <= 480) {
    limit = Math.max(4, limit - 2);
  }

  return limit;
}

// Cabecera del gráfico de evolución: valor actual + variación del rango
// elegido, y estado vacío elegante mientras no haya historial suficiente.
function renderLineChartSummary(points) {
  const summary = document.getElementById("lineChartSummary");
  const valueNode = document.getElementById("lineChartValue");
  const deltaNode = document.getElementById("lineChartDelta");
  const emptyNode = document.getElementById("lineChartEmpty");

  if (emptyNode) {
    emptyNode.classList.toggle("hidden", points.length >= 2);
  }

  if (!summary || !valueNode || !deltaNode) {
    return;
  }

  if (!points.length) {
    summary.hidden = true;
    return;
  }

  summary.hidden = false;
  const last = Number(points[points.length - 1].total || 0);
  valueNode.textContent = formatCurrency(last);

  if (points.length >= 2) {
    const first = Number(points[0].total || 0);
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    deltaNode.textContent = formatSignedPercent(pct);
    deltaNode.className = `delta-chip ${pct > 0 ? "good" : pct < 0 ? "error" : "warn"}`;
    deltaNode.hidden = false;
  } else {
    deltaNode.hidden = true;
  }
}

/* ── Efecto 3D para los gráficos del panel (plugins propios, sin dependencias) ──
   Chart.js no soporta 3D nativo. La dona se achata verticalmente vía transform
   del canvas y se extruye dibujando las paredes laterales; la línea proyecta
   una cinta de profundidad detrás del trazo. */
const PIE3D_SQUASH = 0.62;
const PIE3D_DEPTH = 14;

function getPie3dGeometry(chart) {
  const area = chart.chartArea;
  if (!area) {
    return null;
  }

  const centerY = (area.top + area.bottom) / 2;
  return {
    squash: PIE3D_SQUASH,
    // Centra la elipse y la sube media profundidad para que la pared inferior
    // no se salga del área de dibujo. visualY = offset + squash * modelY
    offset: centerY * (1 - PIE3D_SQUASH) - PIE3D_DEPTH / 2
  };
}

const pie3dPlugin = {
  id: "pie3d",
  beforeEvent(chart, args) {
    // El dibujado está achatado: se invierte la transformación en el evento
    // para que hover y tooltip coincidan con lo que se ve en pantalla.
    const geom = getPie3dGeometry(chart);
    const event = args.event;
    if (geom && typeof event.y === "number") {
      event.y = (event.y - geom.offset) / geom.squash;
    }
  },
  beforeDatasetsDraw(chart) {
    const geom = getPie3dGeometry(chart);
    if (!geom) {
      return;
    }

    const ctx = chart.ctx;
    ctx.save();
    ctx.translate(0, geom.offset);
    ctx.scale(1, geom.squash);

    const meta = chart.getDatasetMeta(0);
    const depth = PIE3D_DEPTH / geom.squash;

    (meta?.data || []).forEach((arc) => {
      const props = arc.getProps(["x", "y", "innerRadius", "outerRadius", "startAngle", "endAngle"]);

      // Pared lateral: banda entre el borde superior y el mismo borde
      // desplazado hacia abajo, sombreada sobre el color del segmento.
      const fillWall = (radius, from, to, shade) => {
        if (from >= to || radius <= 0) {
          return;
        }
        ctx.beginPath();
        ctx.arc(props.x, props.y + depth, radius, from, to);
        ctx.arc(props.x, props.y, radius, to, from, true);
        ctx.closePath();
        ctx.fillStyle = arc.options.backgroundColor;
        ctx.fill();
        ctx.fillStyle = shade;
        ctx.fill();
      };

      // Pared exterior: solo la mitad frontal (ángulos 0..PI en pantalla).
      fillWall(props.outerRadius, Math.max(props.startAngle, 0), Math.min(props.endAngle, Math.PI), "rgba(0, 0, 0, 0.34)");
      // Pared interior vista a través del agujero (mitad trasera).
      fillWall(props.innerRadius, props.startAngle, Math.min(props.endAngle, 0), "rgba(0, 0, 0, 0.5)");
      fillWall(props.innerRadius, Math.max(props.startAngle, Math.PI), props.endAngle, "rgba(0, 0, 0, 0.5)");
    });
  },
  afterDatasetsDraw(chart) {
    if (chart.chartArea) {
      chart.ctx.restore();
    }
  }
};

// Posicionador de tooltip que proyecta el punto del arco al espacio achatado.
function registerChart3dTooltipPositioner() {
  const tooltipPlugin = window.Chart?.Tooltip;
  if (!tooltipPlugin?.positioners || tooltipPlugin.positioners.pie3d) {
    return;
  }

  tooltipPlugin.positioners.pie3d = function (items) {
    const chart = this.chart;
    const geom = chart ? getPie3dGeometry(chart) : null;
    if (!items.length || !geom) {
      return false;
    }

    const pos = items[0].element.tooltipPosition();
    return { x: pos.x, y: geom.offset + geom.squash * pos.y };
  };
}

// Fechas completas para el título del tooltip de la línea (paralelo a data).
let lineTooltipTitles = [];

async function updateCharts(snapshot) {
  if (!state.prefs.showCharts) return;
  if (typeof window.Chart === "undefined") {
    if (chartsLibLoading) return;
    chartsLibLoading = true;
    try {
      await ensureChartJs();
    } catch {
      chartsLibLoading = false;
      return;
    }
    chartsLibLoading = false;
    // Use the freshest snapshot rather than the stale closure.
    snapshot = buildSnapshot();
  }

  const pieItems = snapshot.items
    .filter((item) => item.metrics.currentValue > 0)
    .sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);
  const maxSegments = 6;
  const visibleItems = pieItems.slice(0, maxSegments);
  const otherValue = pieItems
    .slice(maxSegments)
    .reduce((total, item) => total + item.metrics.currentValue, 0);
  const rawPieLabels = visibleItems.map((item) => assetDisplayName(item.row));
  const rawPieValues = visibleItems.map((item) => Number(item.metrics.currentValue.toFixed(2)));
  const pieLabels = otherValue > 0 ? [...rawPieLabels, t("charts.others")] : rawPieLabels;
  const pieValues = otherValue > 0 ? [...rawPieValues, Number(otherValue.toFixed(2))] : rawPieValues;
  const hasPieData = pieValues.length > 0;
  const palette = [
    "#53d3a2",
    "#4ea0ff",
    "#f6c164",
    "#ff7f78",
    "#7dc9ff",
    "#8f79ff",
    "#7ee2cb",
    "#f49cc0"
  ];

  const historyPoints = downsampleHistoryPoints(getRangeFilteredHistoryPoints(snapshot));
  const lineLabels = buildLineTickLabels(historyPoints);
  const lineValues = historyPoints.map((point) => point.total);
  lineTooltipTitles = historyPoints.map((point) => formatDateTime(new Date(point.at)));
  renderLineChartSummary(historyPoints);
  const textColor = getCssVar("--muted");
  const borderColor = getCssVar("--line");
  const accent = getCssVar("--accent");
  const accent2 = getCssVar("--accent-2");
  const pieDatasetValues = hasPieData ? pieValues : [1];
  const pieDatasetLabels = hasPieData ? pieLabels : [t("charts.noData")];
  const pieColors = hasPieData
    ? pieDatasetLabels.map((_, index) => palette[index % palette.length])
    : [borderColor];

  registerChart3dTooltipPositioner();

  if (!state.charts.pie) {
    state.charts.pie = new Chart(dom.portfolioPieChart, {
      type: "doughnut",
      plugins: [pie3dPlugin],
      data: {
        labels: pieDatasetLabels,
        datasets: [
          {
            data: pieDatasetValues,
            backgroundColor: pieColors,
            borderWidth: 0,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            display: hasPieData,
            labels: { color: textColor, boxWidth: 12, padding: 18 }
          },
          tooltip: {
            position: "pie3d",
            callbacks: {
              label(context) {
                if (!hasPieData) {
                  return t("charts.insufficientData");
                }
                return `${context.label}: ${formatCurrency(context.raw)}`;
              }
            }
          }
        }
      }
    });
  } else {
    state.charts.pie.data.labels = pieDatasetLabels;
    state.charts.pie.data.datasets[0].data = pieDatasetValues;
    state.charts.pie.data.datasets[0].backgroundColor = pieColors;
    state.charts.pie.options.plugins.legend.display = hasPieData;
    state.charts.pie.options.plugins.legend.labels.color = textColor;
    state.charts.pie.update();
  }

  if (!state.charts.line && dom.portfolioLineChart) {
    state.charts.line = new Chart(dom.portfolioLineChart, {
      type: "line",
      data: {
        labels: lineLabels,
        datasets: [
          {
            data: lineValues,
            borderColor: accent2,
            backgroundColor: "rgba(78, 160, 255, 0.14)",
            fill: true,
            tension: 0.34,
            borderWidth: 2.5,
            // Sin puntos dibujados: con interacción "index" el tooltip salta
            // al punto más cercano sin tener que acertar con el dedo.
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 24,
            pointBackgroundColor: accent
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            // Las etiquetas ya vienen repartidas desde buildLineTickLabels
            // (el resto son ""); autoSkip las descartaría a su criterio.
            ticks: { color: textColor, autoSkip: false, maxRotation: 30, font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: textColor,
              maxTicksLimit: 5,
              callback(value) {
                return formatCompactCurrency(value);
              }
            },
            grid: { color: borderColor }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            displayColors: false,
            caretSize: 7,
            titleFont: { size: 12 },
            bodyFont: { size: 14, weight: "bold" },
            callbacks: {
              title(items) {
                return lineTooltipTitles[items[0]?.dataIndex] ?? "";
              },
              label(context) {
                return formatCurrency(context.raw);
              }
            }
          }
        }
      }
    });
  } else if (state.charts.line) {
    state.charts.line.data.labels = lineLabels;
    state.charts.line.data.datasets[0].data = lineValues;
    state.charts.line.options.scales.x.ticks.color = textColor;
    state.charts.line.options.scales.y.ticks.color = textColor;
    state.charts.line.options.scales.y.grid.color = borderColor;
    state.charts.line.data.datasets[0].borderColor = accent2;
    state.charts.line.data.datasets[0].pointBackgroundColor = accent;
    state.charts.line.update();
  }

  // Con los gráficos ya pintados, los skeletons de Analítica sobran.
  document.querySelectorAll(".chart-skeleton").forEach((node) => node.classList.add("hidden"));
}
