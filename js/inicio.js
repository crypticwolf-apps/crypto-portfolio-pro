// =============================================================================
// inicio.js - Pantalla de Inicio (rediseno): saludo, saldo con su cambio por
// periodo, grafico del saldo, resumen, lista de activos, reparto, mercado y
// el orden de los bloques que se elige en Ajustes -> Apariencia.
// Mismos datos que antes (buildSnapshot, computeRowMetrics, state.history).
// =============================================================================

// Color de marca de los activos mas comunes (logo sin imagen y reparto).
const LOGO_COLORES = {
  BTC: "#F7931A", ETH: "#627EEA", SOL: "#7B3FE4", ADA: "#0033AD", LINK: "#2A5ADA",
  PEPE: "#3D8B3D", XRP: "#23292F", DOGE: "#C2A633", BNB: "#F0B90B", USDT: "#26A17B",
  USDC: "#2775CA", DOT: "#E6007A", AVAX: "#E84142", MATIC: "#8247E5", POL: "#8247E5",
  TRX: "#EB0029", LTC: "#345D9D", TON: "#0098EA", SUI: "#4DA2FF", SHIB: "#E0442C"
};
const LOGO_RESERVA = ["#5B6CF0", "#0E9F8A", "#C2410C", "#9333EA", "#0369A1", "#B45309", "#BE185D", "#4D7C0F"];
// Por debajo de este valor (en la moneda base) un activo cuenta como saldo
// pequeno y, con el ajuste activo, se agrupa al final de la lista.
const SALDO_PEQUENO = 1;
const ICONO_FLECHA_CAMBIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';

// Activos con color propio en los graficos (reparto e anillo); el resto, "Otros".
const SERIES_MAX = 6;

let grupoPequenosAbierto = false;
let graficoResizeTimer = null;

function bindHome() {
  dom.rangoSaldo?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rango]");
    if (!button || !APARIENCIA.rangos.includes(button.dataset.rango)) {
      return;
    }
    state.prefs.homeRange = button.dataset.rango;
    savePreferences();
    renderMainValueCard(buildSnapshot());
  });

  const list = document.getElementById("portfolioMobileList");
  list?.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="empty-add"]')) {
      handleAddRow();
      return;
    }
    const group = event.target.closest("[data-grupo-toggle]");
    if (group) {
      grupoPequenosAbierto = !grupoPequenosAbierto;
      group.setAttribute("aria-expanded", grupoPequenosAbierto ? "true" : "false");
      const box = document.getElementById("grupoPequenosLista");
      if (box) {
        box.hidden = !grupoPequenosAbierto;
      }
      const hint = group.querySelector("[data-role='grupoAccion']");
      if (hint) {
        hint.textContent = t(grupoPequenosAbierto ? "inicio.ocultar" : "inicio.ver");
      }
      return;
    }
    const open = event.target.closest("[data-asset-open]");
    if (open) {
      openAssetDetail(open.dataset.assetOpen);
    }
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(graficoResizeTimer);
    graficoResizeTimer = window.setTimeout(() => {
      renderHomeChart();
      refitAmounts();
    }, 160);
  });
}

// ── Cabecera ──
function portfolioInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "?";
  }
  const first = (word) => Array.from(word)[0] || "";
  const letters = words.length >= 2
    ? first(words[0]) + first(words[words.length - 1])
    : Array.from(words[0]).slice(0, 2).join("");
  return letters.toUpperCase();
}

function renderHomeGreeting() {
  if (dom.inicioSaludo) {
    const hour = new Date().getHours();
    const key = hour >= 6 && hour < 13 ? "inicio.buenosDias"
      : hour >= 13 && hour < 21 ? "inicio.buenasTardes"
        : "inicio.buenasNoches";
    dom.inicioSaludo.textContent = t(key);
  }
  if (dom.inicioAvatar) {
    dom.inicioAvatar.textContent = portfolioInitials(getPortfolioName());
  }
}

// ── Saldo y su cambio en el periodo elegido ──
function homeHistoryPoints(range) {
  const windowMs = RANGOS_INICIO[range] ?? Infinity;
  const cutoff = Number.isFinite(windowMs) ? Date.now() - windowMs : -Infinity;
  return state.history.filter((point) => point.currency === state.prefs.currency
    && Number(point.total) > 0
    && new Date(point.at).getTime() >= cutoff);
}

