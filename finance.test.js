// Pruebas de los cálculos financieros con Vitest (Node).
// Requiere Node + `npm install` + `npm test`. Estas aserciones son las mismas
// que verifica el arnés de navegador finance.test.html.
import { describe, it, expect } from "vitest";
import CryptoFinance from "./finance.js";

const F = CryptoFinance;

describe("CryptoFinance.buy", () => {
  it("cantidad comprada = importe / precio", () => {
    const r = F.buy({ amount: 500, price: 2, fee: 0, curTokens: 0, curInvestment: 0 });
    expect(r.addTokens).toBeCloseTo(250, 6);
    expect(r.newInvestment).toBeCloseTo(500, 6);
    expect(r.entryPrice).toBeCloseTo(2, 6);
  });

  it("la comisión suma al coste, no compra tokens", () => {
    const r = F.buy({ amount: 200, price: 2, fee: 5, curTokens: 0.05, curInvestment: 3000 });
    expect(r.addTokens).toBeCloseTo(100, 6);
    expect(r.addInvestment).toBeCloseTo(205, 6);
    expect(r.newTokens).toBeCloseTo(100.05, 6);
    expect(r.newInvestment).toBeCloseTo(3205, 6);
  });

  it("suma float-safe (0.1 + 0.3 = 0.4 exacto)", () => {
    const r = F.buy({ amount: 0.3, price: 1, fee: 0, curTokens: 0.1, curInvestment: 0.1 });
    expect(r.newTokens).toBe(0.4);
  });

  it("números muy pequeños", () => {
    const r = F.buy({ amount: 10, price: 0.00001234, fee: 0, curTokens: 0, curInvestment: 0 });
    expect(r.addTokens).toBeCloseTo(10 / 0.00001234, 0);
  });

  it("entradas inválidas → ok:false", () => {
    expect(F.buy({ amount: 100, price: 0 }).ok).toBe(false);
    expect(F.buy({ amount: -1, price: 2 }).ok).toBe(false);
  });
});

describe("CryptoFinance.sell", () => {
  it("cantidad vendida = dinero / precio; restantes y % correctos", () => {
    const r = F.sell({ amount: 300, price: 3, fee: 0, curTokens: 250, curInvestment: 500 });
    expect(r.soldTokens).toBeCloseTo(100, 6);
    expect(r.newTokens).toBeCloseTo(150, 6);
    expect(r.pctOfPosition).toBeCloseTo(40, 3);
    expect(r.realized).toBeCloseTo(100, 6); // coste medio 2, venta a 3, 100 tokens
  });

  it("la comisión reduce el beneficio realizado", () => {
    const r = F.sell({ amount: 300, price: 3, fee: 10, curTokens: 250, curInvestment: 500 });
    expect(r.realized).toBeCloseTo(90, 6);
  });

  it("no vende más de lo disponible (capado) y venta total deja base a 0", () => {
    const r = F.sell({ amount: 100000, price: 3, fee: 0, curTokens: 150, curInvestment: 300 });
    expect(r.soldTokens).toBeCloseTo(150, 6);
    expect(r.newTokens).toBeCloseTo(0, 6);
    expect(r.newInvestment).toBe(0);
    expect(r.entryPrice).toBe(0);
  });

  it("guardas: negativo, sin posición, precio 0 → ok:false", () => {
    expect(F.sell({ amount: -5, price: 2, curTokens: 10, curInvestment: 10 }).ok).toBe(false);
    expect(F.sell({ amount: 100, price: 2, curTokens: 0, curInvestment: 0 }).ok).toBe(false);
    expect(F.sell({ amount: 100, price: 0, curTokens: 10, curInvestment: 10 }).ok).toBe(false);
  });
});

describe("CryptoFinance métricas", () => {
  it("coste medio", () => {
    expect(F.avgPrice(3205, 100.05)).toBeCloseTo(32.034, 3);
    expect(F.avgPrice(100, 0)).toBe(0);
  });

  it("beneficio no realizado y porcentaje", () => {
    const u = F.unrealized({ tokens: 2, investment: 100, currentPrice: 80 });
    expect(u.currentValue).toBeCloseTo(160, 6);
    expect(u.pnl).toBeCloseTo(60, 6);
    expect(u.pnlPct).toBeCloseTo(60, 3);
  });

  it("rentabilidad desde precio medio", () => {
    expect(F.roiPct(100, 150)).toBeCloseTo(50, 3);
    expect(F.roiPct(0, 150)).toBe(0);
  });
});

