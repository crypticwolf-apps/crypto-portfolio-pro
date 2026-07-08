// Service worker de la PWA: app shell offline + estrategias por tipo de recurso.
//  - Shell mismo origen ....... network-first con timeout corto: cada deploy
//    llega solo a los dispositivos instalados; sin red se sirve la caché.
//  - Fuentes y CDNs ........... stale-while-revalidate (cache-first efectivo).
//  - APIs de precios .......... network-first; si la red falla se devuelve la
//    última respuesta cacheada marcada con "X-SW-Fallback: 1" para que la app
//    la etiquete como datos sin conexión (nunca como precio en tiempo real).
const VERSION = "v8";
const SHELL_CACHE = `crypto-portfolio-shell-${VERSION}`;
const CDN_CACHE = `crypto-portfolio-cdn-${VERSION}`;
const API_CACHE = `crypto-portfolio-api-${VERSION}`;
const ACTIVE_CACHES = [SHELL_CACHE, CDN_CACHE, API_CACHE];

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./i18n.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

// Hosts de recursos estáticos externos (fuentes, librerías, iconos de monedas).
const CDN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "assets.coingecko.com",
  "coin-images.coingecko.com",
];

// Hosts de datos de mercado (precios + indice de miedo y codicia).
const API_HOSTS = ["api.coingecko.com", "api.alternative.me"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // No fallar la instalación si algún recurso opcional no está disponible.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !ACTIVE_CACHES.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isCacheableResponse(response) {
  return response && (response.ok || response.type === "opaque");
}

// Con red lenta no se espera indefinidamente: pasado el timeout se sirve caché.
const SHELL_NETWORK_TIMEOUT_MS = 3500;

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sw-network-timeout")), timeoutMs);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// GitHub Pages sirve con max-age=600: sin esto, la caché HTTP del navegador
// puede devolver copias de hasta 10 min tras un deploy aunque el SW sea
// network-first. "no-cache" fuerza revalidación con el origen (ETag → 304).
function buildFreshRequest(request) {
  if (request.mode === "navigate") {
    // Un Request de navegación no se puede clonar: se recrea por URL.
    return new Request(request.url, { cache: "no-cache", credentials: "same-origin" });
  }
  return new Request(request, { cache: "no-cache" });
}

// Shell: network-first. Garantiza que los cambios desplegados se ven en la
// siguiente apertura; si no hay red (o tarda) se cae a la copia cacheada y
// las navegaciones tienen como último recurso el index.html precacheado.
async function handleShellRequest(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetchWithTimeout(buildFreshRequest(request), SHELL_NETWORK_TIMEOUT_MS);
    if (isCacheableResponse(response) && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) {
      return cached;
    }

    if (request.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

// CDNs: stale-while-revalidate. Sirve rápido desde caché y refresca detrás.
async function handleCdnRequest(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const response = await network;
  return response || Response.error();
}

// APIs de precios: network-first. El fallback cacheado se marca con un header
// para que la aplicación lo presente como "datos sin conexión".
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-SW-Fallback", "1");
      const body = await cached.blob();
      return new Response(body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(handleShellRequest(req));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(handleCdnRequest(req));
    return;
  }

  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(handleApiRequest(req));
    return;
  }

  // Cualquier otro origen: comportamiento por defecto del navegador.
});
