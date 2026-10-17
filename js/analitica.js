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

// Widgets de Mercado en Inicio: BTC, ETH, dominancia y miedo/codicia.
function renderMarketSection() {
  if (!dom.marketGrid) {
    return;
  }

  const market = state.market;
  const freshness = market.globalUpdatedAt
    ? formatRelativeTime(new Date(market.globalUpdatedAt).getTime())
    : null;

  const coinCard = (label, data) => {
    if (!data || !Number.isFinite(data.price)) {
      return '<article class="market-card market-skeleton" aria-hidden="true"><span class="skeleton-line w40"></span><span class="skeleton-line w70"></span><span class="skeleton-line w50"></span></article>';
    }
    const tone = data.change24h > 0 ? "positive" : data.change24h < 0 ? "negative" : "neutral";
    return `
      <article class="market-card">
        <header>
          ${data.image ? `<img src="${escapeHtml(data.image)}" alt="" loading="lazy" />` : ""}
          <span>${escapeHtml(label)}</span>
        </header>
        <strong class="money">${formatCurrency(data.price, getPriceDigits(data.price))}</strong>
        <span class="market-change ${tone}">${Number.isFinite(data.change24h) ? formatSignedPercent(data.change24h) : "--"} <small>24h</small></span>
      </article>
    `;
  };

  const dominance = Number.isFinite(market.btcDominance) ? market.btcDominance : null;
  let dominanceCard = '<article class="market-card market-skeleton" aria-hidden="true"><span class="skeleton-line w40"></span><span class="skeleton-line w70"></span></article>';
  if (dominance != null) {
    const radius = 15.9;
    const circumference = 2 * Math.PI * radius;
    const filled = (Math.max(0, Math.min(100, dominance)) / 100) * circumference;
    dominanceCard = `
      <article class="market-card market-card-dominance">
        <header><span>${escapeHtml(t("market.btcDominance"))}</span></header>
        <svg viewBox="0 0 42 42" class="dominance-ring" aria-hidden="true">
          <circle cx="21" cy="21" r="${radius}" fill="none" stroke="rgba(120,150,180,0.18)" stroke-width="3.4"/>
          <circle cx="21" cy="21" r="${radius}" fill="none" stroke="var(--accent)" stroke-width="3.4" stroke-linecap="round"
            stroke-dasharray="${filled.toFixed(2)} ${(circumference - filled).toFixed(2)}" transform="rotate(-90 21 21)"/>
          <text x="21" y="24" text-anchor="middle" class="ring-text">${dominance.toFixed(2)}%</text>
        </svg>
        <span class="market-meta">${freshness ? escapeHtml(t("home.updatedAgo", { time: freshness })) : escapeHtml(t("market.savedData"))}</span>
      </article>
    `;
  }

  // Miedo y codicia: si no hay dato ni caché, la tarjeta simplemente no se pinta.
  let fngCard = "";
  const fng = market.fearGreed;
  if (fng && Number.isFinite(fng.value)) {
    const value = Math.max(0, Math.min(100, Number(fng.value)));
    const isFresh = market.fearGreedUpdatedAt
      && Date.now() - new Date(market.fearGreedUpdatedAt).getTime() < FNG_TTL * 2;
    const freshLabel = isFresh
      ? t("home.updatedAgo", { time: formatRelativeTime(new Date(market.fearGreedUpdatedAt).getTime()) })
      : t("market.savedData");
    fngCard = `
      <article class="market-card market-card-fng">
        <header><span>${escapeHtml(t("market.fearGreed"))}</span></header>
        <div class="fng-value">
          <strong>${value}</strong>
          <span>${escapeHtml(t(fngClassificationKey(value)))}</span>
        </div>
        <div class="fng-bar" aria-hidden="true"><span class="fng-dot" style="left:${value}%"></span></div>
        <span class="market-meta">${escapeHtml(freshLabel)} · ${escapeHtml(t("market.source"))}</span>
      </article>
    `;
  }

  dom.marketGrid.innerHTML = [
    coinCard("BTC", market.btc),
    coinCard("ETH", market.eth),
    dominanceCard,
    fngCard
  ].filter(Boolean).join("");

  // Tendencia simple del mercado: media de las variaciones 24h de BTC y ETH.
  const trendChip = document.getElementById("marketTrendChip");
  if (trendChip) {
    const changes = [market.btc?.change24h, market.eth?.change24h].filter(Number.isFinite);
    if (changes.length) {
      const average = changes.reduce((total, value) => total + value, 0) / changes.length;
      const key = average > 1.5 ? "market.trendUp" : average < -1.5 ? "market.trendDown" : "market.trendFlat";
      trendChip.textContent = t(key);
      trendChip.className = `trend-chip ${average > 1.5 ? "positive" : average < -1.5 ? "negative" : "neutral"}`;
      trendChip.hidden = false;
    } else {
      trendChip.hidden = true;
    }
  }
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
      <div class="insight-card-head">
        <div>
          <h3>${escapeHtml(config.title)}</h3>
          <p>${escapeHtml(config.subtitle)}</p>
        </div>
        <span class="insight-chip ${config.tone}">${escapeHtml(config.badge)}</span>
      </div>
      ${renderInsightRankingItems(config.items, config.mode)}
    </article>
  `;
}

function renderInsights(insights) {
  if (!dom.insightsRankingsGrid) {
    return;
  }

  const rankingCards = [
    {
      title: t("insights.topPerformers"),
      subtitle: t("insights.byCurrentPerformance"),
      badge: t("insights.liveLabel"),
      items: insights.topPerformers,
      mode: "current",
      tone: "positive"
    },
    {
      title: t("insights.worstPerformers"),
      subtitle: t("insights.byCurrentPerformance"),
      badge: t("insights.liveLabel"),
      items: insights.worstPerformers,
      mode: "current",
      tone: "negative"
    },
    {
      title: t("insights.top24h"),
      subtitle: t("insights.by24hChange"),
      badge: "24h",
      items: insights.top24h,
      mode: "24h",
      tone: "positive"
    },
    {
      title: t("insights.topWorst24h"),
      subtitle: t("insights.by24hChange"),
      badge: "24h",
      items: insights.worst24h,
      mode: "24h",
      tone: "negative"
    }
  ];

  dom.insightsRankingsGrid.innerHTML = rankingCards.map(renderRankingCard).join("");
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
    box.innerHTML = `<div class="as-empty"><p>${escapeHtml(t("summary.emptyPositions"))}</p></div>`;
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
    .map((p) => `<button class="as-period ${p.key === period ? "is-active" : ""}" type="button" data-period="${p.key}">${escapeHtml(t(p.label))}</button>`)
    .join("");

  // Importe y porcentaje salen SIEMPRE del mismo cálculo (getPeriodResult):
  // así nunca describen magnitudes distintas.
  const mainMoney = res.money;
  const mainPct = res.pct;
  const mainOk = period === "total" ? true : res.enough;
  const mainTone = mainOk ? toneClass(mainMoney) : "";
  const mainBlock = mainOk
    ? `<strong class="as-main ${mainTone}">${maskedSignedCurrency(mainMoney)}</strong>${mainPct == null ? "" : `<span class="as-main-pct ${mainTone}">${formatSignedPercent(mainPct)}</span>`}`
    : `<strong class="as-main muted">—</strong>`;

  let phrase = "";
  if (period === "total") phrase = t("summary.phraseTotal");
  else if (!res.enough) phrase = t("summary.noHistoryPeriod");
  else phrase = t(res.money >= 0 ? "summary.phraseGain" : "summary.phraseLoss", { amount: maskedCurrency(Math.abs(res.money)), period: periodLabel.toLowerCase() });

  // Con ventas registradas, "invertido" es el capital aportado total (coste
  // abierto + coste de lo vendido): así el % del resultado neto cuadra con
  // los importes visibles. El coste solo-abierto vive en el desglose.
  const deployed = getDeployedCapital(snapshot);
  const secondary = [
    { label: t("analytics.totalValue"), value: maskedCurrency(snapshot.totals.currentValue), hint: t("summary.hintValue") },
    { label: t("analytics.invested"), value: maskedCurrency(deployed), hint: t("summary.hintInvested") }
  ];
  // En "Total" el porcentaje ya está en la cifra principal: no se repite aquí
  // (evita métricas duplicadas). En un periodo concreto se añade el acumulado.
  if (period !== "total") {
    secondary.push({ label: t("summary.totalSinceStart"), value: maskedSignedCurrency(netTotal), tone: toneClass(netTotal), muted: true });
  }

  box.innerHTML = `
    <div class="as-clean">
      <div class="as-period-row" role="group" aria-label="${escapeHtml(t("summary.periodAria"))}">${chips}</div>
      <div class="as-hero">
        <span class="as-label" title="${escapeHtml(period === "total" ? t("summary.hintNet") : t("summary.hintPeriod"))}">${escapeHtml(period === "total" ? t("summary.netTotal") : t("summary.periodResult", { period: periodLabel }))}</span>
        <div class="as-hero-main" aria-live="polite">${mainBlock}</div>
        ${phrase ? `<p class="as-phrase">${escapeHtml(phrase)}</p>` : ""}
      </div>
      <div class="as-secondary">
        ${secondary.map((s) => `<div class="as-sec ${s.muted ? "muted" : ""}"${s.hint ? ` title="${escapeHtml(s.hint)}"` : ""}><span>${escapeHtml(s.label)}</span><b class="${s.tone || ""}">${escapeHtml(String(s.value))}</b></div>`).join("")}
      </div>
    </div>`;

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
    box.innerHTML = `<p class="movers-empty">${escapeHtml(t("analytics.noTrades"))}</p>`;
    return;
  }
  const months = getMonthlyTradeStats(6);
  const totalBuys = state.trades.reduce((s, tr) => s + (tr.type === "buy" ? tr.amount || 0 : 0), 0);
  const totalSells = state.trades.reduce((s, tr) => s + (tr.type === "sell" ? tr.amount || 0 : 0), 0);
  const maxVal = Math.max(1, ...months.map((m) => Math.max(m.buys, m.sells)));
  box.innerHTML = `
    <div class="acts-totals">
      <div><span>${escapeHtml(t("analytics.totalBuys"))}</span><b>${maskedCurrency(totalBuys)}</b></div>
      <div><span>${escapeHtml(t("analytics.totalSells"))}</span><b>${maskedCurrency(totalSells)}</b></div>
      <div><span>${escapeHtml(t("analytics.realizedPnl"))}</span><b class="${toneClass(getRealizedPnl())}">${maskedSignedCurrency(getRealizedPnl())}</b></div>
    </div>
    <div class="acts-months">
      ${months.map((m) => `
        <div class="acts-month">
          <div class="acts-bars">
            <span class="acts-bar buy" style="height:${Math.max(2, (m.buys / maxVal) * 48)}px" title="${escapeHtml(t("analytics.buys"))}: ${formatCurrency(m.buys)}"></span>
            <span class="acts-bar sell" style="height:${Math.max(2, (m.sells / maxVal) * 48)}px" title="${escapeHtml(t("analytics.sells"))}: ${formatCurrency(m.sells)}"></span>
          </div>
          <small>${escapeHtml(m.label)}</small>
        </div>`).join("")}
    </div>
    <div class="acts-legend"><span class="buy">■ ${escapeHtml(t("analytics.buys"))}</span><span class="sell">■ ${escapeHtml(t("analytics.sells"))}</span></div>
  `;
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

  box.innerHTML = rows.map((r) => {
    const width = r.pct != null ? (Math.abs(r.pct) / maxAbs) * 100 : 0;
    const tone = r.pct == null ? "" : r.pct >= 0 ? "positive" : "negative";
    return `
      <div class="compare-row ${r.accent ? "is-accent" : ""}">
        <span class="compare-label">${escapeHtml(r.label)}</span>
        <div class="compare-bar"><span class="${tone}" style="width:${width}%"></span></div>
        <span class="compare-pct ${tone}">${r.pct != null ? formatSignedPercent(r.pct) : "--"}</span>
      </div>
    `;
  }).join("");
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
    box.innerHTML = `<p class="movers-empty">${escapeHtml(t("home.noData"))}</p>`;
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
    box.innerHTML = `<p class="movers-empty">${escapeHtml(t("home.noData"))}</p>`;
    return;
  }
  const colors = {
    l1: "#f6b34c", l2: "#7da4ff", defi: "#3effa8", ia: "#c58bff", meme: "#ff8fc7",
    gaming: "#5ad1ff", infra: "#8fe388", rwa: "#ffd166", privacy: "#9aa7b8",
    payments: "#6ee7d6", exchange: "#ffa07a", stable: "#6d9ec4", otros: "#7b8b9a"
  };
  box.innerHTML = rows.map((r) => `
    <div class="category-row">
      <span class="category-label"><i style="background:${colors[r.key] || colors.otros}"></i>${escapeHtml(t("sector." + r.key))}</span>
      <div class="category-bar"><span style="width:${r.pct.toFixed(1)}%;background:${colors[r.key] || colors.otros}"></span></div>
      <strong>${r.pct.toFixed(1)}%</strong>
      <small class="category-assets">${escapeHtml(r.assets.slice(0, 4).join(" · "))}${r.assets.length > 4 ? " +" + (r.assets.length - 4) : ""}</small>
    </div>
  `).join("");
}
