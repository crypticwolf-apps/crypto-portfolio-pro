// =============================================================================
// analitica.js - Pestana Analitica: resultado por periodo, comparativas,
// categorias, rankings, ideas (insights) y seccion de mercado.
// =============================================================================

function fngClassificationKey(value) {
  if (value < 25) return "market.fgExtremeFear";
  if (value < 45) return "market.fgFear";
  if (value < 55) return "market.fgNeutral";
  if (value < 75) return "market.fgGreed";
  return "market.fgExtremeGreed";
}

// Bloques de Inicio: mejores, peores, próximos TP y alertas (máx. 3 c/u).
function getInsightItems(snapshot) {
  const totalValue = snapshot.totals.currentValue;

  return snapshot.items
    .map((item) => ({
      ...item,
      change24h: typeof item.row.priceChange24h === "number" ? item.row.priceChange24h : null,
      weightPct: totalValue > 0 ? (item.metrics.currentValue / totalValue) * 100 : 0
    }))
    .filter((item) => item.metrics.investment > 0 || item.metrics.currentValue > 0 || item.metrics.tokens > 0);
}

function getCurrentInsightItems(snapshot) {
  return getInsightItems(snapshot).filter(
    (item) =>
      item.metrics.investment > 0 &&
      item.metrics.currentPrice > 0 &&
      item.metrics.currentValue > 0 &&
      Number.isFinite(item.metrics.pnlPct)
  );
}

function get24hInsightItems(snapshot) {
  return getCurrentInsightItems(snapshot).filter((item) => Number.isFinite(item.change24h));
}

function getTopPerformers(snapshot, limit = 3) {
  return [...getCurrentInsightItems(snapshot)]
    .sort((a, b) => b.metrics.pnlPct - a.metrics.pnlPct || b.metrics.currentValue - a.metrics.currentValue)
    .slice(0, limit);
}

function getWorstPerformers(snapshot, limit = 3) {
  return [...getCurrentInsightItems(snapshot)]
    .sort((a, b) => a.metrics.pnlPct - b.metrics.pnlPct || a.metrics.currentValue - b.metrics.currentValue)
    .slice(0, limit);
}

function getTop24h(snapshot, limit = 3) {
  return [...get24hInsightItems(snapshot)]
    .sort((a, b) => b.change24h - a.change24h || b.metrics.currentValue - a.metrics.currentValue)
    .slice(0, limit);
}

function getWorst24h(snapshot, limit = 3) {
  return [...get24hInsightItems(snapshot)]
    .sort((a, b) => a.change24h - b.change24h || a.metrics.currentValue - b.metrics.currentValue)
    .slice(0, limit);
}

// Recorrido del historial de una fila (rango minimo-maximo en %), memorizado.
// Se rehace solo si cambia el historial, no en cada repintado: con precios en
// vivo el panel se redibuja cada segundo y esto se llevaba el rato.
function rowHistoricalRangePct(row) {
  const bruto = row.priceHistory || [];
  const ultimo = bruto.length ? bruto[bruto.length - 1] : null;
  const firma = `${bruto.length}:${ultimo?.at || ""}:${ultimo?.price || ""}`;
  const guardado = rangoHistorialCache.get(row.id);
  if (guardado && guardado.firma === firma) {
    return guardado.valor;
  }

  let valor = null;
  const history = compactRowPriceHistory(bruto);
  if (history.length >= 2) {
    const prices = history
      .map((point) => point.price)
      .filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length >= 2) {
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      // Bucle en vez de Math.min(...prices): con historiales largos el spread
      // monta un array de argumentos en cada llamada.
      for (const price of prices) {
        if (price < minPrice) minPrice = price;
        if (price > maxPrice) maxPrice = price;
      }
      valor = {
        pct: minPrice > 0 ? ((maxPrice - minPrice) / minPrice) * 100 : 0,
        puntos: history.length
      };
    }
  }

  rangoHistorialCache.set(row.id, { firma, valor });
  return valor;
}

function getPortfolioInsights(snapshot) {
  const currentItems = getCurrentInsightItems(snapshot);
  const items24h = get24hInsightItems(snapshot);
  const topPerformers = getTopPerformers(snapshot, 3);
  const worstPerformers = getWorstPerformers(snapshot, 3);
  const top24h = getTop24h(snapshot, 3);
  const worst24h = getWorst24h(snapshot, 3);
  const volatilityItems = currentItems
    .map((item) => {
      const rango = rowHistoricalRangePct(item.row);
      if (!rango) {
        return null;
      }

      return {
        ...item,
        historicalRangePct: rango.pct,
        historicalPoints: rango.puntos
      };
    })
    .filter(Boolean);
  const mostVolatile = [...volatilityItems]
    .sort((a, b) => b.historicalRangePct - a.historicalRangePct || b.metrics.currentValue - a.metrics.currentValue)[0] || null;

  return {
    topPerformers,
    worstPerformers,
    top24h,
    worst24h,
    mostVolatile,
    volatilityItems
  };
}

