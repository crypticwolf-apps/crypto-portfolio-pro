// Pruebas de la logica pura del lector de billeteras (wallet-core.js).
import { describe, it, expect } from "vitest";
import W from "../wallet-core.js";

const SEED_12 = "abandon ability able about above absent absorb abstract absurd abuse access accident";

describe("que se ha pegado", () => {
  it("reconoce direcciones de cada red", () => {
    expect(W.classifyWalletInput("  0x8BA1f109551bD432803012645Ac136ddd64DBA72 ")).toEqual({ kind: "evm", address: "0x8ba1f109551bd432803012645ac136ddd64dba72" });
    expect(W.classifyWalletInput("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").kind).toBe("bitcoin");
    expect(W.classifyWalletInput("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").kind).toBe("bitcoin");
    expect(W.classifyWalletInput("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy").kind).toBe("bitcoin");
    expect(W.classifyWalletInput("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toEqual({ kind: "solana", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" });
  });

  it("rechaza frases semilla, con o sin numeracion", () => {
    expect(W.classifyWalletInput(SEED_12).kind).toBe("seed");
    expect(W.classifyWalletInput(SEED_12.split(" ").map((w, i) => `${i + 1}. ${w}`).join("\n")).kind).toBe("seed");
    expect(W.classifyWalletInput(`${SEED_12} ${SEED_12}`.split(" ").slice(0, 24).join(" ")).kind).toBe("seed");
  });

  it("rechaza claves privadas de cualquier formato", () => {
    expect(W.classifyWalletInput("0x" + "ab".repeat(32)).kind).toBe("privateKey");
    expect(W.classifyWalletInput("ab".repeat(32)).kind).toBe("privateKey");
    expect(W.classifyWalletInput("xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi").kind).toBe("privateKey");
    expect(W.classifyWalletInput("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ").kind).toBe("privateKey");
    expect(W.classifyWalletInput("[" + Array.from({ length: 64 }, (_, i) => i).join(",") + "]").kind).toBe("privateKey");
    // Secreto de Solana: 64 bytes en base58.
    const secreto64 = "4" + "Z".repeat(86);
    expect(W.base58Decode(secreto64).length).toBe(64);
    expect(W.classifyWalletInput(secreto64).kind).toBe("privateKey");
  });

  it("xpub y nombres .eth tienen su propio aviso; lo demas es invalido", () => {
    expect(W.classifyWalletInput("xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8").kind).toBe("xpub");
    expect(W.classifyWalletInput("vitalik.eth").kind).toBe("ens");
    expect(W.classifyWalletInput("hola").kind).toBe("invalid");
    expect(W.classifyWalletInput("0x123").kind).toBe("invalid");
    expect(W.classifyWalletInput("").kind).toBe("empty");
  });

  it("acorta direcciones para mostrarlas", () => {
    expect(W.shortAddress("0x8ba1f109551bd432803012645ac136ddd64dba72")).toBe("0x8ba1…ba72");
  });
});

describe("agrupar activos", () => {
  it("la misma moneda en varias redes se suma; lo no listado queda aparte por contrato", () => {
    const h = W.aggregateHoldings([
      { network: "eth", contract: null, symbol: "ETH", name: "Ethereum", amount: "1.5", priceUsd: 3000, coinId: "ethereum" },
      { network: "base", contract: null, symbol: "ETH", name: "Ethereum", amount: "0.5", priceUsd: null, coinId: "ethereum" },
      { network: "base", contract: "0xaaa", symbol: "USDC", name: "Falso", amount: "1000", priceUsd: null, coinId: null },
      { network: "eth", contract: "0xbbb", symbol: "PEPE2", amount: "0", coinId: null }
    ]);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ key: "cg:ethereum", amount: 2, priceUsd: 3000, dexNetwork: null });
    expect(h[0].parts).toEqual([{ network: "eth", amount: 1.5 }, { network: "base", amount: 0.5 }]);
    expect(h[1]).toMatchObject({ key: "base:0xaaa", coinId: "", dexNetwork: "base", dexAddress: "0xaaa" });
  });

  it("visible por defecto solo con valor de al menos 1", () => {
    expect(W.isHoldingVisible(1)).toBe(true);
    expect(W.isHoldingVisible(0.99)).toBe(false);
    expect(W.isHoldingVisible(NaN)).toBe(false);
  });
});

describe("coste al importar y al sincronizar", () => {
  it("al importar: vacio o al precio de hoy", () => {
    expect(W.initialInvestment("manual", 2, 100)).toBeNull();
    expect(W.initialInvestment("today", 2, 100)).toBe(200);
    expect(W.initialInvestment("today", 2, null)).toBeNull();
  });

  it("bajan los tokens: el coste baja en proporcion (la rentabilidad no cambia)", () => {
    const r = W.syncPosition({ oldTokens: 10, investment: 1000, newTokens: 4, priceNow: 150 });
    expect(r).toEqual({ tokens: 4, investment: 400, change: "down" });
    // Coste medio intacto: 100 por token antes y despues.
    expect(r.investment / r.tokens).toBe(100);
  });

  it("suben: los nuevos entran al precio de ahora", () => {
    expect(W.syncPosition({ oldTokens: 10, investment: 1000, newTokens: 12, priceNow: 150 })).toEqual({ tokens: 12, investment: 1300, change: "up" });
    // Sin precio conocido el coste no se inventa.
    expect(W.syncPosition({ oldTokens: 10, investment: 1000, newTokens: 12, priceNow: null })).toEqual({ tokens: 12, investment: 1000, change: "up" });
  });

  it("a cero: posicion vacia; sin coste puesto: solo cambia la cantidad", () => {
    expect(W.syncPosition({ oldTokens: 10, investment: 1000, newTokens: 0, priceNow: 150 })).toEqual({ tokens: 0, investment: null, change: "down" });
    expect(W.syncPosition({ oldTokens: 10, investment: null, newTokens: 3, priceNow: 150 })).toEqual({ tokens: 3, investment: null, change: "down" });
    expect(W.syncPosition({ oldTokens: 5, investment: 500, newTokens: 5, priceNow: 150 })).toEqual({ tokens: 5, investment: 500, change: "same" });
  });
});
