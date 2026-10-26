// =============================================================================
// Lector de billeteras (Vercel). Devuelve lo que guarda una direccion PUBLICA.
// -----------------------------------------------------------------------------
// La app llama a `/api/wallet?chain=<evm|solana|bitcoin>&address=<direccion>`.
//
//   · Ethereum y compatibles (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB
//     Chain, Avalanche) y Solana, en dos modos:
//       - SIN CUENTA (por defecto): nodos publicos de cada red, sin clave. En
//         EVM se lee la moneda nativa y las ~500 monedas principales de
//         CoinGecko de una vez por red (Multicall3); en Solana, todos los
//         tokens de la direccion. Un token pequeno o muy nuevo de EVM no sale.
//       - CON ALCHEMY (opcional): si existe ALCHEMY_API_KEY en Vercel se usa su
//         Portfolio API, que encuentra todos los tokens. Si Alchemy falla, se
//         cae al modo sin cuenta. Alchemy admite hasta 5 redes por peticion:
//         las 7 redes EVM van en dos peticiones en paralelo.
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
const CG_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&sparkline=false&page=';
const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2/';

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

// ── CoinGecko: contrato -> id de moneda, y top de mercado ──

let cgData = null;
let cgDataAt = 0;
let cgDataPending = null;
let topData = null;
let topDataAt = 0;
let topDataPending = null;
const TOP_TTL_MS = 3600_000;

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

function buildCoinIndex(list) {
  const map = new Map();
  (Array.isArray(list) ? list : []).forEach((coin) => {
    if (coin?.id) map.set(coin.id, { symbol: coin.symbol, name: coin.name, platforms: coin.platforms || {} });
  });
  return map;
}

function coinGeckoHeaders() {
  const key = process.env.COINGECKO_API_KEY;
  return { accept: 'application/json', ...(key ? { 'x-cg-demo-api-key': key } : {}) };
}

/** { byContract, byId } de la lista completa de CoinGecko, o null. */
async function getCoinGeckoData() {
  if (cgData && Date.now() - cgDataAt < CG_MAP_TTL_MS) return cgData;
  if (cgDataPending) return cgDataPending;
  cgDataPending = (async () => {
    try {
      const response = await fetchWithTimeout(CG_LIST_URL, { headers: coinGeckoHeaders() });
      if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
      const list = await response.json();
      cgData = { byContract: buildCoinGeckoMap(list), byId: buildCoinIndex(list) };
      cgDataAt = Date.now();
      return cgData;
    } catch {
      // Sin lista: los tokens llegan sin id y la app los valora por contrato.
      return cgData || null;
    } finally {
      cgDataPending = null;
    }
  })();
  return cgDataPending;
}

/** Las ~500 monedas con mas capitalizacion: { ids, price, image }. */
async function getTopMarkets() {
  if (topData && Date.now() - topDataAt < TOP_TTL_MS) return topData;
  if (topDataPending) return topDataPending;
  topDataPending = (async () => {
    try {
      const pages = await Promise.all([1, 2].map(async (page) => {
        const response = await fetchWithTimeout(`${CG_MARKETS_URL}${page}`, { headers: coinGeckoHeaders() });
        if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
        const rows = await response.json();
        return Array.isArray(rows) ? rows : [];
      }));
      const rows = pages.flat();
      topData = {
        ids: rows.map((row) => row.id).filter(Boolean),
        price: new Map(rows.filter((row) => Number(row.current_price) > 0).map((row) => [row.id, Number(row.current_price)])),
        image: new Map(rows.map((row) => [row.id, safeLogo(row.image)]).filter(([, url]) => url)),
      };
      topDataAt = Date.now();
      return topData;
    } catch {
      return topData || { ids: [], price: new Map(), image: new Map() };
    } finally {
      topDataPending = null;
    }
  })();
  return topDataPending;
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
  const [results, cg] = await Promise.all([
    Promise.allSettled(groups.map((networks) => fetchAlchemyGroup(key, address, networks))),
    getCoinGeckoData(),
  ]);
  const coinMap = cg?.byContract || null;
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
    mode: 'alchemy',
  };
}

// ── Modo sin cuenta: nodos publicos de cada red ──
//
// JSON-RPC estandar (el mismo que usan todas las billeteras), sin claves.
// Varios nodos por red: si uno falla o tarda, se prueba el siguiente.

const PUBLIC_RPCS = {
  eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://1rpc.io/eth', 'https://cloudflare-eth.com'],
  base: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://1rpc.io/base'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://1rpc.io/arb'],
  optimism: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io', 'https://1rpc.io/op'],
  polygon_pos: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com', 'https://1rpc.io/matic'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://1rpc.io/bnb'],
  avax: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc', 'https://1rpc.io/avax/c'],
  solana: ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'],
};
const EVM_PUBLIC_NETWORKS = ['eth', 'base', 'arbitrum', 'optimism', 'polygon_pos', 'bsc', 'avax'];
const RPC_TIMEOUT_MS = 5_000;
// Como mucho 3 nodos por llamada: con todos colgados son 15 s, dentro del
// limite de la funcion (maxDuration 30 en vercel.json).
const MAX_RPC_TRIES = 3;

