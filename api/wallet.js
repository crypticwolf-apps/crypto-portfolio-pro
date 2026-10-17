// =============================================================================
// Lector de billeteras (Vercel). Devuelve lo que guarda una direccion PUBLICA.
// -----------------------------------------------------------------------------
// La app llama a `/api/wallet?chain=<evm|solana|bitcoin>&address=<direccion>`.
//
//   · Ethereum y compatibles (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB
//     Chain, Avalanche) y Solana: Portfolio API de Alchemy. La clave vive en la
//     variable de entorno ALCHEMY_API_KEY del servidor, nunca en el cliente.
//     Alchemy admite hasta 5 redes por direccion y peticion: las 7 redes EVM
//     van en dos peticiones en paralelo.
//   · Bitcoin: mempool.space (sin clave), con blockstream.info de respaldo.
//   · Cada token se identifica por RED + CONTRATO, nunca por su nombre: un token
//     basura llamado "USDC" no puede hacerse pasar por el USDC de verdad. El
//     contrato se cruza con la lista de CoinGecko (coins/list con plataformas)
//     para saber que moneda es; si CoinGecko no lo lista, la app lo valora por
//     contrato en GeckoTerminal.
//
// Solo lectura: no se guarda nada. Una direccion publica solo sirve para mirar
// el saldo, nunca para mover fondos. CORS abierto para la APK (origin file://).
// Fichero autocontenido, sin dependencias.
// =============================================================================

const crypto = require('crypto');

const ALCHEMY_BASE = 'https://api.g.alchemy.com/data/v1/';
const ESPLORA_BASES = ['https://mempool.space/api/', 'https://blockstream.info/api/'];
const CG_LIST_URL = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';

const ETH = { coinId: 'ethereum', symbol: 'ETH', name: 'Ethereum', decimals: 18 };

