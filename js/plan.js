// =============================================================================
// plan.js - Pestana Plan: herramienta de toma de beneficios (TP progresivo y
// completo, por activo y global).
// =============================================================================

/* ═══════════════════════════════════════════════════════
   HERRAMIENTAS — Rebalanceo con nueva aportación + Simulador
   de Take Profits. Solo cálculo con los datos del usuario.
   ═══════════════════════════════════════════════════════ */

function savePlan() {
  state.prefs.plan = { ...state.plan };
  savePreferences();
}

function planClamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Posiciones aptas (con activo definido). Usa coste real cuando existe.
function getPlanPositions() {
  return state.rows
    .filter((row) => row.crypto.trim())
    .map((row) => {
      const m = computeRowMetrics(row);
      return {
        row,
        id: row.id,
        name: assetDisplayName(row),
        symbol: row.symbol || "",
        tokens: m.tokens,
        investment: m.investment,
        avg: m.entryPrice,
        price: m.currentPrice,
        value: m.currentValue,
        pnlPct: m.pnlPct,
        tp1: m.tp1,
        tp2: m.tp2,
        tp3: m.tp3,
        cat: getAssetCategory(row),
        marketCap: Number.isFinite(row.marketCap) ? row.marketCap : 0
      };
    });
}

/* ── Simulador de Take Profits ── */
function getTpConfig(rowId) {
  // Precio del TP en la fila (editor/CSV); % de venta aquí.
  const def = { p1: 30, p2: 50, p3: 100 };
  return { ...def, ...((state.plan.tp || {})[rowId] || {}) };
}
function setTpConfig(rowId, patch) {
  state.plan.tp = state.plan.tp || {};
  state.plan.tp[rowId] = { ...getTpConfig(rowId), ...patch };
  savePlan();
}

// Coste histórico del activo (usa inversión real si existe; si no, tokens × medio).
function tpCost(p) {
  return p.investment > 0 ? p.investment : p.tokens * p.avg;
}

// Devuelve los niveles TP configurados (TP1-TP3), en orden, sólo con precio > 0.
function getTpLevels(p) {
  const cfg = getTpConfig(p.id);
  const raw = [
    { price: p.tp1, pct: cfg.p1 },
    { price: p.tp2, pct: cfg.p2 },
    { price: p.tp3, pct: cfg.p3 }
  ];
  return raw
    .map((l, idx) => ({
      idx,
      label: `TP${idx + 1}`,
      price: Number(l.price) || 0,
      pct: planClamp(Number(l.pct) || 0, 0, 100)
    }))
    .filter((l) => l.price > 0);
}

// Salida progresiva: cada porcentaje se aplica sobre lo que queda.
function computeTpProgressive(p) {
  const levels = getTpLevels(p);
  const cost = tpCost(p);
  let rem = p.tokens;
  let out = 0;
  let acc = 0;
  const steps = levels.map((l) => {
    const sold = rem * (l.pct / 100);
    const income = sold * l.price;
    rem -= sold;
    out += income;
    acc += income;
    return {
      idx: l.idx, label: l.label, price: l.price, pct: l.pct,
      sold, remaining: rem, income, accIncome: acc,
      remainingValue: p.price > 0 ? rem * p.price : 0,
      reached: p.price > 0 && p.price >= l.price
    };
  });
  const remainingValue = p.price > 0 ? rem * p.price : 0;
  const totalOut = out;
  const profit = totalOut + remainingValue - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  return {
    hasTp: levels.length > 0, levels, steps,
    remaining: rem, remainingValue, totalOut, cost, profit, roi,
    noData: !(p.price > 0) || !(p.tokens > 0)
  };
}

// Venta del 100% de la posición en cada TP por separado (no acumulativo).
function computeTpFull(p) {
  const cost = tpCost(p);
  return getTpLevels(p).map((l) => {
    const income = p.tokens * l.price;
    const profit = income - cost;
    return {
      idx: l.idx, label: l.label, price: l.price, income, cost, profit,
      roi: cost > 0 ? (profit / cost) * 100 : 0,
      reached: p.price > 0 && p.price >= l.price
    };
  });
}

