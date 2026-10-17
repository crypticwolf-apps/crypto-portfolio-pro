// =============================================================================
// detalle.js - Ficha de un activo: resumen, grafico, historial, objetivos,
// alertas y notas.
// =============================================================================

/* ═══════════════════════════════════════════════════════
   PANTALLA DE DETALLE DE ACTIVO (full screen)
   Header + pestañas (Resumen/Historial/Objetivos/Alertas/
   Notas) + gráfico + botonera Comprar/Vender/Editar/Más.
   ═══════════════════════════════════════════════════════ */

const DETAIL_RANGES = [
  { key: "1d", labelKey: "detail.range1d", ms: 24 * 60 * 60 * 1000 },
  { key: "1w", labelKey: "detail.range1w", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1mo", labelKey: "detail.range1mo", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "3mo", labelKey: "detail.range3mo", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "1y", labelKey: "detail.range1y", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "total", labelKey: "detail.rangeTotal", ms: Infinity }
];

const DETAIL_TABS = [
  { key: "summary", labelKey: "detail.tabSummary" },
  { key: "history", labelKey: "detail.tabHistory" },
  { key: "targets", labelKey: "detail.tabTargets" },
  { key: "alerts", labelKey: "detail.tabAlerts" },
  { key: "notes", labelKey: "detail.tabNotes" }
];

function bindAssetDetail() {
  const screen = document.getElementById("assetDetailScreen");
  if (!screen) {
    return;
  }
  screen.addEventListener("click", (event) => {
    if (event.target.closest("[data-detail-close]")) {
      closeAssetDetail();
      return;
    }
    const tab = event.target.closest("[data-detail-tab]");
    if (tab) {
      state.detailTab = tab.dataset.detailTab;
      renderAssetDetail();
      return;
    }
    const range = event.target.closest("[data-detail-range]");
    if (range) {
      state.detailRange = range.dataset.detailRange;
      renderAssetDetail();
      return;
    }
    const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
    if (action) {
      handleDetailAction(action);
    }
  });
}

function openAssetDetail(rowId) {
  const row = getRowById(rowId);
  const screen = document.getElementById("assetDetailScreen");
  if (!row || !screen) {
    return;
  }
  state.detailRowId = rowId;
  state.detailTab = "summary";
  screen.hidden = false;
  document.body.classList.add("detail-open");
  renderAssetDetail();
  screen.scrollTop = 0;
}

function closeAssetDetail() {
  const screen = document.getElementById("assetDetailScreen");
  if (!screen || !state.detailRowId) {
    return;
  }
  state.detailRowId = null;
  screen.classList.add("is-closing");
  window.setTimeout(() => {
    screen.hidden = true;
    screen.classList.remove("is-closing");
    screen.innerHTML = "";
    document.body.classList.remove("detail-open");
  }, 220);
}

function handleDetailAction(action) {
  const rowId = state.detailRowId;
  const row = getRowById(rowId);
  if (!row) {
    return;
  }
  switch (action) {
    case "favorite":
      row.favorite = !row.favorite;
      renderTableBody();
      renderDashboardOnly();
      scheduleAutosave();
      renderAssetDetail();
      break;
    case "buy":
      openTradeSheet("buy", rowId);
      break;
    case "sell":
      openTradeSheet("sell", rowId);
      break;
    case "edit":
      openPositionEditor(rowId);
      break;
    case "walletSync":
      syncWallet(row.walletId, { manual: true });
      break;
    case "menu":
      openRowMenu(rowId, document.querySelector("[data-detail-action='menu']"));
      break;
    case "web":
      if (row.coinId) {
        window.open(`https://www.coingecko.com/en/coins/${encodeURIComponent(row.coinId)}`, "_blank", "noopener");
      }
      break;
    default:
      break;
  }
}

function renderAssetDetail() {
  const screen = document.getElementById("assetDetailScreen");
  const row = getRowById(state.detailRowId);
  if (!screen || !row) {
    return;
  }
  const metrics = computeRowMetrics(row);
  const change = Number.isFinite(row.priceChange24h) ? row.priceChange24h : null;

  screen.innerHTML = `
    <div class="detail-inner">
      <header class="detail-head">
        <button class="icon-circle-btn" type="button" data-detail-close aria-label="${escapeHtml(t("buttons.close"))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="detail-head-id">
          <span class="asset-avatar">${renderAssetAvatar(row)}</span>
          <div>
            <strong>${escapeHtml(assetDisplayName(row))}</strong>
            <small>${escapeHtml(row.resolvedName || row.crypto)}</small>
          </div>
        </div>
        <div class="detail-head-actions">
          <button class="icon-circle-btn ${row.favorite ? "is-fav" : ""}" type="button" data-detail-action="favorite" aria-label="${escapeHtml(t("editor.favorite"))}">
            <svg viewBox="0 0 24 24" fill="${row.favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.9 9.1 9z"/></svg>
          </button>
          <button class="icon-circle-btn" type="button" data-detail-action="menu" aria-label="${escapeHtml(t("buttons.moreActions"))}">⋯</button>
        </div>
      </header>

      <nav class="detail-tabs" role="tablist">
        ${DETAIL_TABS.map((tab) => `
          <button class="detail-tab ${state.detailTab === tab.key ? "is-active" : ""}" type="button" role="tab" data-detail-tab="${tab.key}">${escapeHtml(t(tab.labelKey))}</button>
        `).join("")}
      </nav>

      <div class="detail-price-block">
        <strong class="detail-price">${metrics.currentPrice > 0 ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice)) : "--"}</strong>
        ${change != null ? `<span class="delta-chip ${change > 0 ? "good" : change < 0 ? "error" : "warn"}">${formatSignedPercent(change)} <small>24h</small></span>` : ""}
      </div>

      <div class="detail-body">${renderDetailTab(row, metrics)}</div>

      <footer class="detail-foot">
        ${isWalletRow(row)
          ? `<button class="detail-foot-btn buy span-2" type="button" data-detail-action="walletSync">${escapeHtml(t("wallet.syncOne"))}</button>`
          : `<button class="detail-foot-btn buy" type="button" data-detail-action="buy">${escapeHtml(t("detail.buy"))}</button>
        <button class="detail-foot-btn sell" type="button" data-detail-action="sell">${escapeHtml(t("detail.sell"))}</button>`}
        <button class="detail-foot-btn" type="button" data-detail-action="edit">${escapeHtml(t("buttons.edit"))}</button>
        <button class="detail-foot-btn" type="button" data-detail-action="menu">${escapeHtml(t("buttons.moreShort"))}</button>
      </footer>
    </div>
  `;
}

function renderDetailTab(row, metrics) {
  switch (state.detailTab) {
    case "history":
      return renderDetailHistory(row);
    case "targets":
      return renderDetailTargets(row, metrics);
    case "alerts":
      return renderDetailAlerts(row, metrics);
    case "notes":
      return renderDetailNotes(row);
    default:
      return renderDetailSummary(row, metrics);
  }
}

function renderDetailSummary(row, metrics) {
  const totalValue = state.rows.reduce((sum, item) => {
    const v = computeRowMetrics(item).currentValue;
    return sum + (v > 0 ? v : 0);
  }, 0);
  const weight = totalValue > 0 && metrics.currentValue > 0 ? (metrics.currentValue / totalValue) * 100 : null;
  const change = Number.isFinite(row.priceChange24h) ? row.priceChange24h : null;
  const pnl24 = change != null && metrics.currentValue > 0
    ? metrics.currentValue - metrics.currentValue / (1 + change / 100)
    : null;

  const cards = [
    { label: t("detail.quantity"), value: metrics.tokens > 0 ? `${formatNumber(metrics.tokens, metrics.tokens >= 1 ? 4 : 8)} ${escapeHtml(row.symbol || "")}` : "--" },
    { label: t("detail.avgPrice"), value: metrics.entryPrice > 0 ? formatCurrency(metrics.entryPrice, getPriceDigits(metrics.entryPrice)) : "--" },
    { label: t("detail.invested"), value: maskedCurrency(metrics.investment) },
    { label: t("detail.currentValue"), value: maskedCurrency(metrics.currentValue) },
    { label: t("detail.pnlTotal"), value: maskedSignedCurrency(metrics.pnlUsd), tone: toneClass(metrics.pnlUsd), sub: formatPercent(metrics.pnlPct) },
    { label: t("detail.pnl24"), value: pnl24 != null ? maskedSignedCurrency(pnl24) : "--", tone: pnl24 != null ? toneClass(pnl24) : "", sub: change != null ? formatSignedPercent(change) : "" },
    { label: t("detail.weight"), value: weight != null ? `${weight.toFixed(1)}%` : "--" },
    { label: t("detail.ranking"), value: Number.isFinite(row.marketCapRank) ? `#${row.marketCapRank}` : "--" },
    { label: t("detail.marketCap"), value: Number.isFinite(row.marketCap) ? formatCompactCurrency(row.marketCap) : "--" },
    // Extremos, volumen y procedencia del dato: un dato que no existe se
    // muestra como "--", nunca como un cero que parece real.
    { label: t("detail.high24h"), value: Number.isFinite(row.high24h) ? formatCurrency(row.high24h, getPriceDigits(row.high24h)) : "--" },
    { label: t("detail.low24h"), value: Number.isFinite(row.low24h) ? formatCurrency(row.low24h, getPriceDigits(row.low24h)) : "--" },
    { label: t("detail.volume24h"), value: Number.isFinite(row.volume24h) ? formatCompactCurrency(row.volume24h) : "--" },
    { label: t("detail.priceSource"), value: escapeHtml(priceSourceLabel(row)), sub: row.lastPriceAt ? formatRelativeTime(new Date(row.lastPriceAt).getTime()) : "" }
  ];

  return `
    <div class="detail-cards">
      ${cards.map((card) => `
        <div class="detail-card">
          <span>${escapeHtml(card.label)}</span>
          <strong class="${card.tone || ""}">${card.value}</strong>
          ${card.sub ? `<small class="${card.tone || ""}">${escapeHtml(card.sub)}</small>` : ""}
        </div>
      `).join("")}
    </div>
    <section class="detail-chart-block">
      <div class="detail-chart-head">
        <h3>${escapeHtml(t("detail.evolution"))}</h3>
        <div class="detail-range" role="group">
          ${DETAIL_RANGES.map((range) => `
            <button class="detail-range-chip ${state.detailRange === range.key ? "is-active" : ""}" type="button" data-detail-range="${range.key}">${escapeHtml(t(range.labelKey))}</button>
          `).join("")}
        </div>
      </div>
      ${renderDetailChart(row)}
    </section>
  `;
}

// Gráfico SVG ligero (sin Chart.js) a partir del histórico de la posición.
function renderDetailChart(row) {
  const range = DETAIL_RANGES.find((r) => r.key === state.detailRange) || DETAIL_RANGES[0];
  const cutoff = Number.isFinite(range.ms) ? Date.now() - range.ms : 0;
  const history = (row.priceHistory || [])
    .filter((point) => Number.isFinite(point.price) && point.price > 0 && new Date(point.at).getTime() >= cutoff);

  if (history.length < 2) {
    return `<div class="detail-chart-empty">${escapeHtml(t("charts.emptyHistory"))}</div>`;
  }

  const points = downsampleHistoryPoints(history, 100);
  const values = points.map((p) => Number(p.price));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 320;
  const H = 120;
  const coords = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - 6 - ((v - min) / span) * (H - 12)
  ]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "var(--positive)" : "var(--negative)";
  const first = formatCurrency(values[0], getPriceDigits(values[0]));
  const last = formatCurrency(values[values.length - 1], getPriceDigits(values[values.length - 1]));

  return `
    <div class="detail-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t("detail.evolution"))}">
        <defs>
          <linearGradient id="detailFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${up ? "rgba(62,255,168,0.28)" : "rgba(255,85,85,0.28)"}" />
            <stop offset="100%" stop-color="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        <polygon points="${area}" fill="url(#detailFill)" />
        <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="detail-chart-axis"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>
    </div>
  `;
}

