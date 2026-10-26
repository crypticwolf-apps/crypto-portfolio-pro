// Pruebas de extremo a extremo de la app en un Chromium real.
//
// Arranca la app con datos de usuario realistas (historial de precios,
// operaciones y alertas de los tres tipos) y recorre pestanas, hojas, temas y
// flujos criticos a 375 y 320 px. Toda la red esta simulada: CoinGecko, el
// feed de noticias, Binance (REST y WebSocket), GeckoTerminal y el CDN, cuyos
// ficheros se sirven desde node_modules con la MISMA version que piden las URL
// de la app en js/ (se comprueba al empezar).
//
// Uso: npm run test:e2e  (necesita Chromium: npx playwright-core install chromium)
// Sale con codigo 1 si falla cualquier paso, para que la integracion continua
// marque el commit en rojo.

import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULOS = path.join(RAIZ, "node_modules");

// ── Servidor estatico minimo de la raiz del repositorio ──
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};
function arrancarServidor() {
  const servidor = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const fichero = path.resolve(RAIZ, "." + (ruta === "/" ? "/index.html" : ruta));
    if (!fichero.startsWith(RAIZ + path.sep) || !fs.existsSync(fichero) || fs.statSync(fichero).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { "content-type": TIPOS[path.extname(fichero)] || "application/octet-stream" });
    fs.createReadStream(fichero).pipe(res);
  });
  return new Promise((ok) => servidor.listen(0, "127.0.0.1", () => ok(servidor)));
}

// ── Las librerias del CDN se sirven desde node_modules, con su version ──
const CDN = [
  { patron: "**/chart.js@*/**", paquete: "chart.js", fichero: "dist/chart.umd.js" },
  { patron: "**/jspdf@*/**", paquete: "jspdf", fichero: "dist/jspdf.umd.min.js" },
  { patron: "**/jspdf-autotable@*/**", paquete: "jspdf-autotable", fichero: "dist/jspdf.plugin.autotable.min.js" }
];
function comprobarVersionesCdn() {
  const dir = path.join(RAIZ, "js");
  const app = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  const desfases = [];
  for (const { paquete } of CDN) {
    const enApp = app.match(new RegExp(`cdn\\.jsdelivr\\.net/npm/${paquete.replace(".", "\\.")}@([\\d.]+)`))?.[1];
    const instalada = JSON.parse(fs.readFileSync(path.join(MODULOS, paquete, "package.json"), "utf8")).version;
    if (enApp !== instalada) desfases.push(`${paquete}: la app pide ${enApp}, package.json instala ${instalada}`);
  }
  return desfases;
}

