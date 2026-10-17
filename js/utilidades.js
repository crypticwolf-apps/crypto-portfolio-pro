// =============================================================================
// utilidades.js - Piezas comunes sin estado propio: traduccion (t), formato de
// numeros, monedas y fechas, parseo, escapeHtml, CSV, portapapeles, avisos
// (toasts) y carga de librerias externas del CDN.
// =============================================================================

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

// "hace X" / "en X" para etiquetas de frescura de datos.
function formatRelativeTime(timestampMs, future = false) {
  const delta = future ? timestampMs - Date.now() : Date.now() - timestampMs;
  if (!Number.isFinite(delta)) {
    return "--";
  }
  if (delta < 60 * 1000) {
    return future ? t("time.soon") : t("time.now");
  }
  const minutes = Math.floor(delta / 60000);
  if (minutes < 60) {
    return t(future ? "time.inMinutes" : "time.minutes", { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t(future ? "time.inHours" : "time.hours", { n: hours });
  }
  return t("time.days", { n: Math.floor(hours / 24) });
}

function sanitizeFilenamePart(value) {
  const fallback = sanitizePdfText(t("portfolio.defaultName")).toLowerCase().replace(/\s+/g, "-");
  const cleaned = sanitizePdfText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback || "portfolio";
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
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

function showToast(title, detail, tone = "neutral") {
  const icons = {
    positive: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#3effa8" stroke-width="1.5"/><path d="M6 10.5l2.5 2.5L14 7.5" stroke="#3effa8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    negative: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#ff5555" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#ff5555" stroke-width="1.8" stroke-linecap="round"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 2L1 18h18L10 2z" stroke="#ffc947" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="#ffc947" stroke-width="1.8" stroke-linecap="round"/></svg>',
    neutral: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#5aabff" stroke-width="1.5"/><path d="M10 6v5M10 13.5v.5" stroke="#5aabff" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };
  // Guardar, borrar o registrar algo son confirmaciones rutinarias: molesta
  // que tapen media pantalla cuatro segundos. Se reducen a una linea breve.
  // Los avisos y errores mantienen la tarjeta completa: ahi el detalle importa.
  const breve = tone === "positive" || tone === "neutral";
  const toast = document.createElement("article");
  toast.className = `toast ${tone}${breve ? " is-compact" : ""}`;
  toast.innerHTML = breve
    ? `
    <span class="toast-icon">${icons[tone] || icons.neutral}</span>
    <div class="toast-content"><strong>${escapeHtml(title)}</strong></div>
  `
    : `
    <span class="toast-icon">${icons[tone] || icons.neutral}</span>
    <div class="toast-content">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
    <div class="toast-progress"></div>
  `;
  // Solo se mantiene el ultimo aviso rutinario: encadenar acciones no debe
  // apilar carteles uno encima de otro.
  if (breve) {
    dom.toastStack.querySelectorAll(".toast.is-compact").forEach((viejo) => viejo.remove());
  }
  dom.toastStack.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    toast.style.transition = "opacity 0.2s, transform 0.2s";
    window.setTimeout(() => toast.remove(), 200);
  }, breve ? 1600 : 4200);
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