// Cambio del saldo en el periodo: 1D sale de la variacion 24 h de cada activo
// (exacta aunque no haya historial); "Todo" es el resultado neto sobre lo
// aportado (igual que Analitica); el resto, del historial guardado.
function homeRangeChange(snapshot) {
  const range = state.prefs.homeRange;
  const total = snapshot.totals.currentValue;
  if (range === "todo") {
    const result = getPeriodResult("total", snapshot);
    return { delta: result.money, pct: result.pct, label: t("inicio.desdeInicio") };
  }
  if (range === "1d") {
    const change = getPortfolio24hChange(snapshot);
    return change
      ? { delta: change.delta, pct: change.pct, label: t("inicio.etiqueta1d") }
      : { delta: null, pct: null, label: t("inicio.etiqueta1d") };
  }
  const points = homeHistoryPoints(range);
  const first = points[0];
  const base = first ? Number(first.total) : 0;
  if (!(base > 0) || !(total > 0)) {
    return { delta: null, pct: null, label: t("inicio.sinHistorial") };
  }
  // Si el historial empieza bastante despues del inicio del periodo, se dice
  // desde cuando se mide en vez de prometer "este mes".
  const windowMs = RANGOS_INICIO[range];
  const startedLate = new Date(first.at).getTime() - (Date.now() - windowMs) > windowMs * 0.1;
  const label = startedLate
    ? t("inicio.desdeFecha", { fecha: intlFormatter("date", getUiLocale(), { day: "numeric", month: "short" }).format(new Date(first.at)) })
    : t(`inicio.etiqueta${range}`);
  const delta = total - base;
  return { delta, pct: (delta / base) * 100, label };
}

function renderMainValueCard(snapshot) {
  if (!dom.mainValue) {
    return;
  }
  const hidden = state.prefs.hideBalance;
  const parts = moneyParts(snapshot.totals.currentValue);
  dom.mainValue.innerHTML = hidden
    ? '<span class="saldo-entero">••••••</span>'
    : `<span class="saldo-entero">${escapeHtml(parts.main)}</span><span class="saldo-resto">${escapeHtml(parts.rest)}</span>`;
  fitAmount(dom.mainValue, "saldo");

  const change = homeRangeChange(snapshot);
  if (dom.saldoCambio && dom.saldoCambioValor) {
    const has = Number.isFinite(change.delta);
    const tone = has ? toneClass(change.delta) : "neutral";
    dom.saldoCambio.className = `chip-cambio ${tone}`;
    let text = "--";
    if (has) {
      const pct = Number.isFinite(change.pct) ? formatPercent(change.pct) : "";
      text = hidden ? pct || "••••" : [formatSignedCurrency(change.delta), pct].filter(Boolean).join(" · ");
    }
    dom.saldoCambioValor.textContent = text;
  }
  if (dom.saldoCambioEtiqueta) {
    dom.saldoCambioEtiqueta.textContent = change.label;
  }
  if (dom.mainUpdated) {
    dom.mainUpdated.textContent = mainUpdatedLabel();
  }
  dom.rangoSaldo?.querySelectorAll("[data-rango]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.rango === state.prefs.homeRange ? "true" : "false");
  });
  renderHomeChart(snapshot);
  renderHomeGreeting();
}