// ── Datos simulados ──
const MONEDAS = [
  ["bitcoin", "BTC", "Bitcoin", 60000], ["ethereum", "ETH", "Ethereum", 2500], ["solana", "SOL", "Solana", 150],
  ["cardano", "ADA", "Cardano", 0.5], ["chainlink", "LINK", "Chainlink", 15], ["pepe", "PEPE", "Pepe", 0.00001],
  ["usd-coin", "USDC", "USDC", 1]
];
const MERCADO = MONEDAS.map(([id, s, n, p], i) => ({
  id, symbol: s.toLowerCase(), name: n, image: "", current_price: p, market_cap: 1e12 / (i + 1), market_cap_rank: i + 1,
  price_change_percentage_24h: (i % 2 ? -1 : 1) * 2.5, price_change_percentage_24h_in_currency: 2.5,
  price_change_percentage_7d_in_currency: 5, price_change_percentage_1h_in_currency: 0.2,
  high_24h: p * 1.05, low_24h: p * 0.95, total_volume: 1e9,
  sparkline_in_7d: { price: Array.from({ length: 20 }, (_, j) => p * (1 + Math.sin(j) / 20)) }
}));
const NOTICIAS = Array.from({ length: 6 }, (_, i) => ({
  id: "n" + i, ts: Math.floor(Date.now() / 1000) - i * 3600,
  titulo: `Titular ${i} con <b>html</b> & "comillas"`, cuerpo: "Cuerpo <script>window.__xss=1</script>",
  analisis: "Analisis.", cat: i % 2 ? "Mercado" : "Protocolos", tags: ["BTC"], impacto: i + 3
}));
const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
// Billetera de prueba. "SOL" falso: token sin listar con el MISMO simbolo que
// Solana; tiene que valorarse por su contrato (0,5) y nunca como SOL (150).
const EVM_ADDR = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const SOL_FALSO = "0x9999999999999999999999999999999999999999";
const USDC_FALSO = "0x1111111111111111111111111111111111111111";
// GeckoTerminal da 0,52 (Alchemy dijo 0,5 al leer la billetera): asi se ve
// que el precio por contrato manda despues de importar.
const PRECIOS_CONTRATO = { [PEPE]: "0.0000123", [SOL_FALSO]: "0.52" };
function activosEvm(version) {
  const lista = [
    { network: "eth", contract: null, symbol: "ETH", name: "Ethereum", amount: version === 1 ? "1.5" : "0.75", priceUsd: 2500, coinId: "ethereum" },
    { network: "base", contract: null, symbol: "ETH", name: "Ethereum", amount: "0.5", priceUsd: 2500, coinId: "ethereum" },
    { network: "base", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", amount: "250", priceUsd: 1, coinId: "usd-coin" },
    { network: "base", contract: SOL_FALSO, symbol: "SOL", name: "Solana de mentira", amount: "100", priceUsd: 0.5, coinId: null },
    { network: "base", contract: USDC_FALSO, symbol: "USDC", name: "<b>Reclama</b> tu premio", amount: "1000000", priceUsd: null, coinId: null },
    { network: "eth", contract: "0x514910771af9ca656af840dff83e8264ecf986ca", symbol: "LINK", name: "Chainlink", amount: "0.0001", priceUsd: 15, coinId: "chainlink" }
  ];
  if (version >= 2) lista.push({ network: "eth", contract: "0xc00e94cb662c3520282e6f5717214004a7f26888", symbol: "ADA", name: "Cardano", amount: "1000", priceUsd: 0.5, coinId: "cardano" });
  return lista;
}

function respuestaCoinGecko(ruta) {
  if (ruta === "coins/markets") return MERCADO;
  if (ruta === "global") return { data: { total_market_cap: { usd: 2.4e12, eur: 2.2e12 }, market_cap_percentage: { btc: 52, eth: 17 }, market_cap_change_percentage_24h_usd: 1.1 } };
  if (ruta === "search") return { coins: [{ id: "solana", name: "Solana", symbol: "SOL", thumb: "", market_cap_rank: 5 }] };
  if (ruta === "simple/price") return { bitcoin: { usd: 60000, eur: 55200 } };
  if (/market_chart/.test(ruta)) return { prices: Array.from({ length: 30 }, (_, j) => [Date.now() - j * 86400000, 100 + j]) };
  if (/\/history$/.test(ruta)) return { market_data: { current_price: { usd: 58000, eur: 53000 } } };
  if (/^coins\/[^/]+$/.test(ruta)) return { id: ruta.split("/")[1], platforms: ruta.endsWith("pepe") ? { ethereum: PEPE } : {} };
  return {};
}

async function simularRed(ctx, { proxyCaido = false } = {}) {
  const json = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const directas = [];
  const billetera = { version: 1, llamadas: [] };
  await ctx.route("**/api/cg/**", (r) => proxyCaido ? r.abort()
    : json(r, respuestaCoinGecko(new URL(r.request().url()).pathname.replace(/^.*\/api\/cg\//, ""))));
  await ctx.route("**api.coingecko.com/**", (r) => {
    const ruta = new URL(r.request().url()).pathname.replace(/^\/api\/v3\//, "");
    directas.push(ruta);
    return json(r, respuestaCoinGecko(ruta));
  });
  await ctx.route("**/cryptoatalaya.com/data/feed.json", (r) => json(r, NOTICIAS));
  await ctx.route("**/api/v3/ticker/price**", (r) => json(r, ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "LINKUSDT"].map((symbol) => ({ symbol, price: "1" }))));
  await ctx.route("**api.geckoterminal.com/**", (r) => {
    const pedidas = decodeURIComponent(new URL(r.request().url()).pathname.split("/multi/")[1] || "").toLowerCase().split(",");
    const data = pedidas.filter((a) => PRECIOS_CONTRATO[a]).map((a) => ({ attributes: { address: a, price_usd: PRECIOS_CONTRATO[a], volume_usd: { h24: "1000000" }, market_cap_usd: "5000000" } }));
    return json(r, { data });
  });
  // Lector de billeteras (api/wallet.js) con estado: version 2 = la billetera
  // cambio (vendio ETH y recibio ADA).
  await ctx.route("**/api/wallet?**", (r) => {
    const q = new URL(r.request().url()).searchParams;
    billetera.llamadas.push(`${q.get("chain")}:${q.get("address")}`);
    if (q.get("chain") === "solana") return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "missing_key" }) });
    if (q.get("chain") === "bitcoin") return json(r, { chain: "bitcoin", address: q.get("address"), assets: [{ network: "bitcoin", contract: null, symbol: "BTC", name: "Bitcoin", decimals: 8, amount: "0.25", priceUsd: null, logo: null, coinId: "bitcoin" }], failedNetworks: [] });
    return json(r, { chain: "evm", address: q.get("address"), assets: activosEvm(billetera.version), failedNetworks: [], mode: "public" });
  });
  await ctx.route("**api.alternative.me/**", (r) => json(r, { data: [{ value: "55", value_classification: "Greed", timestamp: String(Math.floor(Date.now() / 1000)) }] }));
  for (const lib of CDN) {
    await ctx.route(lib.patron, (r) => r.fulfill({ path: path.join(MODULOS, lib.paquete, lib.fichero), contentType: "application/javascript" }));
  }
  await ctx.route("**fonts.g*/**", (r) => r.abort());
  return { directas, billetera };
}

async function simularWebSockets(page) {
  await page.routeWebSocket(/stream\.binance\.com/, (ws) => {
    const streams = (new URL(ws.url()).searchParams.get("streams") || "").split("/").filter(Boolean);
    const base = { BTCUSDT: 60000, ETHUSDT: 2500, SOLUSDT: 150, ADAUSDT: 0.5, LINKUSDT: 15 };
    let n = 0;
    const t = setInterval(() => {
      n++;
      for (const st of streams) {
        const par = st.split("@")[0].toUpperCase(); const p = base[par] || 1;
        ws.send(JSON.stringify({ stream: st, data: { e: "24hrMiniTicker", s: par, c: String(p * (1 + n / 1000)), o: String(p * 0.98), h: String(p * 1.05), l: String(p * 0.95), q: "1000000" } }));
      }
    }, 300);
    ws.onClose(() => clearInterval(t));
  });
  await page.routeWebSocket(/ws\.kraken\.com/, (ws) => ws.close({ code: 1006 }));
}

// Cartera realista. Con datos virgenes hay caminos que no se recorren: asi se
// colo un fallo de arranque que dejaba la app en blanco con datos reales.
function sembrarCartera() {
  // Solo la primera vez en la pestana: una recarga debe encontrar lo guardado.
  if (sessionStorage.getItem("e2e-sembrado")) return;
  sessionStorage.setItem("e2e-sembrado", "1");
  const historial = (p) => Array.from({ length: 80 }, (_, j) => ({ at: new Date(Date.now() - j * 3600000).toISOString(), price: p * (1 + Math.sin(j / 5) / 10) }));
  const rows = [
    { id: "r-btc", crypto: "bitcoin", coinId: "bitcoin", symbol: "BTC", resolvedName: "Bitcoin", investment: "3000", tokens: "0.05", tp1: "70000", tp2: "80000", tp3: "90000", favorite: true, note: "nota <img src=x onerror=window.__xss=1>", priceHistory: historial(60000) },
    { id: "r-eth", crypto: "ethereum", coinId: "ethereum", symbol: "ETH", resolvedName: "Ethereum", investment: "2000", tokens: "1", tp1: "3000", priceHistory: historial(2500) },
    { id: "r-sol", crypto: "solana", coinId: "solana", symbol: "SOL", resolvedName: "Solana", investment: "1000", tokens: "8", priceHistory: historial(150) },
    { id: "r-ada", crypto: "cardano", coinId: "cardano", symbol: "ADA", resolvedName: "Cardano", investment: "500", tokens: "1200", tp1: "0.8", priceHistory: historial(0.5) },
    { id: "r-link", crypto: "chainlink", coinId: "chainlink", symbol: "LINK", resolvedName: "Chainlink", investment: "400", tokens: "30", priceHistory: historial(15) },
    { id: "r-pepe", crypto: "pepe", coinId: "pepe", symbol: "PEPE", resolvedName: "Pepe", investment: "100", tokens: "10000000", priceHistory: historial(0.00001) }
  ];
  const trades = [
    { id: "t1", at: Date.now() - 5 * 86400000, type: "buy", rowId: "r-btc", symbol: "BTC", tokens: 0.02, price: 50000, amount: 1000, fee: 1 },
    { id: "t2", at: Date.now() - 3 * 86400000, type: "sell", rowId: "r-eth", symbol: "ETH", tokens: 0.2, price: 2800, amount: 560, fee: 1, realized: 60 },
    { id: "t3", at: Date.now() - 40 * 86400000, type: "buy", rowId: "r-sol", symbol: "SOL", tokens: 4, price: 120, amount: 480, fee: 0 }
  ];
  const alerts = [
    { id: "a1", scope: "asset", rowId: "r-btc", kind: "tp", tp: "tp2", createdAt: Date.now(), fired: {} },
    { id: "a2", scope: "asset", rowId: "r-eth", kind: "price", price: 9999, createdAt: Date.now(), fired: {} },
    { id: "a3", scope: "__all__", kind: "tp", tp: "tp1", createdAt: Date.now(), fired: {} },
    { id: "a4", scope: "portfolio", kind: "price", price: 999999, createdAt: Date.now(), fired: {} }
  ];
  localStorage.setItem("crypto-dashboard-rows-v3", JSON.stringify({ rows, trades, alerts }));
}

// ── Ejecucion ──
const resultados = [];
function anotar(grupo, nombre, error) {
  resultados.push({ grupo, nombre, error });
  console.log(`${error ? "FALLO" : "  ok "} [${grupo}] ${nombre}${error ? "\n        " + error : ""}`);
}

async function abrirApp(navegador, url, { ancho = 375, sembrar = true, proxyCaido = false } = {}) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: true });
  const { directas, billetera } = await simularRed(ctx, { proxyCaido });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errores = [];
  page.on("pageerror", (e) => errores.push("error de pagina: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket|ERR_/.test(m.text())) errores.push("consola: " + m.text().slice(0, 200)); });
  page.on("dialog", (d) => d.accept());
  await simularWebSockets(page);
  if (sembrar) await page.addInitScript(sembrarCartera);
  await page.goto(url);
  await page.waitForTimeout(3500);
  return { ctx, page, errores, directas, billetera };
}

async function paso(grupo, nombre, app, fn) {
  const antes = app.errores.length;
  let error = null;
  try { await fn(app.page); } catch (e) { error = e.message.split("\n")[0]; }
  await app.page.waitForTimeout(200);
  const nuevos = app.errores.slice(antes);
  if (!error && nuevos.length) error = nuevos.join(" | ");
  anotar(grupo, nombre, error);
}

// Desborde horizontal: el scroll lateral de la pagina y, ademas, cualquier
// elemento visible que se salga del borde. Lo segundo hace falta porque un
// elemento fijo (el dock, una hoja) que no cabe no genera scroll: se corta.
const desborde = (page) => page.evaluate(() => {
  const ancho = document.documentElement.clientWidth;
  const scroll = document.documentElement.scrollWidth - ancho;
  if (scroll > 0) return `scroll lateral de ${scroll}px`;
  const recortaEnX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || (r.left >= -1 && r.right <= ancho + 1)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || el.closest("[hidden], [aria-hidden='true'], .sr-only")) continue;
    if (recortaEnX(el)) continue;
    const nombre = el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList[0] ? "." + el.classList[0] : "");
    return `${nombre} se sale del borde (${Math.round(r.left)}..${Math.round(r.right)} en ${ancho}px)`;
  }
  return "";
});
const cerrarHoja = (page) => page.click(".icon-circle-btn[data-trade-close]");
const leerFila = (page, id) => page.evaluate((i) => JSON.parse(localStorage.getItem("crypto-dashboard-rows-v3")).rows.find((r) => r.id === i), id);

