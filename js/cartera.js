// =============================================================================
// cartera.js - Pestana Portafolio: tabla de escritorio, orden, barra fija,
// modo privacidad, estado y borrado con deshacer. Lo que se ve en Inicio
// (saldo, grafico, resumen, lista, reparto, mercado) esta en inicio.js.
// =============================================================================

function getPortfolioName() {
  const value = String(state.prefs.portfolioName || "").trim();
  return value || t("portfolio.defaultName");
}

function sanitizePortfolioNameInput(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function renderPortfolioIdentity() {
  const portfolioName = getPortfolioName();

  if (dom.portfolioNameDisplay) {
    dom.portfolioNameDisplay.textContent = portfolioName;
  }

  if (dom.portfolioNameInput && document.activeElement !== dom.portfolioNameInput) {
    dom.portfolioNameInput.value = portfolioName;
  }
  renderHomeGreeting();
}

function savePortfolioName(nextValue) {
  state.prefs.portfolioName = sanitizePortfolioNameInput(nextValue);
  renderPortfolioIdentity();

  if (state.portfolioNameTimer) {
    window.clearTimeout(state.portfolioNameTimer);
  }

  state.portfolioNameTimer = window.setTimeout(() => {
    savePreferences();
    updateSaveMessage(t("portfolio.updated"));
    state.portfolioNameTimer = null;
  }, 240);
}

function applyBalanceVisibility() {
  if (!dom.toggleBalanceBtn) {
    return;
  }
  dom.toggleBalanceBtn.classList.toggle("is-hidden-balance", state.prefs.hideBalance);
  dom.toggleBalanceBtn.setAttribute(
    "aria-label",
    state.prefs.hideBalance ? t("home.showBalance") : t("home.hideBalance")
  );
}

function renderAll() {
  renderPortfolioIdentity();
  // Textos de Apariencia que dependen de la moneda (vista previa, umbral).
  renderAppearanceControls();
  renderTableHead();
  renderTableBody();
  renderDashboardOnly();
  renderStatusCards();
  // Escritorio: el Plan esta a la vista y sigue los cambios de la cartera.
  escRepintarPlan();
}

// ── Lo que se pinta y cuando ──
// Con precios en vivo esto corre cada segundo. Solo se repinta lo que se ve:
// la pestana abierta y la tabla de escritorio (desde 1100 px y en Inicio). Lo
// oculto queda apuntado en seccionesPendientes y se pinta al aparecer, al
// cambiar de pestana o de ancho (pintarPendientes).
const MQ_ESCRITORIO = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1100px)") : null;
const seccionesPendientes = new Set();

function pestanaVisible(tab) {
  // En escritorio todo esta en la misma pagina; Ajustes, solo con su panel abierto.
  if (modoEscritorio()) {
    return tab !== "more" || escEstado.ajustesAbiertos;
  }
  return state.prefs.activeTab === tab;
}

function tablaVisible() {
  return Boolean(MQ_ESCRITORIO?.matches) && pestanaVisible("home");
}

function pintarPendientes() {
  const tabla = seccionesPendientes.has("tabla") && tablaVisible();
  if (tabla) {
    renderTableBody();
  }
  if (tabla || seccionesPendientes.has(state.prefs.activeTab)) {
    renderDashboardOnly();
  }
}

function renderDashboardOnly() {
  const snapshot = buildSnapshot();
  if (pestanaVisible("home")) {
    seccionesPendientes.delete("home");
    renderSummary(snapshot);
    renderMarketSection();
    renderStickyBar(snapshot);
  } else {
    seccionesPendientes.add("home");
  }
  // Escritorio: el Plan tambien esta a la vista (se repinta sin prisa).
  escRepintarPlanVivo();
  if (pestanaVisible("analytics")) {
    seccionesPendientes.delete("analytics");
    // getPortfolioInsights recorre el historico de precios de cada fila.
    renderAnalyticsSummary(snapshot);
    renderInsights(getPortfolioInsights(snapshot));
    updateCharts(snapshot);
  } else {
    seccionesPendientes.add("analytics");
  }
  if (tablaVisible()) {
    renderTotalsRow(snapshot);
  } else {
    seccionesPendientes.add("tabla");
  }
  renderStatusCards();
}