function renderInsightRankingItems(items, mode) {
  if (!items.length) {
    return `<div class="insight-empty">${escapeHtml(t("insights.noData"))}</div>`;
  }

  return `
    <div class="insight-list">
      ${items
        .map((item, index) => {
          const toneClassName = mode === "24h" ? toneClass(item.change24h) : toneClass(item.metrics.pnlPct);
          const metricValue = mode === "24h"
            ? formatSignedPercent(item.change24h)
            : formatPercent(item.metrics.pnlPct);
          const detailValue = mode === "24h"
            ? formatCurrency(item.metrics.currentPrice, getPriceDigits(item.metrics.currentPrice))
            : maskedSignedCurrency(item.metrics.pnlUsd);

          return `
            <article class="insight-item">
              <div class="insight-item-main">
                <span class="insight-item-rank">${index + 1}</span>
                <div>
                  <strong>${escapeHtml(assetDisplayName(item.row))}</strong>
                  <small>${escapeHtml(maskedCurrency(item.metrics.currentValue))}</small>
                </div>
              </div>
              <div class="insight-item-metric">
                <strong class="${toneClassName || "neutral"}">${escapeHtml(metricValue)}</strong>
                <small>${escapeHtml(detailValue)}</small>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderRankingCard(config) {
  return `
    <article class="insight-card">
      <h3 class="insight-card-title">${escapeHtml(config.title)}</h3>
      ${renderInsightRankingItems(config.items, config.mode)}
    </article>
  `;
}

// Mejores y peores en un solo bloque, con un selector: desde la compra
// (rentabilidad) o en las ultimas 24 h. Si todos ganan, la lista de "peores"
// se llama "los que menos ganan" (y al reves con "mejores"), para que no
// salga "peores" con todo en verde.
let insightsModo = "current";
let ultimosInsights = null;

function tituloRanking(items, mode, lado) {
  const valores = items.map((item) => (mode === "24h" ? item.change24h : item.metrics.pnlPct)).filter(Number.isFinite);
  if (lado === "mejores") {
    const nadieGana = valores.length && valores.every((v) => v <= 0);
    return t(nadieGana ? (mode === "24h" ? "insights.menosBajan" : "insights.menosPierden") : "insights.mejores");
  }
  const todosGanan = valores.length && valores.every((v) => v >= 0);
  return t(todosGanan ? (mode === "24h" ? "insights.menosSuben" : "insights.menosGanan") : "insights.peores");
}

function renderInsights(insights) {
  if (!dom.insightsRankingsGrid) {
    return;
  }
  ultimosInsights = insights;
  const mode = insightsModo;
  const mejores = mode === "24h" ? insights.top24h : insights.topPerformers;
  const peores = mode === "24h" ? insights.worst24h : insights.worstPerformers;
  const opcion = (valor, clave) => `<button type="button" data-insights-modo="${valor}" aria-pressed="${mode === valor ? "true" : "false"}">${escapeHtml(t(clave))}</button>`;
  pintarHtml(dom.insightsRankingsGrid, `
    <div class="segmentado en-tarjeta insights-modo" role="group" aria-label="${escapeHtml(t("insights.modoAria"))}">
      ${opcion("current", "insights.modoCompra")}${opcion("24h", "insights.modo24h")}
    </div>
    ${renderRankingCard({ title: tituloRanking(mejores, mode, "mejores"), items: mejores, mode })}
    ${renderRankingCard({ title: tituloRanking(peores, mode, "peores"), items: peores, mode })}
  `);
}

function bindInsights() {
  dom.insightsRankingsGrid?.addEventListener("click", (event) => {
    const modo = event.target.closest("[data-insights-modo]")?.dataset.insightsModo;
    if (modo && modo !== insightsModo) {
      insightsModo = modo;
      if (ultimosInsights) {
        renderInsights(ultimosInsights);
      }
    }
  });
}

// Resumen de Analítica: ROI, rentabilidad por periodos, drawdown,
// concentración (Top 1/3/5), % en stables y riesgo de concentración.
// Resultado del periodo desde el historial de valor (o total desde el inicio).
// No sustituye datos inexistentes por cero: si falta historial → enough:false.
// Capital aportado total = coste de las posiciones abiertas + coste atribuido
// a los tokens ya vendidos. Ese coste se deriva de cada venta registrada:
// realizado = ingresos - coste - comisión  →  coste = ingresos - comisión - realizado.
// Es la base correcta para el porcentaje del resultado NETO (realizado +
// no realizado): usar solo el coste abierto inflaría la rentabilidad.
function getDeployedCapital(snapshot) {
  const soldCost = state.trades.reduce((sum, tr) => {
    if (tr.type !== "sell" || !Number.isFinite(tr.realized)) return sum;
    const cost = (Number(tr.amount) || 0) - (Number(tr.fee) || 0) - Number(tr.realized);
    return sum + Math.max(0, cost);
  }, 0);
  return snapshot.totals.investment + soldCost;
}

function getPeriodResult(key, snapshot) {
  if (key === "total") {
    const unrealized = snapshot.totals.currentValue - snapshot.totals.investment;
    const money = unrealized + getRealizedPnl();
    // El importe y el porcentaje deben describir lo mismo: resultado neto
    // sobre el capital aportado (no solo sobre el coste aún abierto).
    const base = getDeployedCapital(snapshot);
    const pct = base > 0 ? (money / base) * 100 : null;
    return { enough: true, money, pct };
  }
  const def = ANALYTICS_PERIODS.find((p) => p.key === key);
  const points = state.history.filter((p) => p.currency === state.prefs.currency);
  if (!def || points.length < 2) return { enough: false };
  const last = Number(points[points.length - 1].total || 0);
  const cutoff = Date.now() - def.ms;
  let base = null;
  for (const p of points) {
    if (new Date(p.at).getTime() >= cutoff) { base = Number(p.total || 0); break; }
  }
  if (base === null || !(base > 0) || !(last > 0)) return { enough: false };
  return { enough: true, money: last - base, pct: ((last - base) / base) * 100 };
}

// Resumen de rendimiento (rediseño): un número principal, contexto temporal,
// hasta 3 secundarias y un desglose plegable. El resto de métricas viven en
// sus paneles (Insights, Distribución, Riesgo, Actividad, Comparativas).
function renderAnalyticsSummary(snapshot) {
  const box = document.getElementById("analyticsSummaryGrid");
  if (!box) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") { return; }

  const hasPositions = snapshot.totals.investment > 0 || snapshot.totals.currentValue > 0;
  if (!hasPositions) {
    pintarHtml(box, `<div class="as-empty"><p>${escapeHtml(t("summary.emptyPositions"))}</p></div>`);
    renderAnalyticsExtras(snapshot);
    return;
  }

  const period = ANALYTICS_PERIODS.some((p) => p.key === state.analyticsPeriod) ? state.analyticsPeriod : "total";
  state.analyticsPeriod = period;
  const periodLabel = t(ANALYTICS_PERIODS.find((p) => p.key === period).label);

  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const realized = getRealizedPnl();
  const netTotal = totalPnl + realized;
  const res = getPeriodResult(period, snapshot);

  const chips = ANALYTICS_PERIODS
    .map((p) => `<button type="button" data-period="${p.key}" aria-pressed="${p.key === period ? "true" : "false"}">${escapeHtml(t(p.label))}</button>`)
    .join("");

  // Importe y porcentaje salen SIEMPRE del mismo cálculo (getPeriodResult):
  // así nunca describen magnitudes distintas.
  const mainMoney = res.money;
  const mainPct = res.pct;
  const mainOk = period === "total" ? true : res.enough;
  const mainTone = mainOk ? toneClass(mainMoney) : "";
  // Sin ningun precio aun (primer arranque) el resultado seria -100 %: se
  // ensena su silueta hasta que llegan.
  const cargando = saldoCargando(snapshot);
  let mainBlock = mainOk
    ? `<strong class="as-main ${mainTone}">${maskedSignedCurrency(mainMoney)}</strong>${mainPct == null ? "" : `<span class="as-main-pct ${mainTone}">${formatSignedPercent(mainPct)}</span>`}`
    : `<strong class="as-main muted">—</strong>`;
  if (cargando) {
    mainBlock = `<strong class="as-main" aria-busy="true">${esqueletoHtml("esqueleto-saldo")}</strong>`;
  }

  let phrase = "";
  if (cargando) phrase = "";
  else if (period === "total") phrase = t("summary.phraseTotal");
  else if (!res.enough) phrase = t("summary.noHistoryPeriod");
  else phrase = t(res.money >= 0 ? "summary.phraseGain" : "summary.phraseLoss", { amount: maskedCurrency(Math.abs(res.money)), period: periodLabel.toLowerCase() });

  // Con ventas registradas, "invertido" es el capital aportado total (coste
  // abierto + coste de lo vendido): así el % del resultado neto cuadra con
  // los importes visibles. El coste solo-abierto vive en el desglose.
  const deployed = getDeployedCapital(snapshot);
  const secondary = [
    { label: t("analytics.totalValue"), value: maskedCurrency(snapshot.totals.currentValue), hint: t("summary.hintValue"), espera: cargando },
    { label: t("analytics.invested"), value: maskedCurrency(deployed), hint: t("summary.hintInvested") },
    { label: t("analytics.realizedPnl"), value: maskedSignedCurrency(realized), tone: toneClass(realized) }
  ];
  // En "Total" el porcentaje ya está en la cifra principal: no se repite aquí
  // (evita métricas duplicadas). En un periodo concreto se añade el acumulado.
  if (period !== "total") {
    secondary.push({ label: t("summary.totalSinceStart"), value: maskedSignedCurrency(netTotal), tone: toneClass(netTotal), muted: true, espera: cargando });
  }

  pintarHtml(box, `
    <div class="as-clean">
      <div class="segmentado en-tarjeta as-period-row" role="group" aria-label="${escapeHtml(t("summary.periodAria"))}">${chips}</div>
      <div class="as-hero">
        <span class="as-label" title="${escapeHtml(period === "total" ? t("summary.hintNet") : t("summary.hintPeriod"))}">${escapeHtml(period === "total" ? t("summary.netTotal") : t("summary.periodResult", { period: periodLabel }))}</span>
        <div class="as-hero-main" aria-live="polite">${mainBlock}</div>
        ${phrase ? `<p class="as-phrase">${escapeHtml(phrase)}</p>` : ""}
      </div>
      <div class="as-secondary">
        ${secondary.map((s) => `<div class="as-sec ${s.muted ? "muted" : ""}"${s.hint ? ` title="${escapeHtml(s.hint)}"` : ""}><span>${escapeHtml(s.label)}</span><b class="${s.espera ? "" : s.tone || ""}">${s.espera ? esqueletoHtml("esqueleto-valor") : escapeHtml(String(s.value))}</b></div>`).join("")}
      </div>
    </div>`);
  const main = box.querySelector(".as-main");
  if (!cargando) {
    fitAmount(main, "analitica", main?.parentElement);
  }

  renderAnalyticsExtras(snapshot);
}

// Analítica en una sola vista: origen del resultado, comparativa 24h,
// mejor/peor, reparto por sector, seguimiento e historial de operaciones.
function renderAnalyticsExtras(snapshot) {
  renderAnalyticsCategory(snapshot);
  renderAnalyticsCompare(snapshot);
  renderAnalyticsActivityStats();
  renderTradesLog();
}

function renderAnalyticsActivityStats() {
  const box = document.getElementById("analyticsActivityStats");
  if (!box) return;
  if (!state.trades.length) {
    pintarHtml(box, `<p class="movers-empty">${escapeHtml(t("analytics.noTrades"))}</p>`);
    return;
  }
  // Solo los meses con compras o ventas (los ultimos 6 de un ano), el mas
  // reciente arriba, cada barra con su importe.
  const months = getMonthlyTradeStats(12).filter((m) => m.buys > 0 || m.sells > 0).slice(-6).reverse();
  const totalBuys = state.trades.reduce((s, tr) => s + (tr.type === "buy" ? tr.amount || 0 : 0), 0);
  const totalSells = state.trades.reduce((s, tr) => s + (tr.type === "sell" ? tr.amount || 0 : 0), 0);
  const maxVal = Math.max(1, ...months.map((m) => Math.max(m.buys, m.sells)));
  pintarHtml(box, `
    <div class="acts-totals">
      <div><span>${escapeHtml(t("analytics.totalBuys"))}</span><b>${maskedCurrency(totalBuys)}</b></div>
      <div><span>${escapeHtml(t("analytics.totalSells"))}</span><b>${maskedCurrency(totalSells)}</b></div>
      <div><span>${escapeHtml(t("analytics.realizedPnl"))}</span><b class="${toneClass(getRealizedPnl())}">${maskedSignedCurrency(getRealizedPnl())}</b></div>
    </div>
    ${months.length ? `<div class="acts-meses" role="list">
      ${months.map((m) => `
        <div class="acts-mes" role="listitem">
          <span class="acts-mes-nombre">${escapeHtml(m.label)}</span>
          <div class="acts-mes-barras">
            ${[["buy", m.buys, "analytics.buys"], ["sell", m.sells, "analytics.sells"]].filter(([, valor]) => valor > 0).map(([tipo, valor, clave]) => `
              <div class="acts-linea ${tipo}">
                <span class="acts-barra" style="width:${Math.max(3, (valor / maxVal) * 100).toFixed(1)}%" aria-hidden="true"></span>
                <b><span class="solo-lector">${escapeHtml(t(clave))}: </span>${maskedCurrency(valor)}</b>
              </div>`).join("")}
          </div>
        </div>`).join("")}
    </div>` : ""}
    <div class="acts-legend"><span><i class="buy" aria-hidden="true"></i>${escapeHtml(t("analytics.buys"))}</span><span><i class="sell" aria-hidden="true"></i>${escapeHtml(t("analytics.sells"))}</span></div>
  `);
}

function renderAnalyticsCompare(snapshot) {
  const box = document.getElementById("analyticsCompare");
  if (!box) {
    return;
  }
  const change = getPortfolio24hChange(snapshot);
  const rows = [
    { label: t("analytics.myPortfolio"), pct: change ? change.pct : null, accent: true },
    { label: "Bitcoin", pct: state.market.btc && Number.isFinite(state.market.btc.change24h) ? state.market.btc.change24h : null },
    { label: "Ethereum", pct: state.market.eth && Number.isFinite(state.market.eth.change24h) ? state.market.eth.change24h : null }
  ];
  const values = rows.map((r) => Math.abs(r.pct || 0));
  const maxAbs = Math.max(1, ...values);

  pintarHtml(box, rows.map((r) => {
    const width = r.pct != null ? (Math.abs(r.pct) / maxAbs) * 100 : 0;
    const tone = r.pct == null ? "" : r.pct >= 0 ? "positive" : "negative";
    return `
      <div class="compare-row ${r.accent ? "is-accent" : ""}">
        <span class="compare-label">${escapeHtml(r.label)}</span>
        <div class="compare-bar"><span class="${tone}" style="width:${width}%"></span></div>
        <span class="compare-pct ${tone}">${r.pct != null ? formatSignedPercent(r.pct) : "--"}</span>
      </div>
    `;
  }).join(""));
}

// Chips de periodo del resumen de rendimiento.
function bindAnalyticsSummary() {
  const box = document.getElementById("analyticsSummaryGrid");
  if (!box) return;
  box.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-period]");
    if (!chip) return;
    state.analyticsPeriod = chip.dataset.period;
    renderAnalyticsSummary(buildSnapshot());
  });
}

