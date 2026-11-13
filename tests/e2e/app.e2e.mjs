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
  const billetera = { version: 1, llamadas: [], claves: [] };
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
    billetera.claves.push(r.request().headers()["x-coinstats-key"] || "");
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

async function abrirApp(navegador, url, { ancho = 375, alto = 780, movil = true, sembrar = true, proxyCaido = false } = {}) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil, serviceWorkers: "block", acceptDownloads: true });
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
  // E2E_DETALLE=1: el error completo (con el registro de Playwright) para
  // depurar; por defecto, solo su primera linea.
  try { await fn(app.page); } catch (e) { error = process.env.E2E_DETALLE ? e.message : e.message.split("\n")[0]; }
  await app.page.waitForTimeout(200);
  const nuevos = app.errores.slice(antes);
  if (!error && nuevos.length) error = nuevos.join(" | ");
  anotar(grupo, nombre, error);
}

// Desborde horizontal: el scroll lateral de la pagina y, ademas, cualquier
// elemento visible que se salga del borde. Lo segundo hace falta porque un
// elemento fijo (el dock, una hoja) que no cabe no genera scroll: se corta.
const desborde = (page) => page.evaluate(() => {
  // En un movil, lo que no cabe no siempre da scroll lateral: el navegador
  // ensancha la pagina entera y la aleja (la barra inferior queda fuera).
  const pantalla = window.visualViewport ? Math.round(window.visualViewport.width * window.visualViewport.scale) : window.innerWidth;
  if (window.innerWidth > pantalla + 1) return `la pagina se ensancha a ${window.innerWidth}px en una pantalla de ${pantalla}px`;
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
// Texto que se sale de su caja (pisa al vecino) e importes partidos en dos
// lineas. El desborde de pagina no lo ve: el texto puede montarse dentro.
const colisiones = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".tab-section *, #assetDetailScreen *")) {
    if (el.children.length || !el.textContent.trim()) continue;
    const caja = el.getBoundingClientRect();
    if (!caja.width || !caja.height || el.closest("[hidden]")) continue;
    const seccion = el.closest(".tab-section");
    if (seccion && getComputedStyle(seccion).display === "none") continue;
    const cs = getComputedStyle(el);
    const texto = el.textContent.trim();
    if (cs.textOverflow === "ellipsis" && el.matches(".segmentado > button") && el.scrollWidth > el.clientWidth + 1) out.push("cortado: " + texto);
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible" && cs.textOverflow !== "ellipsis" && cs.display !== "inline") {
      let recortado = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") { recortado = p.scrollWidth > p.clientWidth; break; }
      }
      if (!recortado) out.push("se sale: " + texto.slice(0, 40));
    }
    if (/\d[\d.,]*\s?(US\$|€)$/.test(texto) && texto.length < 22) {
      const linea = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      if (caja.height > linea * 1.6) out.push("partido: " + texto);
    }
  }
  return [...new Set(out)].slice(0, 6).join(" | ");
});
const cerrarHoja = (page) => page.click(".icon-circle-btn[data-trade-close]");
const leerFila = (page, id) => page.evaluate((i) => JSON.parse(localStorage.getItem("crypto-dashboard-rows-v3")).rows.find((r) => r.id === i), id);

