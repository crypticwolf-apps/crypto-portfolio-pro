/* ═══════════════════════════════════════════════════════
   wallet-core.js — Logica pura del lector de billeteras.

   Sin estado ni DOM, para probarla aislada (como finance.js):
   reconoce que se ha pegado (direccion de cada red, o algo
   que NUNCA debe escribirse: frase semilla o clave privada),
   agrupa los activos de una billetera y aplica las reglas de
   sincronizacion del coste. Se expone como `window.WalletCore`
   en el navegador y con module.exports para Vitest.
   ═══════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.WalletCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  // Nombre visible de cada red (los ids son los de GeckoTerminal).
  const NETWORK_LABELS = {
    eth: "Ethereum",
    base: "Base",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
    polygon_pos: "Polygon",
    bsc: "BNB Chain",
    avax: "Avalanche",
    solana: "Solana",
    bitcoin: "Bitcoin"
  };

  // Valor minimo (en la moneda base) para mostrar un activo por defecto en la
  // vista previa. Por debajo, o sin precio, suele ser polvo o token basura.
  const MIN_VISIBLE_VALUE = 1;

  function base58Decode(text) {
    if (typeof text !== "string" || !text || text.length > 120) {
      return null;
    }
    let value = 0n;
    for (const char of text) {
      const digit = BASE58.indexOf(char);
      if (digit < 0) {
        return null;
      }
      value = value * 58n + BigInt(digit);
    }
    const bytes = [];
    while (value > 0n) {
      bytes.unshift(Number(value % 256n));
      value /= 256n;
    }
    for (const char of text) {
      if (char !== "1") {
        break;
      }
      bytes.unshift(0);
    }
    return Uint8Array.from(bytes);
  }

  /**
   * Que es lo que se ha pegado. kind:
   *   evm | solana | bitcoin  -> direccion valida (address normalizada)
   *   seed | privateKey       -> PELIGRO: nunca debe escribirse en una app
   *   xpub                    -> clave publica extendida (aun no soportada)
   *   ens                     -> nombre .eth (hay que pegar la direccion 0x)
   *   empty | invalid
   */
  function classifyWalletInput(raw) {
    const text = String(raw ?? "").trim();
    if (!text) {
      return { kind: "empty", address: "" };
    }

    // Frase semilla: 12-24 palabras sueltas (con o sin numeracion "1." "2)").
    const words = text.toLowerCase().split(/[\s,]+/).filter((w) => w && !/^\d+[.)-]?$/.test(w));
    if (words.length >= 11 && words.length <= 25 && words.every((w) => /^[a-z]+$/.test(w))) {
      return { kind: "seed", address: "" };
    }

    // Claves privadas: hex de 64, xprv/yprv/zprv, WIF de Bitcoin, secreto de
    // Solana (64 bytes en base58) o el fichero de clave como lista de numeros.
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(text) || /^[xyzt]prv[1-9A-HJ-NP-Za-km-z]{20,}$/i.test(text)) {
      return { kind: "privateKey", address: "" };
    }
    if (/^\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,}\s*\]$/.test(text)) {
      return { kind: "privateKey", address: "" };
    }

    if (/^0x[0-9a-fA-F]{40}$/.test(text)) {
      return { kind: "evm", address: text.toLowerCase() };
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(text)) {
      return { kind: "ens", address: "" };
    }
    if (/^[xyzYZ]pub[1-9A-HJ-NP-Za-km-z]{100,}$/.test(text)) {
      return { kind: "xpub", address: "" };
    }

    const lower = text.toLowerCase();
    if (/^bc1[02-9ac-hj-np-z]{11,71}$/.test(lower) && (text === lower || text === text.toUpperCase())) {
      return { kind: "bitcoin", address: lower };
    }

    const bytes = base58Decode(text);
    if (bytes) {
      if (bytes.length === 25 && (bytes[0] === 0x00 || bytes[0] === 0x05) && /^[13]/.test(text)) {
        return { kind: "bitcoin", address: text };
      }
      if (bytes.length === 32 && text.length >= 32 && text.length <= 44) {
        return { kind: "solana", address: text };
      }
      if (bytes.length === 64) {
        return { kind: "privateKey", address: "" };
      }
      if ((bytes.length === 37 || bytes.length === 38) && bytes[0] === 0x80) {
        return { kind: "privateKey", address: "" };
      }
    }
    return { kind: "invalid", address: "" };
  }

  function shortAddress(address) {
    const text = String(address || "");
    return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
  }

  function toAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Activos de la billetera -> una posicion por moneda. La misma moneda en
   * varias redes (ETH en Ethereum y en Base, USDC en cuatro redes) se suma en
   * una sola, guardando el desglose. Un token que CoinGecko no conoce se queda
   * aparte, identificado por red + contrato.
   */
  function aggregateHoldings(assets) {
    const byKey = new Map();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const amount = toAmount(asset?.amount);
      if (!amount || !asset.network) {
        return;
      }
      const coinId = asset.coinId ? String(asset.coinId) : "";
      const key = coinId ? `cg:${coinId}` : `${asset.network}:${asset.contract || "native"}`;
      const current = byKey.get(key);
      if (current) {
        current.amount += amount;
        current.parts.push({ network: asset.network, amount });
        current.priceUsd = current.priceUsd ?? (Number(asset.priceUsd) > 0 ? Number(asset.priceUsd) : null);
        current.logo = current.logo || asset.logo || null;
        return;
      }
      byKey.set(key, {
        key,
        coinId,
        symbol: String(asset.symbol || "").toUpperCase(),
        name: String(asset.name || asset.symbol || ""),
        logo: asset.logo || null,
        amount,
        priceUsd: Number(asset.priceUsd) > 0 ? Number(asset.priceUsd) : null,
        parts: [{ network: asset.network, amount }],
        dexNetwork: coinId ? null : asset.network,
        dexAddress: coinId ? null : asset.contract || null
      });
    });
    return [...byKey.values()];
  }

  /** Visible por defecto en la vista previa: con precio y al menos 1 de valor. */
  function isHoldingVisible(value) {
    return Number.isFinite(value) && value >= MIN_VISIBLE_VALUE;
  }

  /** Coste al importar: vacio (lo pone el usuario) o al precio de hoy. */
  function initialInvestment(mode, amount, priceNow) {
    if (mode !== "today") {
      return null;
    }
    const value = toAmount(amount) * Number(priceNow);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /**
   * Nueva lectura de la billetera sobre una posicion ya importada. La cantidad
   * la manda la blockchain; el coste se mantiene coherente:
   *   · bajan los tokens (venta o envio): el coste baja en la misma proporcion
   *     (coste medio), asi la rentabilidad no se descuadra;
   *   · suben: los tokens nuevos entran al precio de ahora (editable despues);
   *   · llegan a cero: la posicion queda vacia, como al venderlo todo;
   *   · sin coste puesto: solo cambia la cantidad.
   * investment: numero o null (vacio). Devuelve { tokens, investment, change }.
   */
  function syncPosition({ oldTokens, investment, newTokens, priceNow }) {
    const before = toAmount(oldTokens);
    const after = toAmount(newTokens);
    const cost = Number.isFinite(investment) && investment >= 0 ? investment : null;
    const change = after > before ? "up" : after < before ? "down" : "same";

    if (after === 0) {
      return { tokens: 0, investment: null, change };
    }
    if (cost === null || before === 0 || change === "same") {
      return { tokens: after, investment: cost, change };
    }
    if (change === "down") {
      return { tokens: after, investment: cost * (after / before), change };
    }
    const price = Number(priceNow);
    const added = price > 0 ? (after - before) * price : 0;
    return { tokens: after, investment: cost + added, change };
  }

  return {
    NETWORK_LABELS,
    MIN_VISIBLE_VALUE,
    base58Decode,
    classifyWalletInput,
    shortAddress,
    aggregateHoldings,
    isHoldingVisible,
    initialInvestment,
    syncPosition
  };
});