// Red de Alchemy -> id de red de la app (el de GeckoTerminal), plataforma de
// CoinGecko y moneda nativa de la red.
const NETWORKS = {
  'eth-mainnet': { id: 'eth', platform: 'ethereum', native: ETH },
  'base-mainnet': { id: 'base', platform: 'base', native: ETH },
  'arb-mainnet': { id: 'arbitrum', platform: 'arbitrum-one', native: ETH },
  'opt-mainnet': { id: 'optimism', platform: 'optimistic-ethereum', native: ETH },
  'polygon-mainnet': {
    id: 'polygon_pos',
    platform: 'polygon-pos',
    native: { coinId: 'polygon-ecosystem-token', symbol: 'POL', name: 'POL (ex-MATIC)', decimals: 18 },
  },
  'bnb-mainnet': {
    id: 'bsc',
    platform: 'binance-smart-chain',
    native: { coinId: 'binancecoin', symbol: 'BNB', name: 'BNB', decimals: 18 },
  },
  'avax-mainnet': {
    id: 'avax',
    platform: 'avalanche',
    native: { coinId: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', decimals: 18 },
  },
  'solana-mainnet': {
    id: 'solana',
    platform: 'solana',
    native: { coinId: 'solana', symbol: 'SOL', name: 'Solana', decimals: 9 },
  },
};

const EVM_GROUPS = [
  ['eth-mainnet', 'base-mainnet', 'arb-mainnet', 'opt-mainnet', 'polygon-mainnet'],
  ['bnb-mainnet', 'avax-mainnet'],
];
const SOLANA_GROUPS = [['solana-mainnet']];

const MAX_PAGES = 5;
const UPSTREAM_TIMEOUT_MS = 12_000;
const RESULT_TTL_MS = 30_000;
const CG_MAP_TTL_MS = 24 * 3600_000;

// ── Validacion de direcciones ──

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(text) {
  if (typeof text !== 'string' || !text || text.length > 120) return null;
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

// Bitcoin heredado (1… / 3…): 25 bytes, version 0x00 o 0x05 y suma de control.
function isLegacyBitcoin(address) {
  const bytes = base58Decode(address);
  if (!bytes || bytes.length !== 25 || (bytes[0] !== 0x00 && bytes[0] !== 0x05)) return false;
  const check = sha256(sha256(Buffer.from(bytes.subarray(0, 21))));
  return check.subarray(0, 4).equals(Buffer.from(bytes.subarray(21)));
}

/** Devuelve la direccion normalizada si es valida para esa red, o null. */
function validateAddress(chain, raw) {
  const address = String(raw || '').trim();
  if (chain === 'evm') {
    return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
  }
  if (chain === 'solana') {
    const bytes = base58Decode(address);
    return bytes && bytes.length === 32 && address.length >= 32 && address.length <= 44 ? address : null;
  }
  if (chain === 'bitcoin') {
    const lower = address.toLowerCase();
    if (/^bc1[02-9ac-hj-np-z]{11,71}$/.test(lower) && (address === lower || address === address.toUpperCase())) {
      return lower;
    }
    return isLegacyBitcoin(address) ? address : null;
  }
  return null;
}

// ── Utilidades ──

/** Cantidad entera en unidades minimas -> texto decimal exacto. */
function formatUnits(units, decimals) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Saldo de Alchemy: hexadecimal ("0x…") o entero decimal, en unidades minimas. */
function parseUnits(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text);
    if (/^\d+$/.test(text)) return BigInt(text);
    return null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

// Los tokens basura meten anuncios y enlaces en el nombre: se recorta.
function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeLogo(value) {
  const url = String(value || '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) && url.length < 500 ? url : null;
}

function usdPrice(prices) {
  if (!Array.isArray(prices)) return null;
  const usd = prices.find((p) => String(p?.currency || '').toLowerCase() === 'usd');
  const value = Number(usd?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class UpstreamError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── CoinGecko: contrato -> id de moneda ──

let cgMap = null;
let cgMapAt = 0;
let cgMapPending = null;

function contractKey(platform, address) {
  const clean = String(address || '').trim();
  return platform === 'solana' ? `solana:${clean}` : `${platform}:${clean.toLowerCase()}`;
}

function buildCoinGeckoMap(list) {
  const map = new Map();
  (Array.isArray(list) ? list : []).forEach((coin) => {
    if (!coin?.id || !coin.platforms || typeof coin.platforms !== 'object') return;
    Object.entries(coin.platforms).forEach(([platform, address]) => {
      if (!address) return;
      const key = contractKey(platform, address);
      if (!map.has(key)) map.set(key, coin.id);
    });
  });
  return map;
}

async function getCoinGeckoMap() {
  if (cgMap && Date.now() - cgMapAt < CG_MAP_TTL_MS) return cgMap;
  if (cgMapPending) return cgMapPending;
  cgMapPending = (async () => {
    try {
      const key = process.env.COINGECKO_API_KEY;
      const response = await fetchWithTimeout(CG_LIST_URL, {
        headers: { accept: 'application/json', ...(key ? { 'x-cg-demo-api-key': key } : {}) },
      });
      if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
      cgMap = buildCoinGeckoMap(await response.json());
      cgMapAt = Date.now();
      return cgMap;
    } catch {
      // Sin lista: los tokens llegan sin id y la app los valora por contrato.
      return cgMap || null;
    } finally {
      cgMapPending = null;
    }
  })();
  return cgMapPending;
}

// ── Alchemy ──

/** Tokens de Alchemy -> activos normalizados (sin saldos a cero ni errores). */
function normalizeAlchemyTokens(tokens, coinMap) {
  const assets = [];
  (Array.isArray(tokens) ? tokens : []).forEach((token) => {
    if (!token || token.error) return;
    const network = NETWORKS[token.network];
    if (!network) return;
    const contract = token.tokenAddress ? String(token.tokenAddress).trim() : null;
    const meta = token.tokenMetadata || {};
    const native = contract ? null : network.native;
    const decimals = Number.isInteger(Number(meta.decimals)) && meta.decimals !== null && meta.decimals !== ''
      ? Number(meta.decimals)
      : native?.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return;
    const units = parseUnits(token.tokenBalance);
    if (units === null || units <= 0n) return;

    const coinId = native
      ? native.coinId
      : coinMap?.get(contractKey(network.platform, contract)) || null;
    assets.push({
      network: network.id,
      contract: contract && network.id !== 'solana' ? contract.toLowerCase() : contract,
      symbol: cleanText(meta.symbol || native?.symbol || '', 16).toUpperCase(),
      name: cleanText(meta.name || native?.name || '', 48),
      decimals,
      amount: formatUnits(units, decimals),
      priceUsd: usdPrice(token.tokenPrices),
      logo: safeLogo(meta.logo),
      coinId,
    });
  });
  return assets;
}

async function fetchAlchemyGroup(key, address, networks) {
  const url = `${ALCHEMY_BASE}${encodeURIComponent(key)}/assets/tokens/by-address`;
  const tokens = [];
  let pageKey;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = {
      addresses: [{ address, networks }],
      withMetadata: true,
      withPrices: true,
      includeNativeTokens: true,
      includeErc20Tokens: true,
      ...(pageKey ? { pageKey } : {}),
    };
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new UpstreamError(response.status === 429 ? 429 : 502, `Alchemy respondio ${response.status}`);
    }
    const json = await response.json();
    const data = json?.data?.data || json?.data || json;
    tokens.push(...(Array.isArray(data?.tokens) ? data.tokens : []));
    pageKey = data?.pageKey;
    if (!pageKey) break;
  }
  return tokens;
}

async function readAlchemy(address, groups) {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) {
    throw new UpstreamError(503, 'missing_key');
  }
  const [results, coinMap] = await Promise.all([
    Promise.allSettled(groups.map((networks) => fetchAlchemyGroup(key, address, networks))),
    getCoinGeckoMap(),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) {
    const first = results[0]?.reason;
    throw first instanceof UpstreamError ? first : new UpstreamError(502, 'Alchemy no responde');
  }
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? groups[i] : null))
    .filter(Boolean)
    .flat()
    .map((n) => NETWORKS[n].id);
  return {
    assets: normalizeAlchemyTokens(ok.flatMap((r) => r.value), coinMap),
    failedNetworks: failed,
    unlisted: coinMap ? 'checked' : 'unchecked',
  };
}

// ── Bitcoin ──

function satsFromEsplora(info) {
  const chain = info?.chain_stats || {};
  const pool = info?.mempool_stats || {};
  const value = (Number(chain.funded_txo_sum) || 0) - (Number(chain.spent_txo_sum) || 0)
    + (Number(pool.funded_txo_sum) || 0) - (Number(pool.spent_txo_sum) || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

async function readBitcoin(address) {
  let lastError = null;
  for (const base of ESPLORA_BASES) {
    try {
      const response = await fetchWithTimeout(`${base}address/${encodeURIComponent(address)}`, {
        headers: { accept: 'application/json' },
      });
      if (response.status === 400) throw new UpstreamError(400, 'invalid_address');
      if (!response.ok) throw new UpstreamError(502, `Esplora respondio ${response.status}`);
      const sats = satsFromEsplora(await response.json());
      return {
        assets: sats > 0
          ? [{
              network: 'bitcoin', contract: null, symbol: 'BTC', name: 'Bitcoin', decimals: 8,
              amount: formatUnits(BigInt(sats), 8), priceUsd: null, logo: null, coinId: 'bitcoin',
            }]
          : [],
        failedNetworks: [],
        unlisted: 'checked',
      };
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 400) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof UpstreamError ? lastError : new UpstreamError(502, 'Bitcoin no responde');
}

// ── Handler ──

const results = new Map();

function sendError(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ error: code, message });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendError(res, 405, 'method', 'Usa GET.');
    return;
  }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const chain = params.get('chain');
  const address = validateAddress(chain, params.get('address'));
  if (!address) {
    sendError(res, 400, 'invalid_address', 'Direccion no valida para esa red.');
    return;
  }

  const cacheKey = `${chain}:${address}`;
  const hit = results.get(cacheKey);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.json(hit.value);
    return;
  }

  try {
    const read = chain === 'bitcoin'
      ? await readBitcoin(address)
      : await readAlchemy(address, chain === 'solana' ? SOLANA_GROUPS : EVM_GROUPS);
    const value = {
      chain,
      address,
      fetchedAt: new Date().toISOString(),
      assets: read.assets,
      failedNetworks: read.failedNetworks,
      unlisted: read.unlisted,
    };
    if (results.size > 300) results.delete(results.keys().next().value);
    results.set(cacheKey, { at: Date.now(), value });
    // Respuesta parcial (una red cayo): no se cachea en la CDN.
    res.setHeader('Cache-Control', read.failedNetworks.length
      ? 'no-store'
      : 'public, s-maxage=30, stale-while-revalidate=60');
    res.json(value);
  } catch (error) {
    if (error instanceof UpstreamError) {
      if (error.status === 503) {
        sendError(res, 503, 'missing_key', 'Falta ALCHEMY_API_KEY en las variables de entorno de Vercel.');
      } else if (error.status === 400) {
        sendError(res, 400, 'invalid_address', 'Direccion no valida para esa red.');
      } else if (error.status === 429) {
        sendError(res, 429, 'rate_limited', 'Demasiadas consultas; prueba en un minuto.');
      } else {
        sendError(res, 502, 'upstream', error.message);
      }
      return;
    }
    sendError(res, 502, 'upstream', 'No se pudo leer la billetera.');
  }
};

// Solo para las pruebas.
module.exports._internals = {
  validateAddress,
  base58Decode,
  formatUnits,
  parseUnits,
  normalizeAlchemyTokens,
  buildCoinGeckoMap,
  satsFromEsplora,
  NETWORKS,
  EVM_GROUPS,
  reset() {
    results.clear();
    cgMap = null;
    cgMapAt = 0;
    cgMapPending = null;
  },
};