// Resumen global BLOQUE 1: suma de todas las salidas progresivas de la cartera.
function computeTpGlobalProgressive() {
  const positions = getPlanPositions().filter((p) => p.tokens > 0);
  let invested = 0, currentValue = 0, totalOut = 0, remainingValue = 0, profit = 0;
  const phases = [0, 0, 0];       // ingreso vendido en cada TP
  const phaseRemain = [0, 0, 0];  // valor aún en cartera tras cada TP
  const levelUsed = [false, false, false];
  const rows = [];
  const noTp = [];
  positions.forEach((p) => {
    const sim = computeTpProgressive(p);
    if (!sim.hasTp) { noTp.push(p); return; }
    invested += sim.cost;
    currentValue += p.value;
    totalOut += sim.totalOut;
    remainingValue += sim.remainingValue;
    profit += sim.profit;
    const stepByIdx = {};
    sim.steps.forEach((s) => { stepByIdx[s.idx] = s; phases[s.idx] += s.income; levelUsed[s.idx] = true; });
    // Reparte el valor restante por fase arrastrando lo que queda del activo.
    let remTokens = p.tokens;
    for (let k = 0; k < 3; k++) {
      if (stepByIdx[k]) remTokens = stepByIdx[k].remaining;
      if (levelUsed[k] || k < sim.levels.length) phaseRemain[k] += p.price > 0 ? remTokens * p.price : 0;
    }
    rows.push({ p, sim });
  });
  const phaseAcc = [];
  let running = 0;
  for (let k = 0; k < 3; k++) { running += phases[k]; phaseAcc[k] = running; }
  const estTotal = totalOut + remainingValue;
  const roi = invested > 0 ? ((estTotal - invested) / invested) * 100 : 0;
  return {
    invested, currentValue, totalOut, remainingValue, estTotal, profit, roi,
    phases, phaseAcc, phaseRemain, levelUsed, rows, noTp,
    count: rows.length, total: positions.length
  };
}

// Resumen global BLOQUE 2: vender el 100% de toda la cartera en un único TP.
function computeTpGlobalFull() {
  const positions = getPlanPositions().filter((p) => p.tokens > 0);
  const scenarios = [0, 1, 2].map((k) => ({ idx: k, label: `TP${k + 1}`, total: 0, invested: 0, count: 0 }));
  positions.forEach((p) => {
    const cost = tpCost(p);
    getTpLevels(p).forEach((l) => {
      const sc = scenarios[l.idx];
      sc.total += p.tokens * l.price;
      sc.invested += cost;
      sc.count += 1;
    });
  });
  return scenarios
    .filter((sc) => sc.count > 0)
    .map((sc) => ({
      ...sc,
      profit: sc.total - sc.invested,
      roi: sc.invested > 0 ? ((sc.total - sc.invested) / sc.invested) * 100 : 0
    }));
}

/* ── Render de la pestaña Plan: únicamente el Simulador de Take Profit ── */
function renderPlan() {
  const box = document.getElementById("planContent");
  if (!box) return;
  renderTpTool();
}

// Sección plegable del Plan. Todo empieza cerrado; el estado de apertura vive
// en tpFolds para que no se cierre al re-renderizar mientras se editan los TP.
// Etiqueta del botón global según haya o no secciones abiertas.
function updateFoldAllBtn() {
  const btn = document.getElementById("planFoldAllBtn");
  if (!btn) return;
  const anyOpen = tpFolds.size > 0;
  btn.textContent = anyOpen ? t("tp.collapseAll") : t("tp.expandAll");
  btn.setAttribute("aria-expanded", anyOpen ? "true" : "false");
}

function tpFold(key, cls, headHtml, bodyHtml) {
  const open = tpFolds.has(key);
  return `
    <details class="panel tp-fold ${cls}" data-fold="${escapeHtml(key)}"${open ? " open" : ""}>
      <summary class="tp-fold-sum">${headHtml}<span class="tp-fold-chev" aria-hidden="true">▾</span></summary>
      <div class="tp-fold-body">${bodyHtml}</div>
    </details>`;
}

