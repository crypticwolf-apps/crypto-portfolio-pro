const STORAGE_KEY = "crypto-dashboard-rows-v3";
const PREFS_KEY = "crypto-dashboard-prefs-v2";
const HISTORY_KEY = "crypto-dashboard-history-v2";
const FX_RATE_CACHE_KEY = "crypto-dashboard-fx-v1";
const AUTOSAVE_DELAY = 800;
const SEARCH_DELAY = 280;
const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const PRICE_CACHE_TTL = 25 * 1000;
const FX_RATE_TTL = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 15000;
const COINGECKO_BASE = "https://api.coingecko.com/api/v3/";

// Free-tier throttle. El API público de CoinGecko admite hoy ~5-15 llamadas
// por minuto y por IP (jul 2026): MIN_GAP=2.5s y tope de 12/min mantienen a
// la app por debajo del límite. El uso normal es 1 llamada de mercado por
// refresco (los coinId van sembrados en los datos por defecto); las búsquedas
// solo se disparan al teclear activos nuevos y ya llevan debounce.
// Los 429 residuales siguen aplicando backoff exponencial con jitter abajo.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_CALLS = 12;
const RATE_LIMIT_MIN_GAP_MS = 2500;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js";
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
const JSPDF_AUTOTABLE_URL = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";

const scriptLoadCache = new Map();
function loadExternalScript(url) {
  if (scriptLoadCache.has(url)) {
    return scriptLoadCache.get(url);
  }
  const promise = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = url;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      scriptLoadCache.delete(url);
      reject(new Error(`Failed to load ${url}`));
    };
    document.head.appendChild(tag);
  });
  scriptLoadCache.set(url, promise);
  return promise;
}

async function ensureChartJs() {
  if (typeof window.Chart !== "undefined") return window.Chart;
  await loadExternalScript(CHART_JS_URL);
  return window.Chart;
}

async function ensureJsPdf() {
  if (window.jspdf?.jsPDF && window.jspdf?.jsPDF?.API?.autoTable) {
    return window.jspdf.jsPDF;
  }
  if (!window.jspdf?.jsPDF) {
    await loadExternalScript(JSPDF_URL);
  }
  if (!window.jspdf?.jsPDF?.API?.autoTable) {
    await loadExternalScript(JSPDF_AUTOTABLE_URL);
  }
  return window.jspdf?.jsPDF;
}
const MAX_ACTIVITY_ITEMS = 18;
const MAX_HISTORY_POINTS = 6000;
const MAX_ROW_HISTORY_POINTS = 240;
const AUTO_REFRESH_OPTIONS = [15, 60, 1800, 3600, 86400];
const CHART_RANGE_WINDOWS = {
  "1m": 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "6mo": 180 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  total: Infinity
};
const CHART_RANGE_ORDER = ["1m", "1h", "1d", "1w", "1mo", "6mo", "1y", "total"];

const CURRENCY_META = {
  usd: { code: "USD", label: "USD", locale: "en-US" },
  eur: { code: "EUR", label: "EUR", locale: "es-ES" }
};

const UI_LOCALES = window.APP_I18N?.UI_LOCALES || { es: "es-ES", en: "en-US", fr: "fr-FR" };
const TRANSLATIONS = window.APP_I18N?.TRANSLATIONS || {};

const DEFAULT_PREFS = {
  theme: "dark",
  currency: "usd",
  language: "es",
  portfolioName: "",
  autoRefreshSec: 60,
  showCharts: true,
  chartRange: "total",
  sortBy: "currentValue",
  sortDir: "desc",
  hiddenColumns: []
};

const TOGGLEABLE_COLUMNS = ["priority", "targets", "tpSignal"];
// Trío inversión/tokens/entrada: con dos datos se deriva el tercero.
const TRIAD_FIELDS = ["investment", "tokens", "entryPrice"];
const THEME_COLORS = { dark: "#050d14", light: "#f0f4f8" };

// Portafolio de demostración genérico (la app es pública): cifras redondas
// y activos conocidos. Los coinId van sembrados para que el primer arranque
// haga una única llamada a /coins/markets en vez de una búsqueda por activo
// (el API público de CoinGecko limita ~5-15 llamadas/min y salían 429).
// Los datos reales de cada usuario viven solo en su dispositivo.
const DEFAULT_ROWS = [
  {
    crypto: "Bitcoin",
    coinId: "bitcoin",
    symbol: "BTC",
    resolvedName: "Bitcoin",
    investment: "3000",
    tokens: "0.05",
    tp1: "75000",
    tp2: "85000",
    tp3: "100000"
  },
  {
    crypto: "Ethereum",
    coinId: "ethereum",
    symbol: "ETH",
    resolvedName: "Ethereum",
    investment: "1000",
    tokens: "0.6",
    tp1: "2500",
    tp2: "3000",
    tp3: "4000"
  },
  {
    crypto: "Solana",
    coinId: "solana",
    symbol: "SOL",
    resolvedName: "Solana",
    investment: "500",
    tokens: "6",
    tp1: "120",
    tp2: "150",
    tp3: "200"
  },
  {
    crypto: "Cardano",
    coinId: "cardano",
    symbol: "ADA",
    resolvedName: "Cardano",
    investment: "250",
    tokens: "500",
    tp1: "0.8",
    tp2: "1",
    tp3: "1.5"
  }
];

const TABLE_COLUMNS = [
  {
    key: "priority",
    labelKey: "table.columns.priority",
    tooltipKey: "table.tooltips.priority",
    sortKey: "favorite"
  },
  {
    key: "asset",
    labelKey: "table.columns.asset",
    tooltipKey: "table.tooltips.asset",
    sortKey: "asset"
  },
  {
    key: "position",
    labelKey: "table.columns.position",
    tooltipKey: "table.tooltips.position",
    sortKey: "investment"
  },
  {
    key: "market",
    labelKey: "table.columns.market",
    tooltipKey: "table.tooltips.market",
    sortKey: "currentValue"
  },
  {
    key: "performance",
    labelKey: "table.columns.performance",
    tooltipKey: "table.tooltips.performance",
    sortKey: "pnlPct"
  },
  {
    key: "targets",
    labelKey: "table.columns.targets",
    tooltipKey: "table.tooltips.targets",
    sortKey: "tp3"
  },
  {
    key: "tpSignal",
    labelKey: "table.columns.tpSignal",
    tooltipKey: "table.tooltips.tpSignal",
    sortKey: "tpSignal"
  },
  {
    key: "actions",
    labelKey: "table.columns.actions",
    tooltipKey: "table.tooltips.actions",
    sortKey: null
  }
];

const state = {
  rows: [],
  prefs: { ...DEFAULT_PREFS },
  activity: [],
  history: [],
  autosaveTimer: null,
  autoRefreshTimer: null,
  searchTimers: new Map(),
  blurTimers: new Map(),
  searchCache: new Map(),
  priceCache: new Map(),
  charts: { pie: null, line: null },
  syncing: false,
  apiStatus: "idle",
  apiMeta: "Sincroniza manualmente para cargar precios.",
  saveMessage: "Sin cambios pendientes",
  lastSyncLabel: "Sin sincronizacion todavia",
  portfolioNameTimer: null,
  rowCounter: 0,
  dashboardFrame: null,
  hiddenColumns: new Set(),
  pendingFetches: new Map(),
  fxRateCache: new Map(),
  refreshRequestId: 0,
  currencySwitchId: 0
};

const dom = {
  summaryGrid: document.getElementById("summaryGrid"),
  insightsRankingsGrid: document.getElementById("insightsRankingsGrid"),
  stickyBar: document.getElementById("stickyBar"),
  stickyBarName: document.getElementById("stickyBarName"),
  stickyBarValue: document.getElementById("stickyBarValue"),
  stickyBarPnl: document.getElementById("stickyBarPnl"),
  navApiBadge: document.getElementById("navApiBadge"),
  navApiText: document.getElementById("navApiText"),
  navSaveBadge: document.getElementById("navSaveBadge"),
  navSaveText: document.getElementById("navSaveText"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  totalsFoot: document.getElementById("totalsFoot"),
  addRowBtn: document.getElementById("addRowBtn"),
  refreshPricesBtn: document.getElementById("refreshPricesBtn"),
  saveBtn: document.getElementById("saveBtn"),
  clearBtn: document.getElementById("clearBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFileInput: document.getElementById("importFileInput"),
  toggleChartsBtn: document.getElementById("toggleChartsBtn"),
  chartsPanel: document.getElementById("chartsPanel"),
  portfolioPieChart: document.getElementById("portfolioPieChart"),
  portfolioLineChart: document.getElementById("portfolioLineChart"),
  lineRangeControl: document.getElementById("lineRangeControl"),
  activityList: document.getElementById("activityList"),
  portfolioNameInput: document.getElementById("portfolioNameInput"),
  portfolioNameDisplay: document.getElementById("portfolioNameDisplay"),
  currencySelect: document.getElementById("currencySelect"),
  autoRefreshSelect: document.getElementById("autoRefreshSelect"),
  themeToggle: document.getElementById("themeToggle"),
  apiStatus: document.getElementById("apiStatus"),
  apiStatusMeta: document.getElementById("apiStatusMeta"),
  saveStatus: document.getElementById("saveStatus"),
  lastSyncLabel: document.getElementById("lastSyncLabel"),
  appLoader: document.getElementById("appLoader"),
  loaderText: document.getElementById("loaderText"),
  toastStack: document.getElementById("toastStack")
};

init();

function t(key, vars = {}) {
  const language = state?.prefs?.language && TRANSLATIONS[state.prefs.language]
    ? state.prefs.language
    : "es";
  const template = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.es?.[key] ?? key;

  return String(template).replace(/\{(\w+)\}/g, (_, token) => String(vars[token] ?? ""));
}

function getUiLocale() {
  return UI_LOCALES[state.prefs.language] || UI_LOCALES.es || "es-ES";
}

function setDefaultMessages() {
  state.apiMeta = t("status.syncManual");
  state.saveMessage = t("status.noPendingChanges");
  state.lastSyncLabel = t("status.noSyncYet");
}

function translateStaticContent() {
  document.documentElement.lang = state.prefs.language || "es";
  document.title = t("document.title");

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });

  const footerTitle = document.querySelector(".footer-copy h2");
  if (footerTitle) {
    footerTitle.textContent = t("footer.title");
  }

  renderPortfolioIdentity();
  renderChartRangeControl();
}

function getAutoRefreshLabel(seconds) {
  if (seconds === 15) {
    return "15s";
  }
  if (seconds === 60) {
    return "1m";
  }
  if (seconds === 1800) {
    return "30m";
  }
  if (seconds === 3600) {
    return "1h";
  }
  if (seconds === 86400) {
    return "24h";
  }
  return `${seconds}s`;
}

// Etiqueta bajo la celda de posición: indica qué campo del trío se está
// calculando automáticamente (o el origen de la entrada si no hay ninguno).
function getAutoFieldLabel(row, metrics) {
  if (row.derivedField === "investment") {
    return t("table.fields.autoInvestment");
  }
  if (row.derivedField === "tokens") {
    return t("table.fields.autoTokens");
  }
  if (row.derivedField === "entryPrice") {
    return t("table.fields.entryDerived");
  }
  return getEntrySourceLabel(metrics.entrySource);
}

function getEntrySourceLabel(source) {
  if (source === "manual") {
    return t("table.fields.entryManual");
  }
  if (source === "derived") {
    return t("table.fields.entryDerived");
  }
  return t("table.fields.entryMissing");
}

function getPortfolioName() {
  const value = String(state.prefs.portfolioName || "").trim();
  return value || t("portfolio.defaultName");
}

function sanitizePortfolioNameInput(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function sanitizeFilenamePart(value) {
  const fallback = sanitizePdfText(t("portfolio.defaultName")).toLowerCase().replace(/\s+/g, "-");
  const cleaned = sanitizePdfText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback || "portfolio";
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

function formatGeneratedDate(date) {
  return new Intl.DateTimeFormat(getUiLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function resolveChartRange(range) {
  if (range === "1m") {
    return "1h";
  }
  return CHART_RANGE_WINDOWS[range] ? range : DEFAULT_PREFS.chartRange;
}

function init() {
  loadState();
  translateStaticContent();
  applyTheme();
  bindEvents();
  bindEnvironmentEvents();
  syncColumnToggleButtons();
  renderAll();
  startAutoRefresh();
  observeChartsPanelForLazyLoad();
  observeHeroForStickyBar();

  window.setTimeout(() => {
    if (isOffline()) {
      // Sin red al arrancar: se muestran los últimos datos guardados y la
      // fecha real de la última sincronización en lugar de forzar un error.
      setApiState("offline", t("status.offlineMeta"));
      return;
    }
    refreshAllPrices({ silentWhenEmpty: true, force: false });
  }, 140);
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sin permiso o contexto no seguro: se intenta el fallback clásico.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
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
  dom.themeToggle.addEventListener("click", toggleTheme);
  dom.portfolioNameInput.addEventListener("input", (event) => {
    savePortfolioName(event.target.value);
  });
  dom.lineRangeControl.addEventListener("click", handleChartRangeClick);

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
  dom.tableBody.addEventListener("input", handleTableInput);
  dom.tableBody.addEventListener("blur", handleTableBlur, true);
  dom.tableBody.addEventListener("focusin", handleTableFocusIn);
  dom.tableBody.addEventListener("keydown", handleTableKeyDown);
  dom.tableBody.addEventListener("mousedown", handleTableMouseDown);
  dom.tableBody.addEventListener("click", handleTableClick);

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-row-id]")) {
      closeAllSuggestions();
    }
  });

  document.querySelectorAll("[data-copy-wallet]").forEach((button) => {
    button.addEventListener("click", () => copyWalletAddress(button));
  });

  const moreActionsBtn = document.getElementById("moreActionsBtn");
  const actionsToolbar = document.getElementById("actionsToolbar");
  if (moreActionsBtn && actionsToolbar) {
    moreActionsBtn.addEventListener("click", () => {
      const open = actionsToolbar.classList.toggle("is-open");
      moreActionsBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  const columnToggles = document.getElementById("columnToggles");
  if (columnToggles) {
    columnToggles.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-col-toggle]");
      if (!btn) return;
      const col = btn.dataset.colToggle;
      if (state.hiddenColumns.has(col)) {
        state.hiddenColumns.delete(col);
        btn.classList.add("is-active");
      } else {
        state.hiddenColumns.add(col);
        btn.classList.remove("is-active");
      }
      state.prefs.hiddenColumns = [...state.hiddenColumns];
      savePreferences();
      applyColumnVisibility();
    });
  }
}