async function recorridoCompleto(navegador, url, ancho) {
  const g = `${ancho}px`;
  const app = await abrirApp(navegador, url, { ancho });
  const { page } = app;

  await paso(g, "arranque con cartera realista", app, async () => {
    const n = await page.evaluate(() => document.querySelectorAll(".asset-mobile-card").length);
    if (n < 6) throw new Error(`se esperaban 6 tarjetas de activo y hay ${n}`);
  });
  for (const tab of ["home", "news", "plan", "analytics", "more"]) {
    await paso(g, `pestana ${tab}: visible y sin desborde`, app, async () => {
      await page.click(`[data-tab-target="${tab}"]`); await page.waitForTimeout(800);
      const alto = await page.evaluate((t) => [...document.querySelectorAll(`.tab-section[data-tab="${t}"]`)].reduce((a, s) => a + s.getBoundingClientRect().height, 0), tab);
      if (!(alto > 0)) throw new Error(`la seccion ${tab} mide 0 de alto`);
      const d = await desborde(page); if (d) throw new Error(d);
    });
  }
  await paso(g, "noticias cargadas", app, async () => {
    await page.click('[data-tab-target="news"]'); await page.waitForTimeout(600);
    const n = await page.evaluate(() => document.querySelectorAll(".news-card").length);
    if (n !== NOTICIAS_TOTAL) throw new Error(`noticias pintadas: ${n}`);
  });
  await paso(g, "menu del engranaje", app, async () => {
    await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
    await page.click("#quickAddBtn"); await page.waitForTimeout(300); await page.click(".fab-cancel");
  });
  for (const q of ["buy", "sell"]) {
    await paso(g, `hoja de ${q === "buy" ? "compra" : "venta"}`, app, async () => {
      await page.click(`[data-quick="${q}"]`); await page.waitForTimeout(400); await cerrarHoja(page); await page.waitForTimeout(300);
    });
  }
  await paso(g, "hoja de alerta con todos sus modos", app, async () => {
    await page.click("#quickAddBtn"); await page.waitForTimeout(300); await page.click('[data-fab-action="alert"]'); await page.waitForTimeout(400);
    for (const k of ["tp1", "tp2", "tp3", "price"]) await page.click(`[data-alert-kind="${k}"]`);
    await page.selectOption("[data-trade-field='rowId']", "__all__"); await cerrarHoja(page); await page.waitForTimeout(300);
  });
  await paso(g, "detalle de activo con todas sus pestanas", app, async () => {
    await page.evaluate(() => document.querySelector("tr[data-row-id]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(600);
    const tabs = await page.evaluate(() => [...document.querySelectorAll("[data-detail-tab]")].map((x) => x.dataset.detailTab));
    if (!tabs.length) throw new Error("el detalle no se abrio");
    for (const t of tabs) { await page.click(`[data-detail-tab="${t}"]`); await page.waitForTimeout(250); }
    await page.click("[data-detail-close]");
  });
  await paso(g, "todas las ordenaciones", app, async () => {
    const ops = await page.evaluate(() => [...document.querySelectorAll("#mobileSortSelect option")].map((o) => o.value));
    for (const o of ops) { await page.selectOption("#mobileSortSelect", o); await page.waitForTimeout(120); }
  });
  await paso(g, "modo privacidad", app, async () => { await page.click("#toggleBalanceBtn"); await page.waitForTimeout(250); await page.click("#toggleBalanceBtn"); });
  await paso(g, "temas claro, OLED y oscuro", app, async () => {
    await page.click('[data-tab-target="more"]'); await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector(".more-settings-panel").open = true; });
    for (const t of ["light", "oled", "dark"]) { await page.click(`[data-theme-set="${t}"]`); await page.waitForTimeout(200); }
  });
  await paso(g, "plegables de Ajustes abiertos sin desborde", app, async () => {
    await page.evaluate(() => document.querySelectorAll('.tab-section[data-tab="more"] details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(300);
    const d = await desborde(page); if (d) throw new Error(d);
  });
  await paso(g, "editar y borrar una alerta", app, async () => {
    const antes = await page.evaluate(() => document.querySelectorAll(".alert-item").length);
    await page.click("[data-alert-edit]"); await page.waitForTimeout(400); await cerrarHoja(page); await page.waitForTimeout(300);
    await page.click("[data-alert-delete]"); await page.waitForTimeout(300);
    const despues = await page.evaluate(() => document.querySelectorAll(".alert-item").length);
    if (despues !== antes - 1) throw new Error(`alertas: ${antes} -> ${despues}`);
  });
  await paso(g, "borrar una compra deshace su efecto exacto", app, async () => {
    await page.click('[data-tab-target="analytics"]'); await page.waitForTimeout(600);
    const n = await page.evaluate(() => document.querySelectorAll("#tradesLog .trade-item").length);
    if (n !== 3) throw new Error(`operaciones listadas: ${n}`);
    const antes = await leerFila(page, "r-btc");
    await page.click('#tradesLog [data-trade-delete="t1"]'); await page.waitForTimeout(500);
    const despues = await leerFila(page, "r-btc");
    // La compra t1 sumo 0,02 tokens y 1000 de coste: hay que quitar justo eso.
    const tok = Number(antes.tokens) - Number(despues.tokens), inv = Number(antes.investment) - Number(despues.investment);
    if (Math.abs(tok - 0.02) > 1e-9 || Math.abs(inv - 1000) > 1e-6) throw new Error(`reversion: -${tok} tokens, -${inv} de coste`);
  });
  await paso(g, "el total se mueve con el feed en vivo", app, async () => {
    await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
    const a = await page.evaluate(() => document.getElementById("mainValue").textContent);
    await page.waitForTimeout(2500);
    const b = await page.evaluate(() => document.getElementById("mainValue").textContent);
    if (a === b) throw new Error(`el total no cambia: ${a}`);
  });
  await paso(g, "cambio de moneda a euros", app, async () => {
    await page.click('[data-tab-target="more"]'); await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector(".more-settings-panel").open = true; });
    await page.selectOption("#currencySelect", "eur"); await page.waitForTimeout(2500);
    const total = await page.evaluate(() => document.getElementById("mainValue").textContent);
    if (!/€/.test(total)) throw new Error(`total sin euros: ${total}`);
  });
  if (ancho === 375) {
    await paso(g, "generar el PDF", app, async () => {
      const descarga = page.waitForEvent("download", { timeout: 20000 }).then((d) => d.suggestedFilename()).catch(() => null);
      await page.click('[data-tab-target="home"]'); await page.waitForTimeout(400);
      await page.click("#quickAddBtn"); await page.waitForTimeout(400); await page.click('[data-fab-action="pdf"]');
      if (!(await descarga)) throw new Error("no se genero la descarga");
    });
    await paso(g, "buscar una moneda al crear posicion", app, async () => {
      await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
      await page.click('[data-quick="new"]'); await page.waitForTimeout(600);
      await page.fill('#positionEditorPortal [data-editor-field="crypto"]', "sol"); await page.waitForTimeout(1500);
      const sug = await page.evaluate(() => document.querySelectorAll("#positionEditorPortal [data-editor-coin]").length);
      if (!sug) throw new Error("no salen sugerencias");
      await page.click("#positionEditorPortal [data-editor-coin]"); await page.waitForTimeout(600);
      const hint = await page.evaluate(() => document.querySelector('#positionEditorPortal [data-editor-role="assetHint"]')?.textContent || "");
      if (!/Solana/.test(hint)) throw new Error(`moneda elegida: ${hint}`);
    });
  }
  await paso(g, "sin HTML inyectado desde noticias ni notas", app, async () => {
    const r = await page.evaluate(() => ({ xss: window.__xss === 1, etiquetas: document.querySelectorAll(".news-card script, .news-card b, img[src='x']").length }));
    if (r.xss || r.etiquetas) throw new Error(`inyeccion: ejecutado=${r.xss}, etiquetas=${r.etiquetas}`);
  });
  await app.ctx.close();
}
const NOTICIAS_TOTAL = NOTICIAS.length;