async function recorridoCompleto(navegador, url, ancho) {
  const g = `${ancho}px`;
  const app = await abrirApp(navegador, url, { ancho });
  const { page } = app;

  await paso(g, "arranque con cartera realista", app, async () => {
    const n = await page.evaluate(() => document.querySelectorAll("#portfolioMobileList .fila-activo").length);
    if (n < 6) throw new Error(`se esperaban 6 filas de activo y hay ${n}`);
  });
  for (const tab of ["home", "news", "plan", "analytics", "more"]) {
    await paso(g, `pestana ${tab}: visible y sin desborde`, app, async () => {
      await page.click(`[data-tab-target="${tab}"]`); await page.waitForTimeout(800);
      const alto = await page.evaluate((t) => [...document.querySelectorAll(`.tab-section[data-tab="${t}"]`)].reduce((a, s) => a + s.getBoundingClientRect().height, 0), tab);
      if (!(alto > 0)) throw new Error(`la seccion ${tab} mide 0 de alto`);
      const d = await desborde(page); if (d) throw new Error(d);
      await page.evaluate((t) => document.querySelectorAll(`.tab-section[data-tab="${t}"] details`).forEach((x) => { x.open = true; }), tab);
      await page.waitForTimeout(150);
      const c = await colisiones(page); if (c) throw new Error(c);
    });
  }
  await paso(g, "analitica: anillo de distribucion y leyenda que suma 100 %", app, async () => {
    await page.click('[data-tab-target="analytics"]'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({
      segmentos: document.querySelectorAll("#analyticsDonut g circle").length,
      leyenda: document.querySelectorAll("#analyticsDonut .dona-leyenda li").length,
      suma: [...document.querySelectorAll("#analyticsDonut .dona-leyenda strong")].reduce((t, x) => t + parseFloat(x.textContent), 0),
      centro: document.querySelector("#analyticsDonut .dona-centro strong")?.textContent
    }));
    if (r.segmentos !== r.leyenda || r.leyenda < 2 || Math.abs(r.suma - 100) > 0.6 || r.centro !== "6") throw new Error(JSON.stringify(r));
  });
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
  await paso(g, "ficha de activo: secciones, rangos del grafico y sin desborde", app, async () => {
    await page.click("#portfolioMobileList .fila-activo-boton[data-asset-open]");
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({
      bloques: document.querySelectorAll("#assetDetailScreen .ficha-bloque").length,
      precio: document.querySelector('#assetDetailScreen [data-detail-role="price"]')?.textContent || "",
      rangos: [...document.querySelectorAll("#assetDetailScreen [data-detail-range]")].map((b) => b.dataset.detailRange),
      botones: [...document.querySelectorAll("#assetDetailScreen .ficha-pie [data-detail-action]")].map((b) => b.dataset.detailAction).join()
    }));
    if (r.bloques !== 5 || !/\d/.test(r.precio) || r.rangos.length !== 6 || r.botones !== "sell,buy") throw new Error(JSON.stringify(r));
    for (const k of r.rangos) {
      await page.click(`[data-detail-range="${k}"]`); await page.waitForTimeout(150);
      const pulsado = await page.evaluate((x) => document.querySelector(`[data-detail-range="${x}"]`).getAttribute("aria-pressed"), k);
      if (pulsado !== "true") throw new Error("rango sin marcar: " + k);
    }
    const d = await desborde(page); if (d) throw new Error(d);
    // Con precios en vivo, los ticks cambian las cifras pero no rehacen los
    // botones (si no, un toque a mitad de tick se perdia).
    const vivo = await page.evaluate(async () => {
      const boton = document.querySelector('#assetDetailScreen .ficha-pie [data-detail-action="buy"]');
      const editar = document.querySelector('#assetDetailScreen .enlace[data-detail-action="edit"]');
      const antes = document.querySelector('#assetDetailScreen [data-detail-role="price"]').textContent;
      await new Promise((ok) => setTimeout(ok, 1500));
      return { boton: boton.isConnected, editar: editar.isConnected, cambia: document.querySelector('#assetDetailScreen [data-detail-role="price"]').textContent !== antes };
    });
    if (!vivo.boton || !vivo.editar || !vivo.cambia) throw new Error("en vivo: " + JSON.stringify(vivo));
    await page.click('#assetDetailScreen [data-detail-action="favorite"]'); await page.waitForTimeout(200);
    const fav = await page.evaluate(() => document.querySelector('#assetDetailScreen [data-detail-action="favorite"]').getAttribute("aria-pressed"));
    await page.click('#assetDetailScreen [data-detail-action="favorite"]');
    if (fav !== "false") throw new Error("favorito no cambia: " + fav);
    await page.click("[data-detail-close]");
  });
  await paso(g, "todas las ordenaciones", app, async () => {
    const ops = await page.evaluate(() => [...document.querySelectorAll("#mobileSortSelect option")].map((o) => o.value));
    for (const o of ops) { await page.selectOption("#mobileSortSelect", o); await page.waitForTimeout(120); }
  });
  await paso(g, "modo privacidad", app, async () => { await page.click("#toggleBalanceBtn"); await page.waitForTimeout(250); await page.click("#toggleBalanceBtn"); });
  await paso(g, "apariencia: claro, automatico (sigue al sistema) y oscuro en negro puro", app, async () => {
    await page.click('[data-tab-target="more"]'); await page.waitForTimeout(300);
    const tema = () => page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor, document.querySelector('meta[name="theme-color"]').content]);
    await page.click('[data-tema-set="light"]'); let r = await tema();
    if (r[0] !== "light" || r[2] !== "#F2F3F5") throw new Error("claro: " + r.join());
    await page.emulateMedia({ colorScheme: "dark" });
    await page.click('[data-tema-set="auto"]'); r = await tema();
    if (r[0] !== "dark") throw new Error("automatico con sistema oscuro: " + r.join());
    await page.emulateMedia({ colorScheme: "light" }); await page.waitForTimeout(200); r = await tema();
    if (r[0] !== "light") throw new Error("automatico no sigue al sistema: " + r.join());
    await page.emulateMedia({ colorScheme: null });
    await page.click('[data-tema-set="dark"]'); r = await tema();
    if (r[0] !== "dark" || r[1] !== "rgb(0, 0, 0)" || r[2] !== "#000000") throw new Error("oscuro en negro puro: " + r.join());
    const retirados = await page.locator('[data-ajuste="oled"], [data-espacio-set]').count();
    if (retirados) throw new Error("siguen los mandos de negro puro o densidad: " + retirados);
  });
  await paso(g, "apariencia: acento y texto grande sin desborde", app, async () => {
    await page.click('[data-acento-set="violeta"]'); await page.click('[data-texto-set="l"]');
    const r = await page.evaluate(() => ({ acento: getComputedStyle(document.documentElement).getPropertyValue("--c-ac").trim(), letra: getComputedStyle(document.documentElement).fontSize }));
    if (r.acento.toUpperCase() !== "#A78BFA" || r.letra !== "17.5px") throw new Error(JSON.stringify(r));
    // Se revisa todo y luego se restaura SIEMPRE: si este paso fallara a
    // medias, los siguientes no deben heredar el texto grande ni la pestana.
    const problemas = [];
    for (const tab of ["more", "home", "news", "plan", "analytics"]) {
      await page.click(`[data-tab-target="${tab}"]`); await page.waitForTimeout(400);
      await page.evaluate((t) => document.querySelectorAll(`.tab-section[data-tab="${t}"] details`).forEach((x) => { x.open = true; }), tab);
      await page.waitForTimeout(150);
      const d = await desborde(page); if (d) problemas.push(`${tab}: ${d}`);
      const c = await colisiones(page); if (c) problemas.push(`${tab}: ${c}`);
    }
    await page.click('[data-tab-target="more"]'); await page.waitForTimeout(300);
    await page.click('[data-acento-set="esmeralda"]'); await page.click('[data-texto-set="m"]');
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem("crypto-dashboard-prefs-v2")));
    if (guardado.accent !== "esmeralda" || guardado.textSize !== "m") throw new Error("no se guardo: " + JSON.stringify(guardado));
    if (problemas.length) throw new Error("con texto grande: " + problemas.join(" || "));
  });
  await paso(g, "apariencia: ocultar y reordenar bloques de inicio", app, async () => {
    await page.click('[data-bloque-switch="mercado"]');
    const oculto = await page.evaluate(() => getComputedStyle(document.querySelector('#inicioBloques [data-bloque="mercado"]')).display);
    if (oculto !== "none") throw new Error("mercado sigue visible");
    await page.click('[data-bloque-switch="mercado"]');
    await page.focus('#bloquesInicio [data-bloque-id="activos"] [data-asa]');
    await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
    const orden = await page.evaluate(() => [...document.querySelectorAll("#inicioBloques > [data-bloque]")].map((b) => b.dataset.bloque).join());
    if (orden !== "grafico,activos,acciones,resumen,reparto,mercado") throw new Error("orden: " + orden);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  });
  await paso(g, "apariencia: arrastrar un bloque y soltar fuera de la lista", app, async () => {
    await page.evaluate(() => document.getElementById("bloquesInicio").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    const asa = await page.locator('#bloquesInicio [data-bloque-id="mercado"] [data-asa]').boundingBox();
    await page.mouse.move(asa.x + asa.width / 2, asa.y + asa.height / 2); await page.mouse.down();
    await page.mouse.move(asa.x + asa.width / 2, 4, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      orden: [...document.querySelectorAll("#inicioBloques > [data-bloque]")].map((b) => b.dataset.bloque)[0],
      colgado: document.querySelectorAll("#bloquesInicio .arrastrando").length
    }));
    if (r.orden !== "mercado" || r.colgado) throw new Error(JSON.stringify(r));
    // Se deja como estaba: mercado al final.
    await page.focus('#bloquesInicio [data-bloque-id="mercado"] [data-asa]');
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  });
  await paso(g, "apariencia: sin decimales y precio como dato de la lista", app, async () => {
    // Inicio esta oculto mientras se cambia el ajuste: se pinta al volver.
    await page.click('[data-ajuste="decimals"]'); await page.waitForTimeout(200);
    await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
    const sin = await page.evaluate(() => document.getElementById("mainValue").textContent);
    if (/,\d\d/.test(sin)) throw new Error("con decimales: " + sin);
    await page.click('[data-tab-target="more"]'); await page.waitForTimeout(300);
    await page.click('[data-ajuste="decimals"]');
    await page.click('[data-metrica-set="precio"]'); await page.waitForTimeout(200);
    const dato = await page.evaluate(() => document.querySelector('#portfolioMobileList [data-role="rowMetric"]').textContent);
    if (!/\$/.test(dato)) throw new Error("dato de la lista: " + dato);
    await page.click('[data-metrica-set="24h"]');
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
    await page.click('[data-tab-target="home"]'); await page.waitForTimeout(300);
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
    const n = await page.evaluate(() => document.querySelectorAll("#portfolioMobileList .fila-activo").length);
    if (!n) throw new Error("no se pinto ninguna posicion");
  });
  await paso(g, "todas las hojas de estilo de css/ cargan", virgen, async (page) => {
    const r = await page.evaluate(() => {
      const enlaces = [...document.querySelectorAll('link[rel="stylesheet"][href*="css/"]')].map((l) => l.href);
      const cargadas = [...document.styleSheets].filter((h) => h.href && enlaces.includes(h.href)).filter((h) => { try { return h.cssRules.length > 0; } catch { return false; } });
      return { enlaces: enlaces.length, cargadas: cargadas.length };
    });
    if (r.enlaces < 11 || r.cargadas !== r.enlaces) throw new Error(JSON.stringify(r));
  });
  await paso(g, "saldos pequenos agrupados al final y desplegables", virgen, async (page) => {
    await page.evaluate(() => {
      ["a", "b"].forEach((k) => state.rows.push(createRow({ id: "peq-" + k, crypto: "polvo" + k, symbol: "P" + k.toUpperCase(), tokens: "1", investment: "0.5", currentPrice: 0.2 })));
      renderAll();
    });
    const r = await page.evaluate(() => ({ grupo: !!document.querySelector(".grupo-pequenos"), oculto: document.getElementById("grupoPequenosLista")?.hidden, filas: document.querySelectorAll("#grupoPequenosLista .fila-activo").length }));
    if (!r.grupo || !r.oculto || r.filas !== 2) throw new Error(JSON.stringify(r));
    await page.click("[data-grupo-toggle]");
    if (await page.evaluate(() => document.getElementById("grupoPequenosLista").hidden)) throw new Error("no se despliega");
  });
  await paso(g, "cerrar y volver a abrir enseguida: ficha, editor y hoja de compra", virgen, async (page) => {
    await page.evaluate(() => {
      openAssetDetail(state.rows[0].id); closeAssetDetail(); openAssetDetail(state.rows[1].id);
    });
    await page.waitForTimeout(450);
    const ficha = await page.evaluate(() => ({ visible: !document.getElementById("assetDetailScreen").hidden, ficha: !!document.querySelector("#assetDetailScreen .ficha") }));
    await page.evaluate(() => closeAssetDetail()); await page.waitForTimeout(350);
    await page.evaluate(() => { openPositionEditor(state.rows[0].id); closePositionEditor(); openPositionEditor(state.rows[1].id); });
    await page.waitForTimeout(450);
    const editor = await page.evaluate(() => ({ visible: !document.getElementById("positionEditorPortal").hidden, form: !!document.querySelector("#positionEditorPortal form"), bloqueo: document.body.classList.contains("editor-open") }));
    await page.evaluate(() => closePositionEditor()); await page.waitForTimeout(350);
    await page.evaluate(() => { openTradeSheet("buy"); closeTradeSheet(); openTradeSheet("sell"); });
    await page.waitForTimeout(450);
    const hoja = await page.evaluate(() => ({ visible: !document.getElementById("tradeSheet").hidden, modo: document.querySelector("#tradeSheet form")?.dataset.tradeMode, bloqueo: document.body.classList.contains("editor-open") }));
    await page.evaluate(() => closeTradeSheet()); await page.waitForTimeout(350);
    const libre = await page.evaluate(() => document.body.classList.contains("editor-open"));
    if (!ficha.visible || !ficha.ficha || !editor.visible || !editor.form || !editor.bloqueo || !hoja.visible || hoja.modo !== "sell" || !hoja.bloqueo || libre) {
      throw new Error(JSON.stringify({ ficha, editor, hoja, libre }));
    }
  });
  await paso(g, "la hoja de compra no acumula escuchas al reabrirla", virgen, async (page) => {
    const n = await page.evaluate(async () => {
      for (let k = 0; k < 6; k++) { openTradeSheet("buy"); closeTradeSheet(); await new Promise((r) => setTimeout(r, 230)); }
      openTradeSheet("buy"); await new Promise((r) => setTimeout(r, 50));
      let veces = 0; const original = window.updateTradePreview;
      window.updateTradePreview = function (...args) { veces += 1; return original.apply(this, args); };
      document.querySelector("#tradeSheet [data-trade-field='amount']").dispatchEvent(new Event("input", { bubbles: true }));
      window.updateTradePreview = original; closeTradeSheet(); await new Promise((r) => setTimeout(r, 230));
      return veces;
    });
    if (n !== 1) throw new Error(`una tecla recalcula la vista previa ${n} veces`);
  });
  await paso(g, "un aviso no se queda con el toque de lo que tiene debajo", virgen, async (page) => {
    const r = await page.evaluate(() => {
      showToast("Prueba", "Aviso encima de la lista", "positive");
      const caja = document.querySelector("#toastStack .toast").getBoundingClientRect();
      const debajo = document.elementFromPoint(caja.left + caja.width / 2, caja.top + caja.height / 2);
      return debajo?.closest(".toast") ? "el aviso" : "ok";
    });
    if (r !== "ok") throw new Error("el toque lo recibe " + r);
  });
  await paso(g, "saldo enorme (token basura valorado en billones): cabe y la barra se pulsa", virgen, async (page) => {
    await page.evaluate(() => {
      state.rows.push(createRow({ id: "basura", crypto: "basura", symbol: "SCAM", tokens: "1000000000", investment: "0", currentPrice: 98765432.1, priceStatus: "success" }));
      renderAll();
      openAssetDetail("basura");
    });
    await page.waitForTimeout(500);
    const ficha = await desborde(page);
    await page.evaluate(() => closeAssetDetail()); await page.waitForTimeout(350);
    const inicio = await desborde(page);
    const r = await page.evaluate(() => { const v = document.getElementById("mainValue"); return { lineas: Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).fontSize)), texto: v.textContent }; });
    // Analitica: la cifra de Rendimiento y la leyenda del anillo.
    await page.click('[data-tab-target="analytics"]', { timeout: 2000 }); await page.waitForTimeout(400);
    const analitica = await desborde(page);
    await page.click('[data-tab-target="home"]', { timeout: 2000 });
    await page.evaluate(() => { state.rows = state.rows.filter((row) => row.id !== "basura"); renderAll(); });
    if (ficha || inicio || analitica || r.lineas > 1) throw new Error(JSON.stringify({ ficha, inicio, analitica, ...r }));
  });
  await paso(g, "ocultar saldos al abrir: la app arranca en privado", virgen, async (page) => {
    await page.evaluate(() => { state.prefs.hideOnOpen = true; state.prefs.hideBalance = false; savePreferences(); });
    await page.reload(); await page.waitForTimeout(2500);
    const v = await page.evaluate(() => document.getElementById("mainValue").textContent);
    if (!/•/.test(v) || /\d/.test(v)) throw new Error("saldo visible: " + v);
  });
  await virgen.ctx.close();
  // Proxy propio caido: debe reintentar contra CoinGecko directo y pintar precio.
  const caido = await abrirApp(navegador, url, { proxyCaido: true });
  await paso(g, "proxy caido: respaldo a CoinGecko directo", caido, async (page) => {
    // Binance da precio a casi todo, asi que lo que se comprueba es que el
    // mercado se pidio de verdad a CoinGecko directo al fallar el proxy.
    if (!caido.directas.includes("coins/markets")) throw new Error(`sin peticion directa a coins/markets (directas: ${caido.directas.join(", ") || "ninguna"})`);
    const valor = await page.evaluate(() => document.querySelector('#portfolioMobileList [data-role="rowValue"]')?.textContent || "");
    if (!/[1-9]/.test(valor)) throw new Error(`sin precio: "${valor}"`);
  });
  await caido.ctx.close();

  // Lo que no se ve no se repinta con cada precio: se pinta al aparecer.
  const vivo = await abrirApp(navegador, url);
  await paso(g, "precios en vivo con Analitica oculta: al abrirla esta al dia", vivo, async (page) => {
    await page.waitForTimeout(1500);
    const pendiente = await page.evaluate(() => seccionesPendientes.has("analytics"));
    if (!pendiente) throw new Error("Analitica se repinta estando oculta");
    await page.evaluate(() => stopLivePrices()); await page.waitForTimeout(1300);
    await page.click('[data-tab-target="analytics"]'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ esperado: maskedCurrency(buildSnapshot().totals.currentValue), pintado: document.getElementById("analyticsSummaryGrid").textContent }));
    if (!r.pintado.includes(r.esperado)) throw new Error(`Analitica no muestra ${r.esperado}`);
  });
  await paso(g, "tabla de escritorio: se pinta al ensanchar y sigue los precios", vivo, async (page) => {
    await page.click('[data-tab-target="home"]'); await page.evaluate(() => startLivePrices());
    await page.waitForTimeout(1500);
    if (await page.evaluate(() => !seccionesPendientes.has("tabla"))) throw new Error("la tabla se repinta estando oculta");
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(400);
    const leer = () => page.evaluate(() => {
      const fila = document.querySelector('#tableBody tr[data-row-id="r-btc"]');
      return { filas: document.querySelectorAll("#tableBody tr[data-row-id]").length, precio: fila?.querySelector("[data-role='rowPrice']")?.textContent, esperado: formatCurrency(getRowById("r-btc").currentPrice, getPriceDigits(getRowById("r-btc").currentPrice)) };
    });
    const a = await leer();
    if (a.filas < 2 || a.precio !== a.esperado) throw new Error("al ensanchar: " + JSON.stringify(a));
    await page.waitForTimeout(1600);
    const b = await leer();
    if (b.precio === a.precio || b.precio !== b.esperado) throw new Error("con precios en vivo: " + JSON.stringify({ a, b }));
  });
  await vivo.ctx.close();
}