function renderTableHead() {
  dom.tableHead.innerHTML = `
    <tr>
      ${TABLE_COLUMNS.map((column) => renderHeaderCell(column)).join("")}
    </tr>
  `;
  renderMobileSortControl();
}

// Selector de orden: mismo estado sortBy/sortDir que las cabeceras de
// escritorio, así ambos mandos quedan siempre sincronizados.
function renderMobileSortControl() {
  if (!dom.mobileSortSelect) {
    return;
  }

  const known = SORT_OPTIONS.some((option) => option.key === state.prefs.sortBy);
  dom.mobileSortSelect.innerHTML = SORT_OPTIONS
    .map(
      (option) => `
        <option value="${option.key}" ${state.prefs.sortBy === option.key ? "selected" : ""}>
          ${escapeHtml(t(option.labelKey))}
        </option>
      `
    )
    .join("");
  if (!known) {
    dom.mobileSortSelect.selectedIndex = -1;
  }

  if (dom.mobileSortDirBtn) {
    const descending = state.prefs.sortDir === "desc";
    dom.mobileSortDirBtn.innerHTML = descending ? "&darr;" : "&uarr;";
    dom.mobileSortDirBtn.setAttribute("aria-label", descending ? t("table.sortDesc") : t("table.sortAsc"));
    dom.mobileSortDirBtn.title = descending ? t("table.sortDesc") : t("table.sortAsc");
  }
}

function renderHeaderCell(column) {
  const isSortable = Boolean(column.sortKey);
  const isActive = state.prefs.sortBy === column.sortKey;
  const arrow = !isActive ? "" : state.prefs.sortDir === "desc" ? "&darr;" : "&uarr;";
  const label = t(column.labelKey);

  return `
    <th scope="col" class="col-${column.key}">
      <div class="th-shell">
        ${isSortable
          ? `<button class="th-sort-btn ${isActive ? "is-active" : ""}" type="button" data-sort-key="${column.sortKey}">
              ${escapeHtml(label)} ${arrow}
            </button>`
          : `<span class="th-button">${escapeHtml(label)}</span>`}
      </div>
    </th>
  `;
}

function renderTableBody() {
  const rows = getSortedRows();
  const totalValue = state.rows.reduce((sum, row) => {
    const value = computeRowMetrics(row).currentValue;
    return sum + (value > 0 ? value : 0);
  }, 0);

  const meaningful = rows.filter((row) => {
    const metrics = computeRowMetrics(row);
    return row.crypto.trim() || metrics.investment > 0 || metrics.currentValue > 0;
  });

  // La lista de Inicio siempre; la tabla de escritorio solo si se ve.
  renderPortfolioMobile(meaningful.length ? rows : []);
  if (!tablaVisible()) {
    seccionesPendientes.add("tabla");
    return;
  }
  seccionesPendientes.delete("tabla");

  if (!meaningful.length) {
    const emptyHtml = `
      <div class="empty-state empty-positions">
        <strong>${escapeHtml(t("table.emptyTitle"))}</strong>
        <p>${escapeHtml(t("table.emptyText"))}</p>
        <button class="primary-btn" type="button" data-action="empty-add">${escapeHtml(t("buttons.newPosition"))}</button>
      </div>`;
    dom.tableBody.innerHTML = `<tr><td colspan="${TABLE_COLUMNS.length}">${emptyHtml}</td></tr>`;
    return;
  }

  dom.tableBody.innerHTML = rows.map((row) => renderRow(row, totalValue)).join("");
  ajustarTablaEscritorio(true);
}