// ── Grafico de area (SVG propio: ligero y nitido a cualquier ancho) ──
// points: [{ at, value }] en orden. Se dibuja al ancho real del contenedor.
function areaChartSvg(points, width, { height = 150, label = "", id = "graficoRelleno" } = {}) {
  const sampled = downsampleHistoryPoints(points, 140);
  const top = 10;
  const bottom = 8;
  const values = sampled.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < Math.abs(max) * 0.002) {
    // Serie casi plana: se centra la linea en vez de exagerar el ruido.
    const pad = Math.max(Math.abs(max) * 0.01, 1e-9);
    min -= pad;
    max += pad;
  }
  const first = sampled[0].at;
  const span = Math.max(1, sampled[sampled.length - 1].at - first);
  const xy = sampled.map((point) => [
    2 + ((point.at - first) / span) * (width - 8),
    top + (1 - (point.value - min) / (max - min)) * (height - top - bottom)
  ]);
  const line = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const end = xy[xy.length - 1];
  const area = `${line} L${end[0].toFixed(1)} ${height} L${xy[0][0].toFixed(1)} ${height} Z`;
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(label)}">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" class="grafico-stop-alto"></stop>
          <stop offset="100%" class="grafico-stop-bajo"></stop>
        </linearGradient>
      </defs>
      <path class="grafico-area" d="${area}" fill="url(#${id})"></path>
      <path class="grafico-linea" d="${line}" fill="none"></path>
      <circle class="grafico-punto" cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="4.5"></circle>
    </svg>`;
}

function chartWidthOf(box) {
  // Oculto no tiene ancho: se estima con la ventana (nunca menos de 120 px).
  return Math.max(120, Math.round(box.clientWidth || Math.min(608, window.innerWidth - 32)));
}

function renderHomeChart(snapshot = null) {
  const box = dom.graficoSaldo;
  if (!box) {
    return;
  }
  const current = (snapshot || buildSnapshot()).totals.currentValue;
  const points = homeHistoryPoints(state.prefs.homeRange).map((point) => ({
    at: new Date(point.at).getTime(),
    value: Number(point.total)
  }));
  if (current > 0) {
    points.push({ at: Date.now(), value: current });
  }
  if (points.length < 3) {
    box.innerHTML = `<div class="grafico-vacio">${escapeHtml(t("inicio.graficoVacio"))}</div>`;
    return;
  }
  // En escritorio el grafico llena el alto de su tarjeta (el ResizeObserver
  // de escritorio.js lo redibuja si cambia); en movil mide 150 px.
  const height = modoEscritorio() ? Math.max(150, Math.round(box.clientHeight)) : 150;
  box.innerHTML = areaChartSvg(points, chartWidthOf(box), { label: t("inicio.graficoAria"), id: "graficoRelleno", height });
}

// ── Resumen: hoy, invertido, mejor y peor de las ultimas 24 h ──
function renderSummary(snapshot) {
  renderMainValueCard(snapshot);

  const change = getPortfolio24hChange(snapshot);
  const dayItems = get24hInsightItems(snapshot);
  const bestDay = [...dayItems].sort((a, b) => b.change24h - a.change24h)[0] || null;
  const worstDay = [...dayItems].sort((a, b) => a.change24h - b.change24h)[0] || null;
  const assets = snapshot.items.filter(({ metrics }) => metrics.currentValue > 0 || metrics.investment > 0).length;

  const cells = [
    {
      label: t("inicio.hoy"),
      value: change ? formatSignedPercent(change.pct) : "--",
      tone: change ? toneClass(change.pct) : "",
      sub: change ? maskedSignedCurrency(change.delta) : t("inicio.sinDatos")
    },
    {
      label: t("summary.investedShort"),
      value: maskedCurrency(snapshot.totals.investment),
      tone: "",
      sub: t(assets === 1 ? "inicio.unActivo" : "inicio.nActivos", { n: assets })
    },
    {
      label: t("inicio.mejor24h"),
      value: bestDay ? formatSignedPercent(bestDay.change24h) : "--",
      tone: bestDay ? toneClass(bestDay.change24h) : "",
      sub: bestDay ? assetDisplayName(bestDay.row) : t("inicio.sinDatos")
    },
    {
      label: t("inicio.peor24h"),
      value: worstDay ? formatSignedPercent(worstDay.change24h) : "--",
      tone: worstDay ? toneClass(worstDay.change24h) : "",
      sub: worstDay ? assetDisplayName(worstDay.row) : t("inicio.sinDatos")
    }
  ];

  dom.summaryGrid.innerHTML = cells.map((cell) => `
    <div class="resumen-celda">
      <span class="resumen-etiqueta">${escapeHtml(cell.label)}</span>
      <strong class="resumen-valor ${cell.tone}">${escapeHtml(cell.value)}</strong>
      <span class="resumen-sub">${escapeHtml(cell.sub)}</span>
    </div>
  `).join("");

  renderAllocationCard(snapshot);
}

// ── Reparto: los tres activos con mas peso y el resto en "Otros" ──
function assetColor(row) {
  const symbol = String(row.symbol || "").toUpperCase();
  if (LOGO_COLORES[symbol]) {
    return LOGO_COLORES[symbol];
  }
  const key = String(row.coinId || row.symbol || row.crypto || "?");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return LOGO_RESERVA[hash % LOGO_RESERVA.length];
}

// Color de cada activo en los graficos (reparto de Inicio y anillo de
// Analitica). Los SERIES_MAX con mas valor reciben un color de la paleta
// validada (--serie-1..6) en el orden en que se anadieron a la cartera: asi un
// activo no cambia de color porque cambie su puesto en el ranking, y es el
// mismo en las dos pantallas.
function seriesColorMap(snapshot) {
  const top = snapshot.items
    .filter(({ metrics }) => metrics.currentValue > 0)
    .sort((a, b) => b.metrics.currentValue - a.metrics.currentValue)
    .slice(0, SERIES_MAX)
    .map(({ row }) => row);
  const map = new Map();
  top
    .sort((a, b) => state.rows.indexOf(a) - state.rows.indexOf(b))
    .forEach((row, index) => map.set(row.id, `var(--serie-${index + 1})`));
  return map;
}

// Texto legible sobre un color de fondo (logo sin imagen).
function inkOn(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? "#0A0B0D" : "#FFFFFF";
}

function renderAllocationCard(snapshot) {
  const card = document.getElementById("allocationCard");
  if (!card) {
    return;
  }
  const items = snapshot.items
    .filter(({ metrics }) => metrics.currentValue > 0)
    .sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);
  const sum = items.reduce((total, { metrics }) => total + metrics.currentValue, 0);
  if (!(sum > 0)) {
    card.hidden = true;
    return;
  }

  const colors = seriesColorMap(snapshot);
  const top = items.length > 4 ? items.slice(0, 3) : items;
  const rest = items.length > 4 ? items.slice(3) : [];
  const parts = top.map(({ row, metrics }) => ({
    name: assetDisplayName(row),
    pct: (metrics.currentValue / sum) * 100,
    color: colors.get(row.id) || "var(--c-t3)"
  }));
  if (rest.length) {
    parts.push({
      name: t("inicio.otros"),
      pct: (rest.reduce((total, { metrics }) => total + metrics.currentValue, 0) / sum) * 100,
      color: "var(--c-t3)"
    });
  }

  card.hidden = false;
  card.innerHTML = `
    <h2 class="titulo-tarjeta">${escapeHtml(t("inicio.reparto"))}</h2>
    <div class="reparto-barra" aria-hidden="true">
      ${parts.map((part) => `<span style="flex-grow:${part.pct.toFixed(3)};background:${part.color}"></span>`).join("")}
    </div>
    <div class="reparto-leyenda">
      ${parts.map((part) => `
        <span class="reparto-item">
          <i style="background:${part.color}" aria-hidden="true"></i>
          <span>${escapeHtml(part.name)}</span>
          <strong>${part.pct.toFixed(1)}%</strong>
        </span>
      `).join("")}
    </div>
  `;
}

// ── Lista de activos ──
function assetLogoHtml(row) {
  const color = assetColor(row);
  const inner = row.image
    ? `<img src="${escapeHtml(row.image)}" alt="" loading="lazy" />`
    : escapeHtml(String(row.symbol || row.crypto || "?").slice(0, 4).toUpperCase());
  return `<span class="logo-activo" style="--logo:${color};color:${inkOn(color)}" aria-hidden="true">${inner}</span>`;
}

function listMetricOf(row, metrics) {
  const metric = state.prefs.listMetric;
  if (metric === "precio") {
    return {
      text: metrics.currentPrice > 0 ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice)) : "--",
      tone: ""
    };
  }
  if (metric === "pnl") {
    return metrics.investment > 0
      ? { text: formatPercent(metrics.pnlPct), tone: toneClass(metrics.pnlPct) }
      : { text: "--", tone: "" };
  }
  const change = row.priceChange24h;
  return Number.isFinite(change)
    ? { text: formatSignedPercent(change), tone: toneClass(change) }
    : { text: "--", tone: "" };
}

function assetRowHtml(row) {
  const metrics = computeRowMetrics(row);
  const metric = listMetricOf(row, metrics);
  const qty = metrics.tokens > 0
    ? `${state.prefs.hideBalance ? "••••" : formatTokenAmount(metrics.tokens)} ${escapeHtml(row.symbol || "")}`
    : escapeHtml(row.symbol || t("row.noAsset"));
  const name = row.resolvedName || assetDisplayName(row);
  return `
    <div class="fila-activo" role="listitem" data-card-row="${escapeHtml(row.id)}">
      <button class="fila-activo-boton" type="button" data-asset-open="${escapeHtml(row.id)}">
        ${assetLogoHtml(row)}
        <span class="fila-activo-id">
          <span class="fila-activo-nombre">${escapeHtml(name)}${row.favorite ? '<span class="favorito" aria-hidden="true">★</span>' : ""}</span>
          <span class="fila-activo-sub">${qty}${walletBadgeHtml(row)}</span>
        </span>
        <span class="fila-activo-cifras">
          <span class="fila-activo-valor" data-role="rowValue">${maskedCurrency(metrics.currentValue)}</span>
          <span class="fila-activo-cambio ${metric.tone}" data-role="rowMetric">${escapeHtml(metric.text)}</span>
        </span>
      </button>
    </div>
  `;
}

// Cantidad de tokens para la lista: las enormes en formato corto (10 M).
function formatTokenAmount(tokens) {
  if (tokens >= 1e6) {
    return intlFormatter("number", getUiLocale(), { notation: "compact", maximumFractionDigits: 2 }).format(tokens);
  }
  return formatNumber(tokens, tokens >= 1 ? 4 : 8);
}

function isSmallBalance(row) {
  const metrics = computeRowMetrics(row);
  return metrics.currentPrice > 0 && metrics.currentValue < SALDO_PEQUENO;
}

function renderPortfolioMobile(rows) {
  const box = document.getElementById("portfolioMobileList");
  if (!box) {
    return;
  }
  if (!rows.length) {
    box.innerHTML = `
      <div class="lista-vacia">
        <strong>${escapeHtml(t("table.emptyTitle"))}</strong>
        <p>${escapeHtml(t("table.emptyText"))}</p>
        <button class="boton-primario" type="button" data-action="empty-add">${escapeHtml(t("buttons.newPosition"))}</button>
      </div>`;
    return;
  }

  const small = state.prefs.groupSmall ? rows.filter(isSmallBalance) : [];
  const grouped = small.length >= 2;
  const main = grouped ? rows.filter((row) => !small.includes(row)) : rows;
  let html = main.map((row) => assetRowHtml(row)).join("");
  if (grouped) {
    const total = small.reduce((sum, row) => sum + computeRowMetrics(row).currentValue, 0);
    html += `
      <div class="grupo-pequenos" role="listitem">
        <button class="fila-activo-boton" type="button" data-grupo-toggle aria-expanded="${grupoPequenosAbierto ? "true" : "false"}" aria-controls="grupoPequenosLista">
          <span class="logo-activo logo-grupo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="16" cy="12" r="1.2"/></svg></span>
          <span class="fila-activo-id">
            <span class="fila-activo-nombre">${escapeHtml(t("inicio.saldosPequenos"))}</span>
            <span class="fila-activo-sub">${escapeHtml(t("inicio.nActivos", { n: small.length }))}</span>
          </span>
          <span class="fila-activo-cifras">
            <span class="fila-activo-valor" data-role="grupoValor">${maskedCurrency(total)}</span>
            <span class="fila-activo-cambio" data-role="grupoAccion">${escapeHtml(t(grupoPequenosAbierto ? "inicio.ocultar" : "inicio.ver"))}</span>
          </span>
        </button>
        <div id="grupoPequenosLista" role="list" ${grupoPequenosAbierto ? "" : "hidden"}>
          ${small.map((row) => assetRowHtml(row)).join("")}
        </div>
      </div>`;
  }
  box.innerHTML = html;
}

function assetRowNode(rowId) {
  return document.querySelector(`#portfolioMobileList [data-card-row="${CSS.escape(String(rowId))}"]`);
}

