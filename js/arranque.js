// =============================================================================
// arranque.js - Arranque y armazon de la interfaz: init(), enlace de eventos,
// pestanas, menu del engranaje, temas, diagnostico y eventos del entorno.
// ULTIMO script de la app: su ultima linea llama a init().
// =============================================================================

function init() {
  loadState();
  loadNewsCache();
  translateStaticContent();
  applyTheme();
  applyDensity();
  bindEvents();
  bindWallets();
  bindEnvironmentEvents();
  applyBalanceVisibility();
  renderAll();
  setActiveTab(state.prefs.activeTab);
  detectIosInstallCard();
  startAutoRefresh();
  startLivePrices();
  observeChartsPanelForLazyLoad();
  observeHeroForStickyBar();
  document.querySelector(".diag-details")?.addEventListener("toggle", (e) => {
    if (e.target.open) renderDiagnostics();
  });

  // Ticker ligero: refresca las etiquetas "hace X / en X" cada minuto.
  window.setInterval(() => {
    renderStatusCards();
    renderLiveIndicator();
    renderMarketSection();
    // Red de seguridad del feed en vivo: si el portafolio cambio de activos
    // (o la conexion se quedo muerta sin avisar) aqui se recompone solo.
    syncLivePrices();
  }, 60000);

  window.setTimeout(() => {
    if (isOffline()) {
      // Sin red al arrancar: se muestran los últimos datos guardados y la
      // fecha real de la última sincronización en lugar de forzar un error.
      setApiState("offline", t("status.offlineMeta"));
      return;
    }
    refreshAllPrices({ silentWhenEmpty: true, force: false });
    // Billeteras: se releen solas si llevan un rato sin actualizarse.
    syncStaleWallets();
  }, 140);
}

// ── Pestañas ──
function setActiveTab(tab) {
  const nextTab = APP_TABS.includes(tab) ? tab : "home";
  const previousTab = state.prefs.activeTab;
  if (previousTab && previousTab !== nextTab && document.body.dataset.activeTab) {
    tabScrollPositions[previousTab] = window.scrollY;
  }
  state.prefs.activeTab = nextTab;
  document.body.dataset.activeTab = nextTab;

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === nextTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  if (nextTab === "analytics" && state.prefs.showCharts) {
    // Chart.js se carga perezosamente solo al abrir Analitica; los skeletons
    // del panel se ocultan cuando el primer render termina.
    ensureChartJs()
      .then(() => {
        try { state.charts.pie?.destroy(); } catch { /* noop */ }
        try { state.charts.line?.destroy(); } catch { /* noop */ }
        state.charts.pie = null;
        state.charts.line = null;
        updateCharts(buildSnapshot());
      })
      .catch(() => {});
  }

  if (nextTab === "news") {
    renderNews();
    fetchNews(false);
  }

  if (nextTab === "plan") {
    renderPlan();
  }

  if (nextTab === "more") {
    renderDiagnostics();
    renderAlertsPanel();
    renderWalletsPanel();
  }

  savePreferences();
  updateStickyBarVisibility();
  const targetScroll = tabScrollPositions[nextTab] || 0;
  window.scrollTo({ top: targetScroll });
  // Refuerzo tras el layout (rAF no es fiable en segundo plano/PWA oculta).
  window.setTimeout(() => window.scrollTo({ top: targetScroll }), 0);
}

