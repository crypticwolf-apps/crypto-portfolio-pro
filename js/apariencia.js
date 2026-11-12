// =============================================================================
// apariencia.js - Ajustes -> Apariencia: tema (claro, oscuro, automatico),
// negro puro, color de acento, tamano del texto, densidad, decimales,
// privacidad al abrir, saldos pequenos, dato de la lista y los bloques de
// Inicio (cuales se ven y en que orden).
// Los atributos de <html> que lee el CSS los pone applyAppearance(); el
// script del <head> hace lo mismo antes de pintar para que no parpadee.
// =============================================================================

const ICONO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const ICONO_ASA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
// Saldo de ejemplo de la vista previa (no es el del usuario).
const VISTA_PREVIA = { total: 10940, cambio: 3940, pct: 56.29 };

function applyAppearance() {
  const root = document.documentElement;
  root.dataset.accent = state.prefs.accent;
  root.dataset.texto = state.prefs.textSize;
  root.dataset.espacio = state.prefs.spacing;
  applyTheme();
  applyHomeBlocks();
}

function bindAppearance() {
  const panel = document.getElementById("aparienciaPanel");
  if (!panel) {
    return;
  }
  renderAccentOptions();
  renderHomeBlocksList();
  renderAppearanceControls();

  panel.addEventListener("click", (event) => {
    const theme = event.target.closest("[data-tema-set]");
    if (theme) {
      setTheme(theme.dataset.temaSet);
      return;
    }
    const accent = event.target.closest("[data-acento-set]");
    if (accent) {
      updateAppearance("accent", accent.dataset.acentoSet, APARIENCIA.acentos);
      return;
    }
    const text = event.target.closest("[data-texto-set]");
    if (text) {
      updateAppearance("textSize", text.dataset.textoSet, APARIENCIA.textos);
      return;
    }
    const spacing = event.target.closest("[data-espacio-set]");
    if (spacing) {
      updateAppearance("spacing", spacing.dataset.espacioSet, APARIENCIA.espacios);
      return;
    }
    const metric = event.target.closest("[data-metrica-set]");
    if (metric) {
      updateAppearance("listMetric", metric.dataset.metricaSet, APARIENCIA.metricas);
      return;
    }
    const toggle = event.target.closest("[data-ajuste]");
    if (toggle) {
      toggleAppearanceSwitch(toggle.dataset.ajuste);
      return;
    }
    const block = event.target.closest("[data-bloque-switch]");
    if (block) {
      const item = state.prefs.homeBlocks.find((entry) => entry.id === block.dataset.bloqueSwitch);
      if (item) {
        item.on = !item.on;
        savePreferences();
        applyHomeBlocks();
        renderHomeBlocksList();
      }
    }
  });

  bindHomeBlocksDrag(document.getElementById("bloquesInicio"));

  // Tema automatico: sigue en vivo al del sistema.
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const onSystemChange = () => {
    if (state.prefs.theme === "auto") {
      applyTheme();
      renderDashboardOnly();
    }
  };
  if (media?.addEventListener) {
    media.addEventListener("change", onSystemChange);
  } else if (media?.addListener) {
    media.addListener(onSystemChange);
  }
}

function updateAppearance(key, value, options) {
  if (!options.includes(value) || state.prefs[key] === value) {
    return;
  }
  state.prefs[key] = value;
  savePreferences();
  applyAppearance();
  if (key === "listMetric") {
    renderAll();
  } else {
    // Acento, texto o densidad: los graficos de Analitica leen los colores
    // y medidas al pintarse.
    renderDashboardOnly();
  }
}

function toggleAppearanceSwitch(key) {
  if (!["oled", "decimals", "hideOnOpen", "groupSmall"].includes(key)) {
    return;
  }
  state.prefs[key] = !state.prefs[key];
  savePreferences();
  if (key === "oled") {
    applyTheme();
    return;
  }
  renderAppearanceControls();
  if (key === "decimals" || key === "groupSmall") {
    renderAll();
  }
}

