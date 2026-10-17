// =============================================================================
// editor.js - Editor de posiciones (crear y editar, con buscador de monedas) y
// menu contextual de cada fila.
// =============================================================================

/* ═══════════════════════════════════════════════════════
   EDITOR DE POSICIONES (portal global fuera de la tabla)
   Bottom sheet en móvil / modal centrado en escritorio.
   Edita la fila viva con autosave; cerrar no descarta.
   ═══════════════════════════════════════════════════════ */

function bindPositionEditor() {
  editorPortal = document.getElementById("positionEditorPortal");
  if (!editorPortal) {
    return;
  }

  editorPortal.addEventListener("click", (event) => {
    if (event.target.closest("[data-editor-close]") || event.target === editorPortal.querySelector(".editor-backdrop")) {
      closePositionEditor();
      return;
    }
    const suggestion = event.target.closest("[data-editor-coin]");
    if (suggestion) {
      selectEditorCoin(suggestion.dataset.editorCoin);
    }
  });

  editorPortal.addEventListener("input", (event) => {
    const field = event.target.closest("[data-editor-field]");
    if (field) {
      handleEditorFieldInput(field);
    }
  });

  editorPortal.addEventListener("change", (event) => {
    const fav = event.target.closest("[data-editor-field='favorite']");
    if (fav) {
      const row = getRowById(state.editorRowId);
      if (row) {
        row.favorite = fav.checked;
        updateLiveRowUi(row.id);
        scheduleAutosave();
      }
    }
  });

  editorPortal.addEventListener("submit", (event) => {
    event.preventDefault();
    savePositionEditor();
  });
}

function openPositionEditor(rowId) {
  const row = getRowById(rowId);
  if (!row || !editorPortal) {
    return;
  }
  closeRowMenu();
  state.editorRowId = rowId;
  renderPositionEditor(row);
  editorPortal.hidden = false;
  document.body.classList.add("editor-open");
  // Foco al primer campo tras la animación (sin provocar zoom en iOS).
  window.setTimeout(() => {
    const firstField = editorPortal.querySelector("[data-editor-field='tokens']");
    if (firstField && !isMobileViewport()) {
      firstField.focus({ preventScroll: true });
    }
  }, 260);
}

function closePositionEditor() {
  if (!editorPortal || !state.editorRowId) {
    return;
  }
  clearTimeout(editorSearchTimer);
  state.editorRowId = null;
  editorPortal.classList.add("is-closing");
  const finish = () => {
    editorPortal.hidden = true;
    editorPortal.classList.remove("is-closing");
    document.body.classList.remove("editor-open");
    editorPortal.innerHTML = "";
  };
  // Respeta la animación pero garantiza el cierre aunque no dispare.
  window.setTimeout(finish, 220);
}

function renderPositionEditor(row) {
  const metrics = computeRowMetrics(row);
  editorPortal.innerHTML = `
    <div class="editor-backdrop"></div>
    <form class="editor-panel" id="positionEditorForm" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("editor.title"))}">
      <header class="editor-head">
        <div class="editor-grip" aria-hidden="true"></div>
        <div class="editor-title-row">
          <h2>${escapeHtml(t("editor.title"))}</h2>
          <button type="button" class="icon-circle-btn" data-editor-close aria-label="${escapeHtml(t("buttons.close"))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </header>

      <div class="editor-body">
        <label class="editor-field">
          <span>${escapeHtml(t("editor.asset"))}</span>
          <input type="text" data-editor-field="crypto" autocomplete="off" placeholder="${escapeHtml(t("row.assetPlaceholder"))}" value="${escapeHtml(row.crypto)}" />
          <div class="editor-suggestions" data-editor-role="suggestions" hidden></div>
          <small class="editor-hint" data-editor-role="assetHint">${escapeHtml(editorAssetHint(row))}</small>
        </label>

        <div class="editor-grid-2">
          <label class="editor-field">
            <span>${escapeHtml(t("table.fields.tokens"))}</span>
            <input type="text" inputmode="decimal" data-editor-field="tokens" value="${escapeHtml(row.tokens)}" placeholder="0.00" />
          </label>
          <label class="editor-field">
            <span>${escapeHtml(t("editor.investment"))}</span>
            <input type="text" inputmode="decimal" data-editor-field="investment" value="${escapeHtml(row.investment)}" placeholder="0.00" />
          </label>
          <label class="editor-field">
            <span>${escapeHtml(t("editor.entryPrice"))}</span>
            <input type="text" inputmode="decimal" data-editor-field="entryPrice" value="${escapeHtml(getEntryDisplayValue(row, metrics))}" placeholder="${escapeHtml(t("table.fields.entryAuto"))}" />
          </label>
          <div class="editor-field editor-readonly">
            <span>${escapeHtml(t("editor.currentPrice"))}</span>
            <strong data-editor-role="currentPrice">${metrics.currentPrice > 0 ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice)) : "--"}</strong>
          </div>
        </div>

        <div class="editor-tp-grid">
          <label class="editor-field"><span>TP1</span><input type="text" inputmode="decimal" data-editor-field="tp1" value="${escapeHtml(row.tp1)}" placeholder="0.00" /></label>
          <label class="editor-field"><span>TP2</span><input type="text" inputmode="decimal" data-editor-field="tp2" value="${escapeHtml(row.tp2)}" placeholder="0.00" /></label>
          <label class="editor-field"><span>TP3</span><input type="text" inputmode="decimal" data-editor-field="tp3" value="${escapeHtml(row.tp3)}" placeholder="0.00" /></label>
        </div>

        <label class="editor-field">
          <span>${escapeHtml(t("editor.note"))}</span>
          <textarea data-editor-field="note" rows="2" maxlength="280" placeholder="${escapeHtml(t("editor.notePlaceholder"))}">${escapeHtml(row.note)}</textarea>
        </label>

        <p class="editor-secondary" data-editor-role="capInfo">${escapeHtml(editorCapInfo(row))}</p>
      </div>

      <footer class="editor-foot">
        <button type="button" class="ghost-btn" data-editor-close>${escapeHtml(t("buttons.cancel"))}</button>
        <button type="submit" class="primary-btn">${escapeHtml(t("editor.save"))}</button>
      </footer>
    </form>
  `;
}

