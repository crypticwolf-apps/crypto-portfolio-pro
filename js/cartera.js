// =============================================================================
// cartera.js - Pestana Portafolio: tabla y tarjetas moviles, filtros, resumen,
// valor total, reparto, barra fija, modo privacidad y borrado con deshacer.
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
  renderTableHead();
  renderTableBody();
  renderDashboardOnly();
  renderActivity();
  renderStatusCards();
  renderChartsVisibility();
}

// Subscriber-style: only repaint activity when state.activity actually changes.
let lastActivitySignature = null;
function renderActivityIfChanged() {
  const signature = state.activity.length
    ? `${state.activity.length}:${state.activity[0]?.id || ""}`
    : "0:empty";
  if (signature === lastActivitySignature) return;
  lastActivitySignature = signature;
  renderActivity();
}

function renderDashboardOnly() {
  const snapshot = buildSnapshot();
  // getPortfolioInsights recorre el histórico de precios de cada fila; se
  // calcula una sola vez por repintado y se comparte entre secciones.
  const insights = getPortfolioInsights(snapshot);
  renderSummary(snapshot, insights);
  renderMarketSection();
  renderAnalyticsSummary(snapshot);
  renderInsights(insights);
  renderTotalsRow(snapshot);
  renderStickyBar(snapshot);
  updateCharts(snapshot);
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

  if (!meaningful.length) {
    const emptyHtml = `
      <div class="empty-state empty-positions">
        <strong>${escapeHtml(t("table.emptyTitle"))}</strong>
        <p>${escapeHtml(t("table.emptyText"))}</p>
        <button class="primary-btn" type="button" data-action="empty-add">${escapeHtml(t("buttons.newPosition"))}</button>
      </div>`;
    dom.tableBody.innerHTML = `<tr><td colspan="${TABLE_COLUMNS.length}">${emptyHtml}</td></tr>`;
    const mobileBox = document.getElementById("portfolioMobileList");
    if (mobileBox) mobileBox.innerHTML = emptyHtml;
    applyPositionFilter();
    return;
  }

  dom.tableBody.innerHTML = rows.map((row) => renderRow(row, totalValue)).join("");
  renderPortfolioMobile(rows, totalValue);
  applyPositionFilter();
}

// ── Vista móvil del portafolio: cada activo es una tarjeta expandible ──
// Usa exactamente las mismas métricas que la tabla de escritorio.
function renderPortfolioMobile(rows, totalValue = 0) {
  const box = document.getElementById("portfolioMobileList");
  if (!box) {
    return;
  }
  box.innerHTML = rows.map((row) => portfolioMobileCardHtml(row, totalValue)).join("");
}