// ── Escritorio (desde 1100 px): toda la app en una pagina ──
// Huecos: en cada fila de tarjetas todas acaban a la misma altura y en las
// rejillas de bloques (activos del Plan, noticias) la ultima fila llega al
// borde.
const huecosEscritorio = (page) => page.evaluate(() => {
  const out = [];
  for (const fila of document.querySelectorAll(".esc-rejilla, .esc-analisis")) {
    const grupos = new Map();
    [...fila.children].filter((h) => h.getClientRects().length).forEach((h) => {
      const k = Math.round(h.getBoundingClientRect().top);
      grupos.set(k, [...(grupos.get(k) || []), h]);
    });
    grupos.forEach((grupo) => {
      const fondos = grupo.map((h) => {
        const ultimo = h.classList.contains("esc-pila") ? [...h.children].filter((x) => x.getClientRects().length).pop() || h : h;
        return Math.round(ultimo.getBoundingClientRect().bottom);
      });
      if (Math.max(...fondos) - Math.min(...fondos) > 2) out.push(`${fila.className}: ${fondos.join("/")}`);
    });
  }
  for (const caja of document.querySelectorAll(".escritorio .tp-activos, .escritorio .news-list")) {
    const visibles = [...caja.children].filter((h) => h.getClientRects().length);
    if (!visibles.length) continue;
    const hueco = caja.getBoundingClientRect().right - visibles[visibles.length - 1].getBoundingClientRect().right;
    if (hueco > 2) out.push(`${caja.className}: hueco de ${Math.round(hueco)}px al final`);
  }
  return out.join(" | ");
});