function syncColumnToggleButtons() {
  document.querySelectorAll("[data-col-toggle]").forEach((btn) => {
    btn.classList.toggle("is-active", !state.hiddenColumns.has(btn.dataset.colToggle));
  });
}

function loadState() {
  const payload = safeParse(localStorage.getItem(STORAGE_KEY));
  const prefs = safeParse(localStorage.getItem(PREFS_KEY));
  const history = safeParse(localStorage.getItem(HISTORY_KEY));

  state.rows = Array.isArray(payload?.rows) && payload.rows.length
    ? payload.rows.map((row) => createRow(row))
    : DEFAULT_ROWS.map((row) => createRow(row));

  state.activity = Array.isArray(payload?.activity) ? payload.activity.slice(0, MAX_ACTIVITY_ITEMS) : [];
  state.history = Array.isArray(history?.points) ? compactHistoryPoints(history.points) : [];
  state.prefs = {
    ...DEFAULT_PREFS,
    ...(prefs && typeof prefs === "object" ? prefs : {})
  };
  if (!TRANSLATIONS[state.prefs.language]) {
    state.prefs.language = DEFAULT_PREFS.language;
  }
  if (!AUTO_REFRESH_OPTIONS.includes(state.prefs.autoRefreshSec)) {
    state.prefs.autoRefreshSec = DEFAULT_PREFS.autoRefreshSec;
  }
  state.prefs.portfolioName = sanitizePortfolioNameInput(state.prefs.portfolioName);
  state.prefs.chartRange = resolveChartRange(state.prefs.chartRange);
  state.prefs.hiddenColumns = Array.isArray(state.prefs.hiddenColumns)
    ? state.prefs.hiddenColumns.filter((column) => TOGGLEABLE_COLUMNS.includes(column))
    : [];
  state.hiddenColumns = new Set(state.prefs.hiddenColumns);

  dom.currencySelect.value = state.prefs.currency;
  dom.autoRefreshSelect.value = String(state.prefs.autoRefreshSec);
  dom.portfolioNameInput.value = getPortfolioName();
  setDefaultMessages();

  // Los precios persistidos conservan su fecha real: la etiqueta de última
  // sincronización refleja cuándo se obtuvieron, no cuándo se abrió la app.
  const lastPersistedSync = state.rows
    .map((row) => row.lastPriceAt)
    .filter(Boolean)
    .sort()
    .pop();
  if (lastPersistedSync) {
    state.lastSyncLabel = t("status.lastSync", {
      time: formatDateTime(new Date(lastPersistedSync))
    });
  }
}

async function handleBaseCurrencyChange(nextCurrency) {
  const normalizedNextCurrency = String(nextCurrency || "").toLowerCase();
  const previousCurrency = String(state.prefs.currency || "").toLowerCase();

  if (!CURRENCY_META[normalizedNextCurrency]) {
    dom.currencySelect.value = previousCurrency || DEFAULT_PREFS.currency;
    return;
  }

  if (normalizedNextCurrency === previousCurrency) {
    dom.currencySelect.value = normalizedNextCurrency;
    return;
  }

  const currencySwitchId = ++state.currencySwitchId;

  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }

  try {
    const conversionRate = await fetchCurrencyConversionRate(previousCurrency, normalizedNextCurrency);
    if (currencySwitchId !== state.currencySwitchId) {
      return;
    }

    applyCurrencyConversionToPortfolio(previousCurrency, normalizedNextCurrency, conversionRate);
    state.prefs.currency = normalizedNextCurrency;
    dom.currencySelect.value = normalizedNextCurrency;
    savePreferences();

    updateSaveMessage(t("alerts.baseCurrencyUpdated"));
    pushActivity(
      t("alerts.baseCurrencyActivityTitle"),
      t("alerts.baseCurrencyActivityText", { currency: normalizedNextCurrency.toUpperCase() }),
      "neutral"
    );

    state.priceCache.clear();
    state.rows.forEach((row) => {
      if (row.crypto.trim()) {
        row.priceStatus = "loading";
        row.priceMessage = t("status.syncing");
      }
    });

    renderTableBody();
    renderDashboardOnly();
    scheduleAutosave();

    await refreshAllPrices({ silentWhenEmpty: true, force: true, reason: "currency-change" });
  } catch (error) {
    dom.currencySelect.value = previousCurrency || DEFAULT_PREFS.currency;
    showToast(t("alerts.refreshFailedTitle"), t("alerts.refreshFailedText"), "negative");
  } finally {
    if (currencySwitchId === state.currencySwitchId) {
      startAutoRefresh();
    }
  }
}

function createRow(partial = {}) {
  state.rowCounter += 1;

  const row = {
    id: partial.id || `row-${Date.now()}-${state.rowCounter}`,
    crypto: String(partial.crypto || ""),
    coinId: String(partial.coinId || ""),
    resolvedName: String(partial.resolvedName || ""),
    symbol: String(partial.symbol || ""),
    image: String(partial.image || ""),
    investment: sanitizeNumericInput(String(partial.investment ?? "")),
    tokens: sanitizeNumericInput(String(partial.tokens ?? "")),
    entryPrice: sanitizeNumericInput(String(partial.entryPrice ?? "")),
    tp1: sanitizeNumericInput(String(partial.tp1 ?? "")),
    tp2: sanitizeNumericInput(String(partial.tp2 ?? "")),
    tp3: sanitizeNumericInput(String(partial.tp3 ?? "")),
    currentPrice: typeof partial.currentPrice === "number" ? partial.currentPrice : null,
    priceChange24h: typeof partial.priceChange24h === "number" ? partial.priceChange24h : null,
    priceStatus: partial.priceStatus || "idle",
    priceMessage: partial.priceMessage || "",
    lastPriceAt: partial.lastPriceAt || null,
    priceHistory: compactRowPriceHistory(Array.isArray(partial.priceHistory) ? partial.priceHistory : []),
    favorite: Boolean(partial.favorite),
    pinned: Boolean(partial.pinned),
    derivedField: TRIAD_FIELDS.includes(partial.derivedField) ? partial.derivedField : "",
    detailsOpen: false,
    suggestions: [],
    suggestionsOpen: false,
    lookupNonce: 0,
    alertsFired: {
      tp1: Boolean(partial.alertsFired?.tp1),
      tp2: Boolean(partial.alertsFired?.tp2),
      tp3: Boolean(partial.alertsFired?.tp3)
    }
  };

  seedRowPriceHistory(row);
  return row;
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
  renderInsights(insights);
  renderTotalsRow(snapshot);
  renderStickyBar(snapshot);
  updateCharts(snapshot);
  renderStatusCards();
}

function applyColumnVisibility() {
  const table = dom.tableBody?.closest("table");
  if (!table) return;
  const colMap = { priority: 1, targets: 6, tpSignal: 7 };

  Object.entries(colMap).forEach(([colKey, colIndex]) => {
    const hidden = state.hiddenColumns.has(colKey);
    table.querySelectorAll(`th:nth-child(${colIndex}), td:nth-child(${colIndex})`).forEach(el => {
      el.style.display = hidden ? "none" : "";
    });
  });
}

function renderTableHead() {
  dom.tableHead.innerHTML = `
    <tr>
      ${TABLE_COLUMNS.map((column) => renderHeaderCell(column)).join("")}
    </tr>
  `;
  applyColumnVisibility();
}

function renderHeaderCell(column) {
  const isSortable = Boolean(column.sortKey);
  const isActive = state.prefs.sortBy === column.sortKey;
  const arrow = !isActive ? "" : state.prefs.sortDir === "desc" ? "&darr;" : "&uarr;";
  const label = t(column.labelKey);
  const tooltip = t(column.tooltipKey);

  return `
    <th scope="col">
      <div class="th-shell">
        ${isSortable
          ? `<button class="th-sort-btn ${isActive ? "is-active" : ""}" type="button" data-sort-key="${column.sortKey}">
              ${escapeHtml(label)} ${arrow}
            </button>`
          : `<span class="th-button">${escapeHtml(label)}</span>`}
        <span class="tooltip-dot" tabindex="0" data-tooltip="${escapeHtml(tooltip)}">i</span>
      </div>
    </th>
  `;
}

function renderTableBody() {
  const rows = getSortedRows();

  dom.tableBody.innerHTML = rows.map((row) => renderRow(row)).join("");

  if (!rows.length) {
    dom.tableBody.innerHTML = `
      <tr>
        <td colspan="${TABLE_COLUMNS.length}">
          <div class="empty-state">${escapeHtml(t("table.empty"))}</div>
        </td>
      </tr>
    `;
  }
  applyColumnVisibility();
}

function renderRow(row) {
  const metrics = computeRowMetrics(row);
  const validation = getValidationMessage(metrics);
  const tpStatus = getTpStatus(metrics);
  const rowTone = metrics.pnlUsd > 0 ? "row-profit" : metrics.pnlUsd < 0 ? "row-loss" : "";
  const rowPinned = row.pinned ? "row-pinned" : "";

  return `
    <tr class="portfolio-row ${rowTone} ${rowPinned} ${row.detailsOpen ? "is-expanded" : ""}" data-row-id="${row.id}">
      <td class="priority-cell" data-label="${escapeHtml(t("table.columns.priority"))}">
        <div class="flag-stack">
          <button
            class="flag-btn ${row.favorite ? "is-active" : ""}"
            type="button"
            data-action="toggle-favorite"
            data-row-id="${row.id}"
            aria-pressed="${row.favorite ? "true" : "false"}"
          >
            ${row.favorite ? t("buttons.favOn") : t("buttons.favOff")}
          </button>
          <button
            class="flag-btn web-btn ${row.coinId ? "is-active" : ""}"
            type="button"
            data-action="open-web"
            data-row-id="${row.id}"
            ${!row.coinId ? "disabled" : ""}
            title="${row.coinId ? "CoinGecko: " + escapeHtml(row.coinId) : ""}"
          >
            ${t("buttons.webLink")}
          </button>
        </div>
      </td>

      <td class="asset-cell" data-label="${escapeHtml(t("table.columns.asset"))}">
        <div class="asset-field">
          <div class="asset-avatar" data-role="assetAvatar">${renderAssetAvatar(row)}</div>
          <div class="field-stack">
            <input
              class="table-input asset-input"
              type="text"
              autocomplete="off"
              placeholder="${escapeHtml(t("row.assetPlaceholder"))}"
              aria-label="${escapeHtml(t("table.columns.asset"))}"
              data-row-id="${row.id}"
              data-field="crypto"
              value="${escapeHtml(row.crypto)}"
            />
            <div class="asset-meta">
              <span class="lookup-meta ${lookupToneClass(row)}" data-role="lookupMeta">
                ${renderLookupMeta(row)}
              </span>
              <span class="validation-meta ${validation.tone}" data-role="validationMeta">
                ${escapeHtml(validation.text)}
              </span>
            </div>
          </div>
          <div class="suggestions ${row.suggestionsOpen && row.suggestions.length ? "" : "hidden"}" data-role="suggestions">
            ${renderSuggestions(row)}
          </div>
        </div>
      </td>

      <td class="position-cell" data-label="${escapeHtml(t("table.columns.position"))}">
        <div class="compact-grid">
          <label class="mini-field">
            <span>${escapeHtml(t("table.fields.investment"))}</span>
            <input
              class="table-input numeric-input"
              type="text"
              inputmode="decimal"
              data-row-id="${row.id}"
              data-field="investment"
              value="${escapeHtml(row.investment)}"
              placeholder="0.00"
            />
          </label>
          <label class="mini-field">
            <span>${escapeHtml(t("table.fields.tokens"))}</span>
            <input
              class="table-input numeric-input"
              type="text"
              inputmode="decimal"
              data-row-id="${row.id}"
              data-field="tokens"
              value="${escapeHtml(row.tokens)}"
              placeholder="0.00"
            />
          </label>
          <label class="mini-field">
            <span>${escapeHtml(t("table.fields.entry"))}</span>
            <input
              class="table-input numeric-input"
              type="text"
              inputmode="decimal"
              data-row-id="${row.id}"
              data-field="entryPrice"
              value="${escapeHtml(getEntryDisplayValue(row, metrics))}"
              placeholder="${escapeHtml(t("table.fields.entryAuto"))}"
            />
          </label>
        </div>
        <div class="validation-meta info" data-role="entryMeta">
          ${escapeHtml(getAutoFieldLabel(row, metrics))}
        </div>
      </td>

      <td class="market-cell" data-label="${escapeHtml(t("table.columns.market"))}">
        <div class="market-metrics">
          <div data-role="priceCell">${renderPriceCell(row)}</div>
          <strong class="money" data-role="currentValue">${formatCurrency(metrics.currentValue)}</strong>
        </div>
      </td>

      <td class="performance-cell" data-label="${escapeHtml(t("table.columns.performance"))}">
        <div class="performance-metrics">
          <strong class="money ${toneClass(metrics.pnlUsd)}" data-role="pnlUsd">${formatSignedCurrency(metrics.pnlUsd)}</strong>
          <span class="numeric ${toneClass(metrics.pnlPct)}" data-role="pnlPct">${formatPercent(metrics.pnlPct)}</span>
          <span class="numeric ${toneClass(metrics.roiPct)}" data-role="roiPct">${escapeHtml(t("row.roi", { value: formatPercent(metrics.roiPct) }))}</span>
        </div>
      </td>

      <td class="targets-cell" data-label="${escapeHtml(t("table.columns.targets"))}">
        <div class="tp-grid">
          <label class="mini-field">
            <span>TP1</span>
            <input
              class="table-input numeric-input"
              type="text"
              inputmode="decimal"
              data-row-id="${row.id}"
              data-field="tp1"
              value="${escapeHtml(row.tp1)}"
              placeholder="0.00"
            />
          </label>
          <label class="mini-field">
            <span>TP2</span>
            <input
              class="table-input numeric-input"
              type="text"
              inputmode="decimal"
              data-row-id="${row.id}"
              data-field="tp2"
              value="${escapeHtml(row.tp2)}"
              placeholder="0.00"
            />
          </label>
          <label class="mini-field">
            <span>TP3</span>
            <input
              class="table-input numeric-input"
              type="text"
              inputmode="decimal"
              data-row-id="${row.id}"
              data-field="tp3"
              value="${escapeHtml(row.tp3)}"
              placeholder="0.00"
            />
          </label>
        </div>
      </td>

      <td class="signal-cell" data-role="tpSignal" data-label="${escapeHtml(t("table.columns.tpSignal"))}">${renderTpSignal(tpStatus)}</td>

      <td class="actions-cell" data-label="${escapeHtml(t("table.columns.actions"))}">
        <div class="action-stack">
          <button class="icon-btn" type="button" data-action="refresh-row" data-row-id="${row.id}">
            ${escapeHtml(t("buttons.refresh"))}
          </button>
          <button class="icon-btn" type="button" data-action="delete-row" data-row-id="${row.id}">
            ${escapeHtml(t("buttons.delete"))}
          </button>
        </div>
      </td>

      <td class="card-toggle-cell">
        <button
          class="details-toggle-btn"
          type="button"
          data-action="toggle-details"
          data-row-id="${row.id}"
          aria-expanded="${row.detailsOpen ? "true" : "false"}"
        >
          ${escapeHtml(row.detailsOpen ? t("row.hideDetails") : t("row.showDetails"))}
        </button>
      </td>
    </tr>
  `;
}