describe("CryptoFinance.capScenario", () => {
  it("precio simulado = cap objetivo / oferta (derivada de cap/precio)", () => {
    // baseCap 100e9 @ precio 2 → oferta 50e9; objetivo 500e9 → sim 10
    const r = F.capScenario({ basePrice: 2, baseCap: 100e9, targetCap: 500e9 });
    expect(r.ok).toBe(true);
    expect(r.supply).toBeCloseTo(50e9, 0);
    expect(r.simPrice).toBeCloseTo(10, 6);
    expect(r.multiplier).toBeCloseTo(5, 6);
    expect(r.pctChange).toBeCloseTo(400, 4);
    expect(r.priceDiff).toBeCloseTo(8, 6);
  });

  it("oferta explícita tiene prioridad sobre la derivada", () => {
    const r = F.capScenario({ basePrice: 2, baseCap: 100e9, baseSupply: 25e9, targetCap: 500e9 });
    expect(r.simPrice).toBeCloseTo(20, 6);
  });

  it("capitalización objetivo inferior → multiplicador < 1 y variación negativa", () => {
    const r = F.capScenario({ basePrice: 2, baseCap: 100e9, targetCap: 50e9 });
    expect(r.multiplier).toBeCloseTo(0.5, 6);
    expect(r.pctChange).toBeCloseTo(-50, 4);
    expect(r.simPrice).toBeCloseTo(1, 6);
  });

  it("precios por debajo de un céntimo", () => {
    // supply grande: baseCap 60e6 @ 0.0006 → oferta 1e11; objetivo 6e9 → 0.06
    const r = F.capScenario({ basePrice: 0.0006, baseCap: 60e6, targetCap: 6e9 });
    expect(r.simPrice).toBeCloseTo(0.06, 8);
    expect(r.multiplier).toBeCloseTo(100, 4);
  });

  it("datos faltantes → ok:false, sin NaN/Infinity", () => {
    expect(F.capScenario({ basePrice: 2, baseCap: 0, targetCap: 500e9, baseSupply: 0 }).ok).toBe(false);
    expect(F.capScenario({ basePrice: 2, baseCap: 100e9, targetCap: 0 }).ok).toBe(false);
    expect(F.capScenario({ basePrice: 0, baseCap: 0, targetCap: 500e9 }).ok).toBe(false);
  });
});

describe("CryptoFinance.capPositionImpact", () => {
  it("valor y beneficio simulados de la posición", () => {
    const r = F.capPositionImpact({ tokens: 100, invested: 150, currentPrice: 2, simPrice: 10 });
    expect(r.curValue).toBeCloseTo(200, 6);
    expect(r.simValue).toBeCloseTo(1000, 6);
    expect(r.valueDiff).toBeCloseTo(800, 6);
    expect(r.simProfit).toBeCloseTo(850, 6);
    expect(r.simRoiPct).toBeCloseTo(566.6667, 3);
  });
});

// El coste atribuido a una venta se deriva de lo que guarda el ledger:
// realizado = ingresos - coste - comision  =>  coste = ingresos - comision - realizado.
// Es la base del "capital aportado" del resumen; si esta derivacion falla, el
// porcentaje del resultado neto dejaria de cuadrar con los importes visibles.
describe("coste atribuido a una venta (base del capital aportado)", () => {
  it("se deriva de ingresos, comision y realizado", () => {
    const r = F.sell({ amount: 1000, price: 1000, fee: 5, curTokens: 2, curInvestment: 1200 });
    // avgCost 600 -> vende 1 token: ingresos 1000, realizado 1000-600-5 = 395
    expect(r.grossProceeds).toBeCloseTo(1000, 6);
    expect(r.realized).toBeCloseTo(395, 6);
    const costDerived = r.grossProceeds - 5 - r.realized;
    expect(costDerived).toBeCloseTo(600, 6);
  });

  it("resultado neto y porcentaje usan la misma base", () => {
    const openCost = 4750, currentValue = 4859.79, soldCost = 600, realized = 395;
    const unrealized = currentValue - openCost;
    const net = unrealized + realized;
    const deployed = openCost + soldCost;
    expect(net).toBeCloseTo(504.79, 2);
    expect((net / deployed) * 100).toBeCloseTo(9.4353, 3);
    // El error historico era dividir el neto entre el coste abierto:
    expect((net / openCost) * 100).not.toBeCloseTo((net / deployed) * 100, 2);
  });
});

describe("CryptoFinance.capNeededForPrice", () => {
  it("capitalización necesaria = precio objetivo × oferta", () => {
    const r = F.capNeededForPrice({ targetPrice: 10, basePrice: 2, baseCap: 100e9 });
    expect(r.ok).toBe(true);
    expect(r.capNeeded).toBeCloseTo(500e9, 0);
    expect(r.multiplier).toBeCloseTo(5, 6);
    expect(r.pctChange).toBeCloseTo(400, 4);
    expect(r.capAdded).toBeCloseTo(400e9, 0);
  });

  it("precio objetivo inválido → ok:false", () => {
    expect(F.capNeededForPrice({ targetPrice: -1, basePrice: 2, baseCap: 100e9 }).ok).toBe(false);
    expect(F.capNeededForPrice({ targetPrice: 10, basePrice: 0, baseCap: 0 }).ok).toBe(false);
  });
});