// Estado visible de todos los mandos del panel.
function renderAppearanceControls() {
  const panel = document.getElementById("aparienciaPanel");
  if (!panel) {
    return;
  }
  const pressed = (selector, attr, value) => {
    panel.querySelectorAll(selector).forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset[attr] === value ? "true" : "false");
    });
  };
  pressed("[data-tema-set]", "temaSet", state.prefs.theme);
  pressed("[data-acento-set]", "acentoSet", state.prefs.accent);
  pressed("[data-texto-set]", "textoSet", state.prefs.textSize);
  pressed("[data-espacio-set]", "espacioSet", state.prefs.spacing);
  pressed("[data-metrica-set]", "metricaSet", state.prefs.listMetric);
  panel.querySelectorAll("[data-ajuste]").forEach((button) => {
    button.setAttribute("aria-checked", state.prefs[button.dataset.ajuste] ? "true" : "false");
  });

  // El negro puro solo se ve en oscuro: en claro el interruptor se apaga a
  // la vista pero conserva la eleccion para cuando se vuelva al oscuro.
  const oledRow = panel.querySelector("[data-ajuste='oled']");
  if (oledRow) {
    const dark = resolvedTheme() === "dark";
    oledRow.disabled = !dark;
    oledRow.setAttribute("aria-checked", state.prefs.oled && dark ? "true" : "false");
  }

  const hint = document.getElementById("agruparHint");
  if (hint) {
    hint.textContent = t("apariencia.agruparHint", { importe: formatCurrency(SALDO_PEQUENO, 0) });
  }

  const preview = document.getElementById("vistaPreviaValor");
  if (preview) {
    const parts = moneyParts(VISTA_PREVIA.total);
    preview.innerHTML = `${escapeHtml(parts.main)}<span class="saldo-resto">${escapeHtml(parts.rest)}</span>`;
  }
  const previewChange = document.getElementById("vistaPreviaCambio");
  if (previewChange) {
    previewChange.textContent = `${formatSignedCurrency(VISTA_PREVIA.cambio)} · ${formatPercent(VISTA_PREVIA.pct)}`;
  }
}

function renderAccentOptions() {
  const box = document.getElementById("acentos");
  if (!box) {
    return;
  }
  box.innerHTML = APARIENCIA.acentos.map((id) => `
    <button class="acento-opcion" type="button" data-acento-set="${id}" aria-pressed="false">
      <span class="acento-muestra ${id}">${ICONO_CHECK}</span>
      <span>${escapeHtml(t(`apariencia.acento.${id}`))}</span>
    </button>
  `).join("");
}

// ── Bloques de Inicio: interruptor y asa para ordenar ──
function renderHomeBlocksList() {
  const list = document.getElementById("bloquesInicio");
  if (!list) {
    return;
  }
  state.prefs.homeBlocks = normalizeHomeBlocks(state.prefs.homeBlocks);
  list.innerHTML = state.prefs.homeBlocks.map(({ id, on }) => {
    const name = t(`apariencia.bloque.${id}`);
    return `
      <li class="bloque-item ${on ? "" : "apagado"}" data-bloque-id="${id}">
        <button class="bloque-asa" type="button" data-asa aria-label="${escapeHtml(t("apariencia.mover", { bloque: name }))}">${ICONO_ASA}</button>
        <span class="bloque-nombre" id="bloqueNombre-${id}">${escapeHtml(name)}</span>
        <button class="interruptor" type="button" role="switch" aria-checked="${on ? "true" : "false"}" aria-labelledby="bloqueNombre-${id}" data-bloque-switch="${id}"></button>
      </li>
    `;
  }).join("");
}

// Lee el orden que ha quedado en la lista y lo guarda.
function saveHomeBlocksOrder(list) {
  const byId = new Map(state.prefs.homeBlocks.map((entry) => [entry.id, entry]));
  state.prefs.homeBlocks = normalizeHomeBlocks(
    [...list.querySelectorAll("[data-bloque-id]")].map((item) => byId.get(item.dataset.bloqueId))
  );
  savePreferences();
  applyHomeBlocks();
}

function bindHomeBlocksDrag(list) {
  if (!list) {
    return;
  }
  let dragging = null;

  // El bloque se coloca delante del primero cuyo centro queda por debajo del
  // dedo: se mueve en el DOM al momento, sin animaciones que medir.
  const onMove = (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) {
      return;
    }
    const others = [...list.querySelectorAll(".bloque-item")].filter((item) => item !== dragging.item);
    const before = others.find((item) => {
      const box = item.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (before) {
      if (dragging.item.nextElementSibling !== before) {
        list.insertBefore(dragging.item, before);
        dragging.moved = true;
      }
    } else if (list.lastElementChild !== dragging.item) {
      list.appendChild(dragging.item);
      dragging.moved = true;
    }
  };
  // Mover el bloque en el DOM le quita la captura del puntero: por eso el
  // movimiento y el soltar se escuchan en la ventana mientras dura el
  // arrastre (si el dedo sale de la lista, el soltar igual llega).
  const finish = (event) => {
    if (!dragging || (event && event.pointerId !== dragging.pointerId)) {
      return;
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    dragging.item.classList.remove("arrastrando");
    if (dragging.moved) {
      saveHomeBlocksOrder(list);
    }
    dragging = null;
  };

  list.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-asa]");
    if (!handle || dragging || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    dragging = { item: handle.closest(".bloque-item"), pointerId: event.pointerId, moved: false };
    dragging.item.classList.add("arrastrando");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    event.preventDefault();
  });

  // Teclado: flechas arriba y abajo sobre el asa.
  list.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-asa]");
    if (!handle || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }
    event.preventDefault();
    const item = handle.closest(".bloque-item");
    const sibling = event.key === "ArrowUp" ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling) {
      return;
    }
    if (event.key === "ArrowUp") {
      list.insertBefore(item, sibling);
    } else {
      list.insertBefore(sibling, item);
    }
    handle.focus();
    saveHomeBlocksOrder(list);
  });
}