async function casosSueltos(navegador, url) {
  const g = "arranque";
  // Primera vez: sin nada guardado, con la cartera de demostracion.
  const virgen = await abrirApp(navegador, url, { sembrar: false });
  await paso(g, "primera apertura sin datos guardados", virgen, async (page) => {
    const n = await page.evaluate(() => document.querySelectorAll(".asset-mobile-card").length);
    if (!n) throw new Error("no se pinto ninguna posicion");
  });
  await virgen.ctx.close();
  // Proxy propio caido: debe reintentar contra CoinGecko directo y pintar precio.
  const caido = await abrirApp(navegador, url, { proxyCaido: true });
  await paso(g, "proxy caido: respaldo a CoinGecko directo", caido, async (page) => {
    // Binance da precio a casi todo, asi que lo que se comprueba es que el
    // mercado se pidio de verdad a CoinGecko directo al fallar el proxy.
    if (!caido.directas.includes("coins/markets")) throw new Error(`sin peticion directa a coins/markets (directas: ${caido.directas.join(", ") || "ninguna"})`);
    const precio = await page.evaluate(() => document.querySelector('.asset-mobile-card [data-role="rowPrice"]')?.textContent || "");
    if (!/\d/.test(precio)) throw new Error(`sin precio: "${precio}"`);
  });
  await caido.ctx.close();
}