// Multicall3: mismo contrato y direccion en todas estas redes. Permite pedir
// cientos de saldos en una sola llamada (aggregate3, fallos permitidos).
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
const SEL_AGGREGATE3 = '82ad56cb'; // aggregate3((address,bool,bytes)[])
const SEL_BALANCE_OF = '70a08231'; // balanceOf(address)
const SEL_DECIMALS = '313ce567'; // decimals()
const MULTICALL_CHUNK = 150;

const SPL_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
];
const MAX_SOLANA_ACCOUNTS = 1000;
const MAX_UNLISTED_LOOKUPS = 60;

// Red de la app -> plataforma de CoinGecko y moneda nativa.
const NETWORK_BY_ID = Object.fromEntries(Object.values(NETWORKS).map((n) => [n.id, n]));

// Respaldo minimo por si CoinGecko no responde: las monedas estables y
// envueltas principales de cada red (siempre se miran).
const CORE_TOKENS = {
  eth: [
    ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'usd-coin', 'USDC', 'USDC'],
    ['0xdac17f958d2ee523a2206206994597c13d831ec7', 'tether', 'USDT', 'Tether'],
    ['0x6b175474e89094c44da98b954eedeac495271d0f', 'dai', 'DAI', 'Dai'],
    ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'weth', 'WETH', 'WETH'],
    ['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 'wrapped-bitcoin', 'WBTC', 'Wrapped Bitcoin'],
    ['0x514910771af9ca656af840dff83e8264ecf986ca', 'chainlink', 'LINK', 'Chainlink'],
  ],
  base: [['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'usd-coin', 'USDC', 'USDC']],
  arbitrum: [
    ['0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'usd-coin', 'USDC', 'USDC'],
    ['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'tether', 'USDT', 'Tether'],
  ],
  optimism: [['0x0b2c639c533813f4aa9d7837caf62653d097ff85', 'usd-coin', 'USDC', 'USDC']],
  polygon_pos: [
    ['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 'usd-coin', 'USDC', 'USDC'],
    ['0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 'tether', 'USDT', 'Tether'],
  ],
  bsc: [
    ['0x55d398326f99059ff775485246999027b3197955', 'tether', 'USDT', 'Tether'],
    ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 'usd-coin', 'USDC', 'USDC'],
  ],
  avax: [
    ['0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', 'usd-coin', 'USDC', 'USDC'],
    ['0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', 'tether', 'USDT', 'Tether'],
  ],
};

async function rpcCall(network, method, params) {
  let lastError = null;
  for (const url of (PUBLIC_RPCS[network] || []).slice(0, MAX_RPC_TRIES)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${url} respondio ${response.status}`);
      const json = await response.json();
      if (json?.error) throw new Error(`${url}: ${json.error.message || 'error'}`);
      if (!json || !('result' in json)) throw new Error(`${url}: sin resultado`);
      return json.result;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new UpstreamError(502, lastError ? lastError.message : `sin nodos para ${network}`);
}

// ── ABI minima de Multicall3.aggregate3 (codificar llamada, leer resultado) ──

const strip0x = (hex) => String(hex || '').replace(/^0x/i, '');
const uintWord = (n) => BigInt(n).toString(16).padStart(64, '0');
const addressWord = (address) => strip0x(address).toLowerCase().padStart(64, '0');

function encodeAggregate3(calls) {
  const elements = calls.map(({ target, data }) => {
    const bytes = strip0x(data);
    const length = bytes.length / 2;
    const padded = bytes.padEnd(Math.ceil(length / 32) * 64, '0');
    // (address target, bool allowFailure = true, bytes callData)
    return addressWord(target) + uintWord(1) + uintWord(96) + uintWord(length) + padded;
  });
  let offset = calls.length * 32;
  const heads = elements.map((element) => {
    const head = uintWord(offset);
    offset += element.length / 2;
    return head;
  });
  return `0x${SEL_AGGREGATE3}${uintWord(32)}${uintWord(calls.length)}${heads.join('')}${elements.join('')}`;
}

/** Resultado de aggregate3 -> [{ success, data }] (data en hex con 0x). */
function decodeAggregate3(hex) {
  const d = strip0x(hex);
  const word = (byteOffset) => {
    const chunk = d.slice(byteOffset * 2, byteOffset * 2 + 64);
    if (chunk.length !== 64) throw new Error('respuesta de multicall cortada');
    return BigInt(`0x${chunk}`);
  };
  const start = Number(word(0));
  // aggregate3 devuelve un unico array: su cabecera siempre apunta a 32.
  if (start !== 32) throw new Error('respuesta de multicall invalida');
  const count = Number(word(start));
  if (count > 5000) throw new Error('respuesta de multicall invalida');
  const base = start + 32;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const element = base + Number(word(base + i * 32));
    const success = word(element) === 1n;
    const bytesAt = element + Number(word(element + 32));
    const length = Number(word(bytesAt));
    out.push({ success, data: `0x${d.slice((bytesAt + 32) * 2, (bytesAt + 32 + length) * 2)}` });
  }
  return out;
}

function firstUint(data) {
  const hex = strip0x(data);
  return hex.length >= 64 ? BigInt(`0x${hex.slice(0, 64)}`) : null;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function multicall(network, calls) {
  const results = [];
  for (const part of chunk(calls, MULTICALL_CHUNK)) {
    const raw = await rpcCall(network, 'eth_call', [{ to: MULTICALL3, data: encodeAggregate3(part) }, 'latest']);
    const decoded = decodeAggregate3(raw);
    if (decoded.length !== part.length) throw new Error('multicall devolvio otra cantidad');
    results.push(...decoded);
  }
  return results;
}

/** Tokens que se miran en una red EVM: top de CoinGecko + respaldo minimo. */
function evmCandidates(network, cg, top) {
  const platform = NETWORK_BY_ID[network].platform;
  const seen = new Set();
  const out = [];
  const add = (contract, coinId, symbol, name) => {
    const clean = String(contract || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push({ contract: clean, coinId, symbol, name });
  };
  if (cg) {
    top.ids.forEach((id) => {
      const coin = cg.byId.get(id);
      if (coin) add(coin.platforms?.[platform], id, coin.symbol, coin.name);
    });
  }
  (CORE_TOKENS[network] || []).forEach(([contract, coinId, symbol, name]) => add(contract, coinId, symbol, name));
  return out;
}

async function readEvmNetwork(network, owner, candidates) {
  const meta = NETWORK_BY_ID[network];
  const assets = [];
  const nativeUnits = parseUnits(await rpcCall(network, 'eth_getBalance', [owner, 'latest']));
  if (nativeUnits && nativeUnits > 0n) {
    const native = meta.native;
    assets.push({
      network, contract: null, symbol: native.symbol, name: native.name, decimals: native.decimals,
      amount: formatUnits(nativeUnits, native.decimals), priceUsd: null, logo: null, coinId: native.coinId,
    });
  }
  if (!candidates.length) return assets;

  const balances = await multicall(network, candidates.map((c) => ({
    target: c.contract,
    data: `0x${SEL_BALANCE_OF}${addressWord(owner)}`,
  })));
  const held = [];
  balances.forEach((result, i) => {
    const units = result.success ? firstUint(result.data) : null;
    if (units && units > 0n) held.push({ ...candidates[i], units });
  });
  if (!held.length) return assets;

  const decimals = await multicall(network, held.map((h) => ({ target: h.contract, data: `0x${SEL_DECIMALS}` })));
  held.forEach((h, i) => {
    const value = decimals[i]?.success ? firstUint(decimals[i].data) : null;
    if (value === null || value > 36n) return;
    const dec = Number(value);
    assets.push({
      network, contract: h.contract,
      symbol: cleanText(h.symbol || '', 16).toUpperCase(),
      name: cleanText(h.name || h.symbol || '', 48),
      decimals: dec, amount: formatUnits(h.units, dec), priceUsd: null, logo: null, coinId: h.coinId || null,
    });
  });
  return assets;
}

/** Precios y nombres de GeckoTerminal para tokens que CoinGecko no lista. */
async function geckoTerminalInfo(network, addresses) {
  const info = new Map();
  for (const part of chunk(addresses.slice(0, MAX_UNLISTED_LOOKUPS), 30)) {
    try {
      const response = await fetchWithTimeout(
        `${GECKOTERMINAL_BASE}networks/${network}/tokens/multi/${part.map(encodeURIComponent).join(',')}`,
        { headers: { accept: 'application/json' } },
      );
      if (!response.ok) continue;
      const json = await response.json();
      (Array.isArray(json?.data) ? json.data : []).forEach((item) => {
        const a = item?.attributes || {};
        const price = Number(a.price_usd);
        info.set(String(a.address || ''), {
          priceUsd: Number.isFinite(price) && price > 0 ? price : null,
          symbol: a.symbol,
          name: a.name,
          logo: safeLogo(a.image_url),
        });
      });
    } catch {
      // Sin precio: el activo queda oculto en la vista previa.
    }
  }
  return info;
}

async function readSolanaPublic(owner, cg) {
  const balance = await rpcCall('solana', 'getBalance', [owner, { commitment: 'confirmed' }]);
  const lamports = parseUnits(String(balance?.value ?? balance ?? '0'));
  const lists = await Promise.allSettled(SPL_PROGRAMS.map((programId) => rpcCall('solana', 'getTokenAccountsByOwner', [
    owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])));
  if (lists[0].status === 'rejected') throw lists[0].reason;

  const byMint = new Map();
  lists
    .flatMap((r) => (r.status === 'fulfilled' && Array.isArray(r.value?.value) ? r.value.value : []))
    .slice(0, MAX_SOLANA_ACCOUNTS)
    .forEach((account) => {
      const parsed = account?.account?.data?.parsed?.info;
      const mint = typeof parsed?.mint === 'string' ? parsed.mint : '';
      const units = parseUnits(String(parsed?.tokenAmount?.amount ?? ''));
      const decimals = Number(parsed?.tokenAmount?.decimals);
      if (!mint || units === null || units <= 0n || !Number.isInteger(decimals) || decimals > 36) return;
      const current = byMint.get(mint);
      if (current) current.units += units;
      else byMint.set(mint, { mint, units, decimals });
    });

  const assets = [];
  if (lamports && lamports > 0n) {
    const native = NETWORK_BY_ID.solana.native;
    assets.push({
      network: 'solana', contract: null, symbol: native.symbol, name: native.name, decimals: native.decimals,
      amount: formatUnits(lamports, native.decimals), priceUsd: null, logo: null, coinId: native.coinId,
    });
  }
  const tokens = [...byMint.values()].map((t) => ({ ...t, coinId: cg?.byContract.get(contractKey('solana', t.mint)) || null }));
  const unlisted = await geckoTerminalInfo('solana', tokens.filter((t) => !t.coinId).map((t) => t.mint));
  tokens.forEach((t) => {
    const coin = t.coinId ? cg.byId.get(t.coinId) : null;
    const extra = unlisted.get(t.mint);
    assets.push({
      network: 'solana', contract: t.mint,
      symbol: cleanText(coin?.symbol || extra?.symbol || '', 16).toUpperCase(),
      name: cleanText(coin?.name || extra?.name || extra?.symbol || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`, 48),
      decimals: t.decimals, amount: formatUnits(t.units, t.decimals),
      priceUsd: extra?.priceUsd ?? null, logo: extra?.logo || null, coinId: t.coinId,
    });
  });
  return assets;
}