async function casosEscritorio(navegador, url) {
  const g = "escritorio";
  const app = await abrirApp(navegador, url, { ancho: 1440, alto: 900, movil: false });
  const { page } = app;
  await paso(g, "toda la app en una pagina, sin pestanas", app, async () => {
    const r = await page.evaluate(() => {
      const ve = (sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"); };
      return {
        barra: ve("#tabBar"), ajustes: ve("#ajustesSeccion"),
        piezas: ["#mainValue", "#graficoSaldo", "#summaryGrid", "#analyticsSummaryGrid", "#tableBody tr[data-row-id]", "#analyticsDonut", "#insightsRankingsGrid", "[data-bloque='mercado']", "#analyticsCategory", "#analyticsCompare", "#analyticsActivityStats", "#planContent .tp-fold", "#newsList .news-card", ".esc-cabecera [data-quick='buy']"].filter((sel) => !ve(sel))
      };
    });
    if (r.barra || r.ajustes || r.piezas.length) throw new Error(JSON.stringify(r));
  });
  for (const [ancho, alto] of [[1100, 760], [1440, 900], [1920, 1080]]) {
    await paso(g, `${ancho}px: sin desbordes ni huecos`, app, async () => {
      await page.setViewportSize({ width: ancho, height: alto }); await page.waitForTimeout(400);
      const d = await desborde(page); if (d) throw new Error(d);
      const h = await huecosEscritorio(page); if (h) throw new Error(h);
    });
  }
  await paso(g, "Ajustes en panel lateral: el engranaje lo abre y Escape lo cierra", app, async () => {
    await page.click("#escAjustesBtn"); await page.waitForTimeout(350);
    const abierto = await page.evaluate(() => ({ visible: document.getElementById("ajustesSeccion").getClientRects().length > 0, foco: document.activeElement?.id, apariencia: document.getElementById("aparienciaPanel").getBoundingClientRect().height }));
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    const cerrado = await page.evaluate(() => ({ visible: document.getElementById("ajustesSeccion").getClientRects().length > 0, foco: document.activeElement?.id }));
    if (!abierto.visible || abierto.foco !== "escAjustesCerrar" || abierto.apariencia < 100 || cerrado.visible || cerrado.foco !== "escAjustesBtn") throw new Error(JSON.stringify({ abierto, cerrado }));
  });
  await paso(g, "la ficha de un activo es un panel lateral y se cierra al pulsar fuera", app, async () => {
    await page.click('#tableBody tr[data-row-id="r-btc"] td.col-value'); await page.waitForTimeout(450);
    const r = await page.evaluate(() => { const f = document.getElementById("assetDetailScreen").getBoundingClientRect(); return { izquierda: Math.round(f.left), derecha: Math.round(f.right), ancho: innerWidth, velo: getComputedStyle(document.getElementById("escVeloFicha")).display }; });
    await page.mouse.click(100, 400); await page.waitForTimeout(400);
    const cerrada = await page.evaluate(() => document.getElementById("assetDetailScreen").hidden);
    if (r.izquierda < 400 || r.derecha !== r.ancho || r.velo !== "block" || !cerrada) throw new Error(JSON.stringify({ ...r, cerrada }));
  });
  await paso(g, "precios en vivo: se mueven la tabla y el saldo", app, async () => {
    const leer = () => page.evaluate(() => [document.querySelector('#tableBody tr[data-row-id="r-btc"] [data-role="rowPrice"]').textContent, document.getElementById("mainValue").textContent]);
    const a = await leer(); await page.waitForTimeout(2200); const b = await leer();
    if (a[0] === b[0] || a[1] === b[1]) throw new Error(JSON.stringify({ a, b }));
  });
  await paso(g, "noticias en bloques: dos filas y 'Ver todas'", app, async () => {
    const r = await page.evaluate(() => { const lista = document.getElementById("newsList"); const vis = [...lista.querySelectorAll(".news-card")].filter((n) => !n.hidden).length; return { vis, total: lista.querySelectorAll(".news-card").length, cols: Number(lista.style.getPropertyValue("--cols")), boton: !document.getElementById("escNoticiasMas").hidden }; });
    const esperadas = Math.min(r.total, r.cols * 2);
    if (r.cols < 2 || r.vis !== esperadas || r.boton !== (r.total > esperadas)) throw new Error(JSON.stringify(r));
  });
  await paso(g, "al estrechar vuelve el movil con su pestana, y al ensanchar el escritorio", app, async () => {
    await page.setViewportSize({ width: 375, height: 780 }); await page.waitForTimeout(500);
    const movil = await page.evaluate(() => ({ barra: getComputedStyle(document.getElementById("tabBar")).display !== "none", escritorio: !document.getElementById("escritorio").hidden, saldo: !!document.querySelector('.tab-section[data-tab="home"] #mainValueCard'), acciones: !!document.querySelector('#inicioBloques [data-bloque="acciones"]'), ajustesRapido: document.getElementById("quickAddBtn").textContent.trim(), noticiasOcultas: document.querySelectorAll("#newsList .news-card[hidden]").length }));
    const d = await desborde(page);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(500);
    const vuelta = await page.evaluate(() => ({ escritorio: !document.getElementById("escritorio").hidden, saldo: !!document.querySelector(".esc-saldo #mainValueCard"), plan: !!document.querySelector('[data-esc-hueco="plan"] #planContent') }));
    if (!movil.barra || movil.escritorio || !movil.saldo || !movil.acciones || movil.ajustesRapido !== "Ajustes" || movil.noticiasOcultas || d || !vuelta.escritorio || !vuelta.saldo || !vuelta.plan) throw new Error(JSON.stringify({ movil, d, vuelta }));
  });
  await app.ctx.close();
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
    const chips = await page.evaluate(() => [...document.querySelectorAll("#portfolioMobileList .wallet-chip")].map((c) => c.textContent.trim()));
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
    const fila = `#portfolioMobileList [data-asset-open="${ethId}"]`;
    await page.click(fila); await page.waitForTimeout(500);
    const acciones = await page.evaluate(() => [...document.querySelectorAll("#assetDetailScreen [data-detail-action]")].map((b) => b.dataset.detailAction));
    if (acciones.includes("buy") || acciones.includes("sell") || !acciones.includes("walletSync")) throw new Error("acciones: " + acciones.join(","));
    await page.click("[data-detail-close]"); await page.waitForTimeout(400);
    await page.click('[data-quick="buy"]'); await page.waitForTimeout(400);
    const opciones = await page.evaluate(() => [...document.querySelectorAll("#tradeSheet [data-trade-field='rowId'] option")].map((o) => o.value));
    const deBilletera = (await filasBilletera(page)).map((f) => f.id);
    if (opciones.some((v) => deBilletera.includes(v))) throw new Error("la compra ofrece posiciones de billetera");
    await cerrarHoja(page); await page.waitForTimeout(300);
    await page.click(fila); await page.waitForTimeout(500);
    await page.click('#assetDetailScreen [data-detail-action="edit"]'); await page.waitForTimeout(500);
    const bloqueo = await page.evaluate(() => ({
      tokens: document.querySelector('#positionEditorPortal [data-editor-field="tokens"]').readOnly,
      crypto: document.querySelector('#positionEditorPortal [data-editor-field="crypto"]').readOnly
    }));
    if (!bloqueo.tokens || !bloqueo.crypto) throw new Error("se puede editar la cantidad o el activo");
    await page.fill('#positionEditorPortal [data-editor-field="investment"]', "4000"); await page.waitForTimeout(200);
    const eth = (await filasBilletera(page)).find((f) => f.id === ethId);
    if (eth.tokens !== "2" || eth.investment !== "4000") throw new Error(`tras editar el coste: ${eth.tokens} / ${eth.investment}`);
    await page.click("#positionEditorPortal [data-editor-close]"); await page.waitForTimeout(400);
    // Se edito desde el detalle: al cerrar el editor se vuelve a el.
    await page.click("[data-detail-close]"); await page.waitForTimeout(400);
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
  const CLAVE = "e2e0123456789abcdef0123456789abcdef0";
  await paso2("clave de CoinStats: solo en este dispositivo, viaja en cada lectura y relee", async () => {
    await abrirPanel();
    const estado = () => page.evaluate(() => ({
      guardada: localStorage.getItem("crypto-dashboard-coinstats-key-v1"),
      on: document.getElementById("coinstatsKeyStatus").classList.contains("is-on"),
      quitar: !document.getElementById("coinstatsKeyClear").hidden,
      campo: document.getElementById("coinstatsKeyInput").value
    }));
    if ((await estado()).on) throw new Error("sale activa sin clave");
    await page.fill("#coinstatsKeyInput", "no es una clave"); await page.click("#coinstatsKeySave"); await page.waitForTimeout(200);
    if ((await estado()).guardada) throw new Error("guardo una clave invalida");
    const antes = app.billetera.claves.length;
    await page.fill("#coinstatsKeyInput", CLAVE); await page.click("#coinstatsKeySave"); await page.waitForTimeout(1800);
    const e = await estado();
    if (e.guardada !== CLAVE || !e.on || !e.quitar || e.campo) throw new Error(JSON.stringify(e));
    // Fuera de las preferencias y de los datos (que se exportan y comparten).
    const fuga = await page.evaluate((k) => ["crypto-dashboard-prefs-v2", "crypto-dashboard-rows-v3"].some((n) => (localStorage.getItem(n) || "").includes(k)), CLAVE);
    if (fuga) throw new Error("la clave se colo en las preferencias o en los datos");
    // Al guardarla se releen las billeteras, y cada lectura la lleva.
    const nuevas = app.billetera.claves.slice(antes);
    if (!nuevas.length || !nuevas.every((k) => k === CLAVE)) throw new Error(`lecturas con clave: ${JSON.stringify(nuevas)}`);
  });
  await paso2("al recargar sigue todo y no se relee de golpe", async () => {
    const antes = app.billetera.llamadas.length;
    await page.reload(); await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({ billeteras: state.wallets.length, chips: document.querySelectorAll("#portfolioMobileList .wallet-chip").length }));
    if (r.billeteras !== 2 || r.chips !== 5) throw new Error(JSON.stringify(r));
    if (app.billetera.llamadas.length !== antes) throw new Error("se releyo sin haber pasado el tiempo");
  });
  await paso2("quitar una billetera borra solo sus posiciones", async () => {
    await abrirPanel();
    await page.click("[data-wallet-delete]"); await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ billeteras: state.wallets.length, deBilletera: state.rows.filter((x) => x.walletId).length, manuales: state.rows.filter((x) => !x.walletId).length }));
    if (r.billeteras !== 1 || r.deBilletera !== 1 || r.manuales !== 6) throw new Error(JSON.stringify(r));
  });
  await paso2("quitar la clave de CoinStats", async () => {
    await page.click("#coinstatsKeyClear"); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ guardada: localStorage.getItem("crypto-dashboard-coinstats-key-v1"), on: document.getElementById("coinstatsKeyStatus").classList.contains("is-on") }));
    if (r.guardada || r.on) throw new Error(JSON.stringify(r));
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

