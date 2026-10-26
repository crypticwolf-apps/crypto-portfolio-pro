// =============================================================================
// config.js - Constantes, estado global (state), referencias al DOM (dom) y
// tablas de sectores. PRIMER script de la app: los demas leen de aqui.
// -----------------------------------------------------------------------------
// La app son scripts clasicos (no modulos ES: la APK abre la app desde file:// y
// ahi los modulos no cargan). Todos comparten el ambito global y se cargan en el
// orden de index.html. Reglas para que siga funcionando:
//   1. Una const/let que se use AL CARGAR otro fichero (fuera de una funcion)
//      tiene que estar en un fichero anterior. Lo normal: dejarla aqui.
//   2. Ningun fichero ejecuta nada al cargar salvo arranque.js, que llama a
//      init() en su ultima linea. Dentro de funciones se puede usar cualquier
//      cosa de cualquier fichero.
//   3. Un fichero nuevo se anade a index.html (antes de arranque.js) y a
//      APP_SHELL en sw.js.
// =============================================================================

const STORAGE_KEY = "crypto-dashboard-rows-v3";
// Versión del esquema de datos guardados. Subirla cuando cambie la forma del
// payload y añadir la migración correspondiente en migrateStoredPayload().
const DATA_SCHEMA_VERSION = 2;
// Memo por fila: computeRowMetrics se invoca decenas de veces por repintado
// (tabla, resumen, analítica, plan). La firma cubre todas sus entradas, así
// el cache se invalida solo cuando cambia algún dato de la fila.
// OJO: debe declararse antes de la llamada a init() (línea ~350).
const rowMetricsMemo = new WeakMap();
const MAX_TRADES = 1000;
const MAX_ALERTS = 200;
// Ambito de una alerta: un activo concreto, todos a la vez, o el valor total
// del portafolio. "all" se guarda como UNA alerta que vigila a todos, no como
// una copia por activo: asi editarla o borrarla es una sola operacion.
const ALERT_SCOPE_ALL = "__all__";
/* ── Noticias (Crypto Atalaya) ──
   El feed lo genera el bot de Telegram del proyecto Atalaya y se publica como
   JSON estatico. Aqui solo se lee: la app no envia nada ni necesita claves.
   Se guarda copia local para poder leer las ultimas noticias sin conexion. */
const NEWS_URL = "https://cryptoatalaya.com/data/feed.json";
const NEWS_CACHE_KEY = "crypto-dashboard-news-v1";
const NEWS_TTL = 5 * 60 * 1000;
// Secciones abiertas del Plan. Solo en memoria: al abrir la app todo empieza
// plegado, pero se conserva mientras se edita (el render se repite al escribir).
const tpFolds = new Set();
// Periodos del resumen de rendimiento (antes de init(): se usa en el 1er render).
const ANALYTICS_PERIODS = [
  { key: "24h", ms: 24 * 3600e3, label: "period.24h" },
  { key: "7d", ms: 7 * 24 * 3600e3, label: "period.7d" },
  { key: "30d", ms: 30 * 24 * 3600e3, label: "period.30d" },
  { key: "3m", ms: 90 * 24 * 3600e3, label: "period.3m" },
  { key: "1a", ms: 365 * 24 * 3600e3, label: "period.1a" },
  { key: "total", ms: null, label: "period.total" }
];
const PREFS_KEY = "crypto-dashboard-prefs-v2";
const HISTORY_KEY = "crypto-dashboard-history-v2";
const FX_RATE_CACHE_KEY = "crypto-dashboard-fx-v1";
const AUTOSAVE_DELAY = 800;
const SEARCH_DELAY = 280;
const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const PRICE_CACHE_TTL = 25 * 1000;
const FX_RATE_TTL = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 15000;
// Ruta preferente: un proxy serverless propio. Ahí vive la clave demo de
// CoinGecko (server-side, nunca en este bundle), la caché compartida entre
// usuarios y el desbloqueo del precio histórico por fecha. Si el proxy cae,
// fetchJsonWithRetry reintenta contra CoinGecko directo (sin clave, pero la app
// sigue funcionando).
//
// Servida por web, la app y su proxy comparten origen en Vercel: ruta
// relativa y nos ahorramos el salto entre dominios (una resolución DNS y un
// preflight menos por arranque). La APK abre los ficheros con origin
// file://, donde no hay servidor propio, así que ahí se usa la absoluta.
// (Si algún día se vuelve a publicar en un host sin /api —GitHub Pages, por
// ejemplo—, hay que excluirlo aquí para que no pida una ruta que no existe.)
const COINGECKO_PROXY_ABS = "https://crypto-portfolio-pro-omega.vercel.app/api/cg/";
const COINGECKO_PROXY = typeof location !== "undefined"
  && (location.protocol === "https:" || location.protocol === "http:")
  ? "/api/cg/"
  : COINGECKO_PROXY_ABS;