function renderDetailHistory(row) {
  const name = normalizeSearchText(assetDisplayName(row));
  const entries = state.activity.filter((item) =>
    normalizeSearchText(`${item.title} ${item.detail}`).includes(name)
  ).slice(0, 20);

  if (!entries.length) {
    return `<div class="detail-empty">${escapeHtml(t("detail.historyEmpty"))}</div>`;
  }
  return `
    <div class="detail-history">
      ${entries.map((item) => `
        <article class="detail-history-item">
          <strong class="${escapeHtml(item.tone || "neutral")}">${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.detail)}</p>
          <time>${escapeHtml(formatDateTime(new Date(item.at)))}</time>
        </article>
      `).join("")}
    </div>
  `;
}

function renderDetailTargets(row, metrics) {
  const targets = [["TP1", metrics.tp1], ["TP2", metrics.tp2], ["TP3", metrics.tp3]];
  const hasAny = targets.some(([, v]) => v > 0);
  if (!hasAny) {
    return `<div class="detail-empty">${escapeHtml(t("detail.targetsEmpty"))}<button class="primary-btn" type="button" data-detail-action="edit">${escapeHtml(t("buttons.edit"))}</button></div>`;
  }
  return `
    <div class="detail-targets">
      ${targets.map(([label, value]) => {
        if (!(value > 0)) {
          return `<div class="detail-target"><span>${label}</span><em>${escapeHtml(t("detail.noTarget"))}</em></div>`;
        }
        const reached = metrics.currentPrice >= value;
        const progress = metrics.currentPrice > 0 ? Math.max(0, Math.min(100, (metrics.currentPrice / value) * 100)) : 0;
        const dist = metrics.currentPrice > 0 ? (value / metrics.currentPrice - 1) * 100 : 0;
        return `
          <div class="detail-target ${reached ? "reached" : ""}">
            <div class="detail-target-top">
              <span>${label} · ${escapeHtml(formatCurrency(value, getPriceDigits(value)))}</span>
              <strong class="${reached ? "positive" : "warning"}">${reached ? escapeHtml(t("detail.reached")) : "+" + dist.toFixed(1) + "%"}</strong>
            </div>
            <div class="tp-progress"><span style="width:${progress}%"></span></div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDetailAlerts(row, metrics) {
  const targets = [["TP1", metrics.tp1, "tp1"], ["TP2", metrics.tp2, "tp2"], ["TP3", metrics.tp3, "tp3"]].filter(([, v]) => v > 0);
  if (!targets.length) {
    return `<div class="detail-empty">${escapeHtml(t("detail.alertsEmpty"))}<button class="primary-btn" type="button" data-detail-action="edit">${escapeHtml(t("buttons.edit"))}</button></div>`;
  }
  return `
    <div class="detail-alerts">
      ${targets.map(([label, value, key]) => {
        const fired = Boolean(row.alertsFired?.[key]);
        return `
          <div class="detail-alert">
            <span class="detail-alert-dot ${fired ? "fired" : ""}"></span>
            <div class="hl-main">
              <strong>${label} · ${escapeHtml(formatCurrency(value, getPriceDigits(value)))}</strong>
              <small>${fired ? escapeHtml(t("detail.alertFired")) : escapeHtml(t("detail.alertPending"))}</small>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDetailNotes(row) {
  const parts = [];
  if (row.purchaseDate) {
    parts.push(`<div class="detail-note-meta"><span>${escapeHtml(t("editor.purchaseDate"))}</span><strong>${escapeHtml(row.purchaseDate)}</strong></div>`);
  }
  if (row.personalLabel) {
    parts.push(`<div class="detail-note-meta"><span>${escapeHtml(t("editor.label"))}</span><strong>${escapeHtml(row.personalLabel)}</strong></div>`);
  }
  const noteHtml = row.note
    ? `<p class="detail-note-text">${escapeHtml(row.note)}</p>`
    : `<div class="detail-empty">${escapeHtml(t("detail.notesEmpty"))}</div>`;
  return `
    <div class="detail-notes">
      ${parts.join("")}
      ${noteHtml}
      <button class="ghost-btn" type="button" data-detail-action="edit">${escapeHtml(t("detail.editNote"))}</button>
    </div>
  `;
}
