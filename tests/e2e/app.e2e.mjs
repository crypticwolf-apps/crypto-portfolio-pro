// Pruebas de extremo a extremo de la app en un Chromium real.
//
// Arranca la app con datos de usuario realistas (historial de precios,
// operaciones y alertas de los tres tipos) y recorre pestanas, hojas, temas y
// flujos criticos a 375 y 320 px. Toda la red esta simulada: CoinGecko, el
// feed de noticias, Binance (REST y WebSocket), GeckoTerminal y el CDN, cuyos
// ficheros se sirven desde node_modules con la MISMA version que piden las URL
// de app.js (se comprueba al empezar).
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
  const app = fs.readFileSync(path.join(RAIZ, "app.js"), "utf8");
  const desfases = [];
  for (const { paquete } of CDN) {
    const enApp = app.match(new RegExp(`cdn\\.jsdelivr\\.net/npm/${paquete.replace(".", "\\.")}@([\\d.]+)`))?.[1];
    const instalada = JSON.parse(fs.readFileSync(path.join(MODULOS, paquete, "package.json"), "utf8")).version;
    if (enApp !== instalada) desfases.push(`${paquete}: app.js pide ${enApp}, package.json instala ${instalada}`);
  }
  return desfases;
}

// ── Datos simulados ──
const MONEDAS = [
  ["bitcoin", "BTC", "Bitcoin", 60000], ["ethereum", "ETH", "Ethereum", 2500], ["solana", "SOL", "Solana", 150],
  ["cardano", "ADA", "Cardano", 0.5], ["chainlink", "LINK", "Chainlink", 15], ["pepe", "PEPE", "Pepe", 0.00001]
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
  await ctx.route("**/api/cg/**", (r) => proxyCaido ? r.abort()
    : json(r, respuestaCoinGecko(new URL(r.request().url()).pathname.replace(/^.*\/api\/cg\//, ""))));
  await ctx.route("**api.coingecko.com/**", (r) => {
    const ruta = new URL(r.request().url()).pathname.replace(/^\/api\/v3\//, "");
    directas.push(ruta);
    return json(r, respuestaCoinGecko(ruta));
  });
  await ctx.route("**/cryptoatalaya.com/data/feed.json", (r) => json(r, NOTICIAS));
  await ctx.route("**/api/v3/ticker/price**", (r) => json(r, ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "LINKUSDT"].map((symbol) => ({ symbol, price: "1" }))));
  await ctx.route("**api.geckoterminal.com/**", (r) => json(r, { data: [{ attributes: { address: PEPE, price_usd: "0.0000123", volume_usd: { h24: "1000000" }, market_cap_usd: "5000000000" } }] }));
  await ctx.route("**api.alternative.me/**", (r) => json(r, { data: [{ value: "55", value_classification: "Greed", timestamp: String(Math.floor(Date.now() / 1000)) }] }));
  for (const lib of CDN) {
    await ctx.route(lib.patron, (r) => r.fulfill({ path: path.join(MODULOS, lib.paquete, lib.fichero), contentType: "application/javascript" }));
  }
  await ctx.route("**fonts.g*/**", (r) => r.abort());
  return directas;
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
  const directas = await simularRed(ctx, { proxyCaido });
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
  return { ctx, page, errores, directas };
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

const desfases = comprobarVersionesCdn();
if (desfases.length) anotar("versiones", "librerias del CDN alineadas con package.json", desfases.join(" | "));
else anotar("versiones", "librerias del CDN alineadas con package.json", null);

const servidor = await arrancarServidor();
const url = `http://127.0.0.1:${servidor.address().port}/index.html`;
const navegador = await chromium.launch();
try {
  await casosSueltos(navegador, url);
  for (const ancho of [375, 320]) await recorridoCompleto(navegador, url, ancho);
} finally {
  await navegador.close();
  servidor.close();
}
const fallos = resultados.filter((r) => r.error);
console.log(`\n${resultados.length} comprobaciones · ${resultados.length - fallos.length} correctas · ${fallos.length} fallidas`);
process.exit(fallos.length ? 1 : 0);