function renderSummary(snapshot, insights = getPortfolioInsights(snapshot)) {
  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment
    ? (totalPnl / snapshot.totals.investment) * 100
    : 0;

  const cards = [
    {
      label: t("summary.totalInvested"),
      value: formatCurrency(snapshot.totals.investment),
      detail: t("summary.loadedPositions", { count: snapshot.items.length }),
      tone: "neutral"
    },
    {
      label: t("summary.totalValue"),
      value: formatCurrency(snapshot.totals.currentValue),
      detail: t("summary.liveAssets", { count: snapshot.connectedCount }),
      tone: "neutral"
    },
    {
      label: t("summary.gainLoss"),
      value: `${formatSignedCurrency(totalPnl)} / ${formatPercent(totalPnlPct)}`,
      detail: t("summary.aggregatePnl"),
      tone: toneClass(totalPnl) || "neutral"
    },
    {
      label: t("insights.mostVolatile"),
      value: insights.mostVolatile
        ? `${assetDisplayName(insights.mostVolatile.row)} / ${formatPercent(insights.mostVolatile.historicalRangePct).replace("+", "")}`
        : t("insights.notAvailable"),
      detail: insights.mostVolatile
        ? t("insights.historicalVariationPoints", { count: insights.mostVolatile.historicalPoints })
        : t("insights.notAvailable"),
      tone: insights.mostVolatile ? "warning" : "neutral"
    }
  ];

  dom.summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card ${card.tone}">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `
    )
    .join("");
}

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

function getPortfolioInsights(snapshot) {
  const currentItems = getCurrentInsightItems(snapshot);
  const items24h = get24hInsightItems(snapshot);
  const topPerformers = getTopPerformers(snapshot, 3);
  const worstPerformers = getWorstPerformers(snapshot, 3);
  const top24h = getTop24h(snapshot, 3);
  const worst24h = getWorst24h(snapshot, 3);
  const volatilityItems = currentItems
    .map((item) => {
      const history = compactRowPriceHistory(item.row.priceHistory || []);
      if (history.length < 2) {
        return null;
      }

      const prices = history.map((point) => point.price).filter((price) => Number.isFinite(price) && price > 0);
      if (prices.length < 2) {
        return null;
      }

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const historicalRangePct = minPrice > 0 ? ((maxPrice - minPrice) / minPrice) * 100 : 0;

      return {
        ...item,
        historicalRangePct,
        historicalPoints: history.length
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
            : formatSignedCurrency(item.metrics.pnlUsd);

          return `
            <article class="insight-item">
              <div class="insight-item-main">
                <span class="insight-item-rank">${index + 1}</span>
                <div>
                  <strong>${escapeHtml(assetDisplayName(item.row))}</strong>
                  <small>${escapeHtml(formatCurrency(item.metrics.currentValue))}</small>
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
    dom.stickyBarValue.textContent = formatCurrency(snapshot.totals.currentValue);
  }
  if (dom.stickyBarPnl) {
    dom.stickyBarPnl.textContent = `${formatSignedCurrency(totalPnl)} (${formatPercent(totalPnlPct)})`;
    dom.stickyBarPnl.className = `sticky-bar-pnl ${toneClass(totalPnl)}`;
  }
}

// La barra fija aparece cuando el hero (que ya muestra el nombre) sale de pantalla.
function observeHeroForStickyBar() {
  if (!dom.stickyBar) {
    return;
  }

  const hero = document.querySelector(".hero-panel");
  if (!hero || typeof window.IntersectionObserver === "undefined") {
    return;
  }

  const io = new IntersectionObserver(([entry]) => {
    const visible = !entry.isIntersecting;
    dom.stickyBar.classList.toggle("is-visible", visible);
    dom.stickyBar.setAttribute("aria-hidden", visible ? "false" : "true");
  }, { rootMargin: "-10px 0px 0px 0px" });
  io.observe(hero);
}

function renderTotalsRow(snapshot) {
  const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
  const totalPnlPct = snapshot.totals.investment
    ? (totalPnl / snapshot.totals.investment) * 100
    : 0;

  dom.totalsFoot.innerHTML = `
    <tr class="totals-row">
      <td class="totals-label-cell">${escapeHtml(t("table.totals"))}</td>
      <td class="totals-inline-cell">${escapeHtml(t("table.assets", { count: snapshot.items.length }))}</td>
      <td class="totals-inline-cell" data-label="${escapeHtml(t("summary.totalInvested"))}">
        <span class="money">${formatCurrency(snapshot.totals.investment)}</span>
        <span class="totals-inline-meta">${escapeHtml(t("table.tokens", { count: formatNumber(snapshot.totals.tokens, 6) }))}</span>
      </td>
      <td class="totals-inline-cell money" data-label="${escapeHtml(t("summary.totalValue"))}">${formatCurrency(snapshot.totals.currentValue)}</td>
      <td class="totals-inline-cell" data-label="${escapeHtml(t("summary.gainLoss"))}">
        <span class="money ${toneClass(totalPnl)}">${formatSignedCurrency(totalPnl)}</span>
        <span class="totals-inline-meta ${toneClass(totalPnlPct)}">${formatPercent(totalPnlPct)}</span>
      </td>
      <td class="totals-tp-cell">
        <div class="totals-tp-inline">
          <span class="totals-tp-chip"><strong>TP1</strong> <span class="money">${formatCurrency(snapshot.totals.tp1)}</span></span>
          <span class="totals-tp-chip"><strong>TP2</strong> <span class="money">${formatCurrency(snapshot.totals.tp2)}</span></span>
          <span class="totals-tp-chip"><strong>TP3</strong> <span class="money">${formatCurrency(snapshot.totals.tp3)}</span></span>
        </div>
      </td>
      <td class="totals-inline-cell">${escapeHtml(t("table.favorites", { count: snapshot.favoriteCount }))}</td>
      <td class="totals-inline-cell">${escapeHtml(t("table.liveTp", { live: snapshot.connectedCount, tp: snapshot.reachedTargets }))}</td>
    </tr>
  `;
}

function renderActivity() {
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
}

function renderChartsVisibility() {
  dom.chartsPanel.classList.toggle("hidden", !state.prefs.showCharts);
  dom.toggleChartsBtn.textContent = state.prefs.showCharts ? t("buttons.hideCharts") : t("buttons.showCharts");
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

function updateLiveRowUi(rowId) {
  const row = getRowById(rowId);
  const rowElement = dom.tableBody.querySelector(`tr[data-row-id="${rowId}"]`);

  if (!row || !rowElement) {
    renderAll();
    return;
  }

  const metrics = computeRowMetrics(row);
  const validation = getValidationMessage(metrics);
  const tpStatus = getTpStatus(metrics);

  const setRole = (role, apply) => {
    const node = rowElement.querySelector(`[data-role='${role}']`);
    if (node) {
      apply(node);
    }
  };

  rowElement.className = `portfolio-row ${metrics.pnlUsd > 0 ? "row-profit" : metrics.pnlUsd < 0 ? "row-loss" : ""} ${row.pinned ? "row-pinned" : ""} ${row.detailsOpen ? "is-expanded" : ""}`;
  setRole("assetAvatar", (node) => { node.innerHTML = renderAssetAvatar(row); });
  setRole("lookupMeta", (node) => {
    node.className = `lookup-meta ${lookupToneClass(row)}`;
    node.innerHTML = renderLookupMeta(row);
  });
  setRole("validationMeta", (node) => {
    node.className = `validation-meta ${validation.tone}`;
    node.textContent = validation.text;
  });
  setRole("entryMeta", (node) => { node.textContent = getAutoFieldLabel(row, metrics); });
  const entryInput = rowElement.querySelector("input[data-field='entryPrice']");
  if (entryInput && document.activeElement !== entryInput) {
    entryInput.value = getEntryDisplayValue(row, metrics);
  }
  setRole("priceCell", (node) => { node.innerHTML = renderPriceCell(row); });
  setRole("currentValue", (node) => { node.textContent = formatCurrency(metrics.currentValue); });
  setRole("pnlUsd", (node) => {
    node.textContent = formatSignedCurrency(metrics.pnlUsd);
    node.className = `money ${toneClass(metrics.pnlUsd)}`;
  });
  setRole("pnlPct", (node) => {
    node.textContent = formatPercent(metrics.pnlPct);
    node.className = `numeric ${toneClass(metrics.pnlPct)}`;
  });
  setRole("roiPct", (node) => {
    node.textContent = t("row.roi", { value: formatPercent(metrics.roiPct) });
    node.className = `numeric ${toneClass(metrics.roiPct)}`;
  });
  setRole("tpSignal", (node) => { node.innerHTML = renderTpSignal(tpStatus); });
  setRole("suggestions", (node) => {
    node.innerHTML = renderSuggestions(row);
    node.classList.toggle("hidden", !(row.suggestionsOpen && row.suggestions.length));
  });

  // Update Web button state when coinId changes
  const webBtn = rowElement.querySelector(".web-btn");
  if (webBtn) {
    webBtn.classList.toggle("is-active", Boolean(row.coinId));
    webBtn.disabled = !row.coinId;
    webBtn.title = row.coinId ? "CoinGecko: " + row.coinId : "";
  }

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

function handleTableInput(event) {
  const input = event.target.closest("[data-field]");
  if (!input) {
    return;
  }

  const row = getRowById(input.dataset.rowId);
  if (!row) {
    return;
  }

  const field = input.dataset.field;
  if (field === "crypto") {
    const nextValue = input.value.trimStart();
    row.crypto = nextValue;
    row.coinId = "";
    row.resolvedName = "";
    row.symbol = "";
    row.image = "";
    row.currentPrice = null;
    row.priceChange24h = null;
    row.lastPriceAt = null;
    row.priceHistory = [];
    row.priceStatus = nextValue ? "loading" : "idle";
    row.priceMessage = nextValue ? "Buscando coincidencias..." : "";
    row.suggestions = [];
    row.suggestionsOpen = Boolean(nextValue);
    queueSuggestionLookup(row.id, nextValue);
    updateLiveRowUi(row.id);
  } else {
    const sanitized = sanitizeNumericInput(input.value);
    if (input.value !== sanitized) {
      input.value = sanitized;
    }
    row[field] = sanitized;
    recalcPositionTriad(row, field);
    updateLiveRowUi(row.id);
  }

  scheduleAutosave();
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

  const targetInput = dom.tableBody.querySelector(
    `input[data-row-id="${row.id}"][data-field="${target}"]`
  );
  if (targetInput && document.activeElement !== targetInput) {
    targetInput.value = row[target];
  }
}

function handleTableBlur(event) {
  const input = event.target.closest("[data-field]");
  if (!input) {
    return;
  }

  const rowId = input.dataset.rowId;
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  const field = input.dataset.field;

  if (field === "crypto") {
    row.crypto = row.crypto.trim();
    input.value = row.crypto;
    clearBlurTimer(rowId);
    const timerId = window.setTimeout(() => {
      const liveRow = getRowById(rowId);
      if (!liveRow) {
        return;
      }

      if (liveRow.crypto && !liveRow.coinId) {
        resolveBestMatchForRow(rowId);
      } else {
        liveRow.suggestionsOpen = false;
        updateLiveRowUi(rowId);
      }
    }, 140);
    state.blurTimers.set(rowId, timerId);
    return;
  }

  const normalized = normalizeNumericString(input.value);
  row[field] = normalized;
  recalcPositionTriad(row, field);
  input.value = row[field];
  updateLiveRowUi(row.id);

  // Re-sort only when focus leaves the table: re-rendering mid-Tab destroys
  // the element that was about to receive focus and breaks keyboard editing.
  const nextFocus = event.relatedTarget;
  if (state.prefs.sortBy !== "asset" && !(nextFocus && dom.tableBody.contains(nextFocus))) {
    renderTableBody();
  }
}

function handleTableFocusIn(event) {
  const input = event.target.closest("[data-field='crypto']");
  if (!input) {
    return;
  }

  const row = getRowById(input.dataset.rowId);
  if (!row) {
    return;
  }

  if (row.suggestions.length) {
    row.suggestionsOpen = true;
    updateLiveRowUi(row.id);
  }
}

function handleTableKeyDown(event) {
  if (event.key !== "Escape") {
    return;
  }

  const rowElement = event.target.closest("tr[data-row-id]");
  if (!rowElement) {
    return;
  }

  const row = getRowById(rowElement.dataset.rowId);
  if (!row) {
    return;
  }

  row.suggestionsOpen = false;
  updateLiveRowUi(row.id);
}

function handleTableMouseDown(event) {
  const button = event.target.closest("[data-action='select-suggestion']");
  if (!button) {
    return;
  }

  event.preventDefault();

  const rowId = button.dataset.rowId;
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  // Cancel any pending blur timer to prevent race condition
  clearBlurTimer(rowId);
  clearSearchTimer(rowId);

  const coin = row.suggestions.find((item) => item.id === button.dataset.coinId);
  if (!coin) {
    return;
  }

  applyCoinSelection(rowId, coin, { fetchPrice: true });
}

function handleTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const rowId = button.dataset.rowId;
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  switch (button.dataset.action) {
    case "toggle-favorite":
      row.favorite = !row.favorite;
      renderTableBody();
      renderDashboardOnly();
      scheduleAutosave();
      break;
    case "open-web":
      if (row.coinId) {
        window.open(`https://www.coingecko.com/en/coins/${encodeURIComponent(row.coinId)}`, "_blank", "noopener");
      }
      break;
    case "delete-row":
      state.rows = state.rows.filter((item) => item.id !== rowId);
      if (!state.rows.length) {
        state.rows.push(createRow());
      }
      clearTimersForRow(rowId);
      renderAll();
      scheduleAutosave();
      pushActivity(
        t("alerts.rowDeletedTitle"),
        t("alerts.rowDeletedText", { asset: assetDisplayName(row) }),
        "negative"
      );
      break;
    case "refresh-row":
      refreshSingleRow(rowId, true);
      break;
    case "toggle-details": {
      row.detailsOpen = !row.detailsOpen;
      const rowElement = dom.tableBody.querySelector(`tr[data-row-id="${rowId}"]`);
      if (rowElement) {
        rowElement.classList.toggle("is-expanded", row.detailsOpen);
      }
      button.setAttribute("aria-expanded", row.detailsOpen ? "true" : "false");
      button.textContent = row.detailsOpen ? t("row.hideDetails") : t("row.showDetails");
      break;
    }
    default:
      break;
  }
}

function handleAddRow() {
  const row = createRow();
  state.rows.push(row);
  renderAll();
  scheduleAutosave();
  pushActivity(t("alerts.newPositionTitle"), t("alerts.newPositionText"), "neutral");

  const input = dom.tableBody.querySelector(`input[data-row-id="${row.id}"][data-field="crypto"]`);
  if (input) {
    input.focus();
  }
}

function handleResetData() {
  const confirmed = window.confirm(t("alerts.resetConfirm"));
  if (!confirmed) {
    return;
  }

  state.rows = [createRow()];
  state.history = [];
  state.activity = [];
  clearAllTimers();
  persistHistory();
  persistState(true);
  renderAll();
  showToast(t("alerts.resetDoneTitle"), t("alerts.resetDoneText"), "warning");
}

function handleExportCsv() {
  const headers = [
    "crypto",
    "coinId",
    "resolvedName",
    "symbol",
    "investment",
    "tokens",
    "entryPrice",
    "tp1",
    "tp2",
    "tp3",
    "favorite",
    "pinned",
    "derivedField"
  ];

  const rows = state.rows.map((row) => [
    row.crypto,
    row.coinId,
    row.resolvedName,
    row.symbol,
    row.investment,
    row.tokens,
    row.entryPrice,
    row.tp1,
    row.tp2,
    row.tp3,
    row.favorite ? "true" : "false",
    row.pinned ? "true" : "false",
    row.derivedField || ""
  ]);

  const csv = [headers, ...rows]
    .map((line) => line.map(escapeCsvCell).join(","))
    .join("\n");

  const filename = `portfolio-${sanitizeFilenamePart(getPortfolioName())}-${formatFileDate(new Date())}.csv`;
  downloadTextFile(filename, csv, "text/csv;charset=utf-8");
  pushActivity(t("alerts.exportTitle"), t("alerts.exportText"), "neutral");
}

function sanitizePdfText(value) {
  return String(value ?? "")
    .replace(/€/g, "EUR ")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFileDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function drawPdfKpiCard(doc, x, y, width, height, label, value, color) {
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, width, height, 2.5, 2.5, "FD");

  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(sanitizePdfText(label), x + width / 2, y + 5.5, { align: "center" });

  doc.setTextColor(color[0], color[1], color[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(sanitizePdfText(value), x + width / 2, y + 13, { align: "center" });
}

function drawPdfFooter(doc, pageWidth, pageHeight, margin, pageNum) {
  const footerY = pageHeight - 8;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(sanitizePdfText(t("pdf.footer")), margin, footerY);
  doc.text(String(pageNum), pageWidth / 2, footerY, { align: "center" });
  doc.setFontSize(5.5);
  doc.text("ETH: 0x6Cb6eEC878C4bBF3eb464A597596cD6e8cF11B92", pageWidth - margin, footerY, { align: "right" });
}

function drawPdfGradientLine(doc, x, y, width) {
  const steps = 40;
  const stepW = width / steps;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(15 + (34 - 15) * ratio);
    const g = Math.round(23 + (211 - 23) * ratio);
    const b = Math.round(42 + (238 - 42) * ratio);
    doc.setFillColor(r, g, b);
    doc.rect(x + i * stepW, y, stepW + 0.3, 1.2, "F");
  }
}

function getChartRangeLabel(range) {
  const labels = {
    "1h": t("charts.range1h"),
    "1d": t("charts.range1d"),
    "1w": t("charts.range1w"),
    "1mo": t("charts.range1mo"),
    "6mo": t("charts.range6mo"),
    "1y": t("charts.range1y"),
    total: t("charts.rangeTotal")
  };

  return labels[resolveChartRange(range)] || labels.total;
}

function buildPdfPieChartImage(snapshot) {
  if (typeof Chart === "undefined") return null;
  const meaningfulItems = snapshot.items.filter(
    (item) => item.metrics.currentValue > 0 || item.metrics.investment > 0
  );
  if (!meaningfulItems.length) return null;

  const sorted = [...meaningfulItems].sort((a, b) =>
    (b.metrics.currentValue || b.metrics.investment) - (a.metrics.currentValue || a.metrics.investment)
  );
  const top = sorted.slice(0, 8);
  const othersValue = sorted.slice(8).reduce((s, i) => s + (i.metrics.currentValue || i.metrics.investment), 0);

  const labels = top.map(i => sanitizePdfText(assetDisplayName(i.row)));
  const data = top.map(i => i.metrics.currentValue || i.metrics.investment);
  if (othersValue > 0) {
    labels.push(sanitizePdfText(t("charts.others")));
    data.push(othersValue);
  }

  const colors = ["#0ea5e9","#22d3ee","#a78bfa","#f472b6","#fb923c","#facc15","#4ade80","#f87171","#94a3b8"];

  const canvas = document.createElement("canvas");
  canvas.width = 440;
  canvas.height = 440;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const chart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, data.length), borderWidth: 2, borderColor: "#ffffff" }] },
    options: {
      animation: false, responsive: false, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "bottom", labels: { font: { size: 11 }, color: "#334155", padding: 8 } },
        tooltip: { enabled: false }
      },
      layout: { padding: 10 }
    }
  });
  chart.update("none");
  const image = canvas.toDataURL("image/png", 1);
  chart.destroy();
  return image;
}