function renderAnalyticsCategory(snapshot) {
  const box = document.getElementById("analyticsCategory");
  if (!box) return;
  const total = snapshot.totals.currentValue;
  if (!(total > 0)) {
    pintarHtml(box, `<p class="movers-empty">${escapeHtml(t("home.noData"))}</p>`);
    return;
  }
  // Agrupa el valor actual por sector. Solo se listan los sectores presentes.
  const byId = new Map();
  snapshot.items.forEach((item) => {
    const value = item.metrics.currentValue;
    if (!(value > 0)) return;
    const key = getAssetSector(item.row);
    const entry = byId.get(key) || { key, value: 0, assets: [] };
    entry.value += value;
    entry.assets.push(item.row.symbol || assetDisplayName(item.row));
    byId.set(key, entry);
  });
  const rows = [...byId.values()]
    .map((e) => ({ ...e, pct: (e.value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
  if (!rows.length) {
    pintarHtml(box, `<p class="movers-empty">${escapeHtml(t("home.noData"))}</p>`);
    return;
  }
  // Cada fila lleva su nombre escrito: una sola tinta (el acento) basta.
  pintarHtml(box, rows.map((r) => `
    <div class="category-row">
      <div class="category-head">
        <span class="category-label">${escapeHtml(t("sector." + r.key))}</span>
        <strong>${r.pct.toFixed(1)}%</strong>
      </div>
      <div class="category-bar" aria-hidden="true"><span style="width:${r.pct.toFixed(1)}%"></span></div>
      <small class="category-assets">${escapeHtml(r.assets.slice(0, 4).join(" · "))}${r.assets.length > 4 ? " +" + (r.assets.length - 4) : ""}</small>
    </div>
  `).join(""));
}

// ── Distribucion: anillo SVG propio ──
// Antes era una tarta 3D de Chart.js; ahora se dibuja aqui (ligero, nitido y
// con los colores de la paleta validada). Chart.js solo se carga para el PDF.
// Hasta 6 activos con color propio (el mismo que en el reparto de Inicio) y
// el resto en "Otros"; la leyenda lleva nombre, % y valor de cada uno.
// Se puede tocar: un trozo del anillo (o su fila en la leyenda) se resalta
// y el centro pasa a decir su nombre, su % y su valor; al tocarlo otra vez
// (o fuera) vuelve al numero de activos. Con raton basta pasar por encima.
let donaSeleccion = null; // clave del trozo elegido (id de la fila u "otros")
let donaPartes = [];

function renderAnalyticsDonut(snapshot) {
  const box = document.getElementById("analyticsDonut");
  if (!box) {
    return;
  }
  const items = snapshot.items
    .filter(({ metrics }) => metrics.currentValue > 0)
    .sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);
  const total = items.reduce((sum, { metrics }) => sum + metrics.currentValue, 0);
  if (!(total > 0)) {
    donaPartes = [];
    pintarHtml(box, saldoCargando(snapshot)
      ? `<div class="dona-figura">${esqueletoHtml("dona-esqueleto")}</div>`
      : `<p class="movers-empty">${escapeHtml(t("charts.insufficientData"))}</p>`);
    return;
  }
  const colors = seriesColorMap(snapshot);
  const top = items.slice(0, SERIES_MAX);
  const rest = items.slice(SERIES_MAX);
  const parts = top.map(({ row, metrics }) => ({
    clave: row.id,
    name: assetDisplayName(row),
    value: metrics.currentValue,
    color: colors.get(row.id) || "var(--c-t3)"
  }));
  if (rest.length) {
    parts.push({
      clave: "otros",
      name: t("charts.others"),
      value: rest.reduce((sum, { metrics }) => sum + metrics.currentValue, 0),
      color: "var(--c-t3)"
    });
  }
  parts.forEach((part) => { part.pct = (part.value / total) * 100; });
  donaPartes = parts;
  if (donaSeleccion && !parts.some((part) => part.clave === donaSeleccion)) {
    donaSeleccion = null;
  }

  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  // 2 px de hueco entre segmentos (si hay mas de uno).
  const gap = parts.length > 1 ? 2 : 0;
  let acc = 0;
  const segments = parts.map((part) => {
    const length = (part.value / total) * circumference;
    const dash = Math.max(0, length - gap);
    const html = `<circle class="dona-seg" data-dona="${escapeHtml(part.clave)}" cx="75" cy="75" r="${radius}" fill="none" stroke-width="16" style="stroke:${part.color}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"><title>${escapeHtml(`${part.name}: ${part.pct.toFixed(1)}%`)}</title></circle>`;
    acc += length;
    return html;
  }).join("");

  pintarHtml(box, `
    <div class="dona-figura">
      <svg viewBox="0 0 150 150" role="img" aria-label="${escapeHtml(t("charts.portfolioDistribution"))}">
        <circle cx="75" cy="75" r="${radius}" fill="none" stroke-width="16" class="dona-pista"></circle>
        <g transform="rotate(-90 75 75)">${segments}</g>
      </svg>
      <div class="dona-centro" aria-live="polite" data-activos="${items.length}"></div>
    </div>
    <ul class="dona-leyenda" role="list">
      ${parts.map((part) => `
        <li>
          <button type="button" class="dona-item" data-dona="${escapeHtml(part.clave)}" aria-pressed="false">
            <i style="background:${part.color}" aria-hidden="true"></i>
            <span class="dona-nombre">${escapeHtml(part.name)}</span>
            <strong>${part.pct.toFixed(1)}%</strong>
            <small>${escapeHtml(maskedCurrency(part.value))}</small>
          </button>
        </li>`).join("")}
    </ul>`);
  marcarDona(box, donaSeleccion);
}

// Resalta un trozo (o ninguno, con null) sin volver a pintar el anillo. El
// resaltado puede ser solo de vista (raton encima); "pulsado" es siempre lo
// elegido de verdad (donaSeleccion).
function marcarDona(box, clave) {
  const parte = donaPartes.find((p) => p.clave === clave) || null;
  box.classList.toggle("con-eleccion", Boolean(parte));
  box.querySelectorAll("[data-dona]").forEach((nodo) => {
    nodo.classList.toggle("activo", Boolean(parte) && nodo.dataset.dona === parte.clave);
    if (nodo.tagName === "BUTTON") {
      nodo.setAttribute("aria-pressed", nodo.dataset.dona === donaSeleccion ? "true" : "false");
    }
  });
  const centro = box.querySelector(".dona-centro");
  if (!centro) {
    return;
  }
  if (parte) {
    pintarHtml(centro, `
      <strong>${parte.pct.toFixed(1)}%</strong>
      <span class="dona-centro-nombre">${escapeHtml(parte.name)}</span>
      <small>${escapeHtml(maskedCurrency(parte.value))}</small>`);
  } else {
    const n = Number(centro.dataset.activos) || 0;
    pintarHtml(centro, `
      <strong>${n}</strong>
      <span>${escapeHtml(t(n === 1 ? "analitica.activo" : "analitica.activos"))}</span>`);
  }
}

function bindDona() {
  const box = document.getElementById("analyticsDonut");
  if (!box) {
    return;
  }
  box.addEventListener("click", (event) => {
    const nodo = event.target.closest("[data-dona]");
    const clave = nodo ? nodo.dataset.dona : null;
    donaSeleccion = clave && clave !== donaSeleccion ? clave : null;
    marcarDona(box, donaSeleccion);
  });
  // Con raton: pasar por encima ensena el trozo; al salir, vuelve lo elegido.
  box.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") {
      return;
    }
    const nodo = event.target.closest("[data-dona]");
    if (nodo) {
      marcarDona(box, nodo.dataset.dona);
    }
  });
  box.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse" || box.contains(event.relatedTarget?.closest?.("[data-dona]") || null)) {
      return;
    }
    marcarDona(box, donaSeleccion);
  });
}

