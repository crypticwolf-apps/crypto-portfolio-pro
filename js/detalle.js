// =============================================================================
// detalle.js - Ficha de un activo (pantalla completa): precio, grafico, tu
// posicion, objetivos de venta (con su aviso), mercado, notas y actividad.
// Todo en una sola pagina, sin pestanas. Abajo, Vender y Comprar (o
// Actualizar billetera en las posiciones leidas de una billetera).
// =============================================================================

const DETAIL_RANGES = [
  { key: "1d", labelKey: "detail.range1d", ms: 24 * 60 * 60 * 1000 },
  { key: "1w", labelKey: "detail.range1w", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1mo", labelKey: "detail.range1mo", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "3mo", labelKey: "detail.range3mo", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "1y", labelKey: "detail.range1y", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "total", labelKey: "detail.rangeTotal", ms: Infinity }
];
const DETAIL_ACTIVITY_MAX = 10;
// Con precio en vivo el grafico de la ficha se redibuja como mucho cada 15 s.
const DETAIL_CHART_LIVE_MS = 15000;
let detailChartAt = 0;
let detailReturnFocus = null;

const ICONOS_FICHA = {
  volver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  mas: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  campana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
};

function starSvg(filled) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.9 9.1 9z"/></svg>`;
}

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
  window.addEventListener("resize", () => {
    if (state.detailRowId) {
      renderDetailChart(getRowById(state.detailRowId));
    }
  });
}

function openAssetDetail(rowId) {
  const row = getRowById(rowId);
  const screen = document.getElementById("assetDetailScreen");
  if (!row || !screen) {
    return;
  }
  // Al cerrar, el foco vuelve a donde estaba (la fila que se toco).
  detailReturnFocus = document.activeElement instanceof HTMLElement && !screen.contains(document.activeElement)
    ? document.activeElement
    : null;
  state.detailRowId = rowId;
  infoMoneda.descripcionAbierta = false;
  showOverlay(screen);
  document.body.classList.add("detail-open");
  renderAssetDetail();
  screen.scrollTop = 0;
  screen.querySelector("[data-detail-close]")?.focus({ preventScroll: true });
}

function closeAssetDetail() {
  const screen = document.getElementById("assetDetailScreen");
  if (!screen || !state.detailRowId) {
    return;
  }
  state.detailRowId = null;
  hideOverlay(screen, 220, () => {
    screen.innerHTML = "";
    document.body.classList.remove("detail-open");
  });
  if (detailReturnFocus?.isConnected) {
    detailReturnFocus.focus({ preventScroll: true });
  }
  detailReturnFocus = null;
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
      openRowMenu(rowId, document.querySelector("#assetDetailScreen [data-detail-action='menu']"));
      break;
    case "descripcion":
      infoMoneda.descripcionAbierta = !infoMoneda.descripcionAbierta;
      repintarFichaInfo();
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
  const name = row.resolvedName || assetDisplayName(row);
  const wallet = isWalletRow(row);

  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-label", name);
  screen.innerHTML = `
    <div class="ficha">
      <header class="ficha-cabecera">
        <button class="boton-icono" type="button" data-detail-close aria-label="${escapeHtml(t("buttons.close"))}">${ICONOS_FICHA.volver}</button>
        <div class="ficha-titulo">
          ${assetLogoHtml(row)}
          <span class="ficha-nombre">
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(row.symbol || row.crypto || "")}</small>
          </span>
        </div>
        <button class="boton-icono ficha-favorito" type="button" data-detail-action="favorite" aria-pressed="${row.favorite ? "true" : "false"}" aria-label="${escapeHtml(t("editor.favorite"))}">${starSvg(row.favorite)}</button>
        <button class="boton-icono" type="button" data-detail-action="menu" aria-label="${escapeHtml(t("buttons.moreActions"))}">${ICONOS_FICHA.mas}</button>
      </header>

      ${renderDetailPrice(row, metrics, name)}

      <section class="ficha-grafico" aria-label="${escapeHtml(t("detail.evolution"))}">
        <div class="grafico-saldo" data-detail-role="chart"></div>
        <p class="grafico-leyenda" data-detail-role="leyenda" hidden></p>
        <div class="segmentado" role="group" aria-label="${escapeHtml(t("inicio.rangoAria"))}">
          ${DETAIL_RANGES.map((range) => `
            <button type="button" data-detail-range="${range.key}" aria-pressed="${state.detailRange === range.key ? "true" : "false"}">${escapeHtml(t(range.labelKey))}</button>
          `).join("")}
        </div>
      </section>

      ${renderDetailPosition(row, metrics)}
      ${renderDetailTargets(row, metrics)}
      ${renderDetailMarket(row)}
      ${renderDetailSupply(row)}
      ${renderDetailAbout(row)}
      ${renderDetailNotes(row)}
      ${renderDetailHistory(row)}

      <footer class="ficha-pie ${wallet ? "es-billetera" : ""}">
        ${wallet
          ? `<button class="ficha-boton es-primario" type="button" data-detail-action="walletSync">${escapeHtml(t("wallet.syncOne"))}</button>`
          : `<button class="ficha-boton" type="button" data-detail-action="sell">${escapeHtml(t("detail.sell"))}</button>
        <button class="ficha-boton es-primario" type="button" data-detail-action="buy">${escapeHtml(t("detail.buy"))}</button>`}
      </footer>
    </div>
  `;
  fitAmount(screen.querySelector("[data-detail-role='price']"), "ficha");
  renderDetailChart(row);
}

