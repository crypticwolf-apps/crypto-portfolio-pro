// =============================================================================
// alertas.js - Alertas de TP y de precio: por activo, para todos los activos y
// para la cartera entera. Hoja de alerta, guardado, comprobacion y panel.
// =============================================================================

/* ═══════════════════════════════════════════════════════
   ALERTAS DE PRECIO
   Tres ambitos: un activo, todos los activos a la vez, o el
   valor total del portafolio. Dos formas de fijar el nivel:
   un objetivo TP ya definido en el activo, o un precio suelto.
   Se guardan, se editan y se borran desde Ajustes > Alertas.
   ═══════════════════════════════════════════════════════ */

// Comportamiento de la hoja de alerta: elegir TP1/TP2/TP3 o un precio, y
// en el caso de "Todos los activos" el precio pasa a ser el valor total del
// portafolio, no el de una moneda.
// Editar una alerta = reabrir la hoja con su ambito y su nivel cargados.
function openAlertEdit(alertId) {
  const alerta = state.alerts.find((item) => item.id === alertId);
  if (!alerta) {
    return;
  }
  state.editingAlertId = alertId;
  openTradeSheet("alert", alerta.scope === "asset" ? alerta.rowId : null);

  const sheet = document.getElementById("tradeSheet");
  if (!sheet) {
    return;
  }
  const select = sheet.querySelector("[data-trade-field='rowId']");
  if (select) {
    // Portafolio y "todos" comparten la misma entrada del selector.
    select.value = alerta.scope === "asset" ? alerta.rowId : ALERT_SCOPE_ALL;
  }
  const tipo = alerta.kind === "price" ? "price" : alerta.tp;
  sheet.querySelectorAll(".alert-kind-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.alertKind === tipo);
  });
  if (alerta.kind === "price") {
    const input = sheet.querySelector("[data-trade-field='alertPrice']");
    if (input) {
      input.value = formatEditableNumber(alerta.price);
    }
  }
  // Se repinta la ayuda y el campo de precio con el estado ya cargado.
  select?.dispatchEvent(new Event("change"));
}

function confirmAlert(sheet, seleccion) {
  const tipo = sheet.querySelector(".alert-kind-chip.is-active")?.dataset.alertKind || "tp1";
  const todos = seleccion === ALERT_SCOPE_ALL;
  const row = todos ? null : getRowById(seleccion);
  if (!todos && !row) {
    return;
  }

  let entrada;
  if (tipo === "price") {
    const precio = parseDecimal(sheet.querySelector("[data-trade-field='alertPrice']")?.value);
    if (!(precio > 0)) {
      showToast(t("trade.invalidTitle"), t("alertsPanel.needPrice"), "warning");
      return;
    }
    // Con "Todos los activos" un precio suelto solo tiene sentido como valor
    // conjunto de la cartera: se guarda como alerta de portafolio.
    entrada = todos
      ? { scope: "portfolio", kind: "price", price: precio }
      : { scope: "asset", rowId: row.id, kind: "price", price: precio };
  } else {
    if (!todos && !(parseDecimal(row[tipo]) > 0)) {
      showToast(t("trade.invalidTitle"), t("alertsPanel.hintNoTp", { tp: tipo.toUpperCase() }), "warning");
      return;
    }
    entrada = todos
      ? { scope: ALERT_SCOPE_ALL, kind: "tp", tp: tipo }
      : { scope: "asset", rowId: row.id, kind: "tp", tp: tipo };
  }

  if (state.editingAlertId) {
    entrada.id = state.editingAlertId;
    state.editingAlertId = null;
  }
  const guardada = saveAlert(entrada);
  if (!guardada) {
    return;
  }

  renderAll();
  const texto = alertLabel(guardada);
  pushActivity(t("alertsPanel.savedTitle"), texto, "neutral");
  showToast(t("alertsPanel.savedTitle"), texto, "positive");
  closeTradeSheet();
  checkAlerts();
}