// Sin conexion la app sale de la cache del service worker: todo lo que carga
// index.html (estilos, scripts, iconos, manifest) tiene que estar en APP_SHELL.
{
  const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8");
  const shell = new Set(sw.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/)[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1).replace(/^\.\//, "")));
  const locales = [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map((m) => m[1]);
  const faltan = [...new Set(locales)].filter((u) => !shell.has(u));
  const rotos = [...shell].filter((u) => u && !fs.existsSync(path.join(RAIZ, u)));
  anotar("version", "el service worker guarda todo lo que carga la pagina", faltan.length || rotos.length
    ? `faltan en APP_SHELL: ${faltan.join(", ") || "-"} · no existen: ${rotos.join(", ") || "-"}` : null);
}

const servidor = await arrancarServidor();
const url = `http://127.0.0.1:${servidor.address().port}/index.html`;
// CHROMIUM_PATH: para usar un Chromium ya instalado en vez del de playwright.
const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  await casosSueltos(navegador, url);
  await casosEscritorio(navegador, url);
  for (const ancho of [375, 320]) await recorridoCompleto(navegador, url, ancho);
  for (const ancho of [375, 320]) await casosBilletera(navegador, url, ancho);
} finally {
  await navegador.close();
  servidor.close();
}
const fallos = resultados.filter((r) => r.error);
console.log(`\n${resultados.length} comprobaciones · ${resultados.length - fallos.length} correctas · ${fallos.length} fallidas`);
process.exit(fallos.length ? 1 : 0);
