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
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("si Alchemy y los nodos publicos caen del todo: 502", async () => {
    fetchMock.mockImplementation(async (url) => (String(url).includes("coingecko") ? json(CG_LIST) : json({}, 500)));
    expect((await call(`chain=evm&address=${EVM}`)).statusCode).toBe(502);
    W.reset();
    fetchMock.mockImplementation(async (url) => (String(url).includes("coingecko") ? json(CG_LIST) : json({}, 429)));
    expect((await call(`chain=solana&address=${SOL}`)).statusCode).toBe(502);
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

// ── Modo sin cuenta (nodos publicos) ──

// Codificador de RESULTADOS de aggregate3 escrito aparte del de la app (asi la
// prueba no se valida a si misma): ((bool success, bytes returnData)[]).
function encodeResults(results) {
  const w = (n) => BigInt(n).toString(16).padStart(64, "0");
  const els = results.map(({ success, data }) => {
    const hex = data.replace(/^0x/, "");
    const len = hex.length / 2;
    return w(success ? 1 : 0) + w(64) + w(len) + hex.padEnd(Math.ceil(len / 32) * 64, "0");
  });
  let off = els.length * 32;
  const heads = els.map((e) => { const h = w(off); off += e.length / 2; return h; });
  return "0x" + w(32) + w(els.length) + heads.join("") + els.join("");
}
const u256 = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// Vector de referencia generado con viem 2 (encodeFunctionData de aggregate3):
// la llamada que la app manda a los nodos tiene que ser identica, byte a byte.
const VIEM_AGGREGATE3 = "0x82ad56cb0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000100000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000002470a082310000000000000000000000008ba1f109551bd432803012645ac136ddd64dba7200000000000000000000000000000000000000000000000000000000000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000004313ce56700000000000000000000000000000000000000000000000000000000";

describe("Multicall3 (ABI hecha a mano)", () => {
  it("codifica exactamente como viem", () => {
    const calls = [
      { target: USDC_ETH, data: "0x70a08231" + EVM.slice(2).padStart(64, "0") },
      { target: "0xdac17f958d2ee523a2206206994597c13d831ec7", data: "0x313ce567" }
    ];
    expect(W.encodeAggregate3(calls)).toBe(VIEM_AGGREGATE3);
  });
  it("decodifica resultados con exito, fallo y datos largos", () => {
    const res = W.decodeAggregate3(encodeResults([
      { success: true, data: u256(42) },
      { success: false, data: "0x" },
      { success: true, data: "0x" + "ab".repeat(70) }
    ]));
    expect(res).toEqual([
      { success: true, data: u256(42) },
      { success: false, data: "0x" },
      { success: true, data: "0x" + "ab".repeat(70) }
    ]);
  });
  it("una respuesta cortada o vacia no se da por buena", () => {
    expect(() => W.decodeAggregate3("0x" + "00".repeat(64))).toThrow();
    const buena = encodeResults([{ success: true, data: u256(1) }, { success: true, data: u256(2) }]);
    expect(() => W.decodeAggregate3(buena.slice(0, buena.length / 2))).toThrow();
    expect(() => W.decodeAggregate3("0x")).toThrow();
  });
});

describe("candidatos por red", () => {
  it("top de CoinGecko con contrato en esa red + respaldo minimo, sin repetir", () => {
    const cg = { byId: W.buildCoinIndex([
      { id: "usd-coin", symbol: "usdc", name: "USDC", platforms: { ethereum: USDC_ETH.toUpperCase().replace("0X", "0x"), base: USDC_BASE } },
      { id: "solo-solana", symbol: "x", name: "X", platforms: { solana: USDC_SOL } },
      { id: "roto", symbol: "r", name: "R", platforms: { ethereum: "no-es-direccion" } }
    ]) };
    const top = { ids: ["usd-coin", "solo-solana", "roto"], price: new Map(), image: new Map() };
    const eth = W.evmCandidates("eth", cg, top);
    expect(eth[0]).toEqual({ contract: USDC_ETH, coinId: "usd-coin", symbol: "usdc", name: "USDC" });
    expect(eth.filter((c) => c.contract === USDC_ETH)).toHaveLength(1);
    expect(eth.some((c) => c.coinId === "tether")).toBe(true);
    expect(eth.every((c) => /^0x[0-9a-f]{40}$/.test(c.contract))).toBe(true);
    // Sin CoinGecko: solo el respaldo minimo.
    expect(W.evmCandidates("base", null, top).map((c) => c.coinId)).toEqual(["usd-coin"]);
  });
});

describe("handler sin cuenta", () => {
  let fetchMock;
  const MARKETS = [
    { id: "ethereum", current_price: 2500, image: "https://img/eth.png" },
    { id: "usd-coin", current_price: 1, image: "https://img/usdc.png" },
    { id: "binancecoin", current_price: 600 },
    { id: "solana", current_price: 150 }
  ];
  const CG_FULL = [
    ...CG_LIST,
    { id: "ethereum", symbol: "eth", name: "Ethereum", platforms: {} },
    { id: "tether", symbol: "usdt", name: "Tether", platforms: { ethereum: "0xdac17f958d2ee523a2206206994597c13d831ec7" } }
  ];
  function rpcBody(opts) { return JSON.parse(opts.body); }

  beforeEach(() => {
    W.reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.ALCHEMY_API_KEY;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EVM: nativo + tokens por Multicall3 en cada red; una red caida no tumba el resto", async () => {
    fetchMock.mockImplementation(async (url, opts) => {
      const u = String(url);
      if (u.startsWith("https://api.coingecko.com/api/v3/coins/list")) return json(CG_FULL);
      if (u.startsWith("https://api.coingecko.com/api/v3/coins/markets")) return json(u.endsWith("page=1") ? MARKETS : []);
      if (u.includes("bsc") || u.includes("bnb")) return json({}, 503); // BNB Chain: todos sus nodos caidos
      const body = rpcBody(opts);
      if (body.method === "eth_getBalance") {
        expect(body.params).toEqual([EVM, "latest"]);
        return json({ jsonrpc: "2.0", id: 1, result: u.includes("ethereum-rpc") ? "0x1bc16d674ec80000" : "0x0" });
      }
      if (body.method === "eth_call") {
        const { to, data } = body.params[0];
        expect(to).toBe(W.MULTICALL3);
        expect(data.startsWith("0x82ad56cb")).toBe(true);
        const n = Number(BigInt("0x" + data.slice(10 + 64, 10 + 128)));
        const esDecimals = data.includes("313ce567");
        const results = Array.from({ length: n }, (_, i) => {
          if (!u.includes("ethereum-rpc")) return { success: true, data: u256(0) };
          if (esDecimals) return { success: true, data: u256(6) };
          // En Ethereum solo el primer candidato (USDC) tiene saldo: 250 USDC.
          return i === 0 ? { success: true, data: u256(250_000_000) } : { success: i % 2 === 0, data: i % 2 === 0 ? u256(0) : "0x" };
        });
        return json({ jsonrpc: "2.0", id: 1, result: encodeResults(results) });
      }
      return json({}, 404);
    });
    const res = await call(`chain=evm&address=${EVM}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe("public");
    expect(res.body.failedNetworks).toEqual(["bsc"]);
    expect(res.body.assets).toEqual([
      expect.objectContaining({ network: "eth", contract: null, coinId: "ethereum", amount: "2", priceUsd: 2500, logo: "https://img/eth.png" }),
      expect.objectContaining({ network: "eth", contract: USDC_ETH, coinId: "usd-coin", symbol: "USDC", decimals: 6, amount: "250", priceUsd: 1 })
    ]);
    // Ninguna llamada a Alchemy sin clave.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("alchemy"))).toBe(false);
  });

  it("si el primer nodo falla se usa el siguiente de la lista", async () => {
    const vistos = [];
    fetchMock.mockImplementation(async (url, opts) => {
      const u = String(url);
      if (u.includes("coingecko")) return json(u.includes("markets") ? [] : CG_FULL);
      vistos.push(new URL(u).hostname);
      if (u.includes("publicnode")) throw new Error("caido");
      const body = rpcBody(opts);
      if (body.method === "eth_getBalance") return json({ result: "0x0" });
      const n = Number(BigInt("0x" + body.params[0].data.slice(10 + 64, 10 + 128)));
      return json({ result: encodeResults(Array.from({ length: n }, () => ({ success: true, data: u256(0) }))) });
    });
    const res = await call(`chain=evm&address=${EVM}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.failedNetworks).toEqual([]);
    expect(vistos).toContain("ethereum-rpc.publicnode.com");
    expect(vistos).toContain("eth.llamarpc.com");
  });

  it("Solana: SOL + tokens SPL sumando cuentas; lo no listado se valora en GeckoTerminal", async () => {
    const MINT_RARO = "Rar0Mint1111111111111111111111111111111111";
    fetchMock.mockImplementation(async (url, opts) => {
      const u = String(url);
      if (u.startsWith("https://api.coingecko.com/api/v3/coins/list")) return json(CG_FULL);
      if (u.startsWith("https://api.coingecko.com/api/v3/coins/markets")) return json(u.endsWith("page=1") ? MARKETS : []);
      if (u.startsWith("https://api.geckoterminal.com/")) {
        expect(u).toContain(`/networks/solana/tokens/multi/${MINT_RARO}`);
        return json({ data: [{ attributes: { address: MINT_RARO, symbol: "RARO", name: "Raro", price_usd: "0.02" } }] });
      }
      const body = rpcBody(opts);
      if (body.method === "getBalance") return json({ result: { context: {}, value: 2500000000 } });
      if (body.method === "getTokenAccountsByOwner") {
        if (body.params[1].programId.startsWith("Tokenz")) return json({ error: { message: "no soportado" } });
        const acc = (mint, amount, decimals) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
        return json({ result: { value: [acc(USDC_SOL, "1000000", 6), acc(USDC_SOL, "500000", 6), acc(MINT_RARO, "300", 0), acc("Vacio1111111111111111111111111111111111111", "0", 6)] } });
      }
      return json({}, 404);
    });
    const res = await call(`chain=solana&address=${SOL}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe("public");
    expect(res.body.assets).toEqual([
      expect.objectContaining({ network: "solana", contract: null, coinId: "solana", amount: "2.5", priceUsd: 150 }),
      expect.objectContaining({ network: "solana", contract: USDC_SOL, coinId: "usd-coin", amount: "1.5", priceUsd: 1 }),
      expect.objectContaining({ network: "solana", contract: MINT_RARO, coinId: null, symbol: "RARO", amount: "300", priceUsd: 0.02 })
    ]);
  });

  it("con clave pero Alchemy caido: se lee igual sin cuenta", async () => {
    process.env.ALCHEMY_API_KEY = "clave";
    fetchMock.mockImplementation(async (url, opts) => {
      const u = String(url);
      if (u.includes("alchemy")) return json({}, 401);
      if (u.includes("coingecko")) return json(u.includes("markets") ? MARKETS : CG_FULL);
      const body = rpcBody(opts);
      if (body.method === "getBalance") return json({ result: { value: 1000000000 } });
      return json({ result: { value: [] } });
    });
    const res = await call(`chain=solana&address=${SOL}`);
    delete process.env.ALCHEMY_API_KEY;
    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe("public");
    expect(res.body.assets[0]).toMatchObject({ coinId: "solana", amount: "1" });
  });
});

// ── CoinStats (forma tomada de una respuesta real de /wallet/balance) ──

describe("CoinStats", () => {
  const DEGEN = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
  const CG = {
    byContract: W.buildCoinGeckoMap([
      { id: "degen-base", symbol: "degen", platforms: { base: DEGEN } },
      { id: "binance-bridged-usdt-bnb-smart-chain", symbol: "usdt", platforms: { "binance-smart-chain": "0x55d398326f99059ff775485246999027b3197955" } }
    ]),
    byId: W.buildCoinIndex([
      { id: "degen-base", symbol: "degen", name: "Degen", platforms: {} },
      { id: "dolphin-2", symbol: "pod", name: "Dolphin", platforms: {} },
      { id: "otra-cosa", symbol: "zzz", name: "Otra", platforms: {} }
    ])
  };
  const REAL = [
    { coinId: "ethereum", amount: 3.128822813472737, chain: "base", name: "Ethereum", symbol: "ETH", price: 2326.77, imgUrl: "https://static.coinstats.app/coins/1650455629727.png", connectionId: "base-wallet" },
    { coinId: "degen-base", amount: 3000574.185146692, chain: "base", name: "Degen", symbol: "DEGEN", price: 0.00089, contractAddress: DEGEN, decimals: 18, connectionId: "base-wallet" },
    { coinId: "dolphin-2", amount: 962.70, chain: "base", name: "Dolphin", symbol: "POD", price: 0.42, contractAddress: "0xed664536023d8e4b1640c394777d34abaff1df8f", decimals: 18 },
    { coinId: "0x3cc0d3ecc81ba57abf3494abc8d4cb0a43410b07_base", amount: 475372908.28, chain: "base", name: "GMonchain", symbol: "GM", price: 1.47e-7, contractAddress: "0x3cc0d3ecc81ba57abf3494abc8d4cb0a43410b07", decimals: 18 },
    { coinId: "otra-cosa", amount: 5, chain: "base", name: "Falsa", symbol: "ABC", price: 3, contractAddress: "0x1234567890123456789012345678901234567890", decimals: 18 },
    { coinId: "binance-coin", amount: 0.5, chain: "binance_smart", name: "BNB", symbol: "BNB", price: 600 },
    { coinId: "tether", amount: 10, chain: "binance_smart", name: "Tether", symbol: "USDT", price: 1, contractAddress: "0x55d398326f99059ff775485246999027b3197955", decimals: 18 },
    { coinId: "ethereum", amount: 0.00000005, chain: "linea", name: "Ethereum", symbol: "ETH", price: 2326.77 },
    { coinId: "nada", amount: 0, chain: "base", name: "Cero", symbol: "CERO", price: 1 }
  ];

  it("normaliza: red de la app, id por contrato, id de CoinStats solo si el simbolo cuadra", () => {
    const a = W.normalizeCoinStats(REAL, CG);
    expect(a).toHaveLength(8);
    expect(a[0]).toMatchObject({ network: "base", contract: null, coinId: "ethereum", symbol: "ETH", amount: "3.128822813472737", priceUsd: 2326.77 });
    expect(a[1]).toMatchObject({ network: "base", contract: DEGEN, coinId: "degen-base", decimals: 18 });
    // Sin contrato en CoinGecko, pero mismo id y mismo simbolo: vale.
    expect(a[2].coinId).toBe("dolphin-2");
    // Id inventado de CoinStats para tokens sin listar: sin id.
    expect(a[3].coinId).toBeNull();
    // Id que existe en CoinGecko pero de OTRA moneda (simbolo distinto): no cuela.
    expect(a[4].coinId).toBeNull();
    // BNB nativo con el id de la app, no el de CoinStats; USDT de BNB por contrato.
    expect(a[5]).toMatchObject({ network: "bsc", contract: null, coinId: "binancecoin" });
    expect(a[6]).toMatchObject({ network: "bsc", coinId: "binance-bridged-usdt-bnb-smart-chain" });
    // Red que la app no lista aparte: se guarda con su nombre; cantidad sin "5e-8".
    expect(a[7]).toMatchObject({ network: "linea", contract: null, amount: "0.00000005" });
  });

  it("acepta tambien la respuesta agrupada por red", () => {
    const a = W.normalizeCoinStats([{ blockchain: "solana", balances: [{ coinId: "solana", amount: 2, symbol: "SOL", name: "Solana", price: 150 }] }], CG);
    expect(a).toEqual([expect.objectContaining({ network: "solana", coinId: "solana", amount: "2", priceUsd: 150 })]);
  });

  it("plainNumber nunca devuelve notacion cientifica", () => {
    expect(W.plainNumber(5e-8)).toBe("0.00000005");
    expect(W.plainNumber(1.5)).toBe("1.5");
    expect(W.plainNumber(0)).toBeNull();
  });

  describe("handler con COINSTATS_API_KEY", () => {
    let fetchMock;
    beforeEach(() => {
      W.reset();
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      process.env.COINSTATS_API_KEY = "cs-clave";
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.COINSTATS_API_KEY;
    });

    it("EVM: una consulta con connectionId=all y la clave en cabecera, nunca en la URL", async () => {
      fetchMock.mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("coingecko")) return json([]);
        return json(REAL.slice(0, 2));
      });
      const res = await call(`chain=evm&address=${EVM}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe("coinstats");
      const cs = fetchMock.mock.calls.filter(([u]) => String(u).includes("coinstats"));
      expect(cs).toHaveLength(1);
      expect(String(cs[0][0])).toBe(`https://openapiv1.coinstats.app/wallet/balance?address=${EVM}&connectionId=all`);
      expect(String(cs[0][0])).not.toContain("cs-clave");
      expect(cs[0][1].headers["X-API-KEY"]).toBe("cs-clave");
      expect(res.body.assets).toHaveLength(2);
    });

    it("Solana y Bitcoin usan su connectionId", async () => {
      fetchMock.mockImplementation(async (url) => (String(url).includes("coingecko") ? json([]) : json([])));
      await call(`chain=solana&address=${SOL}`);
      await call("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
      const ids = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("coinstats")).map((u) => new URL(u).searchParams.get("connectionId"));
      expect(ids).toEqual(["solana", "bitcoin"]);
    });

    it("si CoinStats falla (clave mala, sin creditos) se lee igual por el camino de siempre", async () => {
      fetchMock.mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("coinstats")) return json({ statusCode: 401, message: "Unauthorized" }, 401);
        if (u.startsWith("https://mempool.space/")) return json({ chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 } });
        return json([]);
      });
      const res = await call("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe("public");
      expect(res.body.assets[0]).toMatchObject({ coinId: "bitcoin", amount: "1" });
    });
  });
});