const COINGECKO_DIRECT = "https://api.coingecko.com/api/v3/";
// Lector de billeteras (api/wallet.js): mismo criterio que el de CoinGecko,
// relativo en la web y absoluto en la APK. La clave de Alchemy vive en Vercel.
const WALLET_PROXY = typeof location !== "undefined"
  && (location.protocol === "https:" || location.protocol === "http:")
  ? "/api/wallet"
  : "https://crypto-portfolio-pro-omega.vercel.app/api/wallet";
const MAX_WALLETS = 20;
// Al abrir la app se vuelven a leer las billeteras que lleven mas de esto
// sin actualizarse (el saldo cambia poco; los precios ya van en vivo aparte).
// Una hora: cada lectura gasta creditos del proveedor (CoinStats cobra 40).
const WALLET_STALE_MS = 60 * 60 * 1000;
const COINGECKO_BASE = COINGECKO_PROXY;

// Free-tier throttle. El API público de CoinGecko admite hoy ~5-15 llamadas
// por minuto y por IP (jul 2026): MIN_GAP=2.5s y tope de 12/min mantienen a
// la app por debajo del límite. El uso normal es 1 llamada de mercado por
// refresco (los coinId van sembrados en los datos por defecto); las búsquedas
// solo se disparan al teclear activos nuevos y ya llevan debounce.
// Los 429 residuales siguen aplicando backoff exponencial con jitter abajo.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_CALLS = 12;
const RATE_LIMIT_MIN_GAP_MS = 2500;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js";
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
const JSPDF_AUTOTABLE_URL = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";
const MAX_ACTIVITY_ITEMS = 18;
const MAX_HISTORY_POINTS = 6000;
const MAX_ROW_HISTORY_POINTS = 240;
const AUTO_REFRESH_OPTIONS = [300, 1800, 3600, 86400];
// Datos de mercado globales (widgets de Inicio)
const MARKET_CACHE_KEY = "crypto-dashboard-market-v1";
const MARKETS_LIST_KEY = "crypto-dashboard-markets-list-v4";
const MARKETS_LIST_TTL = 5 * 60 * 1000;
const MARKETS_PAGE_SIZE = 25;
const DOMINANCE_TTL = 60 * 1000;
const FNG_TTL = 45 * 60 * 1000;
const FNG_URL = "https://api.alternative.me/fng/?limit=1";
const APP_TABS = ["home", "news", "plan", "analytics", "more"];

// ── Precios en vivo por WebSocket ──
// Binance manda (stream miniTicker: un mensaje por par y segundo) y Kraken
// entra de reserva cuando Binance no conecta: bloqueo regional, corte de red
// o proveedor caido. Los dos son publicos y de solo lectura, sin claves.
// CoinGecko sigue siendo la fuente de verdad de capitalizacion, ranking e
// historico; el WebSocket solo adelanta el precio y la variacion de 24h.
// Bandera de carga perezosa de Chart.js: tiene que declararse antes de la
// llamada a init(), que puede alcanzar ensureChartJs durante el arranque.
let chartsLibLoading = false;