// ── Mapa de la cartera ──
// Un bloque por moneda con el area de su peso en la cartera y el color del
// cambio en 24 h: verde si sube, rojo si baja y gris cerca de 0 (mas intenso
// cuanto mas se mueve, hasta MAPA_TOPE_CAMBIO). Tocar un bloque abre su ficha.
// Hasta MAPA_MAX monedas con bloque propio; el resto va junto en "Otros".
const MAPA_MAX = 12;
const MAPA_TOPE_CAMBIO = 8; // % en 24 h con el color mas intenso
let mapaResizeTimer = null;
// Tamano medido de la caja del mapa: medirlo en cada tick obligaba al
// navegador a recalcular el diseno. Se vuelve a medir al cambiar el ancho.
let mapaTamano = null;

// Intensidad (0 a 1) del color de un cambio en 24 h.
function intensidadMapa(cambio) {
  if (!Number.isFinite(cambio) || Math.abs(cambio) < 0.05) {
    return 0;
  }
  return Math.min(Math.abs(cambio) / MAPA_TOPE_CAMBIO, 1);
}

function bloquesMapa(snapshot) {
  const items = snapshot.items
    .filter(({ metrics }) => metrics.currentValue > 0)
    .sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);
  const bloques = items.slice(0, MAPA_MAX).map(({ row, metrics }) => ({
    id: row.id,
    simbolo: String(row.symbol || assetDisplayName(row)).toUpperCase(),
    nombre: assetDisplayName(row),
    valor: metrics.currentValue,
    cambio: Number.isFinite(row.priceChange24h) ? row.priceChange24h : null
  }));
  const resto = items.slice(MAPA_MAX);
  if (resto.length) {
    // Cambio de "Otros": el de su valor junto (hoy frente a hace 24 h).
    let valor = 0;
    let ahora = 0;
    let antes = 0;
    resto.forEach(({ row, metrics }) => {
      valor += metrics.currentValue;
      if (Number.isFinite(row.priceChange24h)) {
        ahora += metrics.currentValue;
        antes += metrics.currentValue / (1 + row.priceChange24h / 100);
      }
    });
    bloques.push({
      id: null,
      simbolo: t("charts.others"),
      nombre: `${t("charts.others")} (${resto.length})`,
      valor,
      cambio: antes > 0 ? (ahora / antes - 1) * 100 : null
    });
  }
  return bloques;
}

