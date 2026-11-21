// Pruebas del historial de precios (api/historial.js) con la red simulada.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler from "../api/historial.js";

const H = handler._internals;
const HORA = 3600 * 1000;
const DIA = 24 * HORA;

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.json = (b) => { res.body = b; };
  res.end = () => {};
  return res;
}
async function call(query) {
  const res = fakeRes();
  await handler({ method: "GET", url: `/api/historial?${query}` }, res);
  return res;
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Serie horaria de una moneda: precio = base + horas desde el inicio.
function serieHoraria(desdeMs, horas, base) {
  return Array.from({ length: horas + 1 }, (_, h) => [desdeMs + h * HORA, base + h]);
}

describe("rejilla", () => {
  it("1 dia: un punto cada 10 minutos", () => {
    const r = H.rejillaDe(1, Date.UTC(2026, 0, 10, 12, 34));
    expect(r.n).toBe(145);
    expect(r.paso).toBe(10 * 60 * 1000);
    expect(r.hasta).toBe(Date.UTC(2026, 0, 10, 12, 30));
    expect(r.desde).toBe(r.hasta - DIA);
  });
  it("30 dias: 181 puntos cada 4 horas", () => {
    const r = H.rejillaDe(30, Date.UTC(2026, 0, 10, 12, 34));
    expect(r.n).toBe(181);
    expect(r.paso).toBe(4 * HORA);
    expect(r.hasta).toBe(Date.UTC(2026, 0, 10, 12));
  });
  it("mas de 90 dias: por dias, desde las 00:00 UTC", () => {
    const r = H.rejillaDe(91, Date.UTC(2026, 0, 10, 12, 34));
    expect(r.n).toBe(92);
    expect(r.paso).toBe(DIA);
    expect(r.hasta).toBe(Date.UTC(2026, 0, 10));
  });
});

describe("remuestreo", () => {
  it("toma el ultimo precio conocido en cada punto", () => {
    const precios = [[0, 10], [HORA, 11], [3 * HORA, 13]];
    expect(H.remuestrear(precios, 0, HORA, 4)).toEqual([10, 11, 11, 13]);
  });
  it("si la moneda empieza tarde, los primeros puntos toman su primer precio", () => {
    expect(H.remuestrear([[2 * HORA, 5]], 0, HORA, 4)).toEqual([5, 5, 5, 5]);
  });
  it("sin datos validos devuelve null", () => {
    expect(H.remuestrear([], 0, HORA, 4)).toBe(null);
    expect(H.remuestrear([[0, -1], ["x", 2]], 0, HORA, 4)).toBe(null);
  });
  it("redondea a 6 cifras", () => {
    expect(H.remuestrear([[0, 1.234567891]], 0, HORA, 1)).toEqual([1.23457]);
  });
});

describe("parametros", () => {
  it("limpia, ordena y quita repetidas", () => {
    const p = H.leerParametros("/api/historial?ids=Ethereum,bitcoin,,bitcoin,<script>&vs=EUR&dias=30");
    expect(p).toEqual({ ids: ["bitcoin", "ethereum"], vs: "eur", dias: 30 });
  });
  it("admite ids con punto o guion bajo, pero no tramos de ruta", () => {
    const p = H.leerParametros("/x?ids=usd.e,wrapped_btc,..,.hidden,../simple&vs=usd&dias=7");
    expect(p.ids).toEqual(["usd.e", "wrapped_btc"]);
  });
  it("limita el periodo a 364 dias", () => {
    expect(H.leerParametros("/x?ids=bitcoin&vs=usd&dias=900").dias).toBe(364);
  });
  it("rechaza peticiones sin monedas o con periodo malo", async () => {
    expect((await call("vs=usd&dias=30")).statusCode).toBe(400);
    expect((await call("ids=bitcoin&vs=usd&dias=0")).statusCode).toBe(400);
    expect((await call("ids=bitcoin&vs=us1&dias=7")).statusCode).toBe(400);
  });
});

describe("peticion completa", () => {
  let llamadas;
  beforeEach(() => {
    llamadas = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 10, 12, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.COINGECKO_API_KEY;
  });

  it("devuelve todas las monedas sobre la misma rejilla, con la clave en cabecera", async () => {
    process.env.COINGECKO_API_KEY = "clave-de-prueba";
    const inicio = Date.UTC(2026, 0, 3, 11);
    vi.stubGlobal("fetch", async (url, opts) => {
      llamadas.push({ url: String(url), key: opts?.headers?.["x-cg-demo-api-key"] });
      const base = String(url).includes("/bitcoin/") ? 100 : 10;
      return json({ prices: serieHoraria(inicio, 7 * 24 + 2, base) });
    });
    const res = await call("ids=bitcoin,ethereum&vs=usd&dias=7");
    expect(res.statusCode).toBe(200);
    expect(res.body.n).toBe(169);
    expect(res.body.paso).toBe(HORA);
    expect(res.body.desde).toBe(Date.UTC(2026, 0, 3, 12));
    expect(res.body.precios.bitcoin).toHaveLength(169);
    expect(res.body.precios.bitcoin[0]).toBe(101);
    expect(res.body.precios.ethereum[168]).toBe(10 + 169);
    expect(res.body.faltan).toEqual([]);
    expect(res.headers["cache-control"]).toMatch(/s-maxage=3600/);
    expect(llamadas.every((l) => l.key === "clave-de-prueba" && !l.url.includes("clave"))).toBe(true);
    expect(llamadas[0].url).toMatch(/market_chart\/range\?vs_currency=usd&from=\d+&to=\d+$/);
  });

  it("una moneda sin datos va a 'faltan' y la respuesta se puede guardar", async () => {
    vi.stubGlobal("fetch", async (url) => (String(url).includes("/raro/") ? json({ error: "no" }, 404) : json({ prices: [[Date.now() - DIA, 3]] })));
    const res = await call("ids=bitcoin,raro&vs=eur&dias=7");
    expect(res.body.faltan).toEqual(["raro"]);
    expect(res.body.incompleto).toBe(false);
    expect(res.headers["cache-control"]).toMatch(/public/);
  });

  it("si CoinGecko pone limite, no sigue pidiendo y no se guarda en la CDN", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      return json({}, 429);
    });
    const ids = Array.from({ length: 12 }, (_, i) => `moneda-${i}`).join(",");
    const res = await call(`ids=${ids}&vs=usd&dias=30`);
    expect(res.body.faltan).toHaveLength(12);
    expect(res.body.incompleto).toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(n).toBeLessThanOrEqual(4);
  });

  it("una serie ya pedida sale de memoria sin volver a CoinGecko", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      return json({ prices: [[Date.now() - 2 * DIA, 7]] });
    });
    await call("ids=cardano&vs=usd&dias=91");
    await call("ids=cardano&vs=usd&dias=91");
    expect(n).toBe(1);
  });
});