const LIVE_BINANCE_WS = "wss://stream.binance.com:9443/stream";
const LIVE_BINANCE_PAIRS_URL = "https://api.binance.com/api/v3/ticker/price";
const LIVE_KRAKEN_WS = "wss://ws.kraken.com/v2";
const LIVE_PAIRS_CACHE_KEY = "crypto-dashboard-live-pairs-v1";
const LIVE_PAIRS_TTL = 24 * 60 * 60 * 1000;
// Tope de pares por conexion: mas alla el ancho de banda no compensa.
const LIVE_MAX_STREAMS = 40;
// Un repintado por segundo como maximo, aunque lleguen mas mensajes.
const LIVE_FLUSH_MS = 1000;
// Sin un solo dato en este plazo se da por fallido el proveedor y se prueba
// el siguiente (Binance -> Kraken).
const LIVE_HANDSHAKE_MS = 8000;
// ── GeckoTerminal: precios de tokens DEX que ningun exchange central lista
// (memecoins, microcaps, tokens recien salidos). Publica y sin clave, con
// un limite de ~30 llamadas/min: se consulta en lotes y con espaciado.
const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2/";
const GECKOTERMINAL_POLL_MS = 30 * 1000;
const GECKOTERMINAL_BATCH = 25;
// Contratos por activo: se resuelven una vez y se guardan un dia entero.
const DEX_CONTRACT_CACHE_KEY = "crypto-dashboard-dex-contracts-v1";
const DEX_CONTRACT_TTL = 24 * 60 * 60 * 1000;
// Plataformas de CoinGecko -> redes de GeckoTerminal. Solo las que de verdad
// mueven volumen; el resto de tokens se queda con el precio de CoinGecko.
const DEX_NETWORKS = {
  ethereum: "eth",
  "binance-smart-chain": "bsc",
  solana: "solana",
  "polygon-pos": "polygon_pos",
  "arbitrum-one": "arbitrum",
  base: "base",
  "optimistic-ethereum": "optimism",
  avalanche: "avax",
  sui: "sui",
  aptos: "aptos",
  tron: "tron",
  ton: "ton"
};

// Cuantas operaciones del registro se listan de golpe (con boton para ver
// mas). Arriba a proposito: renderAll() corre desde init() y alcanzaria
// estas declaraciones antes de tiempo si vivieran junto a su funcion.
const TRADES_LOG_PAGE = 12;
let tradesLogLimit = TRADES_LOG_PAGE;

// Cache del recorrido de historial por fila. Arriba a proposito: init()
// llama a renderAll() y ese camino llega aqui en cuanto alguna posicion
// tiene historial guardado, que es el caso de cualquier usuario real.
const rangoHistorialCache = new Map();

// Temporizadores del sondeo DEX. Declarados aqui arriba a proposito: el
// arranque llama a startDexPolling() desde init() y un "let" a mitad del
// fichero se quedaria en zona muerta temporal.
let dexPollTimer = null;
let dexFirstPassTimer = null;

// Margen en el que un precio vivo se considera mas fiable que el sondeo.
const LIVE_QUOTE_FRESH_MS = 20 * 1000;
const LIVE_RECONNECT_BASE = 2000;
const LIVE_RECONNECT_MAX = 60000;
// Estables: su precio es ~1 y el par contra USDT no aporta nada.
const LIVE_SKIP_SYMBOLS = new Set(["USDT", "USDC", "DAI", "TUSD", "FDUSD", "USDD", "BUSD", "PYUSD"]);
// Simbolos que CoinGecko nombra distinto a los exchanges.
const LIVE_SYMBOL_ALIASES = { MIOTA: "IOTA", XBT: "BTC" };
// Cada pestaña recuerda su posición de scroll: al volver no hay saltos ni
// se hereda el desplazamiento de la pestaña anterior. (Debe declararse antes
// de la llamada a init(): las const de módulo no se izan.)
const tabScrollPositions = {};
// Umbrales de capitalización del deslizador de filtros (0 = cualquiera).
const CAP_STEPS = [0, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12];
// Aviso obligatorio del Plan (const antes de init() para evitar TDZ).
const PLAN_DISCLAIMER = "Propuesta basada en tu estrategia y distribucion objetivo. No constituye asesoramiento financiero.";
// Estado del editor-portal (declarado antes de init() para evitar TDZ).
let editorSearchTimer = null;
let editorPortal = null;
// Categorías simples para filtros y reparto de capital.
const STABLE_SYMBOLS = new Set([
  "USDT", "USDC", "DAI", "TUSD", "BUSD", "FDUSD", "USDE", "PYUSD",
  "USDS", "GUSD", "USDP", "FRAX", "LUSD", "USDD"
]);