function renderTpTool() {
  const box = document.getElementById("planContent");
  if (!box) return;
  const positions = getPlanPositions().filter((p) => p.tokens > 0);
  if (!positions.length) {
    box.innerHTML = `<div class="panel plan-empty detail-empty"><strong>${escapeHtml(t("tp.emptyTitle"))}</strong><p>${escapeHtml(t("tp.emptyText"))}</p></div>`;
    return;
  }
  const money = (v) => maskedCurrency(v);
  const prog = computeTpGlobalProgressive();
  const full = computeTpGlobalFull();
  const usedLevels = [0, 1, 2].filter((k) => prog.levelUsed[k]);

  // ── BLOQUE 1: resumen global de TP progresivos ──
  const progPhaseCells = usedLevels
    .map((k) => `<div><span>${escapeHtml(t("tp.totalIn", { tp: "TP" + (k + 1) }))}</span><b>${money(prog.phases[k])}</b></div>`)
    .join("");
  const progTableRows = usedLevels
    .map((k, i) => `<div class="tpg-row"><span>TP${k + 1}</span><span>${money(prog.phases[k])}</span><span>${money(prog.phaseAcc[k])}</span><span>${money(prog.phaseRemain[k])}</span><span class="tpg-exp">${escapeHtml(i === 0 ? t("tp.expFirst") : t("tp.expNext"))}</span></div>`)
    .join("");
  const block1 = tpFold("prog", "tp-block tp-block-prog",
    `<span class="tp-block-badge">1</span><span class="tp-fold-txt"><strong>${escapeHtml(t("tp.progTitle"))}</strong><small>${escapeHtml(t("tp.progSubtitle"))}</small></span>`,
    `
      ${prog.count ? `
      <div class="tp-global-grid">
        <div><span>${escapeHtml(t("tp.grandTotal"))}</span><b>${money(prog.totalOut)}</b></div>
        <div><span>${escapeHtml(t("tp.profit"))}</span><b class="${prog.profit >= 0 ? "positive" : "negative"}">${maskedSignedCurrency(prog.profit)}</b></div>
        <div><span>${escapeHtml(t("tp.roi"))}</span><b class="${prog.roi >= 0 ? "positive" : "negative"}">${formatPercent(prog.roi)}</b></div>
        <div><span>${escapeHtml(t("tp.remainingAfter"))}</span><b>${money(prog.remainingValue)}</b></div>
        ${progPhaseCells}
      </div>
      <div class="tp-global-table tp-table-prog">
        <div class="tpg-row tpg-head"><span>TP</span><span>${escapeHtml(t("tp.collected"))}</span><span>${escapeHtml(t("tp.accumulated"))}</span><span>${escapeHtml(t("tp.remainValue"))}</span><span>${escapeHtml(t("tp.explanation"))}</span></div>
        ${progTableRows}
      </div>` : `<p class="plan-hint">${escapeHtml(t("tp.noneConfigured"))}</p>`}
    `);

  // ── BLOQUE 2: resumen global de venta 100% en cada TP ──
  const fullCards = full
    .map((sc) => `
      <div class="tp-scenario">
        <div class="tp-scenario-top"><strong>${escapeHtml(t("tp.sell100at", { tp: sc.label }))}</strong><b>${money(sc.total)}</b></div>
        <div class="tp-scenario-grid">
          <div><span>${escapeHtml(t("tp.profit"))}</span><b class="${sc.profit >= 0 ? "positive" : "negative"}">${maskedSignedCurrency(sc.profit)}</b></div>
          <div><span>${escapeHtml(t("tp.roi"))}</span><b class="${sc.roi >= 0 ? "positive" : "negative"}">${formatPercent(sc.roi)}</b></div>
        </div>
      </div>`)
    .join("");
  const fullTableRows = full
    .map((sc) => `<div class="tpg-row"><span>${escapeHtml(t("tp.sell100at", { tp: sc.label }))}</span><span>${money(sc.total)}</span><span class="${sc.profit >= 0 ? "positive" : "negative"}">${maskedSignedCurrency(sc.profit)}</span><span class="${sc.roi >= 0 ? "positive" : "negative"}">${formatPercent(sc.roi)}</span></div>`)
    .join("");
  const block2 = tpFold("full", "tp-block tp-block-full",
    `<span class="tp-block-badge">2</span><span class="tp-fold-txt"><strong>${escapeHtml(t("tp.fullTitle"))}</strong><small>${escapeHtml(t("tp.fullSubtitle"))}</small></span>`,
    `
      ${full.length ? `
      <div class="tp-scenarios">${fullCards}</div>
      <div class="tp-global-table tp-table-full">
        <div class="tpg-row tpg-head"><span>${escapeHtml(t("tp.scenario"))}</span><span>${escapeHtml(t("tp.estTotal"))}</span><span>${escapeHtml(t("tp.profit"))}</span><span>${escapeHtml(t("tp.roi"))}</span></div>
        ${fullTableRows}
      </div>` : `<p class="plan-hint">${escapeHtml(t("tp.noneConfigured"))}</p>`}
    `);

  // ── BLOQUE 3: tabla comparativa global por activo ──
  const block3 = prog.count ? tpFold("compare", "",
    `<span class="tp-fold-txt"><strong>${escapeHtml(t("tp.compareTitle"))}</strong></span>`,
    `
      <div class="tp-global-table tp-table-compare" style="--tp-cols:${usedLevels.length + 2}">
        <div class="tpg-row tpg-head"><span>${escapeHtml(t("reb.asset"))}</span>${usedLevels.map((k) => `<span>TP${k + 1}</span>`).join("")}<span>${escapeHtml(t("tp.total"))}</span></div>
        ${prog.rows.map((r) => {
          const byIdx = {};
          r.sim.steps.forEach((s) => { byIdx[s.idx] = s.income; });
          return `<div class="tpg-row"><span>${escapeHtml(r.p.symbol || r.p.name)}</span>${usedLevels.map((k) => `<span>${money(byIdx[k] || 0)}</span>`).join("")}<span>${money(r.sim.totalOut)}</span></div>`;
        }).join("")}
      </div>
    `) : "";

  // Línea de precio con marcadores: medio, actual y cada TP.
  // Escala lineal entre el mínimo y el máximo de los precios relevantes.
  const buildTpPriceLine = (p, sim) => {
    const entry = p.avg > 0 ? p.avg : 0;
    const cur = p.price > 0 ? p.price : 0;
    const levels = sim.levels || [];
    const pts = [entry, cur, ...levels.map((l) => l.price)].filter((v) => v > 0);
    if (!(entry > 0) || !(cur > 0) || pts.length < 2) return "";
    let lo = Math.min(...pts);
    let hi = Math.max(...pts);
    const pad = (hi - lo || hi || 1) * 0.12;
    lo -= pad; hi += pad;
    const span = (hi - lo) || 1;
    const xPct = (v) => Math.max(3, Math.min(97, ((v - lo) / span) * 100));
    const entryX = xPct(entry);
    const curX = xPct(cur);
    const up = cur >= entry;
    const fillLeft = Math.min(entryX, curX);
    const fillW = Math.abs(curX - entryX);
    const ticks = levels.map((l) => {
      const reached = cur >= l.price;
      const dist = ((l.price - cur) / cur) * 100;
      const title = `${l.label} · ${formatCurrency(l.price, getPriceDigits(l.price))} · ${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%`;
      return `<span class="tpl-tp ${reached ? "reached" : "pending"}" style="left:${xPct(l.price)}%" title="${escapeHtml(title)}"></span>`;
    }).join("");
    const labels = levels.map((l) => {
      const reached = cur >= l.price;
      return `<span class="tpl-tp-lbl ${reached ? "reached" : "pending"}" style="left:${xPct(l.price)}%">${l.label}${reached ? " ✓" : ""}</span>`;
    }).join("");
    return `
      <div class="tp-line" role="img" aria-label="${escapeHtml(t("tp.lineAria"))}">
        <div class="tpl-top">
          <span class="tpl-now-lbl ${up ? "up" : "down"}" style="left:${curX}%">${formatCurrency(cur, getPriceDigits(cur))}</span>
        </div>
        <div class="tpl-track">
          <span class="tpl-fill ${up ? "up" : "down"}" style="left:${fillLeft}%; width:${fillW}%"></span>
          ${ticks}
          <span class="tpl-entry" style="left:${entryX}%" title="${escapeHtml(t("tp.avg") + " " + formatCurrency(entry, getPriceDigits(entry)))}"></span>
          <span class="tpl-now" style="left:${curX}%"></span>
        </div>
        <div class="tpl-below">
          <span class="tpl-entry-lbl" style="left:${entryX}%">${escapeHtml(t("tp.avg"))}</span>
          ${labels}
        </div>
      </div>`;
  };

  // ── BLOQUE 4-6: detalle por activo ──
  const perAsset = positions.map((p) => {
    const sim = computeTpProgressive(p);
    const fullA = computeTpFull(p);
    const cfg = getTpConfig(p.id);
    const noData = !(p.price > 0);

    // Solo TP1-TP3 (precio en la fila). Se muestran los TP con precio
    // + un único slot vacío para añadir el siguiente.
    const levelDefs = [
      { key: "tp1", label: "TP1", raw: p.row.tp1, price: p.tp1, pctKey: "p1" },
      { key: "tp2", label: "TP2", raw: p.row.tp2, price: p.tp2, pctKey: "p2" },
      { key: "tp3", label: "TP3", raw: p.row.tp3, price: p.tp3, pctKey: "p3" }
    ];
    let addShown = false;
    const display = [];
    levelDefs.forEach((l) => {
      if (l.price > 0) display.push({ ...l, isAdd: false });
      else if (!addShown) { display.push({ ...l, isAdd: true }); addShown = true; }
    });
    const configRows = display.map((l) => `
      <div class="tp-config-row${l.isAdd ? " is-add" : ""}">
        <span class="tp-config-label">${l.label}</span>
        <input class="tp-config-price" type="text" inputmode="decimal" data-tp-rowprice="${l.key}" data-row-id="${p.id}" value="${escapeHtml(l.raw || "")}" placeholder="${escapeHtml(t("tp.price"))}" />
        <span class="tp-config-pct"><input type="text" inputmode="decimal" data-tp-field="${l.pctKey}" data-row-id="${p.id}" value="${planClamp(Number(cfg[l.pctKey]) || 0, 0, 100)}" />%</span>
        ${l.isAdd
          ? `<span class="tp-config-del-spacer" aria-hidden="true"></span>`
          : `<button class="tp-config-del" type="button" data-tp-del="${l.key}" data-row-id="${p.id}" aria-label="${escapeHtml(t("tp.deleteLevel"))}" title="${escapeHtml(t("tp.deleteLevel"))}">✕</button>`}
      </div>`).join("");

    // Cabecera plegable: identidad del activo + su rendimiento estimado, para
    // poder comparar activos sin necesidad de desplegarlos.
    const foldKey = "asset:" + p.id;
    const head = `
      <span class="asset-avatar">${renderAssetAvatar(p.row)}</span>
      <span class="tp-fold-txt tp-card-id"><strong>${escapeHtml(p.name)}</strong><small>${state.prefs.hideBalance ? "••••" : formatNumber(p.tokens, p.tokens >= 1 ? 4 : 8)} · ${escapeHtml(t("tp.avg"))} ${p.avg > 0 ? maskedCurrency(p.avg, getPriceDigits(p.avg)) : "--"} · ${escapeHtml(t("tp.now"))} ${p.price > 0 ? formatCurrency(p.price, getPriceDigits(p.price)) : "--"}</small></span>
      ${sim.hasTp && !noData ? `<span class="tp-fold-badge ${sim.profit >= 0 ? "positive" : "negative"}">${maskedSignedCurrency(sim.profit)}</span>` : ""}`;
    const configBlock = `<div class="tp-config"><div class="tp-config-legend"><span>${escapeHtml(t("tp.price"))}</span><span>${escapeHtml(t("tp.pctSell"))}</span></div>${configRows}</div>`;

    if (noData) {
      return tpFold(foldKey, "tp-card", head, `${configBlock}<p class="plan-hint tp-warn">${escapeHtml(t("tp.noData"))}</p>`);
    }
    if (!sim.hasTp) {
      return tpFold(foldKey, "tp-card", head, `${configBlock}<p class="plan-hint">${escapeHtml(t("tp.noTargets"))}</p>`);
    }

    const steps = sim.steps.map((s) => `
      <div class="tp-step${s.reached ? " tp-step-reached" : ""}">
        <div class="tp-step-top"><strong>${s.label}</strong><span>${formatCurrency(s.price, getPriceDigits(s.price))} · ${s.pct.toFixed(0)}%${s.reached ? ` <em class="tp-reached-tag">${escapeHtml(t("tp.reachedTag"))}</em>` : ""}</span></div>
        <div class="tp-step-grid">
          <div><span>${escapeHtml(t("tp.sold"))}</span><b>${formatNumber(s.sold, s.sold >= 1 ? 4 : 8)}</b></div>
          <div><span>${escapeHtml(t("tp.remaining"))}</span><b>${formatNumber(s.remaining, s.remaining >= 1 ? 4 : 8)}</b></div>
          <div><span>${escapeHtml(t("tp.income"))}</span><b class="positive">${money(s.income)}</b></div>
        </div>
      </div>`).join("");
    const fullRows = fullA.map((f) => `<div><span>${f.label} 100%${f.reached ? ` <em class="tp-reached-tag">${escapeHtml(t("tp.reachedTag"))}</em>` : ""}</span><b>${money(f.income)}</b><small class="${f.roi >= 0 ? "positive" : "negative"}">${formatPercent(f.roi)}</small></div>`).join("");
    return tpFold(foldKey, "tp-card", head, `
        ${buildTpPriceLine(p, sim)}
        ${configBlock}
        <div class="tp-steps">${steps}</div>
        <div class="tp-summary">
          <div><span>${escapeHtml(t("tp.totalOut"))}</span><b>${money(sim.totalOut)}</b></div>
          <div><span>${escapeHtml(t("tp.remainValue"))}</span><b>${money(sim.remainingValue)}</b></div>
          <div><span>${escapeHtml(t("tp.profit"))}</span><b class="${sim.profit >= 0 ? "positive" : "negative"}">${maskedSignedCurrency(sim.profit)}</b></div>
          <div><span>${escapeHtml(t("tp.roi"))}</span><b class="${sim.roi >= 0 ? "positive" : "negative"}">${formatPercent(sim.roi)}</b></div>
        </div>
        <div class="tp-full"><span class="tp-full-label">${escapeHtml(t("tp.full100"))}</span><div class="tp-full-grid">${fullRows}</div></div>
      `);
  }).join("");

  // ── BLOQUE 7: avisos de activos sin TP ──
  const noTpNotice = prog.noTp.length
    ? `<section class="panel tp-notice"><strong>${escapeHtml(t("tp.noTpTitle"))}</strong><p class="plan-hint">${prog.noTp.map((p) => escapeHtml(p.symbol || p.name)).join(" · ")}</p></section>`
    : "";

  // ── Barra rápida: aplicar los % TP1-TP3 a todos los activos de golpe ──
  const tpAll = state.plan.tpAll || { p1: 30, p2: 50, p3: 100 };
  const quickBar = tpFold("quick", "tp-quick",
    `<span class="tp-fold-txt"><strong>${escapeHtml(t("tp.applyAllTitle"))}</strong><small>${escapeHtml(t("tp.applyAllHint"))}</small></span>`,
    `
      <div class="tp-quick-row">
        <label class="tp-quick-field">TP1<input type="text" inputmode="decimal" data-tp-all="p1" value="${planClamp(Number(tpAll.p1) || 0, 0, 100)}" />%</label>
        <label class="tp-quick-field">TP2<input type="text" inputmode="decimal" data-tp-all="p2" value="${planClamp(Number(tpAll.p2) || 0, 0, 100)}" />%</label>
        <label class="tp-quick-field">TP3<input type="text" inputmode="decimal" data-tp-all="p3" value="${planClamp(Number(tpAll.p3) || 0, 0, 100)}" />%</label>
        <button class="primary-btn tp-quick-btn" type="button" data-plan-action="tpApplyAll">${escapeHtml(t("tp.applyAllBtn"))}</button>
      </div>
    `);

  box.innerHTML = `
    ${block1}
    ${block2}
    ${block3}
    <div class="tp-detail-head"><h2 class="home-section-title">${escapeHtml(t("tp.detailTitle"))}</h2></div>
    ${perAsset}
    ${noTpNotice}
    ${quickBar}
    <p class="plan-disclaimer">${escapeHtml(PLAN_DISCLAIMER)}</p>
  `;
  updateFoldAllBtn();
}

