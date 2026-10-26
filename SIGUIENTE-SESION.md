# Prompt para continuar en otra sesión

Copia todo lo que hay debajo de la línea y pégalo al empezar la sesión nueva.

---

Continúo el desarrollo de mi app **Crypto Portfolio Pro**.

## El proyecto

- **Carpeta:** `D:\Mega\Proyectos\Proyecto mixto\Portafolio Crypto`
- **Qué es:** PWA de cartera de criptomonedas en JavaScript vanilla, **sin build**.
  Ficheros: `index.html`, la app en **`js/`** (18 scripts por tema: `config.js`
  primero, `arranque.js` el último), `styles.css`, `i18n.js`, `finance.js`
  (cálculos puros + tests con Vitest), `wallet-core.js` (lógica pura de
  billeteras + tests), `sw.js`, `api/cg.js` (proxy de CoinGecko; clave en
  `COINGECKO_API_KEY`) y `api/wallet.js` (lector de billeteras; clave en
  `ALCHEMY_API_KEY`). Las claves solo en variables de entorno de Vercel.
- **Scripts clásicos, no módulos ES:** la APK abre la app desde `file://` y ahí
  `import`/`export` no cargan. Los 18 ficheros comparten el ámbito global y se
  ejecutan en el orden de `index.html`. Reglas en la cabecera de `js/config.js`;
  un fichero nuevo va en `index.html` (antes de `arranque.js`) y en `APP_SHELL`
  de `sw.js`.
- **Repositorio:** `crypticwolf-apps/crypto-portfolio-pro` (**público**, no metas
  secretos). Vercel despliega solo en cada push a `main`.
- **Web:** https://cartera.cryptoatalaya.com/ (Vercel, unico sitio vivo; despliega solo en cada push a main)
- **Idioma:** todo en español y sin acentos en código e i18n, por convención previa.

## Reglas de trabajo (importantes)