// Tabla de escritorio: el CSS la aprieta por anchos de ventana, pero con la
// letra de reserva (si Inter no carga) o con cifras enormes aun puede no
// caber. Entonces se aprieta un nivel mas (data-apretada 1 a 3: menos
// relleno, sin la columna Peso, sin el mini grafico) hasta que cabe. Se mide
// al pintar la tabla, al cambiar el tamano o al cargar la letra, y como mucho
// cada 15 s con los precios en vivo (medir obliga a recalcular el diseno).
let tablaAjustadaEn = 0;
function ajustarTablaEscritorio(forzar = false) {
  // Primero el plazo: leer el ancho ya obliga a recalcular el diseno.
  if (!forzar && Date.now() - tablaAjustadaEn < 15000) {
    return;
  }
  const wrap = dom.tableBody?.closest(".table-wrap");
  if (!wrap || !wrap.clientWidth) {
    return;
  }
  tablaAjustadaEn = Date.now();
  let nivel = 0;
  wrap.dataset.apretada = "0";
  while (wrap.scrollWidth > wrap.clientWidth + 1 && nivel < 3) {
    nivel += 1;
    wrap.dataset.apretada = String(nivel);
  }
}

// Fila de solo lectura: toda la edición ocurre en el editor-portal.
function renderRow(row, totalValue = 0) {
  const metrics = computeRowMetrics(row);
  // Aun sin su primer precio: precio, valor y ganancia en silueta.
  const espera = metrics.tokens > 0 && esperaPrecio(row);
  const rowTone = espera ? "" : metrics.pnlUsd > 0 ? "row-profit" : metrics.pnlUsd < 0 ? "row-loss" : "";
  const weight = totalValue > 0 && metrics.currentValue > 0
    ? (metrics.currentValue / totalValue) * 100
    : null;
  const changeText = Number.isFinite(row.priceChange24h) ? formatSignedPercent(row.priceChange24h) : "--";
  const priceText = metrics.currentPrice > 0
    ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice))
    : "--";
  const stale = isStaleQuote(row);

  return `
    <tr class="portfolio-row ${rowTone} ${row.favorite ? "is-fav" : ""}" data-row-id="${row.id}" tabindex="0" role="button" aria-label="${escapeHtml(t("buttons.edit"))} ${escapeHtml(assetDisplayName(row))}">
      <td class="col-asset">
        <div class="asset-field">
          <span class="asset-logo" data-role="assetAvatar">${assetLogoHtml(row)}</span>
          <div class="asset-id" title="${escapeHtml(row.resolvedName || assetDisplayName(row))}">
            <strong data-role="assetName">${escapeHtml(assetDisplayName(row))}</strong>
            <small data-role="assetSub">${escapeHtml(row.resolvedName && row.symbol ? row.resolvedName : t("row.noAsset"))}</small>${walletBadgeHtml(row)}
          </div>
          ${row.favorite ? '<span class="fav-dot" aria-hidden="true">★</span>' : ""}
        </div>
      </td>

      <td class="col-price">
        <div class="stack-cell">
          <strong class="money" data-role="rowPrice">${espera ? esqueletoHtml("esqueleto-valor") : priceText}</strong>
          <span class="quote-time ${stale ? "is-stale" : ""}" data-role="rowQuote">${espera ? "" : escapeHtml(quoteTimeLabel(row))}</span>
        </div>
      </td>

      <td class="col-change">
        <span class="numeric ${toneClass(row.priceChange24h || 0)}" data-role="rowChange">${changeText}</span>
      </td>

      <td class="col-week">${miniGraficoSvg(row.sparkline7d, { ancho: 88, alto: 28 })}</td>

      <td class="col-invested">
        <strong class="money" data-role="rowInvested">${maskedCurrency(metrics.investment)}</strong>
      </td>

      <td class="col-value">
        <strong class="money" data-role="rowValue">${espera ? esqueletoHtml("esqueleto-valor") : maskedCurrency(metrics.currentValue)}</strong>
      </td>

      <td class="col-pnl">
        <div class="stack-cell">
          <strong class="money ${espera ? "" : toneClass(metrics.pnlUsd)}" data-role="rowPnlAbs">${espera ? esqueletoHtml("esqueleto-valor") : maskedSignedCurrency(metrics.pnlUsd)}</strong>
          <span class="numeric ${espera ? "" : toneClass(metrics.pnlPct)}" data-role="rowPnlPct">${espera ? esqueletoHtml("esqueleto-sub") : formatPercent(metrics.pnlPct)}</span>
        </div>
      </td>

      <td class="col-weight">
        <div class="peso-celda">
          <span class="peso-barra" aria-hidden="true"><i data-role="rowWeightBar" style="width:${weight != null ? Math.min(100, weight).toFixed(1) : 0}%"></i></span>
          <span class="peso-texto" data-role="rowWeight">${weight != null ? weight.toFixed(1) + "%" : "--"}</span>
        </div>
      </td>

      <td class="col-actions">
        <div class="row-actions">
          <button class="boton-icono boton-fila" type="button" data-action="edit-row" data-row-id="${row.id}" aria-label="${escapeHtml(t("buttons.edit"))} ${escapeHtml(assetDisplayName(row))}" title="${escapeHtml(t("buttons.edit"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg></button>
          <button class="boton-icono boton-fila" type="button" data-action="row-menu" data-row-id="${row.id}" aria-label="${escapeHtml(t("buttons.moreActions"))}" aria-haspopup="menu" title="${escapeHtml(t("buttons.moreActions"))}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
        </div>
      </td>
    </tr>
  `;
}