/** Precio en USD y logo del top de CoinGecko para lo que tenga id. */
function withTopPrices(assets, top) {
  return assets.map((asset) => (asset.coinId
    ? { ...asset, priceUsd: asset.priceUsd ?? top.price.get(asset.coinId) ?? null, logo: asset.logo || top.image.get(asset.coinId) || null }
    : asset));
}

async function readPublic(chain, owner) {
  const [cg, top] = await Promise.all([getCoinGeckoData(), getTopMarkets()]);
  if (chain === 'solana') {
    return {
      assets: withTopPrices(await readSolanaPublic(owner, cg), top),
      failedNetworks: [],
      unlisted: cg ? 'checked' : 'unchecked',
      mode: 'public',
    };
  }
  const results = await Promise.allSettled(EVM_PUBLIC_NETWORKS.map((network) => (
    readEvmNetwork(network, owner, evmCandidates(network, cg, top))
  )));
  if (!results.some((r) => r.status === 'fulfilled')) {
    throw new UpstreamError(502, 'Ningun nodo publico responde');
  }
  return {
    assets: withTopPrices(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])), top),
    failedNetworks: EVM_PUBLIC_NETWORKS.filter((_, i) => results[i].status === 'rejected'),
    unlisted: cg ? 'checked' : 'unchecked',
    mode: 'public',
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
        mode: 'public',
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
    let read;
    if (chain === 'bitcoin') {
      read = await readBitcoin(address);
    } else if (process.env.ALCHEMY_API_KEY) {
      try {
        read = await readAlchemy(address, chain === 'solana' ? SOLANA_GROUPS : EVM_GROUPS);
      } catch {
        // Alchemy caido, sin cuota o con la clave mal: se lee igual sin cuenta.
        read = await readPublic(chain, address);
      }
    } else {
      read = await readPublic(chain, address);
    }
    const value = {
      chain,
      address,
      fetchedAt: new Date().toISOString(),
      assets: read.assets,
      failedNetworks: read.failedNetworks,
      unlisted: read.unlisted,
      mode: read.mode,
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
  encodeAggregate3,
  decodeAggregate3,
  evmCandidates,
  buildCoinIndex,
  PUBLIC_RPCS,
  MULTICALL3,
  reset() {
    results.clear();
    cgData = null;
    cgDataAt = 0;
    cgDataPending = null;
    topData = null;
    topDataAt = 0;
    topDataPending = null;
  },
};