function bindAlertSheet(sheet, select) {
  const chips = [...sheet.querySelectorAll("[data-alert-kind]")];
  const campoPrecio = sheet.querySelector(".alert-price-field");
  const inputPrecio = sheet.querySelector("[data-trade-field='alertPrice']");
  const etiquetaPrecio = sheet.querySelector("[data-alert-price-label]");
  const sugerencias = sheet.querySelector("[data-alert-suggest]");
  const ayuda = sheet.querySelector("[data-alert-hint]");

  const seleccionado = () => sheet.querySelector(".alert-kind-chip.is-active")?.dataset.alertKind || "tp1";

  const pintar = () => {
    const tipo = seleccionado();
    const todos = select.value === ALERT_SCOPE_ALL;
    const row = todos ? null : getRowById(select.value);

    campoPrecio.hidden = tipo !== "price";
    etiquetaPrecio.textContent = todos
      ? t("alertsPanel.priceLabelPortfolio")
      : t("alertsPanel.priceLabel");

    // Con un activo concreto se ofrecen sus TP ya definidos como atajo.
    const tps = row
      ? ["tp1", "tp2", "tp3"]
          .map((clave) => ({ clave, valor: parseDecimal(row[clave]) }))
          .filter((item) => item.valor > 0)
      : [];
    const mostrarSugerencias = tipo === "price" && tps.length > 0;
    sugerencias.hidden = !mostrarSugerencias;
    sugerencias.innerHTML = mostrarSugerencias
      ? `<span class="alert-suggest-label">${escapeHtml(t("alertsPanel.useTp"))}</span>` +
        tps.map((item) => `<button type="button" class="chip-preset" data-alert-fill="${item.valor}">${item.clave.toUpperCase()} · ${escapeHtml(formatCurrency(item.valor, getPriceDigits(item.valor)))}</button>`).join("")
      : "";

    if (tipo === "price") {
      ayuda.textContent = todos ? t("alertsPanel.hintPortfolio") : t("alertsPanel.hintPrice");
    } else if (todos) {
      ayuda.textContent = t("alertsPanel.hintAllTp", { tp: tipo.toUpperCase() });
    } else if (row) {
      const objetivo = parseDecimal(row[tipo]);
      ayuda.textContent = objetivo > 0
        ? t("alertsPanel.hintAssetTp", {
            tp: tipo.toUpperCase(),
            target: formatCurrency(objetivo, getPriceDigits(objetivo))
          })
        : t("alertsPanel.hintNoTp", { tp: tipo.toUpperCase() });
    } else {
      ayuda.textContent = "";
    }
  };

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((otro) => otro.classList.toggle("is-active", otro === chip));
      pintar();
    });
  });
  select.addEventListener("change", pintar);
  sugerencias.addEventListener("click", (event) => {
    const boton = event.target.closest("[data-alert-fill]");
    if (boton && inputPrecio) {
      inputPrecio.value = formatEditableNumber(Number(boton.dataset.alertFill));
    }
  });
  pintar();
}

