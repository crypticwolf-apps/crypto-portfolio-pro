/* ═══════════════════════════════════════════════════════
   finance.js — ÚNICA fuente de verdad para los cálculos
   financieros (compras, ventas, cantidades, coste medio,
   beneficio realizado/no realizado y rentabilidad).

   Funciones puras, sin dependencias de estado ni DOM, para
   poder probarlas de forma aislada. Se exponen como
   `window.CryptoFinance` en el navegador y como módulo
   (module.exports) para el runner de pruebas (Vitest/Node).
   ═══════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CryptoFinance = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Redondeo decimal estable: evita restos de coma flotante como 0.1+0.2.
  // Se usa solo internamente para neutralizar el error de representación,
  // no para recortar precisión significativa de los tokens.
  function round(value, decimals) {
    if (!Number.isFinite(value)) return 0;
    const f = Math.pow(10, decimals == null ? 12 : decimals);
    return Math.round((value + Number.EPSILON) * f) / f;
  }

  function toNum(v) {
    const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  // ── Compra ──
  // Entrada: importe de dinero invertido + precio + comisión opcional.
  // tokens comprados = importe / precio (la comisión NO compra tokens, se
  // añade al coste). Devuelve el nuevo estado de la posición.
  function buy(input) {
    const amount = Math.max(0, toNum(input.amount));
    const price = Math.max(0, toNum(input.price));
    const fee = Math.max(0, toNum(input.fee));
    const curTokens = Math.max(0, toNum(input.curTokens));
    const curInvestment = Math.max(0, toNum(input.curInvestment));
    if (!(amount > 0) || !(price > 0)) {
      return { ok: false, error: "invalid" };
    }
    const addTokens = round(amount / price);
    const addInvestment = round(amount + fee);
    const newTokens = round(curTokens + addTokens);
    const newInvestment = round(curInvestment + addInvestment);
    return {
      ok: true,
      addTokens,
      addInvestment,
      newTokens,
      newInvestment,
      entryPrice: newTokens > 0 ? round(newInvestment / newTokens) : 0
    };
  }

  // ── Venta ──
  // Entrada: dinero recibido + precio de venta + comisión opcional.
  // tokens vendidos = min(importe / precio, tokens disponibles). Mantiene el
  // coste medio y reduce la base de inversión proporcionalmente. El beneficio
  // realizado descuenta la comisión.
  function sell(input) {
    const amount = Math.max(0, toNum(input.amount));
    const price = Math.max(0, toNum(input.price));
    const fee = Math.max(0, toNum(input.fee));
    const curTokens = Math.max(0, toNum(input.curTokens));
    const curInvestment = Math.max(0, toNum(input.curInvestment));
    if (!(amount > 0) || !(price > 0)) {
      return { ok: false, error: "invalid" };
    }
    if (!(curTokens > 0)) {
      return { ok: false, error: "no-position" };
    }
    const avgCost = curInvestment / curTokens;
    let soldTokens = amount / price;
    if (soldTokens > curTokens) soldTokens = curTokens; // no se vende más de lo disponible
    soldTokens = round(soldTokens);
    const newTokens = round(Math.max(0, curTokens - soldTokens));
    const newInvestment = newTokens > 0 ? round(newTokens * avgCost) : 0;
    const grossProceeds = round(soldTokens * price);
    const realized = avgCost > 0 ? round(soldTokens * (price - avgCost) - fee) : null;
    return {
      ok: true,
      soldTokens,
      newTokens,
      newInvestment,
      entryPrice: newTokens > 0 ? round(avgCost) : 0,
      grossProceeds,
      realized,
      pctOfPosition: curTokens > 0 ? round((soldTokens / curTokens) * 100, 4) : 0
    };
  }

  // ── Coste medio ──
  function avgPrice(investment, tokens) {
    const inv = toNum(investment);
    const tok = toNum(tokens);
    return tok > 0 ? round(inv / tok) : 0;
  }

  // ── Beneficio/pérdida no realizado de una posición ──
  function unrealized(input) {
    const tokens = Math.max(0, toNum(input.tokens));
    const investment = Math.max(0, toNum(input.investment));
    const currentPrice = Math.max(0, toNum(input.currentPrice));
    const currentValue = round(tokens * currentPrice);
    const pnl = round(currentValue - investment);
    return {
      currentValue,
      pnl,
      pnlPct: investment > 0 ? round((pnl / investment) * 100, 4) : 0
    };
  }

  // ── Rentabilidad desde el precio medio de entrada ──
  function roiPct(entryPrice, currentPrice) {
    const e = toNum(entryPrice);
    const c = toNum(currentPrice);
    return e > 0 && c > 0 ? round(((c - e) / e) * 100, 4) : 0;
  }

  /* ═══════════════════════════════════════════════════════
     Comparador de capitalización — funciones puras.
     No redondean: la precisión completa se conserva y el
     formato se aplica solo al mostrar. Devuelven ok:false
     cuando faltan datos esenciales (nunca NaN/Infinity).
     ═══════════════════════════════════════════════════════ */

  // Oferta circulante derivada de cap/precio (idéntica a la que usa el
  // mercado: market_cap = precio × oferta_circulante).
  function circulatingSupply(marketCap, price) {
    const cap = toNum(marketCap);
    const p = toNum(price);
    return p > 0 && cap > 0 ? cap / p : 0;
  }

  // ¿Qué precio tendría el activo base con la capitalización objetivo?
  // input: { basePrice, baseCap, baseSupply?, targetCap }
  function capScenario(input) {
    const basePrice = toNum(input.basePrice);
    const baseCap = toNum(input.baseCap);
    const targetCap = toNum(input.targetCap);
    let supply = toNum(input.baseSupply);
    if (!(supply > 0)) supply = circulatingSupply(baseCap, basePrice);
    if (!(basePrice > 0)) return { ok: false, reason: "no-price" };
    if (!(supply > 0)) return { ok: false, reason: "no-supply" };
    if (!(targetCap > 0)) return { ok: false, reason: "no-target-cap" };
    const simPrice = targetCap / supply;
    const multiplier = baseCap > 0 ? targetCap / baseCap : simPrice / basePrice;
    return {
      ok: true,
      supply,
      simPrice,
      multiplier,
      pctChange: (simPrice / basePrice - 1) * 100,
      priceDiff: simPrice - basePrice,
      targetCap,
      baseCap,
      basePrice
    };
  }

  // Impacto en una posición (simulación; no altera datos reales).
  // input: { tokens, invested, currentPrice, simPrice }
  function capPositionImpact(input) {
    const tokens = Math.max(0, toNum(input.tokens));
    const invested = Math.max(0, toNum(input.invested));
    const curPrice = Math.max(0, toNum(input.currentPrice));
    const simPrice = Math.max(0, toNum(input.simPrice));
    const curValue = tokens * curPrice;
    const simValue = tokens * simPrice;
    return {
      tokens,
      curValue,
      simValue,
      valueDiff: simValue - curValue,
      simProfit: simValue - invested,
      simRoiPct: invested > 0 ? ((simValue - invested) / invested) * 100 : 0
    };
  }

  // Inverso: capitalización necesaria para alcanzar un precio objetivo.
  // input: { targetPrice, basePrice, baseCap, baseSupply? }
  function capNeededForPrice(input) {
    const targetPrice = toNum(input.targetPrice);
    const basePrice = toNum(input.basePrice);
    const baseCap = toNum(input.baseCap);
    let supply = toNum(input.baseSupply);
    if (!(supply > 0)) supply = circulatingSupply(baseCap, basePrice);
    if (!(supply > 0)) return { ok: false, reason: "no-supply" };
    if (!(targetPrice > 0)) return { ok: false, reason: "no-target-price" };
    const capNeeded = targetPrice * supply;
    return {
      ok: true,
      supply,
      capNeeded,
      capAdded: capNeeded - baseCap,
      multiplier: baseCap > 0 ? capNeeded / baseCap : targetPrice / basePrice,
      pctChange: basePrice > 0 ? (targetPrice / basePrice - 1) * 100 : 0
    };
  }

  return {
    round, buy, sell, avgPrice, unrealized, roiPct,
    circulatingSupply, capScenario, capPositionImpact, capNeededForPrice
  };
});
