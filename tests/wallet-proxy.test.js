// Pruebas del lector de billeteras (api/wallet.js) con la red simulada.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler from "../api/wallet.js";

const W = handler._internals;
const EVM = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.json = (b) => { res.body = b; };
  res.end = () => {};
  return res;
}
async function call(query) {
  const res = fakeRes();
  await handler({ method: "GET", url: `/api/wallet?${query}` }, res);
  return res;
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const CG_LIST = [
  { id: "usd-coin", symbol: "usdc", name: "USDC", platforms: { base: USDC_BASE.toUpperCase().replace("0X", "0x"), solana: USDC_SOL } },
  { id: "weth", symbol: "weth", name: "WETH", platforms: { ethereum: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" } }
];

describe("validacion de direcciones", () => {
  it("EVM: 0x + 40 hex, se normaliza a minusculas", () => {
    expect(W.validateAddress("evm", "0x8BA1f109551bD432803012645Ac136ddd64DBA72")).toBe(EVM);
    expect(W.validateAddress("evm", "0x123")).toBeNull();
    expect(W.validateAddress("evm", "8ba1f109551bd432803012645ac136ddd64dba72")).toBeNull();
  });
  it("Solana: base58 que decodifica a 32 bytes", () => {
    expect(W.validateAddress("solana", SOL)).toBe(SOL);
    expect(W.validateAddress("solana", "So11111111111111111111111111111111111111112")).toBe("So11111111111111111111111111111111111111112");
    expect(W.validateAddress("solana", "0OIl" + SOL.slice(4))).toBeNull();
  });
  it("Bitcoin: bech32 y heredada con suma de control", () => {
    expect(W.validateAddress("bitcoin", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    expect(W.validateAddress("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
    expect(W.validateAddress("bitcoin", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy");
    // Un caracter cambiado rompe la suma de control.
    expect(W.validateAddress("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3")).toBeNull();
    expect(W.validateAddress("bitcoin", "bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBeNull();
  });
  it("red desconocida o vacio: nada", () => {
    expect(W.validateAddress("doge", EVM)).toBeNull();
    expect(W.validateAddress("evm", "")).toBeNull();
  });
});

describe("cantidades exactas", () => {
  it("formatUnits no pierde precision", () => {
    expect(W.formatUnits(1234500000000000000n, 18)).toBe("1.2345");
    expect(W.formatUnits(5n, 18)).toBe("0.000000000000000005");
    expect(W.formatUnits(100000000n, 8)).toBe("1");
  });
  it("parseUnits acepta hexadecimal y entero, rechaza lo demas", () => {
    expect(W.parseUnits("0x0de0b6b3a7640000")).toBe(1000000000000000000n);
    expect(W.parseUnits("42")).toBe(42n);
    expect(W.parseUnits("1.5")).toBeNull();
    expect(W.parseUnits(null)).toBeNull();
  });
  it("Bitcoin suma confirmado y pendiente", () => {
    expect(W.satsFromEsplora({ chain_stats: { funded_txo_sum: 150000, spent_txo_sum: 50000 }, mempool_stats: { funded_txo_sum: 1000, spent_txo_sum: 0 } })).toBe(101000);
    expect(W.satsFromEsplora({})).toBe(0);
  });
});

describe("normalizacion de Alchemy", () => {
  const map = W.buildCoinGeckoMap(CG_LIST);
  it("nativo, ERC-20 reconocido por contrato, SPL de Solana y descartes", () => {
    const assets = W.normalizeAlchemyTokens([
      { network: "eth-mainnet", tokenAddress: null, tokenBalance: "0x1bc16d674ec80000", tokenMetadata: { decimals: null }, tokenPrices: [{ currency: "usd", value: "3000.5" }] },
      { network: "base-mainnet", tokenAddress: USDC_BASE, tokenBalance: "0x5f5e100", tokenMetadata: { decimals: 6, symbol: "usdc", name: "USD Coin", logo: "https://x/usdc.png" }, tokenPrices: [{ currency: "usd", value: "1" }] },
      { network: "solana-mainnet", tokenAddress: USDC_SOL, tokenBalance: "2500000", tokenMetadata: { decimals: 6, symbol: "USDC", name: "USD Coin" }, tokenPrices: [] },
      { network: "base-mainnet", tokenAddress: "0x1111111111111111111111111111111111111111", tokenBalance: "0x3e8", tokenMetadata: { decimals: 0, symbol: "USDC", name: "Visit   claim-usdc.example   to claim your reward now!!!", logo: "javascript:alert(1)" } },
      { network: "base-mainnet", tokenAddress: "0x2222222222222222222222222222222222222222", tokenBalance: "0x0", tokenMetadata: { decimals: 18 } },
      { network: "eth-mainnet", tokenAddress: "0x3333333333333333333333333333333333333333", tokenBalance: "0x10", error: "fallo" },
      { network: "fantom-mainnet", tokenAddress: null, tokenBalance: "0x10", tokenMetadata: { decimals: 18 } }
    ], map);
    expect(assets).toHaveLength(4);
    expect(assets[0]).toMatchObject({ network: "eth", contract: null, symbol: "ETH", coinId: "ethereum", amount: "2", priceUsd: 3000.5 });
    expect(assets[1]).toMatchObject({ network: "base", contract: USDC_BASE, symbol: "USDC", coinId: "usd-coin", amount: "100", logo: "https://x/usdc.png" });
    // Solana distingue mayusculas en el contrato: se conserva tal cual.
    expect(assets[2]).toMatchObject({ network: "solana", contract: USDC_SOL, coinId: "usd-coin", amount: "2.5", priceUsd: null });
    // Basura: mismo simbolo que USDC pero otro contrato -> sin id; nombre recortado y logo descartado.
    expect(assets[3].coinId).toBeNull();
    expect(assets[3].name.length).toBeLessThanOrEqual(48);
    expect(assets[3].logo).toBeNull();
  });
});

describe("handler", () => {
  let fetchMock;
  beforeEach(() => {
    W.reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ALCHEMY_API_KEY = "clave-de-prueba";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALCHEMY_API_KEY;
  });

  it("direccion invalida: 400 sin llamar a nadie", async () => {
    const res = await call("chain=evm&address=0x123");
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("invalid_address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin clave de Alchemy: 503 claro y sin llamadas", async () => {
    delete process.env.ALCHEMY_API_KEY;
    const res = await call(`chain=evm&address=${EVM}`);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("missing_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("EVM: dos peticiones (5 + 2 redes), clave en la ruta, paginacion y mapeo", async () => {
    fetchMock.mockImplementation(async (url, opts) => {
      if (String(url).startsWith("https://api.coingecko.com/")) return json(CG_LIST);
      const body = JSON.parse(opts.body);
      const networks = body.addresses[0].networks;
      if (networks.includes("eth-mainnet") && !body.pageKey) {
        return json({ data: { tokens: [{ network: "eth-mainnet", tokenAddress: null, tokenBalance: "0xde0b6b3a7640000", tokenMetadata: { decimals: 18 } }], pageKey: "p2" } });
      }
      if (networks.includes("eth-mainnet") && body.pageKey === "p2") {
        return json({ data: { tokens: [{ network: "base-mainnet", tokenAddress: USDC_BASE, tokenBalance: "0x5f5e100", tokenMetadata: { decimals: 6, symbol: "USDC" } }] } });
      }
      return json({ data: { tokens: [{ network: "bnb-mainnet", tokenAddress: null, tokenBalance: "0x6f05b59d3b20000", tokenMetadata: { decimals: 18 } }] } });
    });
    const res = await call(`chain=evm&address=${EVM}`);
    expect(res.statusCode).toBe(200);
    const alchemyCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("alchemy.com"));
    expect(alchemyCalls).toHaveLength(3);
    alchemyCalls.forEach(([u, o]) => {
      expect(String(u)).toBe("https://api.g.alchemy.com/data/v1/clave-de-prueba/assets/tokens/by-address");
      expect(o.body).not.toContain("clave-de-prueba");
      const b = JSON.parse(o.body);
      expect(b.addresses[0].networks.length).toBeLessThanOrEqual(5);
      expect(b).toMatchObject({ withMetadata: true, withPrices: true, includeNativeTokens: true, includeErc20Tokens: true });
    });
    const grupos = alchemyCalls.map(([, o]) => JSON.parse(o.body).addresses[0].networks.join(","));
    expect(new Set(grupos)).toEqual(new Set([W.EVM_GROUPS[0].join(","), W.EVM_GROUPS[1].join(",")]));
    expect(res.body.assets.map((a) => `${a.network}:${a.coinId}:${a.amount}`)).toEqual([
      "eth:ethereum:1", "base:usd-coin:100", "bsc:binancecoin:0.5"
    ]);
    expect(res.body.failedNetworks).toEqual([]);
  });

  it("si cae un grupo de redes: respuesta parcial que lo dice y no se cachea", async () => {
    fetchMock.mockImplementation(async (url, opts) => {
      if (String(url).startsWith("https://api.coingecko.com/")) return json(CG_LIST);
      const networks = JSON.parse(opts.body).addresses[0].networks;
      if (networks.includes("bnb-mainnet")) return json({}, 500);
      return json({ data: { tokens: [] } });
    });
    const res = await call(`chain=evm&address=${EVM}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.failedNetworks).toEqual(["bsc", "avax"]);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("si Alchemy cae del todo: 502; si limita: 429", async () => {
    fetchMock.mockImplementation(async (url) => (String(url).includes("coingecko") ? json(CG_LIST) : json({}, 500)));
    expect((await call(`chain=evm&address=${EVM}`)).statusCode).toBe(502);
    W.reset();
    fetchMock.mockImplementation(async (url) => (String(url).includes("coingecko") ? json(CG_LIST) : json({}, 429)));
    expect((await call(`chain=solana&address=${SOL}`)).statusCode).toBe(429);
  });

  it("sin lista de CoinGecko: los tokens llegan igual, sin id", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("coingecko")) return json({}, 500);
      return json({ data: { tokens: [{ network: "solana-mainnet", tokenAddress: USDC_SOL, tokenBalance: "1000000", tokenMetadata: { decimals: 6, symbol: "USDC" } }] } });
    });
    const res = await call(`chain=solana&address=${SOL}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.assets[0].coinId).toBeNull();
    expect(res.body.unlisted).toBe("unchecked");
  });

  it("Bitcoin: mempool.space, y blockstream si mempool falla", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith("https://mempool.space/")) return json({}, 503);
      return json({ chain_stats: { funded_txo_sum: 250000000, spent_txo_sum: 50000000 }, mempool_stats: {} });
    });
    const res = await call("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls.map(([u]) => new URL(u).hostname)).toEqual(["mempool.space", "blockstream.info"]);
    expect(res.body.assets).toEqual([expect.objectContaining({ network: "bitcoin", coinId: "bitcoin", symbol: "BTC", amount: "2" })]);
  });

  it("segunda lectura en 30 s: sale de la memoria, sin volver a llamar", async () => {
    fetchMock.mockImplementation(async () => json({ chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0 } }));
    await call("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    await call("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