function renderDetailPrice(row, metrics, name) {
  return `<section class="ficha-precio" data-detail-body="precio">${detailPriceInner(row, metrics, name)}</section>`;
}

// Cambio del precio en el rango elegido (con precios pasados reales); en 1D,
// o mientras no llegan, la variacion de 24 h.
function cambioDelRangoFicha(row, metrics) {
  if (state.detailRange === "1d" || !(metrics.currentPrice > 0)) {
    return null;
  }
  const serie = serieFicha(row, state.detailRange);
  if (!serie) {
    return null;
  }
  const pct = (metrics.currentPrice / serie[0].value - 1) * 100;
  const etiqueta = state.detailRange === "total"
    ? t("ficha.desde", { fecha: intlFormatter("date", getUiLocale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(serie[0].at)) })
    : t(`ficha.periodo.${state.detailRange}`);
  return Number.isFinite(pct) ? { pct, etiqueta } : null;
}

function detailPriceInner(row, metrics, name = row.resolvedName || assetDisplayName(row)) {
  const periodo = cambioDelRangoFicha(row, metrics);
  const change = periodo ? periodo.pct : Number.isFinite(row.priceChange24h) ? row.priceChange24h : null;
  const price = metrics.currentPrice > 0
    ? (() => {
        const parts = moneyParts(metrics.currentPrice, getPriceDigits(metrics.currentPrice));
        return `<span class="saldo-entero">${escapeHtml(parts.main)}</span><span class="saldo-resto">${escapeHtml(parts.rest)}</span>`;
      })()
    : "--";
  const source = metrics.currentPrice > 0 ? priceSourceLabel(row) : t("row.noPrice");
  return `
    <span class="saldo-etiqueta">${escapeHtml(t("ficha.precioDe", { activo: name }))}</span>
    <strong class="saldo-valor" data-detail-role="price">${price}</strong>
    <div class="saldo-cambio">
      <span class="chip-cambio ${change === null ? "neutral" : toneClass(change)}">${ICONO_FLECHA_CAMBIO}<span>${change === null ? "--" : formatSignedPercent(change)}</span></span>
      <span class="saldo-cambio-texto">${escapeHtml(periodo
        ? t("ficha.periodoFuente", { periodo: periodo.etiqueta, fuente: source })
        : t("ficha.hoyFuente", { fuente: source }))}</span>
    </div>`;
}

// Precio en vivo con la ficha abierta: solo se cambia lo que lleva cifras
// (precio, posicion, objetivos y mercado). La cabecera, los enlaces Editar y
// la botonera no se tocan: rehacerlos en cada tick se comia el toque de
// quien pulsaba Comprar justo entonces.
function refreshAssetDetailLive() {
  const screen = document.getElementById("assetDetailScreen");
  const row = getRowById(state.detailRowId);
  if (!screen || !row || screen.hidden) {
    return;
  }
  if (!screen.querySelector(".ficha")) {
    renderAssetDetail();
    return;
  }
  const metrics = computeRowMetrics(row);
  const bodies = {
    precio: () => detailPriceInner(row, metrics),
    posicion: () => detailPositionBody(row, metrics),
    objetivos: () => detailTargetsBody(row, metrics),
    mercado: () => detailMarketBody(row)
  };
  Object.entries(bodies).forEach(([key, html]) => {
    const node = screen.querySelector(`[data-detail-body="${key}"]`);
    if (node) {
      node.innerHTML = html();
    }
  });
  fitAmount(screen.querySelector("[data-detail-role='price']"), "ficha");
  if (Date.now() - detailChartAt > DETAIL_CHART_LIVE_MS) {
    renderDetailChart(row);
  }
}