// Diagnóstico discreto en "Más": estado real de datos y caches.
function renderDiagnostics() {
  const grid = document.getElementById("diagGrid");
  if (!grid) return;
  let storedBytes = 0;
  try {
    [STORAGE_KEY, PREFS_KEY, HISTORY_KEY, FX_RATE_CACHE_KEY].forEach((key) => {
      const v = localStorage.getItem(key);
      if (v) storedBytes += key.length + v.length;
    });
  } catch (error) {
    storedBytes = -1;
  }
  const assets = state.rows.filter((r) => r.crypto.trim()).length;
  const cells = [
    [t("diag.lastSync"), state.lastRefreshAt ? formatRelativeTime(state.lastRefreshAt) : t("status.noSyncYet")],
    [t("diag.assets"), String(assets)],
    [t("diag.activity"), String(state.activity.length)],
    [t("diag.stored"), storedBytes >= 0 ? `${(storedBytes / 1024).toFixed(1)} KB` : "--"],
    [t("diag.priceCache"), String(state.priceCache.size)],
    [t("diag.historyPoints"), String(state.history.length)],
    // Estado del feed en vivo: es lo primero que hay que mirar cuando los
    // precios "no van" (proveedor bloqueado, sin suscripciones, apagado).
    [t("diag.liveStatus"), liveStatusLabel()],
    [t("diag.liveSymbols"), state.live.covered.length
      ? `${state.live.covered.length}/${state.live.symbols.length}`
      : "0"],
    [t("diag.liveLastTick"), state.live.lastTickAt ? formatRelativeTime(state.live.lastTickAt) : "--"]
  ];
  grid.innerHTML = cells
    .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`)
    .join("");
}

// Tarjeta "Añadir al iPhone": solo Safari iOS sin instalar.
function detectIosInstallCard() {
  if (!dom.installCard) {
    return;
  }
  const isIOS = /iphone|ipod|ipad/i.test(navigator.userAgent || "");
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator.standalone === true;
  if (isIOS && !isStandalone) {
    dom.installCard.hidden = false;
  }
}

// ── Bottom sheet de acciones (abierto desde las acciones rápidas de Inicio) ──
function bindFab() {
  const sheet = document.getElementById("fabSheet");
  if (sheet) {
    sheet.addEventListener("click", (event) => {
      if (event.target.closest("[data-fab-close]")) {
        closeFabSheet();
        return;
      }
      const action = event.target.closest("[data-fab-action]")?.dataset.fabAction;
      if (action) {
        closeFabSheet();
        handleFabAction(action);
      }
    });
  }

  // Acciones rápidas de la pantalla de Inicio.
  document.getElementById("quickAddBtn")?.addEventListener("click", () => openFabSheet());
  document.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.quick;
      if (action === "new") {
        // Nueva posicion directa: ya estamos en Portafolio, asi que se evita
        // pasar por handleFabAction para no forzar el scroll al principio.
        handleAddRow();
      } else {
        handleFabAction(action);
      }
    });
  });
}

function openFabSheet() {
  const sheet = document.getElementById("fabSheet");
  if (sheet) {
    sheet.hidden = false;
    document.body.classList.add("fab-open");
  }
}

function closeFabSheet() {
  const sheet = document.getElementById("fabSheet");
  if (!sheet) {
    return;
  }
  sheet.classList.add("is-closing");
  window.setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("is-closing");
    document.body.classList.remove("fab-open");
  }, 200);
}

function handleFabAction(action) {
  switch (action) {
    case "import":
      dom.importFileInput?.click();
      break;
    case "new":
      setActiveTab("home");
      handleAddRow();
      break;
    case "buy":
      openTradeSheet("buy");
      break;
    case "sell":
      openTradeSheet("sell");
      break;
    case "alert":
      // "Alerta" = objetivos TP de una posición: abre el editor en la
      // posición elegida (o una nueva) donde se fijan TP1/TP2/TP3.
      openTradeSheet("alert");
      break;
    case "pdf":
      handleDownloadPdf();
      break;
    case "sharePdf":
      // Mismo informe, pero entregado a la hoja de compartir del sistema.
      handleDownloadPdf("share");
      break;
    case "export":
      handleExportCsv();
      break;
    case "wallet":
      openWalletSheet();
      break;
    default:
      break;
  }
}

// Sirve tanto para el botón "Copiar" como para la propia dirección <code>:
// se guarda el texto original para restaurarlo tras el feedback "Copiado".
async function copyWalletAddress(element) {
  if (element.classList.contains("is-copied")) {
    return;
  }

  const address = element.dataset.copyWallet || "";
  const label = element.dataset.walletLabel || "";
  if (!address) {
    return;
  }

  const copied = await copyTextToClipboard(address);
  if (!copied) {
    showToast(t("wallet.copyErrorTitle"), t("wallet.copyErrorText"), "warning");
    return;
  }

  const originalText = element.textContent;
  element.textContent = t("buttons.copied");
  element.classList.add("is-copied");
  window.setTimeout(() => {
    element.textContent = originalText;
    element.classList.remove("is-copied");
  }, 1800);
  showToast(t("wallet.copiedTitle"), t("wallet.copiedText", { label }), "positive");
}

function bindEvents() {
  dom.addRowBtn.addEventListener("click", handleAddRow);
  dom.refreshPricesBtn.addEventListener("click", () => {
    refreshAllPrices({ silentWhenEmpty: false, force: true, reason: "manual" });
  });
  dom.saveBtn.addEventListener("click", () => {
    persistState(true);
    pushActivity(t("alerts.manualSaveTitle"), t("alerts.manualSaveText"), "neutral");
  });
  dom.clearBtn.addEventListener("click", handleResetData);
  dom.downloadPdfBtn.addEventListener("click", handleDownloadPdf);
  dom.exportBtn.addEventListener("click", handleExportCsv);
  dom.importBtn.addEventListener("click", () => dom.importFileInput.click());
  dom.importFileInput.addEventListener("change", handleImportCsv);
  dom.toggleChartsBtn.addEventListener("click", toggleCharts);
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.themeSet));
  });
  bindAnalyticsSummary();
  bindNews();
  dom.portfolioNameInput.addEventListener("input", (event) => {
    savePortfolioName(event.target.value);
  });
  dom.lineRangeControl?.addEventListener("click", handleChartRangeClick);

  dom.currencySelect.addEventListener("change", async (event) => {
    await handleBaseCurrencyChange(event.target.value);
  });

  dom.autoRefreshSelect.addEventListener("change", (event) => {
    state.prefs.autoRefreshSec = Number.parseInt(event.target.value, 10) || 0;
    savePreferences();
    startAutoRefresh();
    updateSaveMessage(
      state.prefs.autoRefreshSec
        ? t("alerts.autoRefreshEvery", { value: getAutoRefreshLabel(state.prefs.autoRefreshSec) })
        : t("alerts.autoRefreshManual")
    );
  });

  dom.tableHead.addEventListener("click", handleHeaderClick);
  dom.tableBody.addEventListener("keydown", handleTableKeyDown);
  dom.tableBody.addEventListener("click", handleTableClick);
  bindPortfolioMobile();
  bindPositionEditor();
  bindFab();
  bindAssetDetail();
  bindMarkets();
  bindFilters();
  bindPlan();
  updateFiltersBadge();

  document.querySelectorAll("[data-copy-wallet]").forEach((button) => {
    button.addEventListener("click", () => copyWalletAddress(button));
  });

  const moreRefreshBtn = document.getElementById("moreRefreshBtn");
  if (moreRefreshBtn) {
    moreRefreshBtn.addEventListener("click", () => dom.refreshPricesBtn.click());
  }

  const alertsList = document.getElementById("alertsList");
  if (alertsList) {
    alertsList.addEventListener("click", (event) => {
      const borrar = event.target.closest("[data-alert-delete]");
      if (borrar) {
        deleteAlert(borrar.dataset.alertDelete);
        return;
      }
      const editar = event.target.closest("[data-alert-edit]");
      if (editar) {
        openAlertEdit(editar.dataset.alertEdit);
      }
    });
  }
  document.getElementById("addAlertBtn")?.addEventListener("click", () => handleFabAction("alert"));

  const tradesLog = document.getElementById("tradesLog");
  if (tradesLog) {
    tradesLog.addEventListener("click", (event) => {
      const borrar = event.target.closest("[data-trade-delete]");
      if (borrar) {
        deleteTrade(borrar.dataset.tradeDelete);
        return;
      }
      const editar = event.target.closest("[data-trade-edit]");
      if (editar) {
        openTradeEdit(editar.dataset.tradeEdit);
        return;
      }
      if (event.target.closest("[data-trades-more]")) {
        tradesLogLimit += TRADES_LOG_PAGE;
        renderTradesLog();
      }
    });
  }

  if (dom.livePricesSelect) {
    dom.livePricesSelect.addEventListener("change", (event) => {
      state.prefs.livePrices = event.target.value === "on";
      savePreferences();
      if (state.prefs.livePrices) {
        startLivePrices();
      } else {
        stopLivePrices();
      }
      updateSaveMessage(
        state.prefs.livePrices ? t("live.enabledMsg") : t("live.disabledMsg")
      );
    });
  }

  if (dom.mobileSortSelect) {
    dom.mobileSortSelect.addEventListener("change", (event) => {
      const nextKey = event.target.value;
      if (state.prefs.sortBy !== nextKey) {
        state.prefs.sortBy = nextKey;
        // Misma convención que las cabeceras: texto ascendente, resto descendente.
        state.prefs.sortDir = nextKey === "asset" ? "asc" : "desc";
      }
      savePreferences();
      renderAll();
      const option = SORT_OPTIONS.find((item) => item.key === nextKey);
      updateSaveMessage(t("alerts.sortingBy", { column: option ? t(option.labelKey) : nextKey }));
    });
  }

  if (dom.mobileSortDirBtn) {
    dom.mobileSortDirBtn.addEventListener("click", () => {
      state.prefs.sortDir = state.prefs.sortDir === "desc" ? "asc" : "desc";
      savePreferences();
      renderAll();
    });
  }

  // Pestañas (barra inferior en móvil, superior en escritorio)
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tabTarget));
  });

  // Inicio: actualizar (reutiliza el botón de Cartera) y ocultar saldo
  if (dom.homeRefreshBtn) {
    dom.homeRefreshBtn.addEventListener("click", () => dom.refreshPricesBtn.click());
  }
  if (dom.toggleBalanceBtn) {
    dom.toggleBalanceBtn.addEventListener("click", () => {
      state.prefs.hideBalance = !state.prefs.hideBalance;
      savePreferences();
      applyBalanceVisibility();
      renderDashboardOnly();
    });
  }

  if (dom.sharePdfBtn) {
    dom.sharePdfBtn.addEventListener("click", () => handleDownloadPdf("share"));
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.rowMenuOpen) {
        closeRowMenu();
      } else if (!document.getElementById("tradeSheet")?.hidden) {
        closeTradeSheet();
      } else if (state.editorRowId) {
        closePositionEditor();
      } else if (state.detailRowId) {
        closeAssetDetail();
      }
    }
  });
}

// Tema con tres opciones excluyentes: claro, oscuro y OLED (oscuro + negro).
function setTheme(mode) {
  if (mode === "oled") {
    state.prefs.theme = "dark";
    state.prefs.oled = true;
  } else {
    state.prefs.theme = mode === "light" ? "light" : "dark";
    state.prefs.oled = false;
  }
  applyTheme();
  savePreferences();
  renderDashboardOnly();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.prefs.theme;

  // Mantiene el color del marco del navegador/PWA alineado con el tema activo.
  const themeColor = THEME_COLORS[state.prefs.theme] || THEME_COLORS.dark;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", themeColor);
  });
  // OLED es una capa sobre el modo oscuro; se reevalúa tras cambiar de tema.
  applyOled();
  const active = state.prefs.oled && state.prefs.theme === "dark" ? "oled" : state.prefs.theme;
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    const on = btn.dataset.themeSet === active;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

// Tema OLED: capa negra profunda sobre el modo oscuro (independiente del
// toggle claro/oscuro). Solo tiene efecto visual cuando el tema es "dark".
function applyOled() {
  const active = Boolean(state.prefs.oled);
  document.documentElement.dataset.oled = active ? "on" : "";
  // En OLED sobre oscuro, el marco del navegador/PWA va a negro puro.
  if (active && state.prefs.theme === "dark") {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", "#000000");
    });
  }
}

// La vista compacta es ahora la norma: se aplica siempre y no hay ajuste.
function applyDensity() {
  document.documentElement.dataset.density = "compact";
}

function bindEnvironmentEvents() {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      // El WebSocket no sigue abierto en segundo plano: gasta bateria y datos
      // para nada, y al volver se reconecta con precios frescos.
      if (document.visibilityState === "visible") {
        startLivePrices();
      } else {
        stopLivePrices();
      }
      if (document.visibilityState !== "visible" || !state.prefs.autoRefreshSec) {
        return;
      }
      // Al volver a primer plano (clave en PWA de iOS): solo se refresca si
      // ya pasó el intervalo configurado desde la última actualización.
      const elapsed = Date.now() - (state.lastRefreshAt || 0);
      if (elapsed >= state.prefs.autoRefreshSec * 1000) {
        refreshAllPrices({ silentWhenEmpty: true, force: false, reason: "auto" });
      }
      renderStatusCards();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      setApiState("connected", t("status.lastSyncLong", { time: formatClock(new Date()) }));
      // Al recuperar conexión se sincroniza siempre una vez, con force para
      // saltar la caché y no seguir mostrando los precios de la sesión offline.
      refreshAllPrices({ silentWhenEmpty: true, force: true, reason: "auto" });
      startLivePrices();
    });
    window.addEventListener("offline", () => {
      setApiState("offline", t("status.offlineMeta"));
      stopLivePrices();
    });

    // Los gráficos se recalculan al girar el dispositivo o cambiar el tamaño.
    let chartResizeTimer = null;
    const scheduleChartResize = () => {
      if (chartResizeTimer) {
        window.clearTimeout(chartResizeTimer);
      }
      chartResizeTimer = window.setTimeout(() => {
        chartResizeTimer = null;
        state.charts.pie?.resize();
        state.charts.line?.resize();
      }, 180);
    };
    window.addEventListener("resize", scheduleChartResize);
    window.addEventListener("orientationchange", scheduleChartResize);
  }
}

// ── Arranque ──
// init() va en la ULTIMA linea del ULTIMO script a proposito. Las funciones se
// elevan, pero las const/let no: si init() corriera antes de que se evaluase
// alguna, el primer acceso lanzaria un ReferenceError (zona muerta temporal) y
// la app se quedaria en blanco. Paso cuatro veces mientras init() estaba a
// mitad del antiguo app.js. Aqui ya se han cargado todos los ficheros, asi que
// no puede pasar, se declare cada cosa donde se declare.
init();