/* ── Bindings ── */
function bindPlan() {
  const box = document.getElementById("planContent");
  if (!box) return;

  // El botón de plegar/desplegar vive en la cabecera, fuera de #planContent.
  document.getElementById("planFoldAllBtn")?.addEventListener("click", () => handlePlanAction("foldAll"));

  // Mantiene tpFolds al día: el estado abierto sobrevive a los re-renders.
  // Se refresca la etiqueta del botón global sin repintar toda la vista.
  box.addEventListener("toggle", (event) => {
    const fold = event.target.closest && event.target.closest("details.tp-fold");
    if (!fold) return;
    const key = fold.dataset.fold;
    if (fold.open) tpFolds.add(key); else tpFolds.delete(key);
    updateFoldAllBtn();
  }, true);

  box.addEventListener("click", (event) => {
    const tpDel = event.target.closest("[data-tp-del]");
    if (tpDel) {
      const r = getRowById(tpDel.dataset.rowId);
      const key = tpDel.dataset.tpDel;
      if (r && (key === "tp1" || key === "tp2" || key === "tp3")) {
        r[key] = "";
        if (r.alertsFired) r.alertsFired[key] = false;
        persistState(true);
        updateLiveRowUi(r.id);
      }
      renderTpTool();
      return;
    }
    const tpEdit = event.target.closest("[data-tp-edit]");
    if (tpEdit) { openPositionEditor(tpEdit.dataset.tpEdit); return; }
    const action = event.target.closest("[data-plan-action]")?.dataset.planAction;
    if (action) handlePlanAction(action);
  });

  // Commit en "change" (blur/enter) para no perder el foco mientras se escribe.
  box.addEventListener("change", (event) => {
    const tpField = event.target.closest("[data-tp-field]");
    if (tpField) {
      setTpConfig(tpField.dataset.rowId, { [tpField.dataset.tpField]: planClamp(parseDecimal(tpField.value), 0, 100) });
      renderTpTool();
      return;
    }
    const tpRowPrice = event.target.closest("[data-tp-rowprice]");
    if (tpRowPrice) {
      const r = getRowById(tpRowPrice.dataset.rowId);
      if (r) {
        const key = tpRowPrice.dataset.tpRowprice;
        r[key] = sanitizeNumericInput(tpRowPrice.value);
        if (r.alertsFired) r.alertsFired[key] = false;
        persistState(true);
        updateLiveRowUi(r.id);
      }
      renderTpTool();
    }
  });
}

function handlePlanAction(action) {
  switch (action) {
    case "foldAll": {
      // Si hay algo abierto → plegar todo; si todo está plegado → desplegar.
      const folds = document.querySelectorAll("#planContent details.tp-fold");
      const collapse = tpFolds.size > 0;
      folds.forEach((d) => {
        d.open = !collapse;
        if (collapse) tpFolds.delete(d.dataset.fold);
        else tpFolds.add(d.dataset.fold);
      });
      updateFoldAllBtn();
      break;
    }
    case "tpApplyAll": {
      const box = document.getElementById("planContent");
      if (!box) break;
      const read = (k) => planClamp(parseDecimal(box.querySelector(`[data-tp-all="${k}"]`)?.value), 0, 100);
      const vals = { p1: read("p1"), p2: read("p2"), p3: read("p3") };
      state.plan.tpAll = vals;
      savePlan();
      getPlanPositions().forEach((p) => setTpConfig(p.id, vals));
      renderTpTool();
      showToast(t("tp.appliedTitle"), t("tp.appliedText"), "positive");
      break;
    }
    default:
      break;
  }
}