// Al llegar los precios pasados del rango: grafico y cambio del periodo.
function repintarFichaConHistorial() {
  const screen = document.getElementById("assetDetailScreen");
  const row = getRowById(state.detailRowId);
  if (!screen || !row || screen.hidden) {
    return;
  }
  const precio = screen.querySelector("[data-detail-body=\"precio\"]");
  if (precio) {
    precio.innerHTML = detailPriceInner(row, computeRowMetrics(row));
    fitAmount(screen.querySelector("[data-detail-role=\"price\"]"), "ficha");
  }
  renderDetailChart(row);
}

// Grafico del precio: el de CoinGecko en el rango (historial.js) o, si no
// esta, el que la app ha guardado de la posicion. Mas el precio de ahora.
// La linea va en verde si el periodo sube y en rojo si baja.
function renderDetailChart(row) {
  const box = document.querySelector("#assetDetailScreen [data-detail-role='chart']");
  if (!box || !row) {
    return;
  }
  detailChartAt = Date.now();
  const range = DETAIL_RANGES.find((r) => r.key === state.detailRange) || DETAIL_RANGES[0];
  const cutoff = Number.isFinite(range.ms) ? Date.now() - range.ms : 0;
  const reales = serieFicha(row, range.key);
  const points = reales
    ? reales.slice()
    : (row.priceHistory || [])
        .map((point) => ({ at: new Date(point.at).getTime(), value: Number(point.price) }))
        .filter((point) => Number.isFinite(point.value) && point.value > 0 && point.at >= cutoff)
        .sort((a, b) => a.at - b.at);
  const current = computeRowMetrics(row).currentPrice;
  if (current > 0 && (!points.length || Date.now() - points[points.length - 1].at > 60 * 1000)) {
    points.push({ at: Date.now(), value: current });
  }
  if (points.length < 3) {
    box.innerHTML = `<div class="grafico-vacio">${escapeHtml(t("charts.emptyHistory"))}</div>`;
    return;
  }
  const tono = points[points.length - 1].value >= points[0].value ? "sube" : "baja";
  // Tus compras y ventas de este activo (en su fecha y a su precio) y tu
  // precio medio. En modo privado, el medio sin cifra.
  const marcas = state.trades
    .filter((trade) => trade.rowId === row.id && Number(trade.price) > 0 && Number.isFinite(Number(trade.at)))
    .map((trade) => ({ at: Number(trade.at), valor: Number(trade.price), tipo: trade.type === "sell" ? "venta" : "compra" }));
  const medio = computeRowMetrics(row).entryPrice;
  const medioEtiqueta = medio > 0
    ? (state.prefs.hideBalance ? t("ficha.precioMedio") : `${t("ficha.precioMedio")} ${formatCurrency(medio, digitosPrecioCorto(medio))}`)
    : "";
  const grafico = areaChartSvg(points, chartWidthOf(box), { label: t("detail.evolution"), id: "graficoFicha", tono, marcas, medio: medio > 0 ? medio : null, medioEtiqueta });
  const leyenda = document.querySelector("#assetDetailScreen [data-detail-role='leyenda']");
  if (leyenda) {
    const vistas = points[0].at;
    const tipos = new Set(marcas.filter((m) => m.at >= vistas).map((m) => m.tipo));
    const piezas = [
      tipos.has("compra") ? `<span><i class="leyenda-op compra"></i>${escapeHtml(t("ficha.leyendaCompra"))}</span>` : "",
      tipos.has("venta") ? `<span><i class="leyenda-op venta"></i>${escapeHtml(t("ficha.leyendaVenta"))}</span>` : "",
      grafico.html.includes("grafico-medio") ? `<span><i class="leyenda-medio"></i>${escapeHtml(t("ficha.precioMedio"))}</span>` : ""
    ].filter(Boolean);
    leyenda.innerHTML = piezas.join("");
    leyenda.hidden = !piezas.length;
  }
  dibujarGrafico(box, grafico, {
    // Precio de mercado: se ve tambien en modo privado.
    valor: (punto) => formatCurrency(punto.value, getPriceDigits(punto.value)),
    extra: (punto, primero) => {
      const pct = (punto.value / primero.value - 1) * 100;
      return Number.isFinite(pct) ? { texto: formatSignedPercent(pct), tono: toneClass(pct) } : null;
    }
  });
}