// Un precio se considera desactualizado si su última cotización tiene más de
// 2× el intervalo de autorefresh (mínimo 15 min).
function isStaleQuote(row) {
  if (!row.lastPriceAt || !(row.currentPrice > 0)) {
    return false;
  }
  const age = Date.now() - new Date(row.lastPriceAt).getTime();
  const threshold = Math.max(15 * 60 * 1000, (state.prefs.autoRefreshSec || 1800) * 1000 * 2);
  return age > threshold;
}

function quoteTimeLabel(row) {
  if (!(row.currentPrice > 0)) {
    return t("row.noPrice");
  }
  if (!row.lastPriceAt) {
    return "CoinGecko";
  }
  return t("row.sync", { time: formatRelativeTime(new Date(row.lastPriceAt).getTime()) });
}

// ── Ocultar saldo (icono de ojo en Inicio) ──
function maskedCurrency(value, digits) {
  return state.prefs.hideBalance ? "••••" : formatCurrency(value, digits);
}

function maskedSignedCurrency(value) {
  return state.prefs.hideBalance ? "••••" : formatSignedCurrency(value);
}

// Variación 24h de toda la cartera derivada de los cambios por activo.
function getPortfolio24hChange(snapshot) {
  let delta = 0;
  let base = 0;
  snapshot.items.forEach(({ row, metrics }) => {
    if (Number.isFinite(row.priceChange24h) && metrics.currentValue > 0) {
      const previous = metrics.currentValue / (1 + row.priceChange24h / 100);
      if (Number.isFinite(previous) && previous > 0) {
        delta += metrics.currentValue - previous;
        base += previous;
      }
    }
  });
  return base > 0 ? { pct: (delta / base) * 100, delta } : null;
}

function renderStickyBar(snapshot) {
  if (!dom.stickyBar) {
    return;
  }

  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment
    ? (totalPnl / snapshot.totals.investment) * 100
    : 0;

  if (dom.stickyBarName) {
    dom.stickyBarName.textContent = getPortfolioName();
  }
  const cargando = saldoCargando(snapshot);
  if (dom.stickyBarValue) {
    if (cargando) {
      cifrasAnimadas.delete("barra");
      setText(dom.stickyBarValue, "--");
    } else {
      animarCifra("barra", snapshot.totals.currentValue, (valor) => setText(dom.stickyBarValue, maskedCurrency(valor)));
    }
  }
  if (dom.stickyBarPnl && cargando) {
    dom.stickyBarPnl.textContent = "";
  } else if (dom.stickyBarPnl) {
    // Solo el porcentaje: la barra es estrecha y el importe ya esta arriba.
    dom.stickyBarPnl.textContent = formatPercent(totalPnlPct);
    dom.stickyBarPnl.className = `sticky-bar-pnl ${toneClass(totalPnl)}`;
  }
}

// La barra fija aparece cuando el hero (que ya muestra el nombre) sale de pantalla.
function observeHeroForStickyBar() {
  if (!dom.stickyBar) {
    return;
  }

  const hero = document.getElementById("mainValueCard");
  if (!hero || typeof window.IntersectionObserver === "undefined") {
    return;
  }

  const io = new IntersectionObserver(([entry]) => {
    state.heroVisible = entry.isIntersecting;
    updateStickyBarVisibility();
  }, { rootMargin: "-10px 0px 0px 0px" });
  io.observe(hero);
}

