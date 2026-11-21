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

  // ── Saldo en el tiempo ──
  // Una posicion para el historial:
  //   { cantidad (la de hoy), desde (ms de la fecha de compra o null),
  //     movimientos: [{ at, cantidad }] (compras +, ventas -),
  //     precios: [n] sobre la rejilla (o null), precioActual }
  // Lo que no explican las compras y ventas registradas (lo que ya se tenia)
  // cuenta desde la fecha de compra; sin fecha, desde siempre.
  function cantidadEn(pos, t) {
    const movimientos = pos.movimientos || [];
    let base = toNum(pos.cantidad);
    for (const m of movimientos) base -= toNum(m.cantidad);
    let q = pos.desde != null && t < pos.desde ? 0 : base;
    for (const m of movimientos) {
      if (m.at <= t) q += toNum(m.cantidad);
    }
    return q > 1e-12 ? q : 0;
  }

  function precioEnIndice(pos, i) {
    const p = pos.precios && pos.precios[i];
    if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
    const actual = toNum(pos.precioActual);
    return actual > 0 ? actual : 0;
  }

  // Saldo en cada instante de la rejilla (desde, desde+paso, ...) y, al
  // final, el de ahora. Tambien devuelve el dinero que entro o salio
  // (flujos: compras, ventas y posiciones que empiezan dentro del periodo),
  // valorado al precio de ese momento, para no confundirlo con ganancias.
  function serieSaldo(input) {
    const desde = toNum(input.desde);
    const paso = toNum(input.paso);
    const n = Math.max(0, Math.floor(toNum(input.n)));
    const posiciones = input.posiciones || [];
    const ultimo = desde + paso * (n - 1);
    const ahora = toNum(input.ahora) || ultimo;
    const puntos = [];
    for (let i = 0; i < n; i += 1) {
      const t = desde + paso * i;
      let valor = 0;
      for (const pos of posiciones) {
        const q = cantidadEn(pos, t);
        if (q > 0) valor += q * precioEnIndice(pos, i);
      }
      puntos.push({ at: t, value: valor });
    }
    if (n && ahora > ultimo && Number.isFinite(input.valorAhora)) {
      puntos.push({ at: ahora, value: input.valorAhora });
    }
    const flujos = [];
    const precioHacia = (pos, at) => {
      if (at > ultimo) return precioEnIndice(pos, n); // fuera de la rejilla: precio actual
      return precioEnIndice(pos, Math.max(0, Math.min(n - 1, Math.floor((at - desde) / paso))));
    };
    for (const pos of posiciones) {
      const movimientos = pos.movimientos || [];
      let base = toNum(pos.cantidad);
      for (const m of movimientos) base -= toNum(m.cantidad);
      if (pos.desde != null && pos.desde > desde && pos.desde <= ahora && base > 0) {
        flujos.push({ at: pos.desde, value: base * precioHacia(pos, pos.desde) });
      }
      for (const m of movimientos) {
        if (m.at > desde && m.at <= ahora) {
          flujos.push({ at: m.at, value: toNum(m.cantidad) * precioHacia(pos, m.at) });
        }
      }
    }
    return { puntos, flujos };
  }

  // Cambio del saldo en un periodo sin contar el dinero metido o sacado
  // (metodo Dietz simple): ganancia = final - inicial - flujos; el % se
  // mide sobre el capital medio que estuvo invertido en el periodo.
  function rentabilidadPeriodo(puntos, flujos) {
    if (!Array.isArray(puntos) || puntos.length < 2) return null;
    const inicio = puntos[0];
    const fin = puntos[puntos.length - 1];
    const span = fin.at - inicio.at;
    let total = 0;
    let ponderado = 0;
    for (const f of flujos || []) {
      total += f.value;
      ponderado += span > 0 ? f.value * ((fin.at - f.at) / span) : 0;
    }
    const delta = fin.value - inicio.value - total;
    const capital = inicio.value + ponderado;
    return { delta, pct: capital > 0 ? (delta / capital) * 100 : null };
  }

  return {
    round, buy, sell, avgPrice, unrealized, roiPct,
    circulatingSupply, capScenario, capPositionImpact, capNeededForPrice,
    cantidadEn, serieSaldo, rentabilidadPeriodo
  };
});