let pdfBuilding = false;
async function handleDownloadPdf() {
  if (pdfBuilding) return;
  const snapshot = buildSnapshot();
  const meaningfulItems = snapshot.items.filter(
    (item) => item.metrics.investment > 0 || item.metrics.currentValue > 0 || item.metrics.tokens > 0
  );

  if (!meaningfulItems.length) {
    showToast(t("pdf.noDataTitle"), t("pdf.noDataText"), "warning");
    return;
  }

  pdfBuilding = true;
  setLoader(true, t("loader.syncMarket"));
  let jsPdfApi;
  try {
    jsPdfApi = await ensureJsPdf();
  } catch {
    jsPdfApi = null;
  }
  if (!jsPdfApi) {
    pdfBuilding = false;
    setLoader(false);
    showToast(t("pdf.exportErrorTitle"), t("pdf.exportErrorText"), "negative");
    return;
  }

  // El gráfico de distribución es opcional: si Chart.js no carga, el PDF sale sin él.
  let pieImage = null;
  try {
    await ensureChartJs();
    pieImage = buildPdfPieChartImage(snapshot);
  } catch {
    pieImage = null;
  }

  try {
    const doc = new jsPdfApi({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const now = new Date();
    const portfolioName = getPortfolioName();
    const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
    const totalReturn = snapshot.totals.investment
      ? (totalPnl / snapshot.totals.investment) * 100
      : 0;
    const weightBase = snapshot.totals.currentValue > 0 ? snapshot.totals.currentValue : snapshot.totals.investment;
    const pdfRows = [...meaningfulItems]
      .sort((a, b) => {
        const valueA = a.metrics.currentValue || a.metrics.investment;
        const valueB = b.metrics.currentValue || b.metrics.investment;
        return valueB - valueA;
      });
    const generatedAt = formatGeneratedDate(now);
    let pageNum = 1;

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    /* ── HEADER ── */
    let y = 16;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(16);
    doc.text("Crypto Portfolio Pro", margin, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(`${t("pdf.generatedAt", { date: generatedAt })}  |  ${portfolioName}`),
      pageWidth - margin, y, { align: "right" }
    );

    y += 3;
    drawPdfGradientLine(doc, margin, y, contentWidth);
    y += 6;

    /* ── KPI CARDS (3 columns x 2 rows) ── */
    const bestAsset = snapshot.bestAsset;
    const worstAsset = snapshot.worstAsset;
    const bestAssetLabel = bestAsset
      ? `${sanitizePdfText(assetDisplayName(bestAsset.row))} ${formatPercent(bestAsset.metrics.pnlPct)}`
      : "--";
    const worstAssetLabel = worstAsset
      ? `${sanitizePdfText(assetDisplayName(worstAsset.row))} ${formatPercent(worstAsset.metrics.pnlPct)}`
      : "--";
    const pnlColor = totalPnl > 0 ? [22, 101, 52] : totalPnl < 0 ? [153, 27, 27] : [15, 23, 42];
    const worstColor = worstAsset && worstAsset.metrics.pnlPct < 0 ? [153, 27, 27] : [15, 23, 42];
    const cardGap = 3;
    const cardCols = 3;
    const cardWidth = (contentWidth - cardGap * (cardCols - 1)) / cardCols;
    const cardHeight = 17;

    const cards = [
      { label: t("pdf.totalInvestment"), value: formatCurrency(snapshot.totals.investment), color: [15, 23, 42] },
      { label: t("pdf.totalValue"), value: formatCurrency(snapshot.totals.currentValue), color: [15, 23, 42] },
      { label: t("pdf.totalReturn"), value: `${formatSignedCurrency(totalPnl)} (${formatPercent(totalReturn)})`, color: pnlColor },
      { label: t("pdf.bestAsset") || "Best", value: bestAssetLabel, color: [22, 101, 52] },
      { label: t("pdf.worstAsset") || "Worst", value: worstAssetLabel, color: worstColor },
      { label: t("pdf.assetCount"), value: String(meaningfulItems.length), color: [15, 23, 42] }
    ];

    cards.forEach((card, index) => {
      const col = index % cardCols;
      const row = Math.floor(index / cardCols);
      const x = margin + col * (cardWidth + cardGap);
      const cardY = y + row * (cardHeight + cardGap);
      drawPdfKpiCard(doc, x, cardY, cardWidth, cardHeight, card.label, card.value, card.color);
    });

    y += (cardHeight + cardGap) * 2 + 3;

    /* ── PIE CHART INLINE (next to a small summary) ── */
    if (pieImage) {
      const chartSize = 52;
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, contentWidth, chartSize + 6, 3, 3, "FD");

      const pieTitle = sanitizePdfText(t("charts.portfolioDistribution"));
      const topItems = pdfRows.slice(0, 6);
      const infoLines = topItems.map((item) => {
        const weight = weightBase > 0 ? (item.metrics.currentValue / weightBase) * 100 : 0;
        return `${sanitizePdfText(assetDisplayName(item.row))}: ${formatCurrency(item.metrics.currentValue)} (${weight.toFixed(1)}%)`;
      });
      if (pdfRows.length > 6) {
        infoLines.push(`+ ${pdfRows.length - 6} more...`);
      }

      // Mide el bloque (dona + desglose) para centrarlo en la tarjeta.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const titleWidth = doc.getTextWidth(pieTitle);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const infoWidth = Math.max(titleWidth, ...infoLines.map((line) => doc.getTextWidth(line)));
      const groupWidth = chartSize + 10 + infoWidth;
      const startX = margin + Math.max(3, (contentWidth - groupWidth) / 2);

      doc.addImage(pieImage, "PNG", startX, y + 3, chartSize, chartSize, undefined, "FAST");

      const infoX = startX + chartSize + 10;
      let infoY = y + 8;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      doc.text(pieTitle, infoX, infoY);

      infoY += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      infoLines.forEach((line) => {
        doc.text(line, infoX, infoY);
        infoY += 4.5;
      });

      y += chartSize + 10;
    }

    /* ── TABLE HEADER ── */
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10);
    doc.text(sanitizePdfText(t("pdf.positionsTable")), margin, y);
    y += 4;

    /* ── TABLE ── */
    const bodyRows = pdfRows.map((item) => {
      const weight = weightBase > 0 ? (item.metrics.currentValue / weightBase) * 100 : 0;
      return [
        sanitizePdfText(assetDisplayName(item.row) || "--"),
        sanitizePdfText(formatCurrency(item.metrics.investment)),
        sanitizePdfText(formatNumber(item.metrics.tokens, item.metrics.tokens >= 1 ? 4 : 8)),
        sanitizePdfText(
          item.metrics.entryPrice > 0
            ? formatCurrency(item.metrics.entryPrice, getPriceDigits(item.metrics.entryPrice))
            : "--"
        ),
        sanitizePdfText(
          item.metrics.currentPrice > 0
            ? formatCurrency(item.metrics.currentPrice, getPriceDigits(item.metrics.currentPrice))
            : "--"
        ),
        sanitizePdfText(formatSignedCurrency(item.metrics.pnlUsd)),
        sanitizePdfText(formatPercent(item.metrics.pnlPct)),
        sanitizePdfText(formatPercent(weight).replace("+", ""))
      ];
    });

    const totalsRow = [
      sanitizePdfText(t("table.totals")),
      sanitizePdfText(formatCurrency(snapshot.totals.investment)),
      "",
      "",
      "",
      sanitizePdfText(formatSignedCurrency(totalPnl)),
      sanitizePdfText(formatPercent(totalReturn)),
      "100%"
    ];

    doc.autoTable({
      startY: y,
      margin: { top: 30, right: margin, bottom: 18, left: margin },
      theme: "plain",
      showHead: "everyPage",
      styles: {
        font: "helvetica",
        fontSize: 7,
        textColor: [15, 23, 42],
        cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
        overflow: "linebreak",
        lineColor: [226, 232, 240],
        lineWidth: 0
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "center",
        lineWidth: 0
      },
      alternateRowStyles: {
        fillColor: [248, 249, 250]
      },
      columnStyles: {
        // La columna de activo queda en auto para absorber el ancho restante;
        // con las 8 columnas fijas autotable avisaba "width could not fit page".
        0: { halign: "left", fontStyle: "bold" },
        1: { cellWidth: 22, halign: "right" },
        2: { cellWidth: 18, halign: "right" },
        3: { cellWidth: 22, halign: "right" },
        4: { cellWidth: 22, halign: "right" },
        5: { cellWidth: 24, halign: "right" },
        6: { cellWidth: 20, halign: "right" },
        7: { cellWidth: 16, halign: "right" }
      },
      head: [[
        sanitizePdfText(t("pdf.asset")),
        sanitizePdfText(t("pdf.investment")),
        sanitizePdfText(t("pdf.amount")),
        sanitizePdfText(t("pdf.avgEntryPrice")),
        sanitizePdfText(t("pdf.currentPrice")),
        "PnL",
        "%",
        sanitizePdfText(t("pdf.weight"))
      ]],
      body: [...bodyRows, totalsRow],
      didParseCell: (data) => {
        if (data.section === "body") {
          const isLastRow = data.row.index === bodyRows.length;

          if (isLastRow) {
            data.cell.styles.fillColor = [15, 23, 42];
            data.cell.styles.textColor = [255, 255, 255];
            data.cell.styles.fontStyle = "bold";
          } else {
            if (data.column.index === 5 || data.column.index === 6) {
              const rowMetrics = pdfRows[data.row.index]?.metrics;
              if (rowMetrics) {
                if (rowMetrics.pnlUsd > 0) {
                  data.cell.styles.textColor = [22, 101, 52];
                } else if (rowMetrics.pnlUsd < 0) {
                  data.cell.styles.textColor = [153, 27, 27];
                }
              }
            }
          }

          if (!isLastRow) {
            data.cell.styles.lineWidth = { bottom: 0.15, top: 0, left: 0, right: 0 };
            data.cell.styles.lineColor = [226, 232, 240];
          }
        }
      },
      didDrawPage: () => {
        doc.setFillColor(255, 255, 255);

        if (doc.internal.getCurrentPageInfo().pageNumber > 1) {
          let hy = 14;
          doc.setFont("helvetica", "bold");
          doc.setTextColor(15, 23, 42);
          doc.setFontSize(10);
          doc.text("Crypto Portfolio Pro", margin, hy);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          doc.text(sanitizePdfText(portfolioName), pageWidth - margin, hy, { align: "right" });
          hy += 2.5;
          drawPdfGradientLine(doc, margin, hy, contentWidth);
        }

        pageNum++;
        drawPdfFooter(doc, pageWidth, pageHeight, margin, doc.internal.getCurrentPageInfo().pageNumber);
      }
    });

    drawPdfFooter(doc, pageWidth, pageHeight, margin, 1);

    doc.save(`portfolio-resumen-${sanitizeFilenamePart(portfolioName)}-${formatFileDate(now)}.pdf`);
  } catch (error) {
    showToast(t("pdf.exportErrorTitle"), t("pdf.exportErrorText"), "negative");
  } finally {
    pdfBuilding = false;
    setLoader(false);
  }
}