function portfolioMobileCardHtml(row, totalValue = 0) {
  const metrics = computeRowMetrics(row);
  const rowTone = metrics.pnlUsd > 0 ? "row-profit" : metrics.pnlUsd < 0 ? "row-loss" : "";
  const weight = totalValue > 0 && metrics.currentValue > 0
    ? (metrics.currentValue / totalValue) * 100
    : null;
  const change = row.priceChange24h;
  const changeText = Number.isFinite(change) ? formatSignedPercent(change) : "--";
  const priceText = metrics.currentPrice > 0
    ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice))
    : "--";
  const expanded = state.expandedCards.has(row.id);
  const bodyId = `amc-body-${row.id}`;

  // Objetivos TP + distancia al siguiente.
  const tps = [metrics.tp1, metrics.tp2, metrics.tp3]
    .map((value, i) => ({ label: `TP${i + 1}`, value }))
    .filter((tp) => tp.value > 0);
  const tpChips = tps.length
    ? tps.map((tp) => {
        const reached = metrics.currentPrice > 0 && metrics.currentPrice >= tp.value;
        return `<span class="amc-tp ${reached ? "reached" : ""}">${tp.label} ${formatCurrency(tp.value, getPriceDigits(tp.value))}</span>`;
      }).join("")
    : `<span class="amc-tp empty">${escapeHtml(t("row.noTarget"))}</span>`;
  const nextTp = metrics.currentPrice > 0 ? tps.find((tp) => metrics.currentPrice < tp.value) : null;
  const nextTpText = nextTp
    ? `${nextTp.label} · +${((nextTp.value / metrics.currentPrice - 1) * 100).toFixed(1)}%`
    : (tps.length ? t("row.targetReachedShort") : "--");

  const tokensText = metrics.tokens > 0 ? formatNumber(metrics.tokens, metrics.tokens >= 1 ? 4 : 8) : "--";

  return `
    <div class="asset-mobile-card ${rowTone} ${row.favorite ? "is-fav" : ""} ${expanded ? "is-expanded" : ""}" role="listitem" data-card-row="${row.id}">
      <button class="amc-head" type="button" data-card-toggle="${row.id}" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${bodyId}">
        <span class="amc-avatar asset-avatar">${renderAssetAvatar(row)}</span>
        <span class="amc-id">
          <strong class="amc-name">${escapeHtml(assetDisplayName(row))}</strong>
          <small class="amc-sym">${escapeHtml(row.symbol || t("row.noAsset"))}</small>
        </span>
        <span class="amc-value">
          <strong class="money" data-role="rowValue">${maskedCurrency(metrics.currentValue)}</strong>
          <span class="amc-pnl ${toneClass(metrics.pnlUsd)}"><span data-role="rowPnlAbs">${maskedSignedCurrency(metrics.pnlUsd)}</span> · <span data-role="rowPnlPct">${formatPercent(metrics.pnlPct)}</span></span>
        </span>
        <svg class="amc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="amc-subline">
        <span class="amc-price money" data-role="rowPrice">${priceText}</span>
        <span class="amc-24h ${toneClass(change || 0)}" data-role="rowChange">${changeText}<small> 24h</small></span>
      </div>
      <div class="amc-body" id="${bodyId}">
        <div class="amc-body-inner">
          <dl class="amc-grid">
            <div><dt>${escapeHtml(t("table.columns.invested"))}</dt><dd>${maskedCurrency(metrics.investment)}</dd></div>
            <div><dt>${escapeHtml(t("editor.tokens"))}</dt><dd>${tokensText}</dd></div>
            <div><dt>${escapeHtml(t("reb.weight"))}</dt><dd>${weight != null ? weight.toFixed(1) + "%" : "--"}</dd></div>
            <div><dt>${escapeHtml(t("amc.nextTp"))}</dt><dd>${escapeHtml(nextTpText)}</dd></div>
          </dl>
          <div class="amc-tps">${tpChips}</div>
          <div class="amc-actions">
            <button class="primary-btn amc-btn" type="button" data-card-action="buy" data-row-id="${row.id}">${escapeHtml(t("quick.buy"))}</button>
            <button class="primary-btn amc-btn amc-sell" type="button" data-card-action="sell" data-row-id="${row.id}">${escapeHtml(t("quick.sell"))}</button>
            <button class="ghost-btn amc-btn" type="button" data-card-action="edit" data-row-id="${row.id}">${escapeHtml(t("buttons.edit"))}</button>
            <button class="ghost-btn amc-btn amc-delete" type="button" data-card-action="delete" data-row-id="${row.id}">${escapeHtml(t("menu.delete"))}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Actualiza una sola tarjeta móvil (refresco de precios) conservando su estado.
function updateMobileCard(rowId) {
  const box = document.getElementById("portfolioMobileList");
  if (!box) return;
  const card = box.querySelector(`[data-card-row="${rowId}"]`);
  const row = getRowById(rowId);
  if (!card || !row) return;
  const totalValue = state.rows.reduce((sum, item) => {
    const value = computeRowMetrics(item).currentValue;
    return sum + (value > 0 ? value : 0);
  }, 0);
  card.outerHTML = portfolioMobileCardHtml(row, totalValue);
}

// Filtro combinado: búsqueda + categoría + rentabilidad + peso/cap mínimos +
// favoritos + objetivos TP. Solo muestra/oculta filas ya renderizadas.
function applyPositionFilter() {
  const query = normalizeSearchText(state.filterQuery || "");
  const f = state.filters;
  const totalValue = state.rows.reduce((sum, r) => {
    const v = computeRowMetrics(r).currentValue;
    return sum + (v > 0 ? v : 0);
  }, 0);
  const capMin = CAP_STEPS[f.capMin] || 0;

  dom.tableBody.querySelectorAll("tr[data-row-id]").forEach((tr) => {
    const row = getRowById(tr.dataset.rowId);
    if (!row) {
      return;
    }
    const metrics = computeRowMetrics(row);
    const weight = totalValue > 0 && metrics.currentValue > 0 ? (metrics.currentValue / totalValue) * 100 : 0;

    let match = true;
    if (query) {
      match = [row.crypto, row.resolvedName, row.symbol, row.coinId]
        .some((value) => normalizeSearchText(String(value || "")).includes(query));
    }
    if (match && f.category !== "all") match = getAssetCategory(row) === f.category;
    if (match && f.performance === "gaining") match = metrics.pnlUsd > 0;
    if (match && f.performance === "losing") match = metrics.pnlUsd < 0;
    if (match && f.favorites) match = Boolean(row.favorite);
    if (match && f.alerts) match = [metrics.tp1, metrics.tp2, metrics.tp3].some((v) => v > 0);
    if (match && f.weightMin > 0) match = weight >= f.weightMin;
    if (match && capMin > 0) match = Number.isFinite(row.marketCap) && row.marketCap >= capMin;

    tr.style.display = match ? "" : "none";
  });
}

function countActiveFilters() {
  const f = state.filters;
  let n = 0;
  if (f.category !== "all") n += 1;
  if (f.performance !== "all") n += 1;
  if (f.weightMin > 0) n += 1;
  if (f.capMin > 0) n += 1;
  if (f.favorites) n += 1;
  if (f.alerts) n += 1;
  return n;
}

function updateFiltersBadge() {
  const badge = document.getElementById("filtersCount");
  if (!badge) {
    return;
  }
  const n = countActiveFilters();
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

function capStepLabel(step) {
  if (!step) {
    return t("filters.any");
  }
  return formatCompactCurrency(CAP_STEPS[step] || 0);
}

function bindFilters() {
  const drawer = document.getElementById("filtersDrawer");
  const openBtn = document.getElementById("openFiltersBtn");
  const search = document.getElementById("positionSearchInput");
  if (search) {
    search.addEventListener("input", (event) => {
      state.filterQuery = event.target.value;
      applyPositionFilter();
    });
  }
  if (!drawer || !openBtn) {
    return;
  }

  openBtn.addEventListener("click", () => {
    syncFilterInputs();
    drawer.hidden = false;
    document.body.classList.add("filters-open");
  });

  const close = () => {
    drawer.classList.add("is-closing");
    window.setTimeout(() => {
      drawer.hidden = true;
      drawer.classList.remove("is-closing");
      document.body.classList.remove("filters-open");
    }, 200);
  };

  drawer.addEventListener("click", (event) => {
    if (event.target.closest("[data-filters-close]")) {
      close();
    }
    if (event.target.closest("[data-filters-reset]")) {
      state.filters = { category: "all", performance: "all", weightMin: 0, capMin: 0, favorites: false, alerts: false };
      syncFilterInputs();
      commitFilters();
    }
  });

  drawer.addEventListener("input", (event) => {
    const control = event.target.closest("[data-filter]");
    if (!control) {
      return;
    }
    const key = control.dataset.filter;
    if (control.type === "checkbox") {
      state.filters[key] = control.checked;
    } else if (control.type === "range") {
      state.filters[key] = Number(control.value);
    } else {
      state.filters[key] = control.value;
    }
    // Etiquetas de los deslizadores.
    if (key === "weightMin") {
      const out = drawer.querySelector('[data-filter-out="weightMin"]');
      if (out) out.textContent = `${state.filters.weightMin}%`;
    }
    if (key === "capMin") {
      const out = drawer.querySelector('[data-filter-out="capMin"]');
      if (out) out.textContent = capStepLabel(state.filters.capMin);
    }
    commitFilters();
  });
}

function syncFilterInputs() {
  const drawer = document.getElementById("filtersDrawer");
  if (!drawer) {
    return;
  }
  const f = state.filters;
  drawer.querySelectorAll("[data-filter]").forEach((control) => {
    const key = control.dataset.filter;
    if (control.type === "checkbox") {
      control.checked = Boolean(f[key]);
    } else {
      control.value = f[key];
    }
  });
  const wOut = drawer.querySelector('[data-filter-out="weightMin"]');
  if (wOut) wOut.textContent = `${f.weightMin}%`;
  const cOut = drawer.querySelector('[data-filter-out="capMin"]');
  if (cOut) cOut.textContent = capStepLabel(f.capMin);
}

function commitFilters() {
  applyPositionFilter();
  updateFiltersBadge();
  state.prefs.filters = { ...state.filters };
  savePreferences();
}

// Fila de solo lectura: toda la edición ocurre en el editor-portal.
function renderRow(row, totalValue = 0) {
  const metrics = computeRowMetrics(row);
  const rowTone = metrics.pnlUsd > 0 ? "row-profit" : metrics.pnlUsd < 0 ? "row-loss" : "";
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
      <td class="asset-cell col-asset" data-label="${escapeHtml(t("table.columns.asset"))}">
        <div class="asset-field">
          <div class="asset-avatar" data-role="assetAvatar">${renderAssetAvatar(row)}</div>
          <div class="asset-id">
            <strong data-role="assetName">${escapeHtml(assetDisplayName(row))}</strong>
            <small data-role="assetSub">${escapeHtml(row.resolvedName && row.symbol ? row.resolvedName : t("row.noAsset"))}</small>
          </div>
          ${row.favorite ? '<span class="fav-dot" aria-hidden="true">★</span>' : ""}
        </div>
      </td>

      <td class="price-col col-price" data-label="${escapeHtml(t("table.columns.priceCol"))}">
        <div class="stack-cell">
          <strong class="money" data-role="rowPrice">${priceText}</strong>
          <span class="numeric ${toneClass(row.priceChange24h || 0)}" data-role="rowChange">${changeText}<small> 24h</small></span>
          <span class="quote-time ${stale ? "is-stale" : ""}" data-role="rowQuote">${escapeHtml(quoteTimeLabel(row))}</span>
        </div>
      </td>

      <td class="invested-col col-invested" data-label="${escapeHtml(t("table.columns.invested"))}">
        <strong class="money" data-role="rowInvested">${maskedCurrency(metrics.investment)}</strong>
      </td>

      <td class="value-col col-value" data-label="${escapeHtml(t("table.columns.value"))}">
        <div class="stack-cell">
          <strong class="money" data-role="rowValue">${maskedCurrency(metrics.currentValue)}</strong>
          <span class="weight-chip" data-role="rowWeight">${weight != null ? weight.toFixed(1) + "%" : "--"}</span>
        </div>
      </td>

      <td class="pnl-col col-pnl" data-label="${escapeHtml(t("table.columns.performance"))}">
        <div class="stack-cell">
          <strong class="money ${toneClass(metrics.pnlUsd)}" data-role="rowPnlAbs">${maskedSignedCurrency(metrics.pnlUsd)}</strong>
          <span class="numeric ${toneClass(metrics.pnlPct)}" data-role="rowPnlPct">${formatPercent(metrics.pnlPct)}</span>
        </div>
      </td>

      <td class="actions-cell col-actions" data-label="${escapeHtml(t("table.columns.actions"))}">
        <div class="row-actions">
          <button class="icon-btn edit-btn" type="button" data-action="edit-row" data-row-id="${row.id}">${escapeHtml(t("buttons.edit"))}</button>
          <button class="icon-btn ghost-icon" type="button" data-action="row-menu" data-row-id="${row.id}" aria-label="${escapeHtml(t("buttons.moreActions"))}" aria-haspopup="menu">⋯</button>
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

function summaryIconSvg(name) {
  const icons = {
    invested: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15 9.2c-.6-.8-1.7-1.2-3-1.2-1.8 0-3 .8-3 2s1.2 1.7 3 2 3 .8 3 2-1.2 2-3 2c-1.3 0-2.4-.4-3-1.2"/></svg>',
    change: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 6-8"/><path d="M15 6h3v3"/></svg>',
    assets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></svg>'
  };
  return icons[name] || "";
}

function renderSummary(snapshot, insights = getPortfolioInsights(snapshot)) {
  renderMainValueCard(snapshot);

  const change = getPortfolio24hChange(snapshot);
  const dayItems = get24hInsightItems(snapshot);
  const bestDay = [...dayItems].sort((a, b) => b.change24h - a.change24h)[0] || null;
  const worstDay = [...dayItems].sort((a, b) => a.change24h - b.change24h)[0] || null;

  const cards = [
    {
      icon: summaryIconSvg("invested"),
      label: t("summary.investedShort"),
      value: maskedCurrency(snapshot.totals.investment),
      tone: ""
    },
    {
      icon: summaryIconSvg("change"),
      label: t("summary.change24h"),
      value: change ? formatSignedPercent(change.pct) : "--",
      tone: change ? toneClass(change.pct) : ""
    },
    {
      icon: summaryIconSvg("change"),
      label: t("summary.bestDay"),
      value: bestDay ? `${assetDisplayName(bestDay.row)} ${formatSignedPercent(bestDay.change24h)}` : "--",
      tone: bestDay ? "positive" : ""
    },
    {
      icon: summaryIconSvg("change"),
      label: t("summary.worstDay"),
      value: worstDay ? `${assetDisplayName(worstDay.row)} ${formatSignedPercent(worstDay.change24h)}` : "--",
      tone: worstDay ? "negative" : ""
    },
  ];

  dom.summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card mini ${card.tone}">
          <span class="summary-icon" aria-hidden="true">${card.icon}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <p>${escapeHtml(card.label)}</p>
        </article>
      `
    )
    .join("");

  renderAllocationCard(snapshot);
}