// ── Lector de billeteras ──
const SEED = "abandon ability able about above absent absorb abstract absurd abuse access accident";
const filasBilletera = (page) => page.evaluate(() => state.rows.filter((r) => r.walletId).map((r) => ({
  id: r.id, key: r.walletKey, symbol: r.symbol, tokens: r.tokens, investment: r.investment,
  price: r.currentPrice, source: r.priceSource, dex: r.dexAddress, walletId: r.walletId
})));

async function casosBilletera(navegador, url, ancho) {
  const g = `billetera ${ancho}px`;
  const app = await abrirApp(navegador, url, { ancho });
  const { page } = app;
  const campo = '#walletSheet [data-wallet-field="address"]';
  const aviso = () => page.evaluate(() => {
    const n = document.querySelector('#walletSheet [data-wallet-role="detect"]');
    return { cls: n?.className || "", txt: n?.textContent || "" };
  });
  const paso2 = (nombre, fn) => paso(g, nombre, app, fn);
  const abrirPanel = async () => {
    await page.click('[data-tab-target="more"]'); await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector(".wallets-panel").open = true; });
    await page.waitForTimeout(200);
  };

  await paso2("abrir desde el menu del engranaje", async () => {
    await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
    await page.click("#quickAddBtn"); await page.waitForTimeout(300);
    await page.click('[data-fab-action="wallet"]'); await page.waitForTimeout(400);
    const alto = await page.evaluate(() => document.querySelector("#walletSheet .editor-panel")?.getBoundingClientRect().height || 0);
    if (!(alto > 0)) throw new Error("la hoja no se ve");
    const d = await desborde(page); if (d) throw new Error(d);
  });
  await paso2("frase semilla: se borra del campo y avisa", async () => {
    await page.fill(campo, SEED);
    const a = await aviso();
    if (await page.inputValue(campo)) throw new Error("la frase sigue escrita en el campo");
    if (!/is-danger/.test(a.cls) || !/semilla/.test(a.txt)) throw new Error(`aviso: "${a.txt}"`);
    if (!(await page.isDisabled("[data-wallet-read]"))) throw new Error("deja leer con una frase semilla");
  });
  await paso2("clave privada: se borra del campo y avisa", async () => {
    await page.fill(campo, "0x" + "4f".repeat(32));
    const a = await aviso();
    if (await page.inputValue(campo)) throw new Error("la clave sigue escrita en el campo");
    if (!/is-danger/.test(a.cls) || !/clave privada/.test(a.txt)) throw new Error(`aviso: "${a.txt}"`);
  });
  await paso2("xpub: aviso de fase 2, sin leer", async () => {
    await page.fill(campo, "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8");
    if (!/is-warn/.test((await aviso()).cls)) throw new Error("sin aviso");
    if (!(await page.isDisabled("[data-wallet-read]"))) throw new Error("deja leer una xpub");
  });
  await paso2("direccion EVM: se reconoce y se lee", async () => {
    await page.fill(campo, EVM_ADDR.replace(/[a-f]/g, (c) => c.toUpperCase()).replace("0X", "0x"));
    if (!/is-ok/.test((await aviso()).cls)) throw new Error("no la reconoce");
    await page.fill('#walletSheet [data-wallet-field="name"]', "Ledger <img src=x onerror=window.__xss=1>");
    await page.click("[data-wallet-read]"); await page.waitForTimeout(1500);
    if (!(await page.$('#walletSheet [data-wallet-step="preview"]'))) throw new Error("no llega a la vista previa");
  });
  await paso2("vista previa: agrupa redes y oculta la basura", async () => {
    const leer = () => page.evaluate(() => {
      const items = [...document.querySelectorAll("#walletSheet .wallet-asset")];
      const vis = items.filter((li) => li.getBoundingClientRect().height > 0);
      return {
        total: items.length,
        visibles: vis.map((li) => li.querySelector(".wallet-asset-id").textContent.replace(/\s+/g, " ").trim()),
        marcados: vis.filter((li) => li.querySelector("input").checked).length,
        html: document.querySelectorAll("#walletSheet .wallet-asset b").length
      };
    });
    const r = await leer();
    // ETH (Ethereum + Base en una), USDC y el "SOL" sin listar; el USDC falso
    // sin precio y el polvo de LINK quedan ocultos. Lo sin listar sale SIN
    // marcar (suele ser un token regalado para estafar) y con aviso.
    if (r.total !== 5 || r.visibles.length !== 3 || r.marcados !== 2) throw new Error(JSON.stringify(r));
    if (!(await page.$('#walletSheet [data-wallet-role="unlistedNote"]'))) throw new Error("falta el aviso de tokens sin listar");
    if (!r.visibles.some((v) => /Ethereum · Base/.test(v))) throw new Error("ETH no se agrupa: " + r.visibles.join(" / "));
    if (r.html) throw new Error("HTML del nombre de un token pintado");
    // Lectura sin cuenta: avisa de que un token pequeno puede no salir.
    if (!(await page.$('#walletSheet [data-wallet-role="publicNote"]'))) throw new Error("falta el aviso del modo sin cuenta");
    await page.click("[data-wallet-toggle-hidden]"); await page.waitForTimeout(200);
    const r2 = await leer();
    if (r2.visibles.length !== 5 || r2.marcados !== 2) throw new Error("ocultos: " + JSON.stringify(r2));
    const d = await desborde(page); if (d) throw new Error(d);
    await page.click("[data-wallet-toggle-hidden]");
  });
  let ethId = "";
  await paso2("importar al precio de hoy", async () => {
    // El token sin listar se marca a mano (el usuario lo reconoce).
    await page.check(`#walletSheet [data-wallet-pick="base:${SOL_FALSO}"]`); await page.waitForTimeout(200);
    await page.click('[data-wallet-cost="today"]');
    await page.click("[data-wallet-import]"); await page.waitForTimeout(900);
    const filas = await filasBilletera(page);
    if (filas.length !== 3) throw new Error(`posiciones importadas: ${filas.length}`);
    const eth = filas.find((f) => f.key === "cg:ethereum");
    ethId = eth?.id || "";
    if (Number(eth?.tokens) !== 2 || Math.abs(Number(eth?.investment) - 5000) > 1) throw new Error(`ETH: ${eth?.tokens} tokens, coste ${eth?.investment}`);
    const chips = await page.evaluate(() => [...document.querySelectorAll(".asset-mobile-card .wallet-chip")].map((c) => c.textContent.trim()));
    if (chips.length !== 3 || !chips.every((c) => c.startsWith("Ledger"))) throw new Error("etiquetas: " + chips.join(" / "));
  });
  await paso2("token sin listar: precio por contrato, nunca por simbolo", async () => {
    await page.waitForTimeout(2500); // entran ticks de SOLUSDT (150) por el WebSocket
    const falso = (await filasBilletera(page)).find((f) => f.dex === SOL_FALSO);
    if (!falso) throw new Error("no se importo");
    if (Math.abs(Number(falso.price) - 0.52) > 1e-9 || falso.source !== "geckoterminal") throw new Error(`precio ${falso.price} (${falso.source})`);
  });
  await paso2("posicion de billetera: sin comprar ni vender y cantidad bloqueada", async () => {
    await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
    const card = `.asset-mobile-card[data-card-row="${ethId}"]`;
    await page.click(`${card} [data-card-toggle]`); await page.waitForTimeout(300);
    const acciones = await page.evaluate((sel) => [...document.querySelectorAll(sel + " [data-card-action]")].map((b) => b.dataset.cardAction), card);
    if (acciones.includes("buy") || acciones.includes("sell") || !acciones.includes("walletSync")) throw new Error("acciones: " + acciones.join(","));
    await page.click('[data-quick="buy"]'); await page.waitForTimeout(400);
    const opciones = await page.evaluate(() => [...document.querySelectorAll("#tradeSheet [data-trade-field='rowId'] option")].map((o) => o.value));
    const deBilletera = (await filasBilletera(page)).map((f) => f.id);
    if (opciones.some((v) => deBilletera.includes(v))) throw new Error("la compra ofrece posiciones de billetera");
    await cerrarHoja(page); await page.waitForTimeout(300);
    await page.click(`${card} [data-card-action="edit"]`); await page.waitForTimeout(500);
    const bloqueo = await page.evaluate(() => ({
      tokens: document.querySelector('#positionEditorPortal [data-editor-field="tokens"]').readOnly,
      crypto: document.querySelector('#positionEditorPortal [data-editor-field="crypto"]').readOnly
    }));
    if (!bloqueo.tokens || !bloqueo.crypto) throw new Error("se puede editar la cantidad o el activo");
    await page.fill('#positionEditorPortal [data-editor-field="investment"]', "4000"); await page.waitForTimeout(200);
    const eth = (await filasBilletera(page)).find((f) => f.id === ethId);
    if (eth.tokens !== "2" || eth.investment !== "4000") throw new Error(`tras editar el coste: ${eth.tokens} / ${eth.investment}`);
    await page.click("#positionEditorPortal [data-editor-close]"); await page.waitForTimeout(400);
  });
  await paso2("actualizar: si bajan los tokens, el coste baja en proporcion", async () => {
    app.billetera.version = 2; // vendio 0,75 ETH y recibio 1000 ADA
    await abrirPanel();
    const meta = await page.evaluate(() => document.querySelector(".wallet-item")?.textContent.replace(/\s+/g, " ") || "");
    if (!/3 activos/.test(meta)) throw new Error("panel: " + meta);
    await page.click("[data-wallet-sync]"); await page.waitForTimeout(1800);
    const eth = (await filasBilletera(page)).find((f) => f.id === ethId);
    // 1,25 de 2 tokens: el coste (4000) baja a 2500, el coste medio no cambia.
    if (Number(eth.tokens) !== 1.25 || Math.abs(Number(eth.investment) - 2500) > 0.01) throw new Error(`ETH: ${eth.tokens} / ${eth.investment}`);
    const nuevo = await page.evaluate(() => document.querySelector(".wallet-item-new")?.textContent || "");
    if (!/1 activos nuevos/.test(nuevo)) throw new Error(`aviso de nuevos: "${nuevo}"`);
    const d = await desborde(page); if (d) throw new Error(d);
  });
  await paso2("revisar: entra lo nuevo y no se duplica lo importado", async () => {
    await page.click("[data-wallet-review]"); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({
      ya: document.querySelectorAll("#walletSheet .wallet-asset.is-linked").length,
      marcados: [...document.querySelectorAll("#walletSheet [data-wallet-pick]:checked")].map((i) => i.dataset.walletPick)
    }));
    if (r.ya !== 3 || r.marcados.join() !== "cg:cardano") throw new Error(JSON.stringify(r));
    await page.click("[data-wallet-import]"); await page.waitForTimeout(800);
    const filas = await filasBilletera(page);
    const ada = filas.find((f) => f.key === "cg:cardano");
    if (filas.length !== 4 || !ada || ada.investment !== "") throw new Error(`filas ${filas.length}, ADA coste "${ada?.investment}"`);
  });
  await paso2("red sin clave configurada: aviso claro", async () => {
    await page.click("#addWalletBtn"); await page.waitForTimeout(400);
    await page.fill(campo, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    await page.click("[data-wallet-read]"); await page.waitForTimeout(1200);
    const txt = await page.evaluate(() => document.querySelector("#walletSheet .editor-body")?.textContent || "");
    if (!/clave de Alchemy/.test(txt)) throw new Error("mensaje: " + txt.trim().slice(0, 120));
    await page.click('#walletSheet .icon-circle-btn[data-wallet-close]'); await page.waitForTimeout(300);
  });
  await paso2("Bitcoin: entra aparte del BTC manual", async () => {
    await page.click("#addWalletBtn"); await page.waitForTimeout(400);
    await page.fill(campo, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    await page.click("[data-wallet-read]"); await page.waitForTimeout(1500);
    await page.click("[data-wallet-import]"); await page.waitForTimeout(800);
    const btc = await page.evaluate(() => state.rows.filter((r) => r.symbol === "BTC").map((r) => `${r.walletId ? "billetera" : "manual"}:${r.tokens}`));
    if (btc.sort().join() !== "billetera:0.25,manual:0.05") throw new Error(btc.join(" / "));
  });
  await paso2("al recargar sigue todo y no se relee de golpe", async () => {
    const antes = app.billetera.llamadas.length;
    await page.reload(); await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({ billeteras: state.wallets.length, chips: document.querySelectorAll(".asset-mobile-card .wallet-chip").length }));
    if (r.billeteras !== 2 || r.chips !== 5) throw new Error(JSON.stringify(r));
    if (app.billetera.llamadas.length !== antes) throw new Error("se releyo sin haber pasado el tiempo");
  });
  await paso2("quitar una billetera borra solo sus posiciones", async () => {
    await abrirPanel();
    await page.click("[data-wallet-delete]"); await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ billeteras: state.wallets.length, deBilletera: state.rows.filter((x) => x.walletId).length, manuales: state.rows.filter((x) => !x.walletId).length }));
    if (r.billeteras !== 1 || r.deBilletera !== 1 || r.manuales !== 6) throw new Error(JSON.stringify(r));
  });
  await paso2("sin HTML inyectado en nombres de billetera ni de tokens", async () => {
    const r = await page.evaluate(() => ({ xss: window.__xss === 1, img: document.querySelectorAll("img[src='x']").length }));
    if (r.xss || r.img) throw new Error(JSON.stringify(r));
  });
  await app.ctx.close();
}

const desfases = comprobarVersionesCdn();
if (desfases.length) anotar("versiones", "librerias del CDN alineadas con package.json", desfases.join(" | "));
else anotar("versiones", "librerias del CDN alineadas con package.json", null);

const servidor = await arrancarServidor();
const url = `http://127.0.0.1:${servidor.address().port}/index.html`;
const navegador = await chromium.launch();
try {
  await casosSueltos(navegador, url);
  for (const ancho of [375, 320]) await recorridoCompleto(navegador, url, ancho);
  for (const ancho of [375, 320]) await casosBilletera(navegador, url, ancho);
} finally {
  await navegador.close();
  servidor.close();
}
const fallos = resultados.filter((r) => r.error);
console.log(`\n${resultados.length} comprobaciones · ${resultados.length - fallos.length} correctas · ${fallos.length} fallidas`);
process.exit(fallos.length ? 1 : 0);