// Repinta una sola fila (cambio de datos de esa posicion).
function updateMobileCard(rowId) {
  const node = assetRowNode(rowId);
  const row = getRowById(rowId);
  if (node && row) {
    node.outerHTML = assetRowHtml(row);
  }
}

// Tick de precio en vivo: solo cambian el valor y el dato de la derecha.
function updateAssetRowLive(rowId, direction) {
  const node = assetRowNode(rowId);
  const row = getRowById(rowId);
  if (!node || !row) {
    return false;
  }
  const metrics = computeRowMetrics(row);
  const value = node.querySelector("[data-role='rowValue']");
  if (value) {
    setText(value, maskedCurrency(metrics.currentValue));
    flashNode(value, direction);
  }
  const metricNode = node.querySelector("[data-role='rowMetric']");
  if (metricNode) {
    const metric = listMetricOf(row, metrics);
    setText(metricNode, metric.text);
    ["positive", "negative", "neutral"].forEach((tone) => metricNode.classList.toggle(tone, metric.tone === tone));
  }
  // Fila dentro de "Saldos pequenos": su total tambien cambia.
  const group = node.closest("#grupoPequenosLista");
  const groupValue = group?.parentElement?.querySelector("[data-role='grupoValor']");
  if (groupValue) {
    const total = [...group.querySelectorAll("[data-card-row]")]
      .reduce((sum, item) => {
        const groupRow = getRowById(item.dataset.cardRow);
        return sum + (groupRow ? computeRowMetrics(groupRow).currentValue : 0);
      }, 0);
    setText(groupValue, maskedCurrency(total));
  }
  return true;
}