describe("clave de CoinStats puesta por el usuario en la app", () => {
  let fetchMock;
  const KEY = "e2e0123456789abcdef0123456789abcdef0";
  const callWith = async (query, headers) => {
    const res = fakeRes();
    await handler({ method: "GET", url: `/api/wallet?${query}`, headers }, res);
    return res;
  };
  beforeEach(() => {
    W.reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.COINSTATS_API_KEY;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("solo acepta claves con forma de clave (sin espacios ni rarezas)", () => {
    expect(W.coinStatsKeyFrom({ headers: { "x-coinstats-key": KEY } })).toEqual({ key: KEY, own: true });
    expect(W.coinStatsKeyFrom({ headers: { "x-coinstats-key": "corta" } })).toBeNull();
    expect(W.coinStatsKeyFrom({ headers: { "x-coinstats-key": "con espacios dentro de la clave" } })).toBeNull();
    expect(W.coinStatsKeyFrom({ headers: {} })).toBeNull();
  });

  it("usa la clave de la cabecera, la reenvia solo a CoinStats y no deja cachear la respuesta", async () => {
    fetchMock.mockImplementation(async (url) => (String(url).includes("coingecko") ? json([]) : json([
      { coinId: "ethereum", amount: 1, chain: "ethereum", symbol: "ETH", name: "Ethereum", price: 2000 }
    ])));
    const res = await callWith(`chain=evm&address=${EVM}`, { "x-coinstats-key": KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe("coinstats");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const conClave = fetchMock.mock.calls.filter(([, o]) => JSON.stringify(o?.headers || {}).includes(KEY));
    expect(conClave).toHaveLength(1);
    expect(String(conClave[0][0]).startsWith("https://openapiv1.coinstats.app/")).toBe(true);
    // Una lectura SIN clave no recibe lo cacheado con clave (ni al reves).
    fetchMock.mockImplementation(async (url, opts) => {
      if (String(url).includes("coingecko")) return json([]);
      if (String(url).startsWith("https://mempool.space/")) return json({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } });
      const body = JSON.parse(opts.body);
      if (body.method === "eth_getBalance") return json({ result: "0x0" });
      const n = Number(BigInt("0x" + body.params[0].data.slice(10 + 64, 10 + 128)));
      return json({ result: encodeResults(Array.from({ length: n }, () => ({ success: true, data: u256(0) }))) });
    });
    const sinClave = await callWith(`chain=evm&address=${EVM}`, {});
    expect(sinClave.body.mode).toBe("public");
  });

  it("clave rechazada: se lee igual sin CoinStats y la respuesta lo avisa", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("coinstats")) return json({ statusCode: 401 }, 401);
      if (u.includes("coingecko")) return json([]);
      return json({ chain_stats: { funded_txo_sum: 50000000, spent_txo_sum: 0 } });
    });
    const res = await callWith("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", { "x-coinstats-key": KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ mode: "public", warning: "coinstats_key" });
    expect(res.body.assets[0]).toMatchObject({ coinId: "bitcoin", amount: "0.5" });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("sin creditos (429): aviso coinstats_limit", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("coinstats")) return json({}, 429);
      if (u.includes("coingecko")) return json([]);
      return json({ chain_stats: {} });
    });
    const res = await callWith("chain=bitcoin&address=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", { "x-coinstats-key": KEY });
    expect(res.body.warning).toBe("coinstats_limit");
  });
});