// Reparto del capital entre BTC / ETH / stables / altcoins (barra apilada).
function getAllocationBreakdown(snapshot) {
  const totals = { btc: 0, eth: 0, stable: 0, alt: 0 };
  let sum = 0;
  snapshot.items.forEach(({ row, metrics }) => {
    if (metrics.currentValue > 0) {
      totals[getAssetCategory(row)] += metrics.currentValue;
      sum += metrics.currentValue;
    }
  });
  if (!(sum > 0)) {
    return null;
  }
  return {
    btc: (totals.btc / sum) * 100,
    eth: (totals.eth / sum) * 100,
    stable: (totals.stable / sum) * 100,
    alt: (totals.alt / sum) * 100
  };
}

function renderAllocationCard(snapshot) {
  const card = document.getElementById("allocationCard");
  if (!card) {
    return;
  }

  const alloc = getAllocationBreakdown(snapshot);
  if (!alloc) {
    card.hidden = true;
    return;
  }

  const segments = [
    { key: "btc", label: "BTC", color: "#f6b34c" },
    { key: "eth", label: "ETH", color: "#7da4ff" },
    { key: "stable", label: t("alloc.stables"), color: "#6d9ec4" },
    { key: "alt", label: t("alloc.alts"), color: "#3effa8" }
  ].filter((segment) => alloc[segment.key] > 0.05);

  card.hidden = false;
  card.innerHTML = `
    <span class="alloc-title">${escapeHtml(t("alloc.title"))}</span>
    <div class="alloc-bar" aria-hidden="true">
      ${segments.map((segment) => `<span style="width:${alloc[segment.key].toFixed(2)}%;background:${segment.color}"></span>`).join("")}
    </div>
    <div class="alloc-legend">
      ${segments.map((segment) => `
        <span class="alloc-chip">
          <i style="background:${segment.color}"></i>
          ${escapeHtml(segment.label)} <strong>${alloc[segment.key].toFixed(1)}%</strong>
        </span>
      `).join("")}
    </div>
  `;
}