function editorAssetHint(row) {
  if (row.coinId) {
    return `${row.resolvedName || row.crypto}${row.symbol ? ` (${row.symbol})` : ""}`;
  }
  return t("editor.searchHint");
}

function editorCapInfo(row) {
  if (Number.isFinite(row.marketCap)) {
    const rank = Number.isFinite(row.marketCapRank) ? `#${row.marketCapRank} · ` : "";
    return `${t("card.cap")}: ${rank}${formatCompactCurrency(row.marketCap)}`;
  }
  return "";
}

// Refresca los valores derivados del editor sin reconstruirlo (mantiene foco).
function refreshEditorLiveData() {
  const row = getRowById(state.editorRowId);
  if (!row || !editorPortal || editorPortal.hidden) {
    return;
  }
  const metrics = computeRowMetrics(row);
  const priceNode = editorPortal.querySelector("[data-editor-role='currentPrice']");
  if (priceNode) {
    priceNode.textContent = metrics.currentPrice > 0
      ? formatCurrency(metrics.currentPrice, getPriceDigits(metrics.currentPrice))
      : "--";
  }
  const capNode = editorPortal.querySelector("[data-editor-role='capInfo']");
  if (capNode) {
    capNode.textContent = editorCapInfo(row);
  }
  const hintNode = editorPortal.querySelector("[data-editor-role='assetHint']");
  if (hintNode && document.activeElement?.dataset?.editorField !== "crypto") {
    hintNode.textContent = editorAssetHint(row);
  }
}

function handleEditorFieldInput(input) {
  const row = getRowById(state.editorRowId);
  if (!row) {
    return;
  }
  const field = input.dataset.editorField;

  if (field === "crypto") {
    // Cambiar el texto del activo NO borra inversión/tokens/TP: solo marca
    // que la moneda dejó de estar resuelta y lanza la búsqueda con debounce.
    const value = input.value.trimStart();
    row.crypto = value;
    row.coinId = "";
    row.resolvedName = "";
    row.symbol = "";
    row.priceStatus = value ? "loading" : "idle";
    clearTimeout(editorSearchTimer);
    if (value.trim()) {
      editorSearchTimer = window.setTimeout(() => runEditorSearch(value), SEARCH_DELAY);
    } else {
      renderEditorSuggestions([]);
    }
    scheduleAutosave();
    return;
  }

  if (["investment", "tokens", "entryPrice", "tp1", "tp2", "tp3"].includes(field)) {
    const sanitized = sanitizeNumericInput(input.value);
    if (input.value !== sanitized) {
      input.value = sanitized;
    }
    row[field] = sanitized;
    recalcPositionTriad(row, field);
    updateLiveRowUi(row.id);
    scheduleAutosave();
    return;
  }

  // Nota, fecha y etiqueta: texto libre, no afecta a cálculos.
  row[field] = input.value;
  scheduleAutosave();
}

async function runEditorSearch(query) {
  const row = getRowById(state.editorRowId);
  if (!row) {
    return;
  }
  try {
    const coins = await searchCoins(query);
    if (state.editorRowId !== row.id) {
      return;
    }
    row.suggestions = coins.slice(0, 8);
    renderEditorSuggestions(row.suggestions);
  } catch {
    renderEditorSuggestions([]);
  }
}