// ── Mercado ──
function renderMarketSection() {
  if (!dom.marketGrid) {
    return;
  }
  const market = state.market;
  // Mientras no ha llegado nada del mercado se ve un hueco de carga; si ya
  // llego y falta un dato concreto, un guion.
  const loaded = Boolean(market.globalUpdatedAt || market.btc || market.fearGreed);
  const loading = loaded
    ? '<strong class="mercado-valor">--</strong>'
    : '<span class="mercado-cargando" aria-hidden="true"></span>';
  const coin = (label, data) => {
    const ok = data && Number.isFinite(data.price);
    const change = ok && Number.isFinite(data.change24h) ? data.change24h : null;
    return `
      <div class="mercado-celda">
        <span class="mercado-etiqueta">${escapeHtml(label)}</span>
        ${ok ? `<strong class="mercado-valor">${formatCurrency(data.price, getPriceDigits(data.price))}</strong>
        <span class="mercado-sub ${change === null ? "" : toneClass(change)}">${change === null ? "--" : formatSignedPercent(change)} · 24h</span>` : loading}
      </div>`;
  };

  const dominance = Number.isFinite(market.btcDominance) ? Math.max(0, Math.min(100, market.btcDominance)) : null;
  const dominanceCell = `
    <div class="mercado-celda">
      <span class="mercado-etiqueta">${escapeHtml(t("market.btcDominance"))}</span>
      ${dominance === null ? loading : `<strong class="mercado-valor">${dominance.toFixed(1)}%</strong>
      <span class="mercado-barra" aria-hidden="true"><span style="width:${dominance.toFixed(1)}%"></span></span>`}
    </div>`;

  const fng = market.fearGreed;
  const fngValue = fng && Number.isFinite(fng.value) ? Math.max(0, Math.min(100, Number(fng.value))) : null;
  const fngCell = `
    <div class="mercado-celda">
      <span class="mercado-etiqueta">${escapeHtml(t("market.fearGreed"))}</span>
      ${fngValue === null ? loading : `<strong class="mercado-valor">${fngValue} <span class="mercado-sub">${escapeHtml(t(fngClassificationKey(fngValue)))}</span></strong>
      <span class="mercado-barra miedo" aria-hidden="true"><i style="left:${fngValue}%"></i></span>`}
    </div>`;

  dom.marketGrid.innerHTML = [coin("Bitcoin", market.btc), coin("Ethereum", market.eth), dominanceCell, fngCell].join("");

  // Tendencia: media de la variacion 24 h de BTC y ETH.
  const trendChip = document.getElementById("marketTrendChip");
  if (trendChip) {
    const changes = [market.btc?.change24h, market.eth?.change24h].filter(Number.isFinite);
    if (changes.length) {
      const average = changes.reduce((total, value) => total + value, 0) / changes.length;
      const tone = average > 1.5 ? "positive" : average < -1.5 ? "negative" : "neutral";
      trendChip.innerHTML = `${ICONO_FLECHA_CAMBIO}<span>${escapeHtml(t(average > 1.5 ? "market.trendUp" : average < -1.5 ? "market.trendDown" : "market.trendFlat"))}</span>`;
      trendChip.className = `chip-cambio ${tone}`;
      trendChip.hidden = false;
    } else {
      trendChip.hidden = true;
    }
  }
}

// ── Orden y visibilidad de los bloques (Ajustes -> Apariencia) ──
function applyHomeBlocks() {
  const box = dom.inicioBloques;
  if (!box) {
    return;
  }
  normalizeHomeBlocks(state.prefs.homeBlocks).forEach(({ id, on }) => {
    // En escritorio los bloques viven en su sitio de la pagina: se ocultan
    // igual, pero el orden solo manda en la lista de Inicio del movil.
    const section = document.querySelector(`[data-bloque="${id}"]`);
    if (section) {
      section.toggleAttribute("data-apagado", !on);
      if (box.contains(section)) {
        box.appendChild(section);
      }
    }
  });
}