function normalizeAlert(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const scope = raw.scope === ALERT_SCOPE_ALL || raw.scope === "portfolio" ? raw.scope : "asset";
  const kind = raw.kind === "price" ? "price" : "tp";
  const tp = ["tp1", "tp2", "tp3"].includes(raw.tp) ? raw.tp : "tp1";
  const price = Number(raw.price);
  if (kind === "price" && !(price > 0)) {
    return null;
  }
  if (scope === "asset" && !raw.rowId) {
    return null;
  }
  return {
    id: String(raw.id || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    scope,
    rowId: scope === "asset" ? String(raw.rowId) : null,
    kind,
    tp,
    price: kind === "price" ? price : null,
    createdAt: Number(raw.createdAt) || Date.now(),
    // Marca de disparo por activo: {rowId: timestamp}. Asi una alerta de
    // "todos los activos" avisa una vez por cada uno, no una sola vez.
    fired: raw.fired && typeof raw.fired === "object" ? raw.fired : {}
  };
}

function saveAlert(entry) {
  const alerta = normalizeAlert(entry);
  if (!alerta) {
    return null;
  }
  const indice = state.alerts.findIndex((item) => item.id === alerta.id);
  if (indice >= 0) {
    // Al editar se limpian los disparos: el nivel es otro.
    alerta.fired = {};
    state.alerts[indice] = alerta;
  } else {
    state.alerts.unshift(alerta);
    if (state.alerts.length > MAX_ALERTS) {
      state.alerts.length = MAX_ALERTS;
    }
  }
  persistState(true);
  renderAlertsPanel();
  return alerta;
}

function deleteAlert(alertId) {
  const indice = state.alerts.findIndex((item) => item.id === alertId);
  if (indice < 0) {
    return;
  }
  state.alerts.splice(indice, 1);
  persistState(true);
  renderAlertsPanel();
  showToast(t("alertsPanel.deletedTitle"), t("alertsPanel.deletedText"), "positive");
}

// Nivel de precio que vigila una alerta para una fila concreta.
// Devuelve null si no aplica (por ejemplo, un TP que ese activo no tiene).
function alertTargetFor(alert, row) {
  if (alert.kind === "price") {
    return alert.price;
  }
  const valor = parseDecimal(row?.[alert.tp]);
  return valor > 0 ? valor : null;
}

// Filas a las que afecta una alerta.
function alertRowsFor(alert) {
  if (alert.scope === "asset") {
    const row = getRowById(alert.rowId);
    return row ? [row] : [];
  }
  if (alert.scope === ALERT_SCOPE_ALL) {
    return state.rows.filter((row) => row.crypto.trim());
  }
  return [];
}

// Comprueba todas las alertas contra los precios actuales. Se llama en cada
// volcado del feed en vivo y tras cada sincronizacion, y avisa una sola vez
// por activo hasta que la alerta se edite.
function checkAlerts() {
  if (!state.alerts.length) {
    return;
  }
  let cambio = false;

  state.alerts.forEach((alert) => {
    if (alert.scope === "portfolio") {
      const total = state.rows.reduce((suma, row) => {
        const valor = computeRowMetrics(row).currentValue;
        return suma + (valor > 0 ? valor : 0);
      }, 0);
      if (total > 0 && alert.price > 0 && total >= alert.price && !alert.fired.portfolio) {
        alert.fired.portfolio = Date.now();
        cambio = true;
        const texto = t("alertsPanel.hitPortfolioText", {
          total: formatCurrency(total),
          target: formatCurrency(alert.price)
        });
        showToast(t("alertsPanel.hitTitle"), texto, "positive");
        pushActivity(t("alertsPanel.hitTitle"), texto, "positive");
      }
      return;
    }

    alertRowsFor(alert).forEach((row) => {
      const objetivo = alertTargetFor(alert, row);
      const precio = row.currentPrice;
      if (!(objetivo > 0) || !(precio > 0) || precio < objetivo || alert.fired[row.id]) {
        return;
      }
      alert.fired[row.id] = Date.now();
      cambio = true;
      const texto = t("alertsPanel.hitAssetText", {
        asset: assetDisplayName(row),
        target: formatCurrency(objetivo, getPriceDigits(objetivo)),
        price: formatCurrency(precio, getPriceDigits(precio))
      });
      showToast(t("alertsPanel.hitTitle"), texto, "positive");
      pushActivity(t("alertsPanel.hitTitle"), texto, "positive");
    });
  });

  if (cambio) {
    persistState(false);
    renderAlertsPanel();
  }
}

// Descripcion legible de una alerta para la lista de Ajustes.
function alertLabel(alert) {
  const nivel = alert.kind === "price"
    ? formatCurrency(alert.price, getPriceDigits(alert.price))
    : alert.tp.toUpperCase();
  if (alert.scope === "portfolio") {
    return t("alertsPanel.labelPortfolio", { target: nivel });
  }
  if (alert.scope === ALERT_SCOPE_ALL) {
    return t("alertsPanel.labelAll", { target: nivel });
  }
  const row = getRowById(alert.rowId);
  return t("alertsPanel.labelAsset", {
    asset: row ? assetDisplayName(row) : "--",
    target: nivel
  });
}

function renderAlertsPanel() {
  const box = document.getElementById("alertsList");
  if (!box) {
    return;
  }
  if (!state.alerts.length) {
    box.innerHTML = `<p class="movers-empty">${escapeHtml(t("alertsPanel.empty"))}</p>`;
    return;
  }

  box.innerHTML = `
    <ul class="alerts-list" role="list">
      ${state.alerts.map((alert) => {
        const disparos = Object.keys(alert.fired || {}).length;
        return `
        <li class="alert-item" data-alert-id="${escapeHtml(alert.id)}">
          <span class="alert-item-main">
            <strong>${escapeHtml(alertLabel(alert))}</strong>
            <small>${escapeHtml(disparos ? t("alertsPanel.firedCount", { n: disparos }) : t("alertsPanel.waiting"))}</small>
          </span>
          <span class="alert-item-actions">
            <button class="icon-circle-btn" type="button" data-alert-edit="${escapeHtml(alert.id)}" aria-label="${escapeHtml(t("buttons.edit"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button class="icon-circle-btn" type="button" data-alert-delete="${escapeHtml(alert.id)}" aria-label="${escapeHtml(t("buttons.delete"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </span>
        </li>`;
      }).join("")}
    </ul>
  `;
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