function detailCell(label, value, tone = "", sub = "") {
  return `
    <div class="ficha-dato">
      <dt>${escapeHtml(label)}</dt>
      <dd class="${tone}">${value}${sub ? `<small class="${tone}">${escapeHtml(sub)}</small>` : ""}</dd>
    </div>`;
}

function renderDetailPosition(row, metrics) {
  return `
    <section class="tarjeta ficha-bloque">
      <div class="ficha-bloque-cabecera">
        <h2 class="titulo-tarjeta">${escapeHtml(t("ficha.tuPosicion"))}</h2>
        <button class="enlace" type="button" data-detail-action="edit">${escapeHtml(t("buttons.edit"))}</button>
      </div>
      <div class="ficha-bloque-cuerpo" data-detail-body="posicion">${detailPositionBody(row, metrics)}</div>
    </section>`;
}

function detailPositionBody(row, metrics) {
  const totalValue = state.rows.reduce((sum, item) => {
    const v = computeRowMetrics(item).currentValue;
    return sum + (v > 0 ? v : 0);
  }, 0);
  const weight = totalValue > 0 && metrics.currentValue > 0 ? (metrics.currentValue / totalValue) * 100 : null;
  const change = Number.isFinite(row.priceChange24h) ? row.priceChange24h : null;
  const pnl24 = change != null && metrics.currentValue > 0
    ? metrics.currentValue - metrics.currentValue / (1 + change / 100)
    : null;
  const qty = metrics.tokens > 0
    ? `${state.prefs.hideBalance ? "••••" : escapeHtml(formatNumber(metrics.tokens, metrics.tokens >= 1 ? 4 : 8))} ${escapeHtml(row.symbol || "")}`
    : "--";
  const hasCost = metrics.investment > 0;
  return `
    <div class="ficha-posicion">
      <strong class="ficha-posicion-valor">${maskedCurrency(metrics.currentValue)}</strong>
      ${hasCost ? `<span class="chip-cambio ${toneClass(metrics.pnlPct)}">${ICONO_FLECHA_CAMBIO}<span>${formatPercent(metrics.pnlPct)}</span></span>` : ""}
    </div>
    ${isWalletRow(row) ? `<p class="ficha-billetera">${walletBadgeHtml(row)}</p>` : ""}
    <dl class="ficha-datos">
      ${detailCell(t("detail.quantity"), qty)}
      ${detailCell(t("detail.avgPrice"), metrics.entryPrice > 0 ? escapeHtml(formatCurrency(metrics.entryPrice, getPriceDigits(metrics.entryPrice))) : "--")}
      ${detailCell(t("detail.invested"), escapeHtml(maskedCurrency(metrics.investment)))}
      ${detailCell(t("ficha.ganancia"), hasCost ? escapeHtml(maskedSignedCurrency(metrics.pnlUsd)) : "--", hasCost ? toneClass(metrics.pnlUsd) : "")}
      ${detailCell(t("ficha.hoy"), pnl24 != null ? escapeHtml(maskedSignedCurrency(pnl24)) : "--", pnl24 != null ? toneClass(pnl24) : "", change != null ? formatSignedPercent(change) : "")}
      ${detailCell(t("detail.weight"), weight != null ? `${weight.toFixed(1)}%` : "--")}
    </dl>`;
}

// Objetivos de venta (TP1-3): progreso hasta cada uno y si ya se aviso.
function detailTargetsOf(metrics) {
  return [["TP1", metrics.tp1, "tp1"], ["TP2", metrics.tp2, "tp2"], ["TP3", metrics.tp3, "tp3"]].filter(([, v]) => v > 0);
}