async function handleImportCsv(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const records = parseCsv(text);
    if (!records.length) {
      throw new Error(t("alerts.importFailedText"));
    }

    state.rows = records.map((record) => createRow({
      crypto: record.crypto || record.symbol || "",
      coinId: record.coinId || "",
      resolvedName: record.resolvedName || "",
      symbol: record.symbol || "",
      investment: record.investment || "",
      tokens: record.tokens || "",
      entryPrice: record.entryPrice || "",
      tp1: record.tp1 || "",
      tp2: record.tp2 || "",
      tp3: record.tp3 || "",
      favorite: record.favorite === "true",
      pinned: record.pinned === "true",
      derivedField: record.derivedField || ""
    }));

    renderAll();
    scheduleAutosave();
    pushActivity(
      t("alerts.importTitle"),
      t("alerts.importText", { count: state.rows.length, file: file.name }),
      "positive"
    );
    showToast(t("alerts.importDoneTitle"), t("alerts.importDoneText", { count: state.rows.length }), "positive");
    await refreshAllPrices({ silentWhenEmpty: true, force: true, reason: "import" });
  } catch (error) {
    showToast(t("alerts.importFailedTitle"), error.message || t("alerts.importFailedText"), "negative");
  }
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

function toggleTheme() {
  state.prefs.theme = state.prefs.theme === "dark" ? "light" : "dark";
  applyTheme();
  savePreferences();
  renderDashboardOnly();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.prefs.theme;
  dom.themeToggle.textContent = state.prefs.theme === "dark" ? t("theme.light") : t("theme.dark");

  // Mantiene el color del marco del navegador/PWA alineado con el tema activo.
  const themeColor = THEME_COLORS[state.prefs.theme] || THEME_COLORS.dark;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", themeColor);
  });
}

function isAutoRefreshAllowed() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }

  if (!state.prefs.autoRefreshSec) {
    return;
  }

  state.autoRefreshTimer = window.setInterval(() => {
    if (!isAutoRefreshAllowed()) return;
    refreshAllPrices({ silentWhenEmpty: true, force: false, reason: "auto" });
  }, state.prefs.autoRefreshSec * 1000);
}

function bindEnvironmentEvents() {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.prefs.autoRefreshSec) {
        // Refresh once on resume so the user doesn't stare at stale prices.
        refreshAllPrices({ silentWhenEmpty: true, force: false, reason: "auto" });
      }
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      setApiState("connected", t("status.lastSyncLong", { time: formatClock(new Date()) }));
      // Al recuperar conexión se sincroniza siempre una vez, con force para
      // saltar la caché y no seguir mostrando los precios de la sesión offline.
      refreshAllPrices({ silentWhenEmpty: true, force: true, reason: "auto" });
    });
    window.addEventListener("offline", () => {
      setApiState("offline", t("status.offlineMeta"));
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

function queueSuggestionLookup(rowId, query) {
  clearSearchTimer(rowId);
  if (!query.trim()) {
    return;
  }

  const timerId = window.setTimeout(() => {
    fetchRowSuggestions(rowId, query);
  }, SEARCH_DELAY);

  state.searchTimers.set(rowId, timerId);
}

function clearSearchTimer(rowId) {
  const timerId = state.searchTimers.get(rowId);
  if (timerId) {
    window.clearTimeout(timerId);
    state.searchTimers.delete(rowId);
  }
}

function clearBlurTimer(rowId) {
  const timerId = state.blurTimers.get(rowId);
  if (timerId) {
    window.clearTimeout(timerId);
    state.blurTimers.delete(rowId);
  }
}

function clearTimersForRow(rowId) {
  clearSearchTimer(rowId);
  clearBlurTimer(rowId);
}

function clearAllTimers() {
  state.searchTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.blurTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.searchTimers.clear();
  state.blurTimers.clear();
}

async function fetchRowSuggestions(rowId, query) {
  clearSearchTimer(rowId);
  const row = getRowById(rowId);
  if (!row || normalizeSearchText(row.crypto) !== normalizeSearchText(query)) {
    return;
  }

  const nonce = Date.now() + Math.random();
  row.lookupNonce = nonce;
  row.priceStatus = "loading";
  row.priceMessage = t("row.searching");
  updateLiveRowUi(row.id);

  try {
    const coins = await searchCoins(query);
    const liveRow = getRowById(rowId);
    if (!liveRow || liveRow.lookupNonce !== nonce) {
      return;
    }

    liveRow.suggestions = coins.slice(0, 6);
    liveRow.suggestionsOpen = liveRow.suggestions.length > 0;
    if (!coins.length) {
      liveRow.priceStatus = "not_found";
      liveRow.priceMessage = t("row.noMatches");
    } else {
      liveRow.priceStatus = "idle";
      liveRow.priceMessage = "";
    }

    updateLiveRowUi(rowId);
  } catch (error) {
    const liveRow = getRowById(rowId);
    if (!liveRow || liveRow.lookupNonce !== nonce) {
      return;
    }

    liveRow.suggestions = [];
    liveRow.suggestionsOpen = false;
    liveRow.priceStatus = "error";
    liveRow.priceMessage = t("status.apiError");
    updateLiveRowUi(rowId);
  }
}

async function resolveBestMatchForRow(rowId) {
  const row = getRowById(rowId);
  if (!row || !row.crypto.trim()) {
    return;
  }

  // Already resolved (e.g. user picked from suggestions)
  if (row.coinId) {
    return;
  }

  try {
    const coins = row.suggestions.length ? row.suggestions : await searchCoins(row.crypto);
    const best = chooseBestCoinMatch(row.crypto, coins);

    if (!best) {
      row.priceStatus = "not_found";
      row.priceMessage = t("row.notFound");
      row.suggestionsOpen = false;
      updateLiveRowUi(row.id);
      return;
    }

    await applyCoinSelection(rowId, best, { fetchPrice: true });
  } catch (error) {
    row.priceStatus = "error";
    row.priceMessage = t("status.apiError");
    row.suggestionsOpen = false;
    updateLiveRowUi(row.id);
  }
}

async function applyCoinSelection(rowId, coin, options = {}) {
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  row.coinId = coin.id;
  row.resolvedName = coin.name;
  row.symbol = String(coin.symbol || "").toUpperCase();
  row.crypto = row.symbol || coin.name;
  row.image = coin.thumb || coin.image || row.image || "";
  row.suggestions = [];
  row.suggestionsOpen = false;
  row.priceStatus = "loading";
  row.priceMessage = t("row.querying");
  updateLiveRowUi(rowId);

  const input = dom.tableBody.querySelector(`input[data-row-id="${rowId}"][data-field="crypto"]`);
  if (input) {
    input.value = row.crypto;
  }

  if (options.fetchPrice) {
    await refreshSingleRow(rowId, false);
  }

  scheduleAutosave();
}

async function refreshSingleRow(rowId, force) {
  const row = getRowById(rowId);
  if (!row) {
    return;
  }

  if (!row.coinId && row.crypto.trim()) {
    await resolveBestMatchForRow(rowId);
    return;
  }

  if (!row.coinId) {
    return;
  }

  if (isOffline()) {
    setApiState("offline", t("status.offlineMeta"));
    showToast(t("alerts.offlineTitle"), t("alerts.offlineText"), "warning");
    return;
  }

  try {
    setLoader(true, `${t("buttons.refresh")} ${assetDisplayName(row)}...`);
    setApiState("syncing", `${t("row.querying")} ${assetDisplayName(row)} / CoinGecko`);
    const marketMap = await fetchMarketData([row.coinId], { force });
    const market = marketMap.get(row.coinId);
    if (!market) {
      throw new Error(t("row.noPrice"));
    }

    const previousPrice = row.currentPrice;
    applyMarketDataToRow(row, market);
    maybeFireTpAlerts(row, previousPrice);
    updateLiveRowUi(rowId);
    if (market.__fromCache) {
      // El service worker sirvió datos cacheados: no se registra histórico
      // nuevo ni se presenta la respuesta como sincronización en tiempo real.
      persistState(false);
      setApiState("offline", t("status.offlineMeta"));
    } else {
      appendPortfolioHistory();
      persistState(false);
      setApiState("connected", t("status.lastSyncLong", { time: formatClock(new Date()) }));
    }
  } catch (error) {
    row.priceStatus = "error";
    row.priceMessage = t("status.apiError");
    updateLiveRowUi(rowId);
    setApiState("error", t("status.apiError"));
  } finally {
    setLoader(false);
  }
}

async function refreshAllPrices({ silentWhenEmpty = false, force = false, reason = "manual" } = {}) {
  // Prevent overlapping refresh calls
  if (state.syncing && reason === "auto") {
    return;
  }

  if (isOffline()) {
    setApiState("offline", t("status.offlineMeta"));
    if (reason === "manual") {
      showToast(t("alerts.offlineTitle"), t("alerts.offlineText"), "warning");
    }
    return;
  }

  const refreshRequestId = ++state.refreshRequestId;

  const actionableRows = state.rows.filter((row) => row.coinId || row.crypto.trim());

  if (!actionableRows.length) {
    if (!silentWhenEmpty) {
      showToast(t("alerts.noAssetsTitle"), t("alerts.noAssetsText"), "warning");
    }
    return;
  }

  state.syncing = true;
  setLoader(true, t("loader.syncMarket"));
  setApiState("syncing", t("alerts.refreshAll", { count: actionableRows.length }));

  actionableRows.forEach((row) => {
    if (row.crypto.trim()) {
      row.priceStatus = "loading";
      row.priceMessage = t("status.syncing");
    }
  });
  renderTableBody();

  try {
    const unresolvedRows = actionableRows.filter((row) => !row.coinId && row.crypto.trim());
    const resolved = await Promise.all(
      unresolvedRows.map(async (row) => ({
        rowId: row.id,
        coin: chooseBestCoinMatch(row.crypto, await searchCoins(row.crypto))
      }))
    );
    if (refreshRequestId !== state.refreshRequestId) {
      return;
    }

    resolved.forEach(({ rowId, coin }) => {
      const row = getRowById(rowId);
      if (!row) {
        return;
      }

      if (!coin) {
        row.priceStatus = "not_found";
        row.priceMessage = t("row.notFound");
        row.currentPrice = null;
        row.priceChange24h = null;
        return;
      }

      row.coinId = coin.id;
      row.resolvedName = coin.name;
      row.symbol = String(coin.symbol || "").toUpperCase();
      row.image = coin.thumb || coin.image || row.image;
      row.crypto = row.symbol || coin.name;
    });

    const ids = [...new Set(state.rows.map((row) => row.coinId).filter(Boolean))];
    const marketMap = await fetchMarketData(ids, { force });
    if (refreshRequestId !== state.refreshRequestId) {
      return;
    }

    state.rows.forEach((row) => {
      if (!row.coinId) {
        return;
      }

      const market = marketMap.get(row.coinId);
      if (!market) {
        row.currentPrice = null;
        row.priceChange24h = null;
        row.priceStatus = "error";
        row.priceMessage = t("row.noPrice");
        return;
      }

      const previousPrice = row.currentPrice;
      applyMarketDataToRow(row, market);
      maybeFireTpAlerts(row, previousPrice);
    });

    const servedFromCache = [...marketMap.values()].some((market) => market && market.__fromCache);

    if (!servedFromCache) {
      appendPortfolioHistory();
    }
    renderAll();
    persistState(false);

    if (servedFromCache) {
      // Datos entregados por la caché del service worker (red caída aunque
      // navigator.onLine diga lo contrario): se etiquetan como sin conexión.
      setApiState("offline", t("status.offlineMeta"));
      if (reason === "manual") {
        showToast(t("alerts.offlineTitle"), t("alerts.offlineText"), "warning");
      }
    } else {
      setApiState("connected", t("status.lastSyncLong", { time: formatClock(new Date()) }));
      if (reason === "manual") {
        pushActivity(t("alerts.priceUpdatedTitle"), t("alerts.priceUpdatedText"), "positive");
      }
    }
  } catch (error) {
    if (refreshRequestId !== state.refreshRequestId) {
      return;
    }

    state.rows.forEach((row) => {
      if (row.priceStatus === "loading") {
        row.priceStatus = "error";
        row.priceMessage = t("status.apiError");
      }
    });
    renderAll();
    setApiState("error", t("status.apiError"));
    if (reason === "manual") {
      showToast(t("alerts.refreshFailedTitle"), t("alerts.refreshFailedText"), "negative");
    }
  } finally {
    if (refreshRequestId === state.refreshRequestId) {
      state.syncing = false;
      setLoader(false);
    }
  }
}

function applyMarketDataToRow(row, market) {
  row.currentPrice = typeof market.current_price === "number" ? market.current_price : null;
  row.priceChange24h =
    typeof market.price_change_percentage_24h === "number"
      ? market.price_change_percentage_24h
      : null;
  row.image = market.image || row.image;
  row.symbol = String(market.symbol || row.symbol || "").toUpperCase();
  row.resolvedName = market.name || row.resolvedName;
  row.priceStatus = row.currentPrice !== null ? "success" : "error";
  row.priceMessage = row.currentPrice !== null ? "" : t("row.noPrice");
  if (market.__fromCache) {
    // Precio cacheado: se conserva la fecha original de la sincronización
    // para no presentarlo como precio en tiempo real.
    row.lastPriceAt = row.lastPriceAt || null;
  } else {
    row.lastPriceAt = new Date().toISOString();
    appendRowPriceHistory(row);
  }
  row.suggestions = [];
  row.suggestionsOpen = false;
}

function maybeFireTpAlerts(row, previousPrice) {
  const currentPrice = typeof row.currentPrice === "number" ? row.currentPrice : 0;
  const previous = typeof previousPrice === "number" ? previousPrice : 0;
  const targets = [
    { key: "tp1", label: "TP1", value: parseDecimal(row.tp1) },
    { key: "tp2", label: "TP2", value: parseDecimal(row.tp2) },
    { key: "tp3", label: "TP3", value: parseDecimal(row.tp3) }
  ].filter((target) => target.value > 0);

  targets.forEach((target) => {
    if (row.alertsFired[target.key]) {
      return;
    }

    if (currentPrice >= target.value && previous < target.value) {
      row.alertsFired[target.key] = true;
      const asset = assetDisplayName(row);
      const body = t("alerts.targetHitText", {
        asset,
        target: target.label,
        value: formatCurrency(target.value)
      });
      showToast(t("alerts.targetHitTitle"), body, "positive");
      pushActivity(t("alerts.targetHitActivity"), body, "positive");
    }
  });
}

async function searchCoins(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  const cached = state.searchCache.get(normalized);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return cached.value;
  }

  const url = `${COINGECKO_BASE}search?query=${encodeURIComponent(query.trim())}`;
  const payload = await fetchJson(url);
  const coins = Array.isArray(payload.coins) ? payload.coins : [];
  const normalizedCoins = coins.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    thumb: coin.thumb,
    market_cap_rank: coin.market_cap_rank
  }));

  state.searchCache.set(normalized, { at: Date.now(), value: normalizedCoins });
  return normalizedCoins;
}