function renderMainValueCard(snapshot) {
  if (!dom.mainValue) {
    return;
  }

  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment
    ? (totalPnl / snapshot.totals.investment) * 100
    : 0;

  dom.mainValue.textContent = maskedCurrency(snapshot.totals.currentValue);
  if (dom.mainPnlAbs) {
    dom.mainPnlAbs.textContent = maskedSignedCurrency(totalPnl);
    dom.mainPnlAbs.className = toneClass(totalPnl);
  }
  if (dom.mainPnlPct) {
    dom.mainPnlPct.hidden = false;
    dom.mainPnlPct.textContent = formatPercent(totalPnlPct);
    dom.mainPnlPct.className = `delta-chip ${totalPnl > 0 ? "good" : totalPnl < 0 ? "error" : "warn"}`;
  }
  if (dom.mainUpdated) {
    dom.mainUpdated.textContent = mainUpdatedLabel();
  }

  renderMainSparkline();
}

// Línea fina de 7 días bajo el valor total: solo con historial real (≥2 puntos).
function renderMainSparkline() {
  if (!dom.mainSparkline || !dom.mainSparklinePath) {
    return;
  }

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const points = state.history.filter(
    (point) => point.currency === state.prefs.currency && new Date(point.at).getTime() >= cutoff
  );

  if (points.length < 2) {
    dom.mainSparkline.hidden = true;
    return;
  }

  const sampled = downsampleHistoryPoints(points, 60);
  const values = sampled.map((point) => Number(point.total || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) =>
    `${((index / (values.length - 1)) * 100).toFixed(2)},${(26 - ((value - min) / span) * 23).toFixed(2)}`
  );
  dom.mainSparklinePath.setAttribute("points", coords.join(" "));
  dom.mainSparkline.hidden = false;
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
  if (dom.stickyBarValue) {
    dom.stickyBarValue.textContent = maskedCurrency(snapshot.totals.currentValue);
  }
  if (dom.stickyBarPnl) {
    dom.stickyBarPnl.textContent = state.prefs.hideBalance
      ? formatPercent(totalPnlPct)
      : `${formatSignedCurrency(totalPnl)} (${formatPercent(totalPnlPct)})`;
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
  const visible = state.prefs.activeTab === "home" && !state.heroVisible;
  dom.stickyBar.classList.toggle("is-visible", visible);
  dom.stickyBar.setAttribute("aria-hidden", visible ? "false" : "true");
}

function renderTotalsRow(snapshot) {
  renderCarteraSummary(snapshot);

  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment
    ? (totalPnl / snapshot.totals.investment) * 100
    : 0;

  // Fila de totales alineada con las 6 columnas de solo lectura.
  dom.totalsFoot.innerHTML = `
    <tr class="totals-row">
      <td class="totals-label-cell col-asset">${escapeHtml(t("table.totals"))}</td>
      <td class="col-price"></td>
      <td class="totals-inline-cell money col-invested" data-label="${escapeHtml(t("summary.totalInvested"))}">${maskedCurrency(snapshot.totals.investment)}</td>
      <td class="totals-inline-cell money col-value" data-label="${escapeHtml(t("summary.totalValue"))}">${maskedCurrency(snapshot.totals.currentValue)}</td>
      <td class="totals-inline-cell col-pnl" data-label="${escapeHtml(t("summary.gainLoss"))}">
        <span class="money ${toneClass(totalPnl)}">${maskedSignedCurrency(totalPnl)}</span>
        <span class="totals-inline-meta ${toneClass(totalPnlPct)}">${formatPercent(totalPnlPct)}</span>
      </td>
      <td class="col-actions"></td>
    </tr>
  `;
}

// Tarjeta superior de Cartera: nº posiciones, valor, PnL total y 24h.
function renderCarteraSummary(snapshot) {
  const el = document.getElementById("carteraSummary");
  if (!el) {
    return;
  }
  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment ? (totalPnl / snapshot.totals.investment) * 100 : 0;
  const change = getPortfolio24hChange(snapshot);
  const count = snapshot.items.filter(
    (item) => item.metrics.investment > 0 || item.metrics.currentValue > 0 || item.row.crypto.trim()
  ).length;
  const stale = state.lastRefreshAt
    ? t("home.updatedAgo", { time: formatRelativeTime(state.lastRefreshAt) })
    : t("status.noSyncYet");

  el.innerHTML = `
    <div class="cartera-sum-main">
      <div>
        <span class="cartera-sum-label">${escapeHtml(t("home.totalValue"))}</span>
        <strong class="cartera-sum-value">${maskedCurrency(snapshot.totals.currentValue)}</strong>
      </div>
      <div class="cartera-sum-pnl ${toneClass(totalPnl)}">
        <strong>${maskedSignedCurrency(totalPnl)}</strong>
        <span>${formatPercent(totalPnlPct)}</span>
      </div>
    </div>
    <div class="cartera-sum-meta">
      <span>${escapeHtml(t("cartera.positions", { count }))}</span>
      <span class="${change ? toneClass(change.pct) : ""}">${escapeHtml(t("summary.change24h"))}: ${change ? formatSignedPercent(change.pct) : "--"}</span>
      <span class="cartera-sum-updated">${escapeHtml(stale)}</span>
    </div>
  `;
}

function renderActivity() {
  // El listado de actividad se retiró de la interfaz (pestaña "Actividad"
  // eliminada). Se conserva el estado interno, pero no hay dónde pintarlo.
  if (!dom.activityList) {
    return;
  }
  if (!state.activity.length) {
    dom.activityList.innerHTML = `
      <div class="empty-state">${escapeHtml(t("activity.empty"))}</div>
    `;
    return;
  }

  dom.activityList.innerHTML = state.activity
    .slice(0, 8)
    .map(
      (item) => `
        <article class="activity-item">
          <strong class="${escapeHtml(item.tone || "neutral")}">${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.detail)}</p>
          <time>${escapeHtml(formatDateTime(new Date(item.at)))}</time>
        </article>
      `
    )
    .join("");
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
  // La pantalla de detalle abierta también se mantiene al día.
  if (state.detailRowId === rowId) {
    renderAssetDetail();
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
  setRole("assetAvatar", (node) => { node.innerHTML = renderAssetAvatar(row); });
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
    node.innerHTML = `${Number.isFinite(row.priceChange24h) ? formatSignedPercent(row.priceChange24h) : "--"}<small> 24h</small>`;
    node.className = `numeric ${toneClass(row.priceChange24h || 0)}`;
  });
  setRole("rowQuote", (node) => {
    node.textContent = quoteTimeLabel(row);
    node.classList.toggle("is-stale", isStaleQuote(row));
  });
  setRole("rowInvested", (node) => { node.textContent = maskedCurrency(metrics.investment); });
  setRole("rowValue", (node) => { node.textContent = maskedCurrency(metrics.currentValue); });
  setRole("rowWeight", (node) => { node.textContent = weight != null ? `${weight.toFixed(1)}%` : "--"; });
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

  if (!target) {
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

// ── Interacciones de la lista móvil de activos ──
function bindPortfolioMobile() {
  const box = document.getElementById("portfolioMobileList");
  if (!box) {
    return;
  }
  box.addEventListener("click", (event) => {
    const emptyAdd = event.target.closest('[data-action="empty-add"]');
    if (emptyAdd) {
      handleAddRow();
      return;
    }
    const toggle = event.target.closest("[data-card-toggle]");
    if (toggle) {
      toggleMobileCard(toggle.dataset.cardToggle, toggle);
      return;
    }
    const actionBtn = event.target.closest("[data-card-action]");
    if (actionBtn) {
      const rowId = actionBtn.dataset.rowId;
      switch (actionBtn.dataset.cardAction) {
        case "buy": openTradeSheet("buy", rowId); break;
        case "sell": openTradeSheet("sell", rowId); break;
        case "edit": openPositionEditor(rowId); break;
        case "delete": deletePositionWithUndo(rowId); break;
        default: break;
      }
    }
  });
}

function toggleMobileCard(rowId, toggleBtn) {
  const card = document.querySelector(`.asset-mobile-card[data-card-row="${rowId}"]`);
  if (!card) return;
  const expanded = card.classList.toggle("is-expanded");
  if (expanded) {
    state.expandedCards.add(rowId);
  } else {
    state.expandedCards.delete(rowId);
  }
  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

// Eliminar posición con confirmación + opción de deshacer.
function deletePositionWithUndo(rowId) {
  const row = getRowById(rowId);
  if (!row) return;
  if (!window.confirm(t("menu.deleteConfirm", { asset: assetDisplayName(row) }))) {
    return;
  }
  const index = state.rows.findIndex((item) => item.id === rowId);
  state.lastDeleted = { row: { ...row }, index };
  state.rows = state.rows.filter((item) => item.id !== rowId);
  state.expandedCards.delete(rowId);
  clearTimersForRow(rowId);
  if (state.detailRowId === rowId) {
    closeAssetDetail();
  }
  // Mantiene al menos una fila editable si el portafolio queda vacío.
  const addedPlaceholder = !state.rows.length;
  if (addedPlaceholder) {
    state.rows.push(createRow());
    state.lastDeleted = null; // no hay deshacer limpio si se recreó placeholder
  }
  renderAll();
  scheduleAutosave();
  pushActivity(
    t("alerts.rowDeletedTitle"),
    t("alerts.rowDeletedText", { asset: assetDisplayName(row) }),
    "negative"
  );
  if (state.lastDeleted) {
    showUndoToast(t("alerts.rowDeletedText", { asset: assetDisplayName(row) }), () => undoDelete());
  } else {
    showToast(t("alerts.rowDeletedTitle"), t("alerts.rowDeletedText", { asset: assetDisplayName(row) }), "warning");
  }
}

function undoDelete() {
  if (!state.lastDeleted) return;
  const { row, index } = state.lastDeleted;
  state.rows.splice(Math.min(index, state.rows.length), 0, row);
  state.lastDeleted = null;
  renderAll();
  scheduleAutosave();
  showToast(t("undo.restoredTitle"), t("undo.restoredText", { asset: assetDisplayName(row) }), "positive");
}

// Toast con acción "Deshacer" (temporizador más largo).
function showUndoToast(detail, onUndo) {
  if (!dom.toastStack) return;
  const toast = document.createElement("article");
  toast.className = "toast warning toast-undo";
  toast.innerHTML = `
    <div class="toast-content">
      <strong>${escapeHtml(t("alerts.rowDeletedTitle"))}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
    <button type="button" class="toast-undo-btn">${escapeHtml(t("undo.action"))}</button>
  `;
  const remove = () => { toast.style.opacity = "0"; window.setTimeout(() => toast.remove(), 200); };
  toast.querySelector(".toast-undo-btn").addEventListener("click", () => {
    onUndo();
    remove();
  });
  dom.toastStack.appendChild(toast);
  window.setTimeout(remove, 6500);
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

function renderAssetAvatar(row) {
  if (row.image) {
    return `<img src="${escapeHtml(row.image)}" alt="${escapeHtml(assetDisplayName(row))}" />`;
  }

  const label = String(row.symbol || row.crypto || "?").slice(0, 3).toUpperCase();
  return `<span>${escapeHtml(label)}</span>`;
}