function renderDetailTargets(row, metrics) {
  const hasTargets = detailTargetsOf(metrics).length > 0;
  return `
    <section class="tarjeta ficha-bloque">
      <div class="ficha-bloque-cabecera">
        <h2 class="titulo-tarjeta">${escapeHtml(t("ficha.objetivos"))}</h2>
        ${hasTargets ? `<button class="enlace" type="button" data-detail-action="edit">${escapeHtml(t("buttons.edit"))}</button>` : ""}
      </div>
      <div class="ficha-bloque-cuerpo" data-detail-body="objetivos">${detailTargetsBody(row, metrics)}</div>
      ${hasTargets ? "" : `<button class="boton-secundario" type="button" data-detail-action="edit">${escapeHtml(t("ficha.objetivosAnadir"))}</button>`}
    </section>`;
}

function detailTargetsBody(row, metrics) {
  const targets = detailTargetsOf(metrics);
  if (!targets.length) {
    return `<p class="ficha-vacio">${escapeHtml(t("ficha.objetivosVacio"))}</p>`;
  }
  return `
    <div class="ficha-objetivos">
      ${targets.map(([label, value, key]) => {
        const reached = metrics.currentPrice > 0 && metrics.currentPrice >= value;
        const progress = metrics.currentPrice > 0 ? Math.max(0, Math.min(100, (metrics.currentPrice / value) * 100)) : 0;
        const dist = metrics.currentPrice > 0 ? (value / metrics.currentPrice - 1) * 100 : null;
        const fired = Boolean(row.alertsFired?.[key]);
        return `
          <div class="ficha-objetivo ${reached ? "alcanzado" : ""}">
            <div class="ficha-objetivo-fila">
              <span><strong>${label}</strong> · ${escapeHtml(formatCurrency(value, getPriceDigits(value)))}</span>
              <span class="ficha-objetivo-falta">${reached ? escapeHtml(t("detail.reached")) : dist === null ? "--" : escapeHtml(t("ficha.falta", { pct: dist.toFixed(1) }))}</span>
            </div>
            <div class="ficha-barra" aria-hidden="true"><span style="width:${progress.toFixed(1)}%"></span></div>
            <small class="ficha-aviso ${fired ? "enviado" : ""}">${ICONOS_FICHA.campana}${escapeHtml(t(fired ? "ficha.avisoEnviado" : "ficha.avisoPendiente"))}</small>
          </div>`;
      }).join("")}
    </div>`;
}

function renderDetailMarket(row) {
  return `
    <section class="tarjeta ficha-bloque">
      <h2 class="titulo-tarjeta">${escapeHtml(t("market.title"))}</h2>
      <div class="ficha-bloque-cuerpo" data-detail-body="mercado">${detailMarketBody(row)}</div>
    </section>`;
}

function fechaCortaFicha(iso) {
  const ms = Date.parse(iso || "");
  return Number.isFinite(ms)
    ? intlFormatter("date", getUiLocale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms))
    : "";
}