function getAssetCategory(row) {
  const symbol = String(row.symbol || "").toUpperCase();
  if (row.coinId === "bitcoin" || symbol === "BTC") {
    return "btc";
  }
  if (row.coinId === "ethereum" || symbol === "ETH") {
    return "eth";
  }
  if (STABLE_SYMBOLS.has(symbol)) {
    return "stable";
  }
  return "alt";
}
/* Sectores para la analítica por categoría. Mapa curado por id de CoinGecko
   (el endpoint de mercados no devuelve categorías). Lo no listado cae en
   "otros"; en la vista solo se muestran los sectores presentes en la cartera. */
const ASSET_SECTORS = {
  l1: ["bitcoin", "ethereum", "solana", "cardano", "avalanche-2", "polkadot", "cosmos", "near", "aptos", "sui", "the-open-network", "tron", "algorand", "hedera-hashgraph", "internet-computer", "sei-network", "kaspa", "tezos", "eos", "elrond-erd-2", "multiversx", "flow", "celo", "kava", "binancecoin", "ethereum-classic", "bitcoin-cash", "litecoin", "sonic-3", "berachain-bera", "monad", "movement", "story-2", "injective-protocol", "kadena", "fantom", "harmony", "zilliqa", "stacks", "core", "cronos", "neo", "qtum"],
  l2: ["matic-network", "polygon-ecosystem-token", "arbitrum", "optimism", "immutable-x", "starknet", "mantle", "metis-token", "loopring", "zksync", "blast", "manta-network", "scroll", "taiko", "linea", "mode", "zora", "morph", "unichain"],
  defi: ["uniswap", "aave", "maker", "sky", "curve-dao-token", "lido-dao", "compound-governance-token", "havven", "synthetix-network-token", "pancakeswap-token", "jupiter-exchange-solana", "raydium", "thorchain", "dydx-chain", "dydx", "ethena", "pendle", "rocket-pool", "frax-share", "1inch", "gmx", "convex-finance", "balancer", "yearn-finance", "jito-governance-token", "aerodrome-finance", "velodrome-finance", "hyperliquid", "radiant-capital", "spell-token", "liquity", "stargate-finance", "sushi", "orca", "meteora", "kamino", "drift-protocol", "morpho", "euler", "usual", "resolv"],
  ia: ["fetch-ai", "artificial-superintelligence-alliance", "singularitynet", "ocean-protocol", "render-token", "bittensor", "akash-network", "worldcoin-wld", "arkham", "grass", "nosana", "phala-network", "virtuals-protocol", "ai16z", "aixbt", "zerebro", "griffain", "freysa-ai", "io-net", "aethir", "tars-protocol", "tars-ai", "swarms", "cookie", "wayfinder", "vana", "sahara-ai", "openledger", "kaito", "numeraire", "cortex", "autonolas", "theoriq", "allora", "prime-intellect", "gaib", "kite-ai"],
  meme: ["dogecoin", "shiba-inu", "pepe", "bonk", "dogwifcoin", "floki", "brett-based", "popcat", "mog-coin", "book-of-meme", "cat-in-a-dogs-world", "turbo", "notcoin", "memecoin-2", "spx6900", "fartcoin", "neiro-3", "first-neiro-on-ethereum", "neiro", "ponke", "goatseus-maximus", "peanut-the-squirrel", "moo-deng", "act-i-the-ai-prophecy", "michi", "myro", "wen-4", "slerf", "just-a-chill-guy", "apu-apustaja", "andy-the-wojak", "mother-iggy", "daddy-tate", "retardio", "gigachad-2", "baby-doge-coin", "dogelon-mars", "samoyedcoin", "hoppy", "simons-cat", "pepecoin-2", "dogs-2", "hamster-kombat", "pudgy-penguins", "keyboard-cat", "toshi", "degen-base", "higher", "mumu-the-bull", "useless-coin", "housecoin"],
  gaming: ["the-sandbox", "decentraland", "axie-infinity", "gala", "illuvium", "beam-2", "ronin", "enjincoin", "yield-guild-games", "apecoin", "pixels", "echelon-prime", "gods-unchained", "star-atlas", "wax", "ultra", "big-time", "portal-2", "nakamoto-games", "shrapnel", "xai-blockchain"],
  infra: ["chainlink", "the-graph", "filecoin", "arweave", "helium", "storj", "pyth-network", "wormhole", "celestia", "eigenlayer", "quant-network", "vechain", "iota", "theta-token", "livepeer", "golem", "layerzero", "axelar", "ankr", "band-protocol", "api3", "dia-data", "zelcash", "iexec-rlc", "walrus-2", "space-and-time", "chainbase", "hemi", "succinct"],
  rwa: ["ondo-finance", "polymesh", "centrifuge", "maple", "goldfinch", "clearpool", "chintai", "mantra-dao", "realio-network", "propy", "landshare", "tokenfi", "plume"],
  privacy: ["monero", "zcash", "dash", "oasis-network", "secret", "decred", "railgun", "aleph-zero", "horizen"],
  payments: ["ripple", "stellar", "nano", "request-network", "pundi-x-2", "cheqd-network"],
  exchange: ["okb", "crypto-com-chain", "kucoin-shares", "leo-token", "gatechain-token", "bitget-token", "whitebit", "bnb", "huobi-token", "mx-token"],
  stable: ["tether", "usd-coin", "dai", "first-digital-usd", "ethena-usde", "usds", "true-usd", "paypal-usd", "frax", "usdd", "usdt0", "susds", "binance-usd", "gemini-dollar", "liquity-usd", "crvusd"]
};