1. **Tres copias:** la raíz es la fuente. Tras cada cambio hay que copiar los
   ficheros tocados a `crypto-portfolio-pwa\` y `android-build\www\` (la
   carpeta `js\` entera; el antiguo `app.js` ya no se usa).
2. **Subir al terminar cada bloque:** `git add` → `commit` → `git fetch` +
   `git rebase origin/main` → `push`. Nunca `--force`.
3. **Verificar el despliegue:** Vercel publica su resultado en el commit de
   GitHub. `gh api repos/crypticwolf-apps/crypto-portfolio-pro/commits/<sha>/status`
   debe dar `state: success` con contexto `Vercel`.
4. **Verificar en el navegador antes de dar nada por bueno**, comprobando
   **visibilidad real** (altura > 0), no solo que el HTML exista en el DOM.
5. **Pruebas:** `npm install` y `npm run test:all` (Vitest + recorrido completo
   en Chromium a 375 y 320 px con datos realistas, `tests/e2e/app.e2e.mjs`).
   GitHub Actions las pasa solas en cada push: si sale una cruz roja en el
   commit, algo se ha roto. Vercel publica igualmente, no espera a las pruebas.

## Trampas ya conocidas (no repetirlas)

- **Especificidad CSS:** hay muchas reglas con ámbito
  `:root[data-density="compact"]` (la vista compacta está siempre activa). Una
  regla nueva sin ese prefijo **queda anulada** y parece que el cambio no se
  aplica. Declara los cambios con el mismo prefijo.
- **Visibilidad de pestañas:** la regla que muestra la pestaña activa
  **enumera los nombres uno a uno**
  (`body[data-active-tab="X"] .tab-section[data-tab="X"]`). Si añades o renombras
  una pestaña hay que añadirla ahí, o quedará invisible aunque su HTML exista.
- **TDZ (resuelto de raíz):** `init()` está en la **última línea** de
  `js/arranque.js`, el último script, así que toda `const`/`let` existe antes
  del arranque. Rompió la app en blanco cuatro veces cuando estaba a mitad del
  antiguo `app.js`. **No moverla.** Y ningún fichero puede usar al cargar (fuera
  de una función) algo declarado en un fichero posterior.
- **Probar con datos reales:** arrancar con datos de demostración vírgenes no
  recorre todos los caminos (sin historial de precios, sin operaciones, sin
  alertas). Un fallo de arranque pasó todas las pruebas así y rompió la app de
  verdad. Las pruebas de arranque deben sembrar historial, operaciones y alertas.
- **Borrados en bloque:** limpiar por rangos ya se ha llevado por delante
  funciones y estilos vecinos dos veces. Tras cualquier limpieza, comprobar que
  las clases clave conservan estilos (`.tp-fold-sum`, `.more-fold-sum`,
  `.theme-picker`, `.insight-item`, `.tab-bar` deben ser `flex`/`fixed`).
- **Entorno de vista previa:** el panel del navegador está oculto, así que **las
  transiciones CSS se congelan** y `getComputedStyle` devuelve el valor anterior.
  Para medir colores inyecta antes `*{transition:none !important}`. Las capturas
  suelen dar timeout; medir por geometría es más fiable.

## Sistema visual ya consolidado (respetarlo)

- Radios: **24px** contenedor · **14px** tarjeta · **10px** control.
- Ritmo vertical **8px** en las cinco pestañas.
- **Dos** tamaños de título: 15,2px sección y 13,76px cabecera plegable.
- Tipografía en escala de 6 pasos (`0.62 / 0.72 / 0.82 / 0.95 / 1.05 / 1.3 rem`).
  **Ninguna etiqueta por debajo de 0,6rem (9,6px).**
- Todas las cifras con `font-variant-numeric: tabular-nums`.
- Tres temas: claro / oscuro / **OLED** (negro puro, tokens `--glass-*` neutros).
- Modo privacidad (botón del ojo): oculta importes propios; los precios de
  mercado y los objetivos de TP sí se ven.

## Estado actual

Pestañas: **Noticias · Plan · Portafolio · Analítica · Ajustes**. Portafolio en el
centro del menú inferior, destacado y sobresaliendo.

- **Acciones rápidas:** Ajustes ⚙ · Comprar · Vender · Activo +.
- **Menú del engranaje:** Añadir alerta · Descargar PDF · Compartir PDF ·
  Exportar CSV · Importar CSV.
- **Precios en vivo:** WebSocket de Binance (Kraken de reserva), GeckoTerminal
  para tokens DEX por red + contrato, CoinGecko para el resto y para metadatos.
  Interruptor y estado en Ajustes → Preferencias y Diagnóstico.
- **Alertas** guardadas, editables y borrables (Ajustes → Alertas): por TP de un
  activo, por TP en todos los activos, por precio, o por valor total de cartera.
- **Compras y ventas** editables y borrables en Analítica; borrar o editar
  deshace su efecto exacto sobre la posición.
- **Noticias** del feed de Crypto Atalaya (`cryptoatalaya.com/data/feed.json`,
  CORS `*` en `/data/*`). Sin etiquetas ni enlace a la fuente en la tarjeta.
- **Ordenación:** "Rentabilidad %" (`pnlPct`) y "Ganancia en dinero" (`pnlUsd`).
- **Billeteras (fase 1):** se pega una dirección pública (Ethereum y 6 redes
  compatibles, Solana o Bitcoin) desde Activo +, el menú ⚙ o Ajustes →
  Billeteras; vista previa con casillas y basura oculta; coste "lo pongo yo" o
  "precio de hoy". Reglas: la cantidad la marca la blockchain (sin Comprar/Vender
  en esas posiciones, cantidad bloqueada en el editor); si bajan los tokens el
  coste baja en proporción; si suben, lo nuevo entra al precio del momento.
  Los tokens se identifican por **red + contrato, nunca por nombre o símbolo**
  (`isDexOnlyRow`): un "USDC" falso no puede valer como el real. Frases semilla
  y claves privadas se detectan, se borran del campo y se avisa.

## Pendiente

- **Lector de billeteras SIN cuenta (por defecto):** Alchemy no dejaba crear
  cuenta, así que `api/wallet.js` lee con los nodos públicos de cada red
  (publicnode y oficiales de respaldo): en EVM, nativo + top 500 de CoinGecko
  por Multicall3 (ABI hecha a mano, comprobada byte a byte contra viem); en
  Solana, `getTokenAccountsByOwner` (todos los tokens; los no listados se
  valoran en GeckoTerminal). Falta **probarlo con una dirección real** en la
  web (desde el entorno de Claude no hay salida a esos nodos). Si un nodo deja
  de funcionar, la lista está en `PUBLIC_RPCS`.
- **Alchemy (opcional):** si algún día se pone `ALCHEMY_API_KEY` en Vercel (+
  Redeploy), se usa para encontrar también tokens pequeños de EVM; si falla,
  se vuelve solo al modo sin cuenta.
- **Clave de CoinGecko:** `COINGECKO_API_KEY` en Vercel sigue sin poner
  (funciona sin ella, con menos límite y sin precio histórico por fecha).
- **Billeteras, fase 2:** xpub de Bitcoin (Ledger/Trezor), escanear QR, coste
  estimado por fecha de llegada de cada token, más redes (Tron, TON, Sui).

- **Fase 4 de precios:** ATH, ATL, supply, categorías, descripción y enlaces
  oficiales de CoinGecko en el detalle del activo.
- **GitHub Pages:** el workflow ya no existe, pero la copia vieja sigue servida
  hasta poner Settings → Pages → Source en *None*.

## Cómo quiero que trabajes

- Antes de cambios grandes, revisa el código afectado y dime qué has encontrado.
- Verifica en el navegador a **375px y 320px**: visibilidad real, sin scroll
  horizontal y consola sin errores.
- Sube cada bloque terminado y confírmame que el despliegue ha ido bien.
- Si algo de lo que pido choca con lo que ya existe, **dímelo antes de hacerlo**.