function chooseBestCoinMatch(query, coins) {
  if (!Array.isArray(coins) || !coins.length) {
    return null;
  }

  const normalizedQuery = normalizeSearchText(query);
  const byMarketCap = (a, b) => {
    const rankA = Number.isFinite(a.market_cap_rank) ? a.market_cap_rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.market_cap_rank) ? b.market_cap_rank : Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  };

  // CoinGecko returns many low-rank memecoins that hijack popular symbols
  // (e.g., a coin with symbol "ETHEREUM" or name "Solana" colliding with the
  // real chain). Pool all exact matches across symbol/name/id and pick the
  // one with the best market_cap_rank.
  const exactMatches = coins.filter((coin) =>
    normalizeSearchText(coin.symbol) === normalizedQuery ||
    normalizeSearchText(coin.name) === normalizedQuery ||
    normalizeSearchText(coin.id) === normalizedQuery
  );
  if (exactMatches.length) {
    return [...exactMatches].sort(byMarketCap)[0];
  }

  const startsWithName = coins.find((coin) =>
    normalizeSearchText(coin.name).startsWith(normalizedQuery)
  );
  if (startsWithName) {
    return startsWithName;
  }

  const startsWithSymbol = coins.find((coin) =>
    normalizeSearchText(coin.symbol).startsWith(normalizedQuery)
  );
  if (startsWithSymbol) {
    return startsWithSymbol;
  }

  return [...coins].sort((a, b) => {
    const rankA = Number.isFinite(a.market_cap_rank) ? a.market_cap_rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.market_cap_rank) ? b.market_cap_rank : Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  })[0];
}

async function fetchMarketData(ids, { force = false } = {}) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const currency = state.prefs.currency;
  const results = new Map();
  const staleIds = [];

  uniqueIds.forEach((id) => {
    const cacheKey = `${currency}:${id}`;
    const cached = state.priceCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < PRICE_CACHE_TTL) {
      results.set(id, cached.value);
    } else {
      staleIds.push(id);
    }
  });

  if (staleIds.length) {
    const url = `${COINGECKO_BASE}coins/markets?vs_currency=${encodeURIComponent(currency)}&ids=${encodeURIComponent(staleIds.join(","))}&sparkline=false&price_change_percentage=24h&per_page=250`;
    const payload = await fetchJson(url);
    const rows = Array.isArray(payload) ? payload : [];
    const fromSwCache = Boolean(payload?.__swFallback);

    rows.forEach((item) => {
      if (fromSwCache) {
        // Respuesta de la caché del SW: se marca y no se guarda con sello
        // fresco en priceCache, para reintentar en cuanto haya red.
        item.__fromCache = true;
      } else {
        const cacheKey = `${currency}:${item.id}`;
        state.priceCache.set(cacheKey, { at: Date.now(), value: item });
      }
      results.set(item.id, item);
    });
  }

  return results;
}

async function fetchJsonDirect(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    // El service worker marca con este header las respuestas rescatadas de su
    // caché cuando la red falla; el flag permite no tratarlas como frescas.
    if (response.headers.get("X-SW-Fallback") === "1" && data && typeof data === "object") {
      try {
        Object.defineProperty(data, "__swFallback", { value: true });
      } catch {
        // Payload no extensible: se ignora y se trata como respuesta normal.
      }
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJson(url) {
  // Deduplicate identical in-flight requests
  const cacheKey = url + "|" + state.prefs.currency;
  if (state.pendingFetches.has(cacheKey)) {
    return state.pendingFetches.get(cacheKey);
  }

  const promise = fetchJsonWithRetry(url);
  state.pendingFetches.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    state.pendingFetches.delete(cacheKey);
  }
}

// FIFO queue + sliding-window rate limiter. Each acquire() resolves once
// the call is allowed under both: (a) RATE_LIMIT_MAX_CALLS per minute,
// (b) min gap between back-to-back calls. Cooperates with backoff below.
const rateLimiter = (() => {
  const recent = [];
  const queue = [];
  let lastCallAt = 0;
  let pumping = false;

  function nextDelay() {
    const now = Date.now();
    while (recent.length && now - recent[0] >= RATE_LIMIT_WINDOW_MS) {
      recent.shift();
    }
    const gapWait = Math.max(0, RATE_LIMIT_MIN_GAP_MS - (now - lastCallAt));
    if (recent.length < RATE_LIMIT_MAX_CALLS) {
      return gapWait;
    }
    return Math.max(gapWait, RATE_LIMIT_WINDOW_MS - (now - recent[0]) + 5);
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const wait = nextDelay();
      if (wait > 0) {
        await new Promise((r) => window.setTimeout(r, wait));
        continue;
      }
      const resolve = queue.shift();
      const stamp = Date.now();
      recent.push(stamp);
      lastCallAt = stamp;
      resolve();
    }
    pumping = false;
  }

  return {
    acquire() {
      return new Promise((resolve) => {
        queue.push(resolve);
        pump();
      });
    },
    penalty(ms) {
      // Defer the next allowed slot by `ms`. We push lastCallAt forward
      // (not recent[]) so the sliding window self-clears normally — pushing
      // a future timestamp into recent[] would poison the window since
      // `now - future` is never >= RATE_LIMIT_WINDOW_MS until the stamp ages.
      const wait = Math.max(0, ms);
      lastCallAt = Math.max(lastCallAt, Date.now() + wait);
    }
  };
})();

// Sin proxy CORS: api.coingecko.com sirve cabeceras CORS correctas y los
// proxies públicos gratuitos (corsproxy.io, allorigins...) están caídos o
// bloqueados (403/500). Cada intento contra un proxy muerto quemaba un hueco
// del rate limiter y retrasaba el reintento útil.
async function fetchJsonWithRetry(url) {
  let lastError;
  let backoff = BACKOFF_BASE_MS;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rateLimiter.acquire();
    try {
      return await fetchJsonDirect(url, FETCH_TIMEOUT);
    } catch (err) {
      lastError = err;
      const status = Number((/HTTP\s+(\d+)/.exec(err?.message || ""))?.[1]);
      if (status === 429 || status === 418) {
        // Rate limit: backoff exponencial con jitter y se reintenta.
        const jitter = Math.floor(Math.random() * 400);
        const wait = Math.min(BACKOFF_MAX_MS, backoff) + jitter;
        rateLimiter.penalty(wait);
        await new Promise((r) => window.setTimeout(r, wait));
        backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
      } else if (attempt >= 1) {
        // Error de red/HTTP no recuperable tras un reintento: se propaga.
        break;
      }
    }
  }
  throw lastError;
}

function getFxCacheKey(fromCurrency, toCurrency) {
  return `${String(fromCurrency || "").toLowerCase()}:${String(toCurrency || "").toLowerCase()}`;
}

function readFxRateCacheStore() {
  const parsed = safeParse(localStorage.getItem(FX_RATE_CACHE_KEY));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function getCachedCurrencyConversionRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  const cacheKey = getFxCacheKey(fromCurrency, toCurrency);
  const inMemory = state.fxRateCache.get(cacheKey);
  if (inMemory && Date.now() - inMemory.at < FX_RATE_TTL && Number.isFinite(inMemory.rate) && inMemory.rate > 0) {
    return inMemory.rate;
  }

  const store = readFxRateCacheStore();
  const stored = store[cacheKey];
  if (stored && Date.now() - Number(stored.at || 0) < FX_RATE_TTL && Number.isFinite(stored.rate) && stored.rate > 0) {
    const normalizedRate = Number(stored.rate);
    state.fxRateCache.set(cacheKey, { at: Number(stored.at), rate: normalizedRate });
    return normalizedRate;
  }

  return null;
}