/* Respaldo por simbolo: si el id de CoinGecko no esta en el mapa (o la posicion
   se creo a mano sin id), se clasifica por ticker. Evita que activos conocidos
   acaben en "Otros" solo porque su id no coincida. */
const SECTOR_BY_SYMBOL_RAW = {
  ia: ["TAO", "RENDER", "RNDR", "FET", "AGIX", "OCEAN", "AKT", "WLD", "VIRTUAL", "AI16Z", "AIXBT", "ZEREBRO", "GRIFFAIN", "FREYSA", "IO", "ATH", "TARS", "SWARMS", "COOKIE", "PROMPT", "VANA", "SAHARA", "OPEN", "KAITO", "NMR", "CTXC", "OLAS", "GRASS", "NOS", "PHA", "ARKM", "ALLO", "GAIB", "KITE"],
  meme: ["DOGE", "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "BRETT", "POPCAT", "MOG", "BOME", "MEW", "TURBO", "NOT", "MEME", "SPX", "FARTCOIN", "NEIRO", "PONKE", "GOAT", "PNUT", "MOODENG", "ACT", "MICHI", "MYRO", "WEN", "SLERF", "CHILLGUY", "APU", "ANDY", "MOTHER", "DADDY", "RETARDIO", "GIGA", "BABYDOGE", "ELON", "SAMO", "HOPPY", "DOGS", "HMSTR", "TOSHI", "DEGEN", "HIGHER", "MUMU", "WOJAK", "USELESS", "HOUSE", "PENGU"],
  l1: ["BTC", "ETH", "SOL", "ADA", "AVAX", "DOT", "ATOM", "NEAR", "APT", "SUI", "TON", "TRX", "ALGO", "HBAR", "ICP", "SEI", "KAS", "XTZ", "EOS", "EGLD", "FLOW", "CELO", "KAVA", "BNB", "ETC", "BCH", "LTC", "BERA", "MON", "MOVE", "IP", "INJ", "KDA", "FTM", "ONE", "STX", "CORE", "CRO", "NEO", "QTUM"],
  l2: ["MATIC", "POL", "ARB", "OP", "IMX", "STRK", "MNT", "METIS", "LRC", "ZK", "BLAST", "MANTA", "SCR", "TAIKO", "LINEA", "MODE", "ZORA"],
  defi: ["UNI", "AAVE", "MKR", "SKY", "CRV", "LDO", "COMP", "SNX", "CAKE", "JUP", "RAY", "RUNE", "DYDX", "ENA", "PENDLE", "RPL", "FXS", "1INCH", "GMX", "CVX", "BAL", "YFI", "JTO", "AERO", "VELO", "HYPE", "SUSHI", "ORCA", "MET", "KMNO", "DRIFT", "MORPHO", "EUL", "USUAL", "RESOLV"],
  gaming: ["SAND", "MANA", "AXS", "GALA", "ILV", "BEAM", "RON", "ENJ", "YGG", "APE", "PIXEL", "PRIME", "GODS", "ATLAS", "WAXP", "UOS", "BIGTIME", "PORTAL", "NAKA", "SHRAP", "XAI"],
  infra: ["LINK", "GRT", "FIL", "AR", "HNT", "STORJ", "PYTH", "W", "TIA", "EIGEN", "QNT", "VET", "IOTA", "THETA", "LPT", "GLM", "ZRO", "AXL", "ANKR", "BAND", "API3", "DIA", "FLUX", "RLC", "WAL", "SXT", "HEMI", "PROVE"],
  rwa: ["ONDO", "POLYX", "CFG", "MPL", "GFI", "CPOOL", "OM", "RIO", "PRO", "PLUME"],
  privacy: ["XMR", "ZEC", "DASH", "ROSE", "SCRT", "DCR", "RAIL", "AZERO", "ZEN"],
  payments: ["XRP", "XLM", "XNO", "REQ", "PUNDIX", "CHEQ"],
  exchange: ["OKB", "KCS", "LEO", "GT", "BGB", "WBT", "HT", "MX"],
  stable: ["USDT", "USDC", "DAI", "FDUSD", "USDE", "USDS", "TUSD", "PYUSD", "FRAX", "USDD", "USDT0", "SUSDS", "BUSD", "GUSD", "LUSD", "CRVUSD"]
};

// Indices invertidos (se construyen una vez).
const SECTOR_BY_ID = (() => {
  const map = new Map();
  Object.entries(ASSET_SECTORS).forEach(([sector, ids]) => ids.forEach((id) => map.set(id, sector)));
  return map;
})();
const SECTOR_BY_SYMBOL = (() => {
  const map = new Map();
  Object.entries(SECTOR_BY_SYMBOL_RAW).forEach(([sector, syms]) => syms.forEach((sy) => {
    if (!map.has(sy)) map.set(sy, sector);
  }));
  return map;
})();

// Sector de una posicion: primero por id de CoinGecko (exacto) y, si no
// aparece, por simbolo. Las stablecoins tienen su propia comprobacion.
function getAssetSector(row) {
  const id = String(row.coinId || "").toLowerCase();
  if (id && SECTOR_BY_ID.has(id)) return SECTOR_BY_ID.get(id);
  const symbol = String(row.symbol || "").toUpperCase();
  if (STABLE_SYMBOLS.has(symbol)) return "stable";
  if (symbol && SECTOR_BY_SYMBOL.has(symbol)) return SECTOR_BY_SYMBOL.get(symbol);
  return "otros";
}

const CHART_RANGE_WINDOWS = {
  "1m": 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "6mo": 180 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  total: Infinity
};

const CURRENCY_META = {
  usd: { code: "USD", label: "USD", locale: "en-US" },
  eur: { code: "EUR", label: "EUR", locale: "es-ES" }
};

const UI_LOCALES = window.APP_I18N?.UI_LOCALES || { es: "es-ES", en: "en-US", fr: "fr-FR" };
const TRANSLATIONS = window.APP_I18N?.TRANSLATIONS || {};

const DEFAULT_PREFS = {
  theme: "dark",
  oled: false,
  currency: "usd",
  language: "es",
  portfolioName: "",
  autoRefreshSec: 1800,
  livePrices: true,
  showCharts: true,
  chartRange: "total",
  sortBy: "marketCap",
  sortDir: "desc",
  hiddenColumns: [],
  hideBalance: false,
  activeTab: "home",
  filters: null,
  plan: null
};

// Trío inversión/tokens/entrada: con dos datos se deriva el tercero.
const TRIAD_FIELDS = ["investment", "tokens", "entryPrice"];
// Opciones del selector de orden (móvil y escritorio). Incluye claves que
// no tienen columna propia: variación 24h, capitalización, ranking y TP.
// Selector de orden único y limpio (sin filtros por categoría).
const SORT_OPTIONS = [
  { key: "marketCap", labelKey: "sort.marketCap" },
  { key: "currentValue", labelKey: "sort.positionValue" },
  { key: "pnlPct", labelKey: "sort.pnlPct" },
  { key: "pnlUsd", labelKey: "sort.pnlUsd" },
  { key: "change24h", labelKey: "sort.change24h" },
  { key: "investment", labelKey: "sort.invested" },
  { key: "asset", labelKey: "sort.name" }
];
const THEME_COLORS = { dark: "#050d14", light: "#f0f4f8" };

// Portafolio de demostración genérico (la app es pública): cifras redondas
// y activos conocidos. Los coinId van sembrados para que el primer arranque
// haga una única llamada a /coins/markets en vez de una búsqueda por activo
// (el API público de CoinGecko limita ~5-15 llamadas/min y salían 429).
// Los datos reales de cada usuario viven solo en su dispositivo.
const DEFAULT_ROWS = [
  {
    crypto: "Bitcoin",
    coinId: "bitcoin",
    symbol: "BTC",
    resolvedName: "Bitcoin",
    investment: "3000",
    tokens: "0.05",
    tp1: "75000",
    tp2: "85000",
    tp3: "100000"
  },
  {
    crypto: "Ethereum",
    coinId: "ethereum",
    symbol: "ETH",
    resolvedName: "Ethereum",
    investment: "1000",
    tokens: "0.6",
    tp1: "2500",
    tp2: "3000",
    tp3: "4000"
  },
  {
    crypto: "Solana",
    coinId: "solana",
    symbol: "SOL",
    resolvedName: "Solana",
    investment: "500",
    tokens: "6",
    tp1: "120",
    tp2: "150",
    tp3: "200"
  },
  {
    crypto: "Cardano",
    coinId: "cardano",
    symbol: "ADA",
    resolvedName: "Cardano",
    investment: "250",
    tokens: "500",
    tp1: "0.8",
    tp2: "1",
    tp3: "1.5"
  }
];

// Tabla simplificada de solo lectura: la edición vive en el editor-portal.
const TABLE_COLUMNS = [
  { key: "asset", labelKey: "table.columns.asset", sortKey: "asset" },
  { key: "price", labelKey: "table.columns.priceCol", sortKey: "currentPrice" },
  { key: "invested", labelKey: "table.columns.invested", sortKey: "investment" },
  { key: "value", labelKey: "table.columns.value", sortKey: "currentValue" },
  { key: "pnl", labelKey: "table.columns.performance", sortKey: "pnlPct" },
  { key: "actions", labelKey: "table.columns.actions", sortKey: null }
];

const state = {
  rows: [],
  prefs: { ...DEFAULT_PREFS },
  activity: [],
  // Libro de operaciones estructurado (compras/ventas): alimenta el PnL
  // realizado y la analítica de actividad mensual. Tope MAX_TRADES.
  trades: [],
  // Alertas de precio guardadas (por activo, para todos, o del valor total).
  alerts: [],
  // Billeteras leidas por direccion publica. Sus posiciones son filas
  // normales con walletId; la cantidad la marca la blockchain.
  wallets: [],
  history: [],
  autosaveTimer: null,
  autoRefreshTimer: null,
  searchTimers: new Map(),
  blurTimers: new Map(),
  searchCache: new Map(),
  priceCache: new Map(),
  charts: { pie: null, line: null },
  syncing: false,
  apiStatus: "idle",
  apiMeta: "Sincroniza manualmente para cargar precios.",
  saveMessage: "Sin cambios pendientes",
  lastSyncLabel: "Sin sincronizacion todavia",
  portfolioNameTimer: null,
  rowCounter: 0,
  dashboardFrame: null,
  hiddenColumns: new Set(),
  pendingFetches: new Map(),
  fxRateCache: new Map(),
  // Feed de precios en vivo (WebSocket). "provider" es el que esta sirviendo.
  live: {
    // Libro de precios: simbolo -> ultimo dato conocido con su procedencia.
    // Es el punto unico donde se decide que precio se muestra.
    book: new Map(),
    socket: null,
    provider: null,
    status: "off",
    pairs: [],
    symbols: [],
    covered: [],
    pending: new Map(),
    flushTimer: null,
    handshakeTimer: null,
    reconnectTimer: null,
    retries: 0,
    triedBinance: false,
    lastTickAt: 0,
    knownPairs: null
  },
  refreshRequestId: 0,
  currencySwitchId: 0,
  filterQuery: "",
  filters: { category: "all", performance: "all", weightMin: 0, capMin: 0, favorites: false, alerts: false },
  plan: { tp: {}, tpAll: { p1: 30, p2: 50, p3: 100 } },
  heroVisible: true,
  editorRowId: null,
  // Operacion del registro que se esta editando (null = alta nueva).
  editingTradeId: null,
  // Alerta que se esta editando desde el panel de Ajustes.
  editingAlertId: null,
  rowMenuOpen: false,
  detailRowId: null,
  detailTab: "summary",
  detailRange: "1d",
  news: [],
  newsAt: 0,
  newsFilter: "all",
  newsLoading: false,
  newsError: null,
  newsOpen: {},
  marketsList: [],
  marketsListAt: 0,
  marketsQuery: "",
  marketsPage: 1,
  marketsLoading: false,
  // Orden de la tabla de mercado (columna + dirección).
  marketsSort: { key: "marketCap", dir: "desc" },
  // Nº de tarjetas visibles en la lista móvil de mercado ("Cargar más").
  marketsMobileLimit: 20,
  // Ids de tarjetas de activo desplegadas en la vista móvil del portafolio.
  expandedCards: new Set(),
  // Ids de tarjetas de mercado desplegadas en la vista móvil.
  expandedMarket: new Set(),
  // Última posición eliminada (para "Deshacer").
  lastDeleted: null,
  lastRefreshAt: 0,
  market: {
    btc: null,
    eth: null,
    btcDominance: null,
    fearGreed: null,
    globalUpdatedAt: null,
    fearGreedUpdatedAt: null,
    loading: false,
    error: null
  }
};

const dom = {
  summaryGrid: document.getElementById("summaryGrid"),
  insightsRankingsGrid: document.getElementById("insightsRankingsGrid"),
  stickyBar: document.getElementById("stickyBar"),
  stickyBarName: document.getElementById("stickyBarName"),
  stickyBarValue: document.getElementById("stickyBarValue"),
  stickyBarPnl: document.getElementById("stickyBarPnl"),
  navApiBadge: document.getElementById("navApiBadge"),
  navApiText: document.getElementById("navApiText"),
  navSaveBadge: document.getElementById("navSaveBadge"),
  navSaveText: document.getElementById("navSaveText"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  totalsFoot: document.getElementById("totalsFoot"),
  addRowBtn: document.getElementById("addRowBtn"),
  refreshPricesBtn: document.getElementById("refreshPricesBtn"),
  saveBtn: document.getElementById("saveBtn"),
  clearBtn: document.getElementById("clearBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFileInput: document.getElementById("importFileInput"),
  toggleChartsBtn: document.getElementById("toggleChartsBtn"),
  chartsPanel: document.getElementById("chartsPanel"),
  portfolioPieChart: document.getElementById("portfolioPieChart"),
  portfolioLineChart: document.getElementById("portfolioLineChart"),
  lineRangeControl: document.getElementById("lineRangeControl"),
  activityList: document.getElementById("activityList"),
  portfolioNameInput: document.getElementById("portfolioNameInput"),
  portfolioNameDisplay: document.getElementById("portfolioNameDisplay"),
  currencySelect: document.getElementById("currencySelect"),
  autoRefreshSelect: document.getElementById("autoRefreshSelect"),
  apiStatus: document.getElementById("apiStatus"),
  apiStatusMeta: document.getElementById("apiStatusMeta"),
  saveStatus: document.getElementById("saveStatus"),
  lastSyncLabel: document.getElementById("lastSyncLabel"),
  appLoader: document.getElementById("appLoader"),
  loaderText: document.getElementById("loaderText"),
  toastStack: document.getElementById("toastStack"),
  positionFilterInput: document.getElementById("positionFilterInput"),
  mobileSortSelect: document.getElementById("mobileSortSelect"),
  mobileSortDirBtn: document.getElementById("mobileSortDirBtn"),
  mainValue: document.getElementById("mainValue"),
  mainPnlAbs: document.getElementById("mainPnlAbs"),
  mainPnlPct: document.getElementById("mainPnlPct"),
  mainUpdated: document.getElementById("mainUpdated"),
  liveDot: document.getElementById("liveDot"),
  livePricesSelect: document.getElementById("livePricesSelect"),
  mainSparkline: document.getElementById("mainSparkline"),
  mainSparklinePath: document.getElementById("mainSparklinePath"),
  homeStatusLine: document.getElementById("homeStatusLine"),
  homeRefreshBtn: document.getElementById("homeRefreshBtn"),
  toggleBalanceBtn: document.getElementById("toggleBalanceBtn"),
  marketGrid: document.getElementById("marketGrid"),
  autoRefreshMeta: document.getElementById("autoRefreshMeta"),
  installCard: document.getElementById("installCard"),
  sharePdfBtn: document.getElementById("sharePdfBtn"),
  sheetBackdrop: document.getElementById("sheetBackdrop")
};