// La sticky bar solo aparece en Inicio con la tarjeta principal fuera de
// pantalla; en el resto de pestañas tapaba la barra de acciones y títulos.
function updateStickyBarVisibility() {
  if (!dom.stickyBar) {
    return;
  }
  // En escritorio la cabecera ya va fija arriba: la barra no hace falta.
  const visible = !modoEscritorio() && state.prefs.activeTab === "home" && !state.heroVisible;
  dom.stickyBar.classList.toggle("is-visible", visible);
  dom.stickyBar.setAttribute("aria-hidden", visible ? "false" : "true");
}

function renderTotalsRow(snapshot) {
  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment
    ? (totalPnl / snapshot.totals.investment) * 100
    : 0;

  ajustarTablaEscritorio();
  // Fila de totales alineada con las columnas de la tabla.
  const change = getPortfolio24hChange(snapshot);
  const cargando = saldoCargando(snapshot);
  pintarHtml(dom.totalsFoot, `
    <tr class="totals-row">
      <td class="totals-label-cell col-asset">${escapeHtml(t("table.totals"))}</td>
      <td class="col-price"></td>
      <td class="col-change"><span class="numeric ${change ? toneClass(change.pct) : ""}">${change ? formatSignedPercent(change.pct) : "--"}</span></td>
      <td class="col-week"></td>
      <td class="col-invested"><strong class="money">${maskedCurrency(snapshot.totals.investment)}</strong></td>
      <td class="col-value"><strong class="money">${cargando ? esqueletoHtml("esqueleto-valor") : maskedCurrency(snapshot.totals.currentValue)}</strong></td>
      <td class="col-pnl">
        <div class="stack-cell">
          ${cargando ? esqueletoHtml("esqueleto-valor") : `<strong class="money ${toneClass(totalPnl)}">${maskedSignedCurrency(totalPnl)}</strong>
          <span class="numeric ${toneClass(totalPnlPct)}">${formatPercent(totalPnlPct)}</span>`}
        </div>
      </td>
      <td class="col-weight"><span class="peso-texto">${snapshot.totals.currentValue > 0 ? "100%" : "--"}</span></td>
      <td class="col-actions"></td>
    </tr>
  `);
}

function renderStatusCards() {
  dom.apiStatus.textContent = readableApiStatus(state.apiStatus);
  dom.apiStatus.className = toneClassForStatus(state.apiStatus);
  dom.apiStatusMeta.textContent = state.apiMeta;
  dom.saveStatus.textContent = state.saveMessage;
  dom.lastSyncLabel.textContent = state.lastSyncLabel;

  if (dom.navApiBadge) {
    const tone =
      state.apiStatus === "connected" ? "good"
        : state.apiStatus === "syncing" || state.apiStatus === "offline" ? "warn"
          : state.apiStatus === "error" ? "error"
            : "";
    dom.navApiBadge.className = `nav-badge ${tone}`;
  }
  if (dom.navApiText) {
    dom.navApiText.textContent = readableApiStatus(state.apiStatus);
  }
  if (dom.navSaveText) {
    dom.navSaveText.textContent = state.saveMessage;
  }

  if (dom.homeStatusLine) {
    dom.homeStatusLine.textContent = `${readableApiStatus(state.apiStatus)} · ${state.lastSyncLabel}`;
  }

  if (dom.autoRefreshMeta) {
    const parts = [];
    if (state.lastRefreshAt) {
      parts.push(t("more.lastUpdate", { time: formatRelativeTime(state.lastRefreshAt) }));
      if (state.prefs.autoRefreshSec) {
        parts.push(t("more.nextUpdate", {
          time: formatRelativeTime(state.lastRefreshAt + state.prefs.autoRefreshSec * 1000, true)
        }));
      }
    }
    dom.autoRefreshMeta.textContent = parts.join(" · ");
  }
}