function cacheCurrencyConversionRate(fromCurrency, toCurrency, rate) {
  if (!Number.isFinite(rate) || rate <= 0) {
    return;
  }

  const now = Date.now();
  const normalizedRate = Number(rate);
  const directKey = getFxCacheKey(fromCurrency, toCurrency);
  const inverseKey = getFxCacheKey(toCurrency, fromCurrency);

  state.fxRateCache.set(directKey, { at: now, rate: normalizedRate });
  state.fxRateCache.set(inverseKey, { at: now, rate: 1 / normalizedRate });

  const store = readFxRateCacheStore();
  store[directKey] = { at: now, rate: normalizedRate };
  store[inverseKey] = { at: now, rate: 1 / normalizedRate };
  localStorage.setItem(FX_RATE_CACHE_KEY, JSON.stringify(store));
}

async function fetchCurrencyConversionRate(fromCurrency, toCurrency) {
  const from = String(fromCurrency || "").toLowerCase();
  const to = String(toCurrency || "").toLowerCase();
  if (from === to) {
    return 1;
  }

  const cachedRate = getCachedCurrencyConversionRate(from, to);
  if (cachedRate) {
    return cachedRate;
  }

  const url = `${COINGECKO_BASE}simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(`${from},${to}`)}`;
  const payload = await fetchJson(url);
  const sourceValue = Number(payload?.bitcoin?.[from]);
  const targetValue = Number(payload?.bitcoin?.[to]);
  const rate = sourceValue > 0 && targetValue > 0 ? targetValue / sourceValue : NaN;

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Unable to resolve FX rate");
  }

  cacheCurrencyConversionRate(from, to, rate);
  return rate;
}

function convertStoredCurrencyInput(value, conversionRate) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  const numericValue = parseDecimal(rawValue);
  if (!Number.isFinite(numericValue)) {
    return rawValue;
  }

  if (numericValue === 0) {
    return rawValue;
  }

  return formatEditableNumber(numericValue * conversionRate);
}

function convertNumericAmount(value, conversionRate, digits = 8) {
  if (!Number.isFinite(value)) {
    return value;
  }

  const normalizedRate = Number(conversionRate);
  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) {
    return value;
  }

  return Number((value * normalizedRate).toFixed(digits));
}

function applyCurrencyConversionToPortfolio(fromCurrency, toCurrency, conversionRate) {
  if (!Number.isFinite(conversionRate) || conversionRate <= 0 || fromCurrency === toCurrency) {
    return;
  }

  state.rows.forEach((row) => {
    row.investment = convertStoredCurrencyInput(row.investment, conversionRate);
    row.entryPrice = convertStoredCurrencyInput(row.entryPrice, conversionRate);
    row.tp1 = convertStoredCurrencyInput(row.tp1, conversionRate);
    row.tp2 = convertStoredCurrencyInput(row.tp2, conversionRate);
    row.tp3 = convertStoredCurrencyInput(row.tp3, conversionRate);

    if (typeof row.currentPrice === "number") {
      row.currentPrice = convertNumericAmount(row.currentPrice, conversionRate);
    }

    if (Array.isArray(row.priceHistory) && row.priceHistory.length) {
      row.priceHistory = compactRowPriceHistory(
        row.priceHistory.map((point) => ({
          ...point,
          price: convertNumericAmount(Number(point.price || 0), conversionRate)
        }))
      );
    }
  });

  state.history = compactHistoryPoints(
    state.history.map((point) => {
      if (point.currency !== fromCurrency) {
        return point;
      }

      return {
        ...point,
        currency: toCurrency,
        total: convertNumericAmount(Number(point.total || 0), conversionRate, 2)
      };
    })
  );

  persistHistory();
}

function getSortedRows() {
  const items = state.rows.map((row, index) => ({
    row,
    index,
    metrics: computeRowMetrics(row)
  }));

  items.sort((a, b) => compareRows(a, b));
  return items.map((item) => item.row);
}

function compareRows(a, b) {
  if (a.row.pinned !== b.row.pinned) {
    return a.row.pinned ? -1 : 1;
  }

  const direction = state.prefs.sortDir === "desc" ? -1 : 1;
  const valueA = sortValueFor(a, state.prefs.sortBy);
  const valueB = sortValueFor(b, state.prefs.sortBy);

  if (typeof valueA === "string" || typeof valueB === "string") {
    const normalizedA = String(valueA || "");
    const normalizedB = String(valueB || "");
    const result = normalizedA.localeCompare(normalizedB, "es", { sensitivity: "base" });
    if (result !== 0) {
      return result * direction;
    }
  } else if (valueA !== valueB) {
    return ((valueA || 0) - (valueB || 0)) * direction;
  }

  return a.index - b.index;
}

function sortValueFor(item, key) {
  switch (key) {
    case "favorite":
      return item.row.favorite ? 1 : 0;
    case "asset":
      return assetDisplayName(item.row);
    case "investment":
      return item.metrics.investment;
    case "tokens":
      return item.metrics.tokens;
    case "entryPrice":
      return item.metrics.entryPrice;
    case "currentPrice":
      return item.metrics.currentPrice;
    case "currentValue":
      return item.metrics.currentValue;
    case "pnlUsd":
      return item.metrics.pnlUsd;
    case "pnlPct":
      return item.metrics.pnlPct;
    case "roiPct":
      return item.metrics.roiPct;
    case "tp1":
      return item.metrics.tp1;
    case "tp2":
      return item.metrics.tp2;
    case "tp3":
      return item.metrics.tp3;
    case "tpSignal":
      return getTpStatus(item.metrics).score;
    default:
      return item.index;
  }
}

function buildSnapshot() {
  const items = state.rows.map((row) => ({
    row,
    metrics: computeRowMetrics(row)
  }));

  const totals = items.reduce(
    (accumulator, item) => {
      accumulator.investment += item.metrics.investment;
      accumulator.tokens += item.metrics.tokens;
      accumulator.currentValue += item.metrics.currentValue;
      accumulator.tp1 += item.metrics.tp1Value;
      accumulator.tp2 += item.metrics.tp2Value;
      accumulator.tp3 += item.metrics.tp3Value;
      return accumulator;
    },
    { investment: 0, tokens: 0, currentValue: 0, tp1: 0, tp2: 0, tp3: 0 }
  );

  const validItems = items.filter((item) => item.metrics.investment > 0 || item.metrics.currentValue > 0);
  const connectedCount = items.filter((item) => item.metrics.currentPrice > 0).length;
  const reachedTargets = items.filter((item) => getTpStatus(item.metrics).tone === "good").length;
  const favoriteCount = items.filter((item) => item.row.favorite).length;
  const byPnl = [...validItems].sort((a, b) => b.metrics.pnlPct - a.metrics.pnlPct);

  return {
    items,
    totals,
    bestAsset: byPnl[0] || null,
    worstAsset: byPnl[byPnl.length - 1] || null,
    connectedCount,
    reachedTargets,
    favoriteCount
  };
}

function computeRowMetrics(row) {
  const investment = parseDecimal(row.investment);
  const tokens = parseDecimal(row.tokens);
  const manualEntryPrice = parseDecimal(row.entryPrice);
  const entryPrice = manualEntryPrice || (investment > 0 && tokens > 0 ? investment / tokens : 0);
  const entrySource = manualEntryPrice > 0 ? "manual" : entryPrice > 0 ? "derived" : "none";
  const tp1 = parseDecimal(row.tp1);
  const tp2 = parseDecimal(row.tp2);
  const tp3 = parseDecimal(row.tp3);
  const currentPrice = typeof row.currentPrice === "number" ? row.currentPrice : 0;
  const currentValue = tokens * currentPrice;
  const tp1Value = tokens * tp1;
  const tp2Value = tokens * tp2;
  const tp3Value = tokens * tp3;
  const pnlUsd = currentValue - investment;
  const pnlPct = investment > 0 ? (pnlUsd / investment) * 100 : 0;
  const roiPct = entryPrice > 0 && currentPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  return {
    investment,
    tokens,
    entryPrice,
    entrySource,
    tp1,
    tp2,
    tp3,
    tp1Value,
    tp2Value,
    tp3Value,
    currentPrice,
    currentValue,
    pnlUsd,
    pnlPct,
    roiPct
  };
}

function getEntryDisplayValue(row, metrics) {
  if (row.entryPrice) {
    return row.entryPrice;
  }

  if (metrics.entrySource === "derived" && metrics.entryPrice > 0) {
    return formatEditableNumber(metrics.entryPrice);
  }

  return "";
}

function getTpStatus(metrics) {
  const targets = [
    { label: "TP1", value: metrics.tp1 },
    { label: "TP2", value: metrics.tp2 },
    { label: "TP3", value: metrics.tp3 }
  ].filter((target) => target.value > 0);

  if (!metrics.currentPrice) {
    return { tone: "warn", label: t("row.noPriceStatus"), score: -2 };
  }

  if (!targets.length) {
    return { tone: "warn", label: t("row.noTarget"), score: -1 };
  }

  const reached = targets.filter((target) => metrics.currentPrice >= target.value);
  if (reached.length) {
    const lastReached = reached[reached.length - 1];
    return { tone: "good", label: t("row.targetReached", { target: lastReached.label }), score: 10 + reached.length };
  }

  const nextTarget = targets.find((target) => metrics.currentPrice < target.value);
  const ratio = nextTarget ? metrics.currentPrice / nextTarget.value : 0;

  if (ratio >= 0.92) {
    return { tone: "warn", label: t("row.nearTarget", { target: nextTarget.label }), score: 3 + ratio };
  }

  return { tone: "error", label: t("row.farTarget", { target: nextTarget.label }), score: ratio };
}

function renderTpSignal(tpStatus) {
  return `
    <span class="signal-badge ${tpStatus.tone}">
      <span class="signal-dot" aria-hidden="true"></span>
      ${escapeHtml(tpStatus.label)}
    </span>
  `;
}

function getValidationMessage(metrics) {
  if (!metrics.investment && !metrics.tokens) {
    return { text: t("validation.completeInvestmentTokens"), tone: "info" };
  }

  if (metrics.investment > 0 && metrics.tokens <= 0) {
    return { text: t("validation.missingTokens"), tone: "error" };
  }

  if (metrics.tokens > 0 && metrics.investment <= 0) {
    return { text: t("validation.missingInvestment"), tone: "error" };
  }

  if (metrics.entryPrice > 0) {
    const lowerTarget = [metrics.tp1, metrics.tp2, metrics.tp3]
      .filter((value) => value > 0)
      .some((value) => value < metrics.entryPrice);
    if (lowerTarget) {
      return { text: t("validation.tpBelowEntry"), tone: "error" };
    }
  }

  return { text: t("validation.consistent"), tone: "info" };
}

function renderAssetAvatar(row) {
  if (row.image) {
    return `<img src="${escapeHtml(row.image)}" alt="${escapeHtml(assetDisplayName(row))}" />`;
  }

  const label = String(row.symbol || row.crypto || "?").slice(0, 3).toUpperCase();
  return `<span>${escapeHtml(label)}</span>`;
}

function renderLookupMeta(row) {
  if (!row.crypto.trim()) {
    return t("row.coingeckoPending");
  }

  if (row.priceStatus === "loading") {
    return t("row.searching");
  }

  if (row.priceStatus === "success") {
    return escapeHtml(`${row.resolvedName || row.crypto}${row.symbol ? ` (${row.symbol})` : ""}`);
  }

  if (row.priceStatus === "not_found") {
    return t("row.noMatches");
  }

  if (row.priceStatus === "error") {
    return escapeHtml(row.priceMessage || t("status.apiError"));
  }

  if (row.resolvedName) {
    return escapeHtml(row.resolvedName);
  }

  return t("row.readyToSearch");
}

function renderSuggestions(row) {
  if (!row.suggestions.length) {
    return "";
  }

  return row.suggestions
    .map(
      (coin) => `
        <button
          class="suggestion-btn"
          type="button"
          data-action="select-suggestion"
          data-row-id="${row.id}"
          data-coin-id="${escapeHtml(coin.id)}"
        >
          <img src="${escapeHtml(coin.thumb || "")}" alt="${escapeHtml(coin.name)}" />
          <span>
            <strong>${escapeHtml(coin.name)}</strong>
            <span class="suggestion-symbol">${escapeHtml(String(coin.symbol || "").toUpperCase())}</span>
          </span>
          <span class="suggestion-rank">
            ${coin.market_cap_rank ? t("row.rank", { rank: coin.market_cap_rank }) : t("row.noRank")}
          </span>
        </button>
      `
    )
    .join("");
}

function renderPriceCell(row) {
  if (!row.crypto.trim()) {
    return `<span class="empty-cell">${escapeHtml(t("row.noAsset"))}</span>`;
  }

  if (row.priceStatus === "loading") {
    return `
      <span class="price-badge warn">
        <span class="loader-dot" aria-hidden="true"></span>
        ${escapeHtml(t("row.querying"))}
      </span>
    `;
  }

  if (row.priceStatus === "not_found") {
    return `<span class="price-badge warn">${escapeHtml(t("row.notFound"))}</span>`;
  }

  if (row.priceStatus === "error") {
    return `<span class="price-badge error">${escapeHtml(row.priceMessage || t("status.apiError"))}</span>`;
  }

  if (typeof row.currentPrice === "number") {
    const deltaTone =
      row.priceChange24h > 0 ? "good" : row.priceChange24h < 0 ? "error" : "warn";

    return `
      <div class="price-stack">
        <strong class="money">${formatCurrency(row.currentPrice, getPriceDigits(row.currentPrice))}</strong>
        <span class="delta-chip ${deltaTone}">
          24h ${formatSignedPercent(row.priceChange24h || 0)}
        </span>
        <span class="price-subline">${row.lastPriceAt ? escapeHtml(t("row.sync", { time: formatClock(new Date(row.lastPriceAt)) })) : "CoinGecko"}</span>
      </div>
    `;
  }

  return `<span class="empty-cell">${escapeHtml(t("row.noPrice"))}</span>`;
}

function lookupToneClass(row) {
  if (row.priceStatus === "success") {
    return "good";
  }
  if (row.priceStatus === "loading" || row.priceStatus === "not_found") {
    return "warn";
  }
  if (row.priceStatus === "error") {
    return "error";
  }
  return "";
}