describe("saldo en el tiempo", () => {
  const H = 3600 * 1000;
  // Rejilla de 5 horas: t = 0, 1h, 2h, 3h, 4h.
  const rejilla = { desde: 0, paso: H, n: 5 };

  it("cantidad: lo de hoy menos lo comprado despues, mas lo vendido despues", () => {
    const pos = { cantidad: 3, desde: null, movimientos: [{ at: 2 * H, cantidad: 2 }, { at: 3 * H, cantidad: -1 }] };
    // Antes de todo: 3 - 2 + 1 = 2; tras la compra: 4; tras la venta: 3.
    expect(CryptoFinance.cantidadEn(pos, 0)).toBe(2);
    expect(CryptoFinance.cantidadEn(pos, 2 * H)).toBe(4);
    expect(CryptoFinance.cantidadEn(pos, 4 * H)).toBe(3);
  });

  it("cantidad: antes de la fecha de compra no cuenta", () => {
    const pos = { cantidad: 1, desde: 2 * H, movimientos: [] };
    expect(CryptoFinance.cantidadEn(pos, H)).toBe(0);
    expect(CryptoFinance.cantidadEn(pos, 2 * H)).toBe(1);
  });

  it("cantidad: nunca negativa aunque falten compras por registrar", () => {
    const pos = { cantidad: 0, desde: null, movimientos: [{ at: 2 * H, cantidad: -5 }] };
    expect(CryptoFinance.cantidadEn(pos, H)).toBe(5);
    expect(CryptoFinance.cantidadEn(pos, 3 * H)).toBe(0);
  });

  it("serie: cantidad de cada momento por el precio de ese momento", () => {
    const pos = { cantidad: 2, desde: null, movimientos: [], precios: [10, 11, 12, 13, 14], precioActual: 15 };
    const { puntos, flujos } = CryptoFinance.serieSaldo({ ...rejilla, posiciones: [pos], ahora: 5 * H, valorAhora: 30 });
    expect(puntos.map((p) => p.value)).toEqual([20, 22, 24, 26, 28, 30]);
    expect(puntos[5].at).toBe(5 * H);
    expect(flujos).toEqual([]);
  });

  it("serie: sin precio pasado se usa el actual (valor constante)", () => {
    const pos = { cantidad: 1, desde: null, movimientos: [], precios: null, precioActual: 7 };
    const { puntos } = CryptoFinance.serieSaldo({ ...rejilla, posiciones: [pos] });
    expect(puntos.map((p) => p.value)).toEqual([7, 7, 7, 7, 7]);
  });

  it("serie: una compra dentro del periodo es un flujo, no ganancia", () => {
    const pos = { cantidad: 2, desde: null, movimientos: [{ at: 2 * H, cantidad: 1 }], precios: [10, 10, 10, 10, 10], precioActual: 10 };
    const { puntos, flujos } = CryptoFinance.serieSaldo({ ...rejilla, posiciones: [pos], ahora: 4 * H });
    expect(puntos.map((p) => p.value)).toEqual([10, 10, 20, 20, 20]);
    expect(flujos).toEqual([{ at: 2 * H, value: 10 }]);
    // El saldo se duplica, pero el precio no se ha movido: 0 % de ganancia.
    const r = CryptoFinance.rentabilidadPeriodo(puntos, flujos);
    expect(r.delta).toBeCloseTo(0, 10);
    expect(r.pct).toBeCloseTo(0, 10);
  });

  it("serie: una posicion con fecha de compra dentro del periodo entra como flujo", () => {
    const pos = { cantidad: 1, desde: 2 * H, movimientos: [], precios: [5, 5, 8, 9, 10], precioActual: 10 };
    const { puntos, flujos } = CryptoFinance.serieSaldo({ ...rejilla, posiciones: [pos], ahora: 4 * H });
    expect(puntos.map((p) => p.value)).toEqual([0, 0, 8, 9, 10]);
    expect(flujos).toEqual([{ at: 2 * H, value: 8 }]);
    const r = CryptoFinance.rentabilidadPeriodo(puntos, flujos);
    // Entro con 8 y vale 10: gana 2 (25 % sobre lo que estuvo invertido la mitad del periodo).
    expect(r.delta).toBeCloseTo(2, 10);
    expect(r.pct).toBeCloseTo((2 / (8 * 0.5)) * 100, 10);
  });

  it("rentabilidad: sin flujos es el cambio simple", () => {
    const r = CryptoFinance.rentabilidadPeriodo([{ at: 0, value: 100 }, { at: H, value: 110 }], []);
    expect(r.delta).toBe(10);
    expect(r.pct).toBeCloseTo(10, 10);
  });

  it("rentabilidad: una venta no cuenta como perdida", () => {
    const pos = { cantidad: 1, desde: null, movimientos: [{ at: 2 * H, cantidad: -1 }], precios: [10, 10, 10, 10, 10], precioActual: 10 };
    const { puntos, flujos } = CryptoFinance.serieSaldo({ ...rejilla, posiciones: [pos], ahora: 4 * H });
    expect(puntos.map((p) => p.value)).toEqual([20, 20, 10, 10, 10]);
    const r = CryptoFinance.rentabilidadPeriodo(puntos, flujos);
    expect(r.delta).toBeCloseTo(0, 10);
  });

  it("rentabilidad: con menos de dos puntos no hay dato", () => {
    expect(CryptoFinance.rentabilidadPeriodo([{ at: 0, value: 1 }], [])).toBe(null);
  });
});