// Actualización selectiva de una fila (sin re-render): mantiene el foco y no
// pisa lo que el usuario escribe en el editor.
function updateLiveRowUi(rowId) {
  const row = getRowById(rowId);
  const rowElement = dom.tableBody.querySelector(`tr[data-row-id="${rowId}"]`);

  // El editor abierto siempre refleja los datos frescos (precio, cap, etc.).
  if (state.editorRowId === rowId) {
    refreshEditorLiveData();
  }
  // La ficha abierta tambien se mantiene al dia. Con el editor encima se
  // rehace entera (pueden cambiar objetivos o notas); si no, solo sus cifras,
  // para no comerse un toque en sus botones (refrescos de precio).
  if (state.detailRowId === rowId) {
    if (state.editorRowId) {
      renderAssetDetail();
    } else {
      refreshAssetDetailLive();
    }
  }

  if (!row || !rowElement) {
    scheduleDashboardRefresh();
    return;
  }

  const metrics = computeRowMetrics(row);
  const totalValue = state.rows.reduce((sum, item) => {
    const value = computeRowMetrics(item).currentValue;
    return sum + (value > 0 ? value : 0);
  }, 0);
  const weight = totalValue > 0 && metrics.currentValue > 0
    ? (metrics.currentValue / totalValue) * 100
    : null;

  const setRole = (role, apply) => {
    const node = rowElement.querySelector(`[data-role='${role}']`);
    if (node) {
      apply(node);
    }
  };

  rowElement.className = `portfolio-row ${metrics.pnlUsd > 0 ? "row-profit" : metrics.pnlUsd < 0 ? "row-loss" : ""} ${row.favorite ? "is-fav" : ""}`;
  setRole("assetAvatar", (node) => { node.innerHTML = assetLogoHtml(row); });
  setRole("assetName", (node) => { node.textContent = assetDisplayName(row); });
  setRole("assetSub", (node) => {
    node.textContent = row.resolvedName && row.symbol ? row.resolvedName : t("row.noAsset");
  });
  setRole("rowPrice", (node) => {
    node.textContent = metrics.currentPrice > 0
      ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice))
      : "--";
  });
  setRole("rowChange", (node) => {
    node.textContent = Number.isFinite(row.priceChange24h) ? formatSignedPercent(row.priceChange24h) : "--";
    node.className = `numeric ${toneClass(row.priceChange24h || 0)}`;
  });
  setRole("rowQuote", (node) => {
    node.textContent = quoteTimeLabel(row);
    node.classList.toggle("is-stale", isStaleQuote(row));
  });
  setRole("rowInvested", (node) => { node.textContent = maskedCurrency(metrics.investment); });
  setRole("rowValue", (node) => { node.textContent = maskedCurrency(metrics.currentValue); });
  setRole("rowWeight", (node) => { node.textContent = weight != null ? `${weight.toFixed(1)}%` : "--"; });
  setRole("rowWeightBar", (node) => { node.style.width = `${weight != null ? Math.min(100, weight).toFixed(1) : 0}%`; });
  setRole("rowPnlAbs", (node) => {
    node.textContent = maskedSignedCurrency(metrics.pnlUsd);
    node.className = `money ${toneClass(metrics.pnlUsd)}`;
  });
  setRole("rowPnlPct", (node) => {
    node.textContent = formatPercent(metrics.pnlPct);
    node.className = `numeric ${toneClass(metrics.pnlPct)}`;
  });

  // Mantiene sincronizada la tarjeta equivalente de la vista móvil.
  updateMobileCard(rowId);

  scheduleDashboardRefresh();
}

function scheduleDashboardRefresh() {
  if (state.dashboardFrame) {
    return;
  }

  state.dashboardFrame = window.requestAnimationFrame(() => {
    state.dashboardFrame = null;
    renderDashboardOnly();
  });
}

function handleHeaderClick(event) {
  const button = event.target.closest("[data-sort-key]");
  if (!button) {
    return;
  }

  const nextKey = button.dataset.sortKey;
  if (state.prefs.sortBy === nextKey) {
    state.prefs.sortDir = state.prefs.sortDir === "desc" ? "asc" : "desc";
  } else {
    state.prefs.sortBy = nextKey;
    state.prefs.sortDir = nextKey === "asset" ? "asc" : "desc";
  }

  savePreferences();
  renderAll();
  const column = TABLE_COLUMNS.find((item) => item.sortKey === nextKey);
  updateSaveMessage(t("alerts.sortingBy", { column: column ? t(column.labelKey) : nextKey }));
}