function renderEditorSuggestions(coins) {
  const box = editorPortal?.querySelector("[data-editor-role='suggestions']");
  if (!box) {
    return;
  }
  if (!coins.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = coins.map((coin) => `
    <button type="button" class="editor-suggestion" data-editor-coin="${escapeHtml(coin.id)}">
      <img src="${escapeHtml(coin.thumb || "")}" alt="" loading="lazy" />
      <span><strong>${escapeHtml(coin.name)}</strong><small>${escapeHtml(String(coin.symbol || "").toUpperCase())}</small></span>
      <span class="editor-suggestion-rank">${coin.market_cap_rank ? "#" + coin.market_cap_rank : ""}</span>
    </button>
  `).join("");
}

async function selectEditorCoin(coinId) {
  const row = getRowById(state.editorRowId);
  if (!row) {
    return;
  }
  const coin = (row.suggestions || []).find((item) => item.id === coinId);
  if (!coin) {
    return;
  }
  // Seleccionar moneda actualiza identidad y precio, pero conserva inversión,
  // tokens y TP (no se borra nada del capital ya introducido).
  renderEditorSuggestions([]);
  row.coinId = coin.id;
  row.resolvedName = coin.name;
  row.symbol = String(coin.symbol || "").toUpperCase();
  row.crypto = row.symbol || coin.name;
  row.image = coin.thumb || coin.image || row.image || "";
  const cryptoInput = editorPortal.querySelector("[data-editor-field='crypto']");
  if (cryptoInput) {
    cryptoInput.value = row.crypto;
  }
  refreshEditorLiveData();
  scheduleAutosave();
  await refreshSingleRow(row.id, true);
  refreshEditorLiveData();
}

function savePositionEditor() {
  const row = getRowById(state.editorRowId);
  if (row) {
    // Normaliza los numéricos al guardar (igual que hacía el blur de la tabla).
    ["investment", "tokens", "entryPrice", "tp1", "tp2", "tp3"].forEach((field) => {
      row[field] = normalizeNumericString(row[field]);
    });
    persistState(true);
    renderAll();
    updateSaveMessage(t("editor.saved"));
    showToast(t("editor.savedTitle"), t("editor.savedText"), "positive");
  }
  closePositionEditor();
}

/* ── Menú contextual por posición (acciones secundarias) ── */

function openRowMenu(rowId, anchor) {
  closeRowMenu();
  const row = getRowById(rowId);
  if (!row) {
    return;
  }
  const menu = document.createElement("div");
  menu.className = "row-context-menu";
  menu.id = "rowContextMenu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-menu-action="web" ${row.coinId ? "" : "disabled"}>${escapeHtml(t("menu.openWeb"))}</button>
    <button type="button" role="menuitem" data-menu-action="refresh">${escapeHtml(t("menu.refresh"))}</button>
    <button type="button" role="menuitem" data-menu-action="duplicate">${escapeHtml(t("menu.duplicate"))}</button>
    <button type="button" role="menuitem" class="danger" data-menu-action="delete">${escapeHtml(t("menu.delete"))}</button>
  `;
  document.body.appendChild(menu);
  state.rowMenuOpen = rowId;

  const rect = anchor.getBoundingClientRect();
  const menuWidth = 190;
  let left = rect.right - menuWidth;
  left = Math.max(10, Math.min(left, window.innerWidth - menuWidth - 10));
  let top = rect.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 10) {
    top = rect.top - menu.offsetHeight - 6;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(10, top)}px`;

  menu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
    if (action) {
      handleRowMenuAction(rowId, action);
    }
  });

  window.setTimeout(() => {
    document.addEventListener("click", onRowMenuOutside, { once: true });
  }, 0);
}

function onRowMenuOutside(event) {
  if (!event.target.closest("#rowContextMenu")) {
    closeRowMenu();
  }
}

function closeRowMenu() {
  const menu = document.getElementById("rowContextMenu");
  if (menu) {
    menu.remove();
  }
  state.rowMenuOpen = false;
}

function handleRowMenuAction(rowId, action) {
  const row = getRowById(rowId);
  closeRowMenu();
  if (!row) {
    return;
  }
  switch (action) {
    case "web":
      if (row.coinId) {
        window.open(`https://www.coingecko.com/en/coins/${encodeURIComponent(row.coinId)}`, "_blank", "noopener");
      }
      break;
    case "refresh":
      refreshSingleRow(rowId, true);
      break;
    case "duplicate": {
      const copy = createRow({
        ...row,
        id: undefined,
        personalLabel: row.personalLabel
      });
      const index = state.rows.findIndex((item) => item.id === rowId);
      state.rows.splice(index + 1, 0, copy);
      renderAll();
      scheduleAutosave();
      pushActivity(t("menu.duplicate"), t("menu.duplicatedText", { asset: assetDisplayName(row) }), "neutral");
      openPositionEditor(copy.id);
      break;
    }
    case "delete":
      if (!window.confirm(t("menu.deleteConfirm", { asset: assetDisplayName(row) }))) {
        return;
      }
      state.rows = state.rows.filter((item) => item.id !== rowId);
      if (!state.rows.length) {
        state.rows.push(createRow());
      }
      clearTimersForRow(rowId);
      if (state.detailRowId === rowId) {
        closeAssetDetail();
      }
      renderAll();
      scheduleAutosave();
      pushActivity(
        t("alerts.rowDeletedTitle"),
        t("alerts.rowDeletedText", { asset: assetDisplayName(row) }),
        "negative"
      );
      break;
    default:
      break;
  }
}