function detailMarketBody(row) {
  const price = (value) => (Number.isFinite(value) ? escapeHtml(formatCurrency(value, getPriceDigits(value))) : "--");
  const info = infoDeMoneda(row);
  const moneda = state.prefs.currency;
  const actual = computeRowMetrics(row).currentPrice;
  // Maximo y minimo historicos, con la distancia desde el precio de ahora.
  const extremo = (valor, fecha) => {
    if (!Number.isFinite(valor)) {
      return null;
    }
    const pct = actual > 0 ? (actual / valor - 1) * 100 : null;
    const detalle = [pct != null ? formatSignedPercent(pct) : "", fechaCortaFicha(fecha)].filter(Boolean).join(" · ");
    return `${price(valor)}${detalle ? `<small class="ficha-dato-extra">${escapeHtml(detalle)}</small>` : ""}`;
  };
  const ath = info ? extremo(info.ath[moneda], info.athFecha[moneda]) : null;
  const atl = info ? extremo(info.atl[moneda], info.atlFecha[moneda]) : null;
  const fdv = info && Number.isFinite(info.fdv[moneda]) ? escapeHtml(formatCompactCurrency(info.fdv[moneda])) : null;
  const rows = [
    [t("ficha.capitalizacion"), Number.isFinite(row.marketCap) ? escapeHtml(formatCompactCurrency(row.marketCap)) : "--"],
    [t("detail.ranking"), Number.isFinite(row.marketCapRank) ? `#${row.marketCapRank}` : "--"],
    [t("detail.high24h"), price(row.high24h)],
    [t("detail.low24h"), price(row.low24h)],
    [t("detail.volume24h"), Number.isFinite(row.volume24h) ? escapeHtml(formatCompactCurrency(row.volume24h)) : "--"],
    ...(ath ? [[t("ficha.ath"), ath]] : []),
    ...(atl ? [[t("ficha.atl"), atl]] : []),
    ...(fdv ? [[t("ficha.fdv"), fdv]] : []),
    [t("detail.priceSource"), `${escapeHtml(priceSourceLabel(row))}${row.lastPriceAt ? ` <small>· ${escapeHtml(formatRelativeTime(new Date(row.lastPriceAt).getTime()))}</small>` : ""}`]
  ];
  return `<dl class="ficha-lista">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

// ── Suministro: en circulacion, total y maximo (con cuanto se ha emitido) ──
function renderDetailSupply(row) {
  if (!row.coinId) {
    return "";
  }
  return `
    <section class="tarjeta ficha-bloque">
      <h2 class="titulo-tarjeta">${escapeHtml(t("ficha.suministro"))}</h2>
      <div class="ficha-bloque-cuerpo" data-detail-body="suministro">${detailSupplyBody(row)}</div>
    </section>`;
}

function detailSupplyBody(row) {
  const info = infoDeMoneda(row);
  if (!info) {
    return `<p class="ficha-vacio">${escapeHtml(t(isOffline() ? "ficha.sinInfo" : "ficha.cargandoInfo"))}</p>`;
  }
  if (!info.circulante && !info.total && !info.maximo) {
    return `<p class="ficha-vacio">${escapeHtml(t("ficha.sinSuministro"))}</p>`;
  }
  const simbolo = row.symbol || "";
  const cantidad = (v) => `${escapeHtml(formatTokenAmount(v))} ${escapeHtml(simbolo)}`;
  const emitido = info.circulante && info.maximo ? Math.min(100, (info.circulante / info.maximo) * 100) : null;
  const filas = [
    info.circulante ? [t("ficha.circulante"), cantidad(info.circulante)] : null,
    info.total ? [t("ficha.total"), cantidad(info.total)] : null,
    [t("ficha.maximo"), info.maximo ? cantidad(info.maximo) : escapeHtml(t("ficha.sinLimite"))]
  ].filter(Boolean);
  const textoEmitido = emitido != null ? t("ficha.emitido", { pct: `${emitido.toFixed(1)}%` }) : "";
  return `
    ${emitido != null ? `
      <div class="ficha-emitido">
        <div class="ficha-emitido-barra" aria-hidden="true"><span style="width:${emitido.toFixed(1)}%"></span></div>
        <small>${escapeHtml(textoEmitido)}</small>
      </div>` : ""}
    <dl class="ficha-lista">${filas.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

// ── Sobre la moneda: categorias, descripcion, datos y enlaces oficiales ──
function renderDetailAbout(row) {
  if (!row.coinId) {
    return "";
  }
  return `
    <section class="tarjeta ficha-bloque">
      <h2 class="titulo-tarjeta">${escapeHtml(t("ficha.sobre", { nombre: row.resolvedName || assetDisplayName(row) }))}</h2>
      <div class="ficha-bloque-cuerpo" data-detail-body="sobre">${detailAboutBody(row)}</div>
    </section>`;
}

function detailAboutBody(row) {
  pedirInfoMoneda(row);
  const info = infoDeMoneda(row);
  if (!info) {
    return `<p class="ficha-vacio">${escapeHtml(t(isOffline() ? "ficha.sinInfo" : "ficha.cargandoInfo"))}</p>`;
  }
  const larga = info.descripcion.length > 240;
  const abierta = infoMoneda.descripcionAbierta;
  const datos = [
    info.lanzamiento ? [t("ficha.lanzamiento"), escapeHtml(fechaCortaFicha(info.lanzamiento))] : null,
    info.algoritmo ? [t("ficha.algoritmo"), escapeHtml(info.algoritmo)] : null
  ].filter(Boolean);
  const partes = [
    info.categorias.length
      ? `<ul class="ficha-categorias" aria-label="${escapeHtml(t("ficha.categorias"))}">${info.categorias.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
      : "",
    info.descripcion
      ? `<div class="ficha-descripcion-caja">
          <p class="ficha-descripcion${larga && !abierta ? " plegada" : ""}">${escapeHtml(info.descripcion)}</p>
          <div class="ficha-descripcion-pie">
            ${info.descripcionEnIngles ? `<small>${escapeHtml(t("ficha.enIngles"))}</small>` : "<span></span>"}
            ${larga ? `<button class="enlace" type="button" data-detail-action="descripcion" aria-expanded="${abierta ? "true" : "false"}">${escapeHtml(t(abierta ? "ficha.leerMenos" : "ficha.leerMas"))}</button>` : ""}
          </div>
        </div>`
      : "",
    datos.length ? `<dl class="ficha-lista">${datos.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>` : "",
    info.enlaces.length
      ? `<div class="ficha-enlaces">${info.enlaces.map((e) => `<a class="ficha-enlace" href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(`ficha.enlace.${e.tipo}`))}</a>`).join("")}</div>`
      : ""
  ].filter(Boolean);
  return partes.length ? partes.join("") : `<p class="ficha-vacio">${escapeHtml(t("ficha.sinInfo"))}</p>`;
}

// Al llegar los datos ampliados (o al abrir y cerrar la descripcion).
function repintarFichaInfo() {
  const screen = document.getElementById("assetDetailScreen");
  const row = getRowById(state.detailRowId);
  if (!screen || !row || screen.hidden) {
    return;
  }
  const cuerpos = { mercado: detailMarketBody, suministro: detailSupplyBody, sobre: detailAboutBody };
  Object.entries(cuerpos).forEach(([clave, pintar]) => {
    const nodo = screen.querySelector(`[data-detail-body="${clave}"]`);
    if (nodo) {
      nodo.innerHTML = pintar(row);
    }
  });
}

function renderDetailNotes(row) {
  const meta = [];
  if (row.purchaseDate) {
    meta.push(`<div><dt>${escapeHtml(t("editor.purchaseDate"))}</dt><dd>${escapeHtml(row.purchaseDate)}</dd></div>`);
  }
  if (row.personalLabel) {
    meta.push(`<div><dt>${escapeHtml(t("editor.label"))}</dt><dd>${escapeHtml(row.personalLabel)}</dd></div>`);
  }
  return `
    <section class="tarjeta ficha-bloque">
      <div class="ficha-bloque-cabecera">
        <h2 class="titulo-tarjeta">${escapeHtml(t("detail.tabNotes"))}</h2>
        <button class="enlace" type="button" data-detail-action="edit">${escapeHtml(t(row.note ? "buttons.edit" : "ficha.notaAnadir"))}</button>
      </div>
      ${meta.length ? `<dl class="ficha-lista">${meta.join("")}</dl>` : ""}
      ${row.note
        ? `<p class="ficha-nota">${escapeHtml(row.note)}</p>`
        : `<p class="ficha-vacio">${escapeHtml(t("detail.notesEmpty"))}</p>`}
    </section>`;
}

// Movimientos registrados de este activo (compras, ventas, cambios).
function renderDetailHistory(row) {
  const name = normalizeSearchText(assetDisplayName(row));
  const entries = state.activity.filter((item) =>
    normalizeSearchText(`${item.title} ${item.detail}`).includes(name)
  ).slice(0, DETAIL_ACTIVITY_MAX);

  return `
    <section class="tarjeta ficha-bloque">
      <h2 class="titulo-tarjeta">${escapeHtml(t("ficha.actividad"))}</h2>
      ${entries.length
        ? `<ul class="ficha-actividad">
            ${entries.map((item) => `
              <li>
                <span class="ficha-actividad-punto ${escapeHtml(item.tone || "neutral")}" aria-hidden="true"></span>
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <p>${escapeHtml(item.detail)}</p>
                  <time>${escapeHtml(formatDateTime(new Date(item.at)))}</time>
                </div>
              </li>`).join("")}
          </ul>`
        : `<p class="ficha-vacio">${escapeHtml(t("detail.historyEmpty"))}</p>`}
    </section>`;
}