// Con dos datos cualesquiera del trío inversión/tokens/entrada se calcula el
// tercero. El campo calculado queda marcado en row.derivedField y se
// recalcula en vivo al cambiar los otros dos; si el usuario lo escribe a
// mano deja de ser automático. Vaciar un campo teniendo los otros dos lo
// convierte en el automático.
function recalcPositionTriad(row, editedField) {
  if (!TRIAD_FIELDS.includes(editedField)) {
    return;
  }

  if (row.derivedField === editedField && String(row[editedField]).trim()) {
    // El usuario escribió sobre el campo automático: pasa a manual.
    row.derivedField = "";
  }

  const others = TRIAD_FIELDS.filter((field) => field !== editedField);
  const editedValue = parseDecimal(row[editedField]);
  const othersFilled = others.filter((field) => parseDecimal(row[field]) > 0);

  let target = "";
  if (row.derivedField && row.derivedField !== editedField) {
    target = row.derivedField;
  } else if (!String(row[editedField]).trim() && othersFilled.length === 2) {
    target = editedField;
  } else if (editedValue > 0 && othersFilled.length === 1) {
    target = others.find((field) => !(parseDecimal(row[field]) > 0));
  }

  // En una posicion de billetera la cantidad la marca la blockchain: el
  // calculo automatico nunca la toca (el coste y el precio de entrada si).
  if (!target || (isWalletRow(row) && target === "tokens")) {
    return;
  }

  const investment = parseDecimal(row.investment);
  const tokens = parseDecimal(row.tokens);
  const entryPrice = parseDecimal(row.entryPrice);

  let result = NaN;
  if (target === "investment" && tokens > 0 && entryPrice > 0) {
    result = tokens * entryPrice;
  } else if (target === "tokens" && investment > 0 && entryPrice > 0) {
    result = investment / entryPrice;
  } else if (target === "entryPrice" && investment > 0 && tokens > 0) {
    result = investment / tokens;
  }

  if (Number.isFinite(result) && result > 0) {
    row[target] = formatEditableNumber(result);
    row.derivedField = target;
  } else if (row.derivedField === target) {
    // Faltan datos de origen: el campo automático se limpia.
    row[target] = "";
    row.derivedField = "";
  } else {
    return;
  }

  // Refleja el campo derivado en el editor abierto (sin pisar el foco).
  const targetInput = document.querySelector(`[data-editor-field="${target}"]`);
  if (targetInput && document.activeElement !== targetInput) {
    targetInput.value = row[target];
  }
}

// Click en la tabla/tarjetas: editar, menú contextual o abrir editor tocando
// la fila. La tabla es de solo lectura; todo lo demás vive en el editor.
function handleTableClick(event) {
  const actionBtn = event.target.closest("[data-action]");
  if (actionBtn) {
    const rowId = actionBtn.dataset.rowId;
    switch (actionBtn.dataset.action) {
      case "empty-add":
        handleAddRow();
        return;
      case "edit-row":
        openPositionEditor(rowId);
        return;
      case "row-menu":
        openRowMenu(rowId, actionBtn);
        return;
      default:
        return;
    }
  }

  // Toque en cualquier parte de la fila (excepto botones) abre el detalle.
  const rowElement = event.target.closest("tr[data-row-id]");
  if (rowElement) {
    openAssetDetail(rowElement.dataset.rowId);
  }
}

function handleTableKeyDown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const rowElement = event.target.closest("tr[data-row-id]");
  if (rowElement && event.target === rowElement) {
    event.preventDefault();
    openAssetDetail(rowElement.dataset.rowId);
  }
}

function handleAddRow() {
  const row = createRow();
  state.rows.push(row);
  renderAll();
  syncLivePrices();
  scheduleAutosave();
  pushActivity(t("alerts.newPositionTitle"), t("alerts.newPositionText"), "neutral");
  openPositionEditor(row.id);
}