function closeAllSuggestions() {
  state.rows.forEach((row) => {
    if (row.suggestionsOpen) {
      row.suggestionsOpen = false;
      updateLiveRowUi(row.id);
    }
  });
}

function getRowById(rowId) {
  return state.rows.find((row) => row.id === rowId);
}

function compactRowPriceHistory(points) {
  const now = Date.now();
  const normalized = points
    .filter((point) => point && Number.isFinite(point.price) && point.at && Number.isFinite(new Date(point.at).getTime()))
    .map((point) => ({
      at: new Date(point.at).toISOString(),
      price: Number(point.price)
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const keep = [];
  const seenBuckets = new Set();

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const point = normalized[index];
    const pointAt = new Date(point.at).getTime();
    const age = now - pointAt;
    let bucketSize = 5 * 60 * 1000;

    if (age > 24 * 60 * 60 * 1000 && age <= 7 * 24 * 60 * 60 * 1000) {
      bucketSize = 60 * 60 * 1000;
    } else if (age > 7 * 24 * 60 * 60 * 1000 && age <= 30 * 24 * 60 * 60 * 1000) {
      bucketSize = 6 * 60 * 60 * 1000;
    } else if (age > 30 * 24 * 60 * 60 * 1000) {
      bucketSize = 24 * 60 * 60 * 1000;
    }

    const bucketKey = `${bucketSize}:${Math.floor(pointAt / bucketSize)}`;
    if (seenBuckets.has(bucketKey)) {
      continue;
    }

    keep.push(point);
    seenBuckets.add(bucketKey);
  }

  return keep.reverse().slice(-MAX_ROW_HISTORY_POINTS);
}

function seedRowPriceHistory(row) {
  if (!row || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0 || row.priceHistory.length) {
    return;
  }

  const currentAt = row.lastPriceAt && Number.isFinite(new Date(row.lastPriceAt).getTime())
    ? new Date(row.lastPriceAt)
    : new Date();

  const seededPoints = [];

  if (Number.isFinite(row.priceChange24h)) {
    const ratio = 1 + row.priceChange24h / 100;
    if (ratio > 0) {
      const previousPrice = row.currentPrice / ratio;
      if (Number.isFinite(previousPrice) && previousPrice > 0) {
        seededPoints.push({
          at: new Date(currentAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          price: Number(previousPrice)
        });
      }
    }
  }

  seededPoints.push({
    at: currentAt.toISOString(),
    price: Number(row.currentPrice)
  });

  row.priceHistory = compactRowPriceHistory(seededPoints);
}

function appendRowPriceHistory(row) {
  if (!row || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0) {
    return;
  }

  if (!row.priceHistory.length) {
    seedRowPriceHistory(row);
    if (row.priceHistory.length >= 2) {
      return;
    }
  }

  const point = {
    at: row.lastPriceAt || new Date().toISOString(),
    price: Number(row.currentPrice)
  };

  const lastPoint = row.priceHistory[row.priceHistory.length - 1];
  if (
    lastPoint &&
    Math.abs(new Date(point.at).getTime() - new Date(lastPoint.at).getTime()) < 20 * 1000
  ) {
    row.priceHistory[row.priceHistory.length - 1] = point;
  } else {
    row.priceHistory.push(point);
  }

  row.priceHistory = compactRowPriceHistory(row.priceHistory);
}

function compactHistoryPoints(points) {
  const now = Date.now();
  const normalized = points
    .filter((point) => point && point.at && Number.isFinite(new Date(point.at).getTime()))
    .map((point) => ({
      at: new Date(point.at).toISOString(),
      currency: point.currency || state.prefs.currency,
      total: Number(point.total || 0)
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const keep = [];
  const seenBuckets = new Set();

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const point = normalized[index];
    const pointAt = new Date(point.at).getTime();
    const age = now - pointAt;
    let bucketSize = 60 * 1000;

    if (age > 6 * 60 * 60 * 1000 && age <= 24 * 60 * 60 * 1000) {
      bucketSize = 5 * 60 * 1000;
    } else if (age > 24 * 60 * 60 * 1000 && age <= 7 * 24 * 60 * 60 * 1000) {
      bucketSize = 30 * 60 * 1000;
    } else if (age > 7 * 24 * 60 * 60 * 1000 && age <= 30 * 24 * 60 * 60 * 1000) {
      bucketSize = 2 * 60 * 60 * 1000;
    } else if (age > 30 * 24 * 60 * 60 * 1000 && age <= 180 * 24 * 60 * 60 * 1000) {
      bucketSize = 12 * 60 * 60 * 1000;
    } else if (age > 180 * 24 * 60 * 60 * 1000) {
      bucketSize = 24 * 60 * 60 * 1000;
    }

    const bucketKey = `${point.currency}:${bucketSize}:${Math.floor(pointAt / bucketSize)}`;
    if (seenBuckets.has(bucketKey)) {
      continue;
    }

    keep.push(point);
    seenBuckets.add(bucketKey);
  }

  return keep.reverse().slice(-MAX_HISTORY_POINTS);
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

  if (range === "1m") {
    return 6;
  }
  if (range === "1h") {
    return 8;
  }
  if (range === "1d") {
    return 6;
  }
  if (range === "1w" || range === "1mo") {
    return 7;
  }
  return 8;
}

function appendPortfolioHistory() {
  const snapshot = buildSnapshot();
  if (snapshot.totals.currentValue <= 0) {
    return;
  }

  const point = {
    at: new Date().toISOString(),
    currency: state.prefs.currency,
    total: Number(snapshot.totals.currentValue.toFixed(2))
  };

  const lastPoint = state.history[state.history.length - 1];
  if (
    lastPoint &&
    lastPoint.currency === point.currency &&
    Date.now() - new Date(lastPoint.at).getTime() < 20 * 1000
  ) {
    state.history[state.history.length - 1] = point;
  } else {
    state.history.push(point);
  }

  state.history = compactHistoryPoints(state.history);
  persistHistory();
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

let chartsLibLoading = false;
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

  if (!state.charts.line) {
    state.charts.line = new Chart(dom.portfolioLineChart, {
      type: "line",
      data: {
        labels: lineLabels,
        datasets: [
          {
            data: lineValues,
            borderColor: accent2,
            backgroundColor: "rgba(78, 160, 255, 0.16)",
            fill: true,
            tension: 0.34,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: accent
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            // Las etiquetas ya vienen repartidas desde buildLineTickLabels
            // (el resto son ""); autoSkip las descartaría a su criterio.
            ticks: { color: textColor, autoSkip: false, maxRotation: 30 },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: textColor,
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
  } else {
    state.charts.line.data.labels = lineLabels;
    state.charts.line.data.datasets[0].data = lineValues;
    state.charts.line.options.scales.x.ticks.color = textColor;
    state.charts.line.options.scales.y.ticks.color = textColor;
    state.charts.line.options.scales.y.grid.color = borderColor;
    state.charts.line.data.datasets[0].borderColor = accent2;
    state.charts.line.data.datasets[0].pointBackgroundColor = accent;
    state.charts.line.update();
  }
}

function scheduleAutosave() {
  if (state.autosaveTimer) {
    window.clearTimeout(state.autosaveTimer);
  }

  updateSaveMessage(t("alerts.pendingChanges"));
  state.autosaveTimer = window.setTimeout(() => {
    persistState(false);
  }, AUTOSAVE_DELAY);
}

function persistState(manual) {
  try {
    const payload = {
      rows: state.rows.map((row) => ({
        id: row.id,
        crypto: row.crypto,
        coinId: row.coinId,
        resolvedName: row.resolvedName,
        symbol: row.symbol,
        image: row.image,
        investment: row.investment,
        tokens: row.tokens,
        entryPrice: row.entryPrice,
        tp1: row.tp1,
        tp2: row.tp2,
        tp3: row.tp3,
        currentPrice: row.currentPrice,
        priceChange24h: row.priceChange24h,
        priceStatus: row.priceStatus,
        priceMessage: row.priceMessage,
        lastPriceAt: row.lastPriceAt,
        priceHistory: row.priceHistory,
        favorite: row.favorite,
        pinned: row.pinned,
        derivedField: row.derivedField,
        alertsFired: row.alertsFired
      })),
      activity: state.activity.slice(0, MAX_ACTIVITY_ITEMS)
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    savePreferences();
    persistHistory();
    updateSaveMessage(
      t("alerts.savedAt", {
        mode: manual ? t("alerts.savedManual") : t("alerts.savedAuto"),
        time: formatClock(new Date())
      })
    );
  } catch (error) {
    showToast(t("status.apiError"), t("alerts.saveFailedText"), "negative");
  }
}

function savePreferences() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
}

// History payload can reach ~480 KB; stringify+setItem is synchronous and was
// running on every successful refresh. Coalesce writes into idle time so the
// main thread stays free for INP.
let historyWriteHandle = null;
const idleSchedule = (cb) =>
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(cb, { timeout: 2000 })
    : window.setTimeout(cb, 250);
const idleCancel = (h) =>
  typeof window.cancelIdleCallback === "function"
    ? window.cancelIdleCallback(h)
    : window.clearTimeout(h);

function persistHistory() {
  if (historyWriteHandle != null) idleCancel(historyWriteHandle);
  historyWriteHandle = idleSchedule(() => {
    historyWriteHandle = null;
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify({ points: compactHistoryPoints(state.history) })
      );
    } catch {
      // Quota or serialization failure — keep app running, drop write silently.
    }
  });
}

function setApiState(status, meta) {
  state.apiStatus = status;
  state.apiMeta = meta;
  if (status === "connected") {
    state.lastSyncLabel = t("status.lastSync", { time: formatClock(new Date()) });
  }
  renderStatusCards();
}

function setLoader(visible, label = t("loader.syncMarket")) {
  state.syncing = visible;
  dom.appLoader.classList.toggle("is-visible", visible);
  dom.appLoader.setAttribute("aria-hidden", visible ? "false" : "true");
  dom.loaderText.textContent = label;
}

function updateSaveMessage(message) {
  state.saveMessage = message;
  renderStatusCards();
}

function pushActivity(title, detail, tone = "neutral") {
  state.activity.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title,
    detail,
    tone,
    at: new Date().toISOString()
  });
  state.activity = state.activity.slice(0, MAX_ACTIVITY_ITEMS);
  renderActivityIfChanged();
  scheduleAutosave();
}

function showToast(title, detail, tone = "neutral") {
  const icons = {
    positive: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#3effa8" stroke-width="1.5"/><path d="M6 10.5l2.5 2.5L14 7.5" stroke="#3effa8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    negative: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#ff5555" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#ff5555" stroke-width="1.8" stroke-linecap="round"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 2L1 18h18L10 2z" stroke="#ffc947" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="#ffc947" stroke-width="1.8" stroke-linecap="round"/></svg>',
    neutral: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#5aabff" stroke-width="1.5"/><path d="M10 6v5M10 13.5v.5" stroke="#5aabff" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };
  const toast = document.createElement("article");
  toast.className = `toast ${tone}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[tone] || icons.neutral}</span>
    <div class="toast-content">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
    <div class="toast-progress"></div>
  `;
  dom.toastStack.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    toast.style.transition = "opacity 0.2s, transform 0.2s";
    window.setTimeout(() => toast.remove(), 200);
  }, 4200);
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === "\"") {
      if (insideQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += character;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  if (!headers) {
    return [];
  }

  return dataRows.map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header).trim()] = String(cells[index] ?? "").trim();
    });
    return record;
  });
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeNumericInput(value) {
  const cleaned = String(value).replace(/,/g, ".").replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) {
    return cleaned;
  }
  return `${parts.shift()}.${parts.join("")}`;
}

function normalizeNumericString(value) {
  const sanitized = sanitizeNumericInput(value);
  if (!sanitized) {
    return "";
  }

  const numeric = Number.parseFloat(sanitized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "";
  }

  return numeric.toString();
}

function parseDecimal(value) {
  const numeric = Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

function formatCurrency(value, digits = 2) {
  const meta = CURRENCY_META[state.prefs.currency] || CURRENCY_META.usd;
  return new Intl.NumberFormat(getUiLocale() || meta.locale, {
    style: "currency",
    currency: meta.code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value || 0);
}

function formatCompactCurrency(value) {
  const meta = CURRENCY_META[state.prefs.currency] || CURRENCY_META.usd;
  return new Intl.NumberFormat(getUiLocale() || meta.locale, {
    style: "currency",
    currency: meta.code,
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value || 0);
}

function formatSignedCurrency(value) {
  const absolute = formatCurrency(Math.abs(value));
  if (value > 0) {
    return `+${absolute}`;
  }
  if (value < 0) {
    return `-${absolute}`;
  }
  return absolute;
}

function formatPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedPercent(value) {
  return `${value >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat(getUiLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value || 0);
}

function formatEditableNumber(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  const digits = getPriceDigits(value);
  return Number(value.toFixed(digits)).toString();
}

function getPriceDigits(price) {
  if (price >= 1000) {
    return 2;
  }
  if (price >= 1) {
    return 4;
  }
  if (price >= 0.01) {
    return 6;
  }
  return 8;
}

function formatClock(date) {
  return new Intl.DateTimeFormat(getUiLocale(), {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat(getUiLocale(), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function assetDisplayName(row) {
  return row.symbol || row.resolvedName || row.crypto || t("table.columns.asset");
}

function toneClass(value) {
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return "neutral";
}

function toneClassForStatus(status) {
  if (status === "connected") {
    return "positive";
  }
  if (status === "error") {
    return "negative";
  }
  if (status === "syncing" || status === "offline") {
    return "warning";
  }
  return "neutral";
}

function readableApiStatus(status) {
  if (status === "connected") {
    return t("status.connected");
  }
  if (status === "error") {
    return t("status.apiError");
  }
  if (status === "syncing") {
    return t("status.syncing");
  }
  if (status === "offline") {
    return t("status.offline");
  }
  return t("status.ready");
}

function normalizeSearchText(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function escapeCsvCell(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}