function renderMapaCartera(snapshot) {
  const box = document.getElementById("mapaCartera");
  const escala = document.getElementById("mapaCarteraEscala");
  if (!box) {
    return;
  }
  const bloques = bloquesMapa(snapshot);
  const total = bloques.reduce((suma, b) => suma + b.valor, 0);
  if (!(total > 0)) {
    const cargando = saldoCargando(snapshot);
    if (box.classList.contains("vacio") !== !cargando) {
      mapaTamano = null;
    }
    box.classList.toggle("vacio", !cargando);
    pintarHtml(box, cargando
      ? esqueletoHtml("mapa-esqueleto")
      : `<p class="movers-empty">${escapeHtml(t("charts.insufficientData"))}</p>`);
    if (escala) escala.hidden = true;
    return;
  }
  if (box.classList.contains("vacio")) {
    box.classList.remove("vacio");
    mapaTamano = null;
  }
  if (escala) escala.hidden = false;
  // El tamano real de la caja decide que textos caben en cada bloque. Si
  // aun no se ve (otra pestana), se usa la proporcion que le da el CSS.
  if (!mapaTamano && box.clientWidth > 0) {
    mapaTamano = { ancho: box.clientWidth, alto: box.clientHeight || Math.round(box.clientWidth * 0.75) };
  }
  const ancho = mapaTamano ? mapaTamano.ancho : 340;
  const alto = mapaTamano ? mapaTamano.alto : Math.round(ancho * 0.75);
  const rects = CryptoFinance.mapaRectangulos(bloques.map((b) => b.valor), ancho, alto);
  // Dos decimales bastan (menos de 1 px): con el goteo de precios el mapa
  // suele quedar igual y no se repinta.
  const pc = (v, base) => `${((v / base) * 100).toFixed(2)}%`;
  pintarHtml(box, bloques.map((b, i) => {
    const r = rects[i];
    const peso = (b.valor / total) * 100;
    // Un decimal (y el valor en formato corto en la etiqueta): el mapa no
    // cambia con cada centesima de los precios en vivo y no se repinta.
    const cambioTxt = b.cambio == null ? "--" : `${b.cambio >= 0 ? "+" : ""}${b.cambio.toFixed(1)}%`;
    const tono = b.cambio == null || intensidadMapa(b.cambio) === 0 ? "" : (b.cambio > 0 ? " sube" : " baja");
    const etiqueta = t("analitica.mapaBloque", {
      nombre: b.nombre,
      peso: `${peso.toFixed(1)}%`,
      cambio: cambioTxt,
      valor: state.prefs.hideBalance ? "••••" : formatCompactCurrency(b.valor)
    });
    // Textos segun el sitio: el simbolo; el cambio y el peso si hay hueco
    // (sin hueco no se ponen a medias: el bloque lleva su etiqueta).
    // El simbolo entero o nada: "W..." no dice que moneda es.
    const cabeSimbolo = r.w >= Math.max(40, b.simbolo.length * 8 + 14) && r.h >= 24;
    const cabeCambio = r.w >= Math.max(62, cambioTxt.length * 8 + 14) && r.h >= 40;
    const cabePeso = r.w >= 72 && r.h >= 58;
    const grande = r.w >= 120 && r.h >= 84 ? " grande" : "";
    const chico = r.w < 72 || r.h < 58 ? " chico" : "";
    const textos = cabeSimbolo ? `
        <span class="mapa-simbolo">${escapeHtml(b.simbolo)}</span>
        ${cabeCambio ? `<span class="mapa-cambio">${escapeHtml(cambioTxt)}</span>` : ""}
        ${cabePeso ? `<span class="mapa-peso">${peso.toFixed(1)}%</span>` : ""}` : "";
    const estilo = `left:${pc(r.x, ancho)};top:${pc(r.y, alto)};width:${pc(r.w, ancho)};height:${pc(r.h, alto)};--mapa-fuerza:${intensidadMapa(b.cambio).toFixed(2)}`;
    const clase = `mapa-bloque${tono}${grande}${chico}`;
    return b.id
      ? `<button type="button" class="${clase}" style="${estilo}" data-asset-open="${escapeHtml(b.id)}" aria-label="${escapeHtml(etiqueta)}" title="${escapeHtml(etiqueta)}">${textos}</button>`
      : `<div class="${clase} otros" style="${estilo}" role="img" aria-label="${escapeHtml(etiqueta)}" title="${escapeHtml(etiqueta)}">${textos}</div>`;
  }).join(""));
}

function bindMapaCartera() {
  const box = document.getElementById("mapaCartera");
  if (!box) {
    return;
  }
  box.addEventListener("click", (event) => {
    const bloque = event.target.closest("[data-asset-open]");
    if (bloque) {
      openAssetDetail(bloque.dataset.assetOpen);
    }
  });
  // Al cambiar el ancho, los bloques se vuelven a repartir.
  window.addEventListener("resize", () => {
    window.clearTimeout(mapaResizeTimer);
    mapaResizeTimer = window.setTimeout(() => {
      mapaTamano = null;
      if (box.clientWidth > 0) {
        renderMapaCartera(buildSnapshot());
      }
    }, 160);
  });
}

