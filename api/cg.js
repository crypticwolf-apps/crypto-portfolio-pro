// =============================================================================
// Proxy serverless de CoinGecko (Vercel).
// -----------------------------------------------------------------------------
// La PWA es estática y llama a CoinGecko desde el navegador; una clave metida
// ahí quedaría expuesta. Este proxy es el único que habla con CoinGecko:
//
//   · Guarda la clave demo como variable de entorno DEL SERVIDOR
//     (COINGECKO_API_KEY), nunca en el bundle del cliente.
//   · Cachea las respuestas en memoria y con Cache-Control, así el coste hacia
//     CoinGecko NO crece con el número de usuarios y se respeta su límite.
//   · Los precios históricos por fecha se cachean como INMUTABLES: el precio de
//     un día pasado no cambia nunca.
//   · CORS abierto para que también funcione desde la APK (origin file://).
//
// Funciona SIN clave (límite más bajo y sin histórico) y CON clave (desbloquea
// /coins/{id}/history y sube el límite). Fichero autocontenido, sin imports.
//
// La app llama a `/api/cg/<ruta-de-coingecko>?<params>`. Un rewrite de
// vercel.json lo redirige aquí pasando la ruta en el parámetro `cgpath`.
// =============================================================================

const CG_BASE = 'https://api.coingecko.com/api/v3/';

// Solo se permiten las rutas que la app usa de verdad, para que el proxy no se
// convierta en un CoinGecko abierto para cualquiera.
const ALLOWED = [
  /^simple\/price$/,
  /^coins\/markets$/,
  /^coins\/list$/,
  /^coins\/[^/]+$/,
  /^coins\/[^/]+\/history$/,
  /^coins\/[^/]+\/market_chart$/,
  /^coins\/[^/]+\/market_chart\/range$/,
  /^search$/,
  /^global$/,
];

/** TTL (ms) y Cache-Control según el tipo de dato. */
function cachePolicy(cgPath) {
  if (/\/history$/.test(cgPath) || /\/market_chart(\/range)?$/.test(cgPath)) {
    // Precio pasado: inmutable. Se cachea un año en CDN y navegador.
    return { ttlMs: 365 * 24 * 3600_000, header: 'public, max-age=31536000, immutable' };
  }
  if (cgPath === 'search' || cgPath === 'global' || cgPath === 'coins/list') {
    return { ttlMs: 5 * 60_000, header: 'public, s-maxage=300, stale-while-revalidate=600' };
  }
  // Precios vivos: 30 s con revalidación en segundo plano.
  return { ttlMs: 30_000, header: 'public, s-maxage=30, stale-while-revalidate=120' };
}

// Cache en memoria (sobrevive entre invocaciones de una instancia caliente).
const store = new Map();
const MAX_ENTRIES = 500;

function readCache(key, ttlMs) {
  const hit = store.get(key);
  if (!hit) return null;
  // Aunque haya caducado se conserva como respaldo "stale" por si CoinGecko falla.
  return { value: hit.value, stale: Date.now() - hit.at > ttlMs };
}

function writeCache(key, value) {
  if (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(key, { at: Date.now(), value });
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
    res.statusCode = 405;
    res.json({ error: 'Método no permitido. Usa GET.' });
    return;
  }

  const parsed = new URL(req.url, 'http://localhost');
  const params = parsed.searchParams;

  // El rewrite deja la ruta de CoinGecko en `cgpath`; el resto son sus params.
  const cgPath = (params.get('cgpath') || '').replace(/^\/+|\/+$/g, '');
  params.delete('cgpath');
  params.delete('path');

  if (!cgPath || !ALLOWED.some((re) => re.test(cgPath))) {
    res.statusCode = 400;
    res.json({ error: `Ruta no permitida: ${cgPath || '(vacía)'}` });
    return;
  }

  const key = process.env.COINGECKO_API_KEY;
  if (key) params.set('x_cg_demo_api_key', key);

  const query = params.toString();
  const target = `${CG_BASE}${cgPath}${query ? `?${query}` : ''}`;
  const policy = cachePolicy(cgPath);

  // 1) Cache fresca: se sirve sin tocar CoinGecko.
  const cached = readCache(target, policy.ttlMs);
  if (cached && !cached.stale) {
    res.setHeader('Cache-Control', policy.header);
    res.setHeader('X-Proxy-Cache', 'hit');
    res.json(cached.value);
    return;
  }

  // 2) Se pide a CoinGecko.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let upstream;
    try {
      upstream = await fetch(target, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (upstream.status === 429 || upstream.status >= 500) {
      // Límite o caída de CoinGecko: si hay dato viejo, se sirve marcado.
      if (cached) {
        res.setHeader('X-Proxy-Cache', 'stale');
        res.json(cached.value);
        return;
      }
      res.statusCode = upstream.status;
      res.json({ error: `CoinGecko respondió ${upstream.status}` });
      return;
    }

    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.json({ error: `CoinGecko respondió ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    writeCache(target, data);
    res.setHeader('Cache-Control', policy.header);
    res.setHeader('X-Proxy-Cache', cached ? 'revalidated' : 'miss');
    res.json(data);
  } catch (err) {
    // Red caída: último recurso, el dato viejo si lo hay.
    if (cached) {
      res.setHeader('X-Proxy-Cache', 'stale');
      res.json(cached.value);
      return;
    }
    res.statusCode = 502;
    res.json({ error: err instanceof Error ? err.message : 'Error en el proxy de datos.' });
  }
};
