# Prompt para continuar en otra sesión

Copia todo lo que hay debajo de la línea y pégalo al empezar la sesión nueva.

---

Continúo el desarrollo de mi app **Crypto Portfolio Pro**.

## El proyecto

- **Carpeta:** `D:\Mega\Proyectos\Proyecto mixto\Portafolio Crypto`
- **Qué es:** PWA de cartera de criptomonedas en JavaScript vanilla, **sin build**.
  Ficheros: `index.html`, la app en **`js/`** (25 scripts por tema: `config.js`
  primero, `arranque.js` el último), **`css/`** (estilos: `tokens.css` sistema visual, `base.css`,
  `componentes.css` y una hoja por pantalla: inicio, ajustes, hojas, detalle,
  analitica, plan, noticias, tablet y escritorio), `i18n.js`, `finance.js`
  (cálculos puros + tests con Vitest), `wallet-core.js` (lógica pura de
  billeteras + tests), `sw.js`, `api/cg.js` (proxy de CoinGecko; clave en
  `COINGECKO_API_KEY`), `api/historial.js` (precios pasados de todas las
  monedas en una petición, para el gráfico del saldo; usa la misma clave) y
  `api/wallet.js` (lector de billeteras; claves de CoinStats/Alchemy). Las
  claves solo en variables de entorno de Vercel.
- **Nombre:** **Crypto Portfolio Pro** en todas partes (manifest, título, PDF);
  bajo el icono, "Crypto Pro".
- **Scripts clásicos, no módulos ES:** la APK abre la app desde `file://` y ahí
  `import`/`export` no cargan. Los 25 ficheros comparten el ámbito global y se
  ejecutan en el orden de `index.html`. Reglas en la cabecera de `js/config.js`;
  un fichero nuevo va en `index.html` (antes de `arranque.js`) y en `APP_SHELL`
  de `sw.js`.
- **Repositorio:** `crypticwolf-apps/crypto-portfolio-pro` (**público**, no metas
  secretos). Vercel despliega solo en cada push a `main`.
- **Web:** https://cartera.cryptoatalaya.com/ (Vercel, unico sitio vivo; despliega solo en cada push a main)
- **Idioma:** todo en español y sin acentos en código e i18n, por convención previa.

## Reglas de trabajo (importantes)

1. **Tres copias:** la raíz es la fuente. Tras cada cambio hay que copiar los
   ficheros tocados a `crypto-portfolio-pwa\` y `android-build\www\` (las
   carpetas `js\` y `css\` enteras; el antiguo `app.js` ya no se usa). Al
   terminar, dime siempre la lista de ficheros a copiar o borrar.
2. **Subir al terminar cada bloque:** `git add` → `commit` → `git fetch` +
   `git rebase origin/main` → `push`. Nunca `--force`.
3. **Verificar el despliegue:** Vercel publica su resultado en el commit de
   GitHub. `gh api repos/crypticwolf-apps/crypto-portfolio-pro/commits/<sha>/status`
   debe dar `state: success` con contexto `Vercel`.
4. **Verificar en el navegador antes de dar nada por bueno**, comprobando
   **visibilidad real** (altura > 0), no solo que el HTML exista en el DOM.
5. **Pruebas:** `npm install` y `npm run test:all` (Vitest + recorrido completo
   en Chromium a 375 y 320 px y en escritorio con datos realistas,
   `tests/e2e/app.e2e.mjs`; la red está simulada, incluido `api/historial`).
   GitHub Actions las pasa solas en cada push: si sale una cruz roja en el
   commit, algo se ha roto. Vercel publica igualmente, no espera a las pruebas.

## Trampas ya conocidas (no repetirlas)

- **Especificidad CSS:** todas las hojas de `css/` usan el prefijo
  `:root[data-ui]` (y `:root[data-ui][data-theme]` en `hojas.css`). Una regla
  nueva sin ese prefijo **queda anulada** y parece que el cambio no se aplica.
- **Letra Inter en local:** si la máquina tiene Inter instalada, los tests no
  ven lo que ve la CI (que usa una letra de reserva más ancha). Para
  reproducirlo, excluir Inter con fontconfig (`FONTCONFIG_FILE`).
- **Visibilidad de pestañas:** la regla que muestra la pestaña activa
  **enumera los nombres uno a uno**
  (`body[data-active-tab="X"] .tab-section[data-tab="X"]`, en `css/base.css`). Si añades o renombras
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
  `.insight-item` deben ser `flex`; `.barra-inferior`, `fixed`).
- **Escritorio mueve piezas:** desde 1100 px, `js/escritorio.js` saca tarjetas de
  sus pestañas y las coloca en `#escritorio` (y las devuelve al estrechar).
  Una tarjeta nueva de Inicio que deba verse en escritorio necesita su hueco
  en `escPiezas()` y en el HTML de `#escritorio`.
- **Service worker:** cada fichero nuevo que cargue `index.html` va en
  `APP_SHELL` y hay que subir `VERSION` (la prueba e2e lo comprueba).
  `/api/historial` va siempre a la red (no se cachea ahí).
- **Cifras animadas:** el saldo (`#mainValue`) y el de la barra fija tardan
  650 ms en llegar al valor nuevo (`animarCifra` en `js/utilidades.js`). Una
  prueba que lea el texto justo después de un cambio verá un valor intermedio:
  esperar o probar `animarCifra` directamente.
- **Esqueletos de carga:** una fila "espera precio" si tiene `coinId`, aún no
  tiene precio y su estado es `idle`/`loading` (`esperaPrecio`); el saldo
  carga si ninguna tiene precio todavía (`saldoCargando`). Lo que se calcule
  con precios (saldo, resultado, ganancia) debe mirar eso para no enseñar
  "0,00" o "-100 %" en el primer arranque.
- **Rendimiento con precios en vivo (cada segundo):** no leer medidas
  (`clientWidth`, `scrollWidth`...) en lo que se pinta en cada tick: obliga a
  recalcular el diseño de toda la página. Por eso: `fitAmount` usa un ancho
  de ventana guardado, el gráfico del saldo y el mapa guardan su medida (se
  renueva al cambiar de tamaño) y `ajustarTablaEscritorio` mira el plazo
  antes de medir. Para escribir HTML en cada tick, `pintarHtml(nodo, html)`
  (utilidades.js): no toca el DOM si no cambia. El gráfico del saldo solo se
  redibuja si la línea se movería un píxel (`firmaGraficoSaldo`). El saldo
  solo se anima en saltos de 0,5 % o más (`CIFRA_SALTO_MIN`). El destello de
  precios cambia el color de golpe (`steps`): un fundido repintaba la tabla en
  cada fotograma. En escritorio las bandas fuera de la pantalla llevan
  `content-visibility: auto` (por eso, medidas con la página sin desplazar
  pueden dar textos "pisados" que no existen: comprobar haciendo scroll).
  Medir con la CPU frenada ×4 (CDP `Emulation.setCPUThrottlingRate`).
- **Simulador de WebSocket de Playwright:** guarda los mensajes dentro de la
  página y la memoria sube sola; para buscar fugas, generar los ticks dentro
  de la app (`applyLiveTick`).
- **Tabla de posiciones de escritorio:** escalones por ancho en
  escritorio.css (1599, 1439, 1279 px) y, si aun no cabe (letra de reserva,
  cifras enormes), `data-apretada` 1-3 (menos relleno, sin Peso, sin 7 d).
  La prueba e2e comprueba de 1100 a 1600 px con una posición de millones.
- **Entorno de vista previa:** el panel del navegador está oculto, así que **las
  transiciones CSS se congelan** y `getComputedStyle` devuelve el valor anterior.
  Para medir colores inyecta antes `*{transition:none !important}`. Las capturas
  suelen dar timeout; medir por geometría es más fiable.

## Sistema visual ya consolidado (respetarlo)

- Todo sale de `css/tokens.css`: colores (`--c-*`), radios (`--r-xl` 24px
  contenedor · `--r-md` 14px tarjeta · `--r-sm` 10px control · `--r-pill`),
  espaciado (`--tarjeta-pad`, `--bloque-gap`) y letra **Inter**.
- Todas las cifras con `font-variant-numeric: tabular-nums`.
- Temas: claro / oscuro (**siempre negro puro**, sin opción OLED aparte) /
  automático. 6 colores de acento y 3 tamaños de texto. La densidad es siempre
  la cómoda (la opción se quitó). Contraste de texto ≥ 4,5:1.
- Modo privacidad (botón del ojo): oculta importes propios; los precios de
  mercado y los objetivos de TP sí se ven.

## Estado actual

Pestañas (móvil): **Noticias · Plan · Portafolio · Analítica · Ajustes**, con
Portafolio en el centro del menú inferior.

- **Inicio:** saldo con su cambio en el periodo (1D · 1S · 1M · 3M · 1A · Todo) y
  gráfico del saldo **reconstruido con precios pasados** (`js/historial.js` +
  `api/historial.js`): en cada fecha cuenta lo que tenías según las compras y
  ventas registradas y la fecha de compra de cada posición (sin fecha, todo el
  periodo). El % del periodo no cuenta como ganancia el dinero metido o sacado
  (Dietz simple, `CryptoFinance.rentabilidadPeriodo`). 1D usa la variación 24 h
  y Todo el resultado neto. Sin datos (o si CoinGecko corta la respuesta y lo
  que falta pesa más del 10 %), el gráfico usa el historial guardado en el
  dispositivo. Máximo un año (límite de CoinGecko sin plan de pago).
- **Gráficos táctiles** (`dibujarGrafico` en `js/graficos.js`): en Inicio y en la
  ficha, tocar y arrastrar (o pasar el ratón, o las flechas) muestra una línea
  con el valor y la fecha; en modo privado el saldo sale como ••••. Mientras se
  mira, el gráfico no se redibuja (se aplica al soltar).
- **Ficha de un activo:** gráfico con precios reales de CoinGecko por rango
  (`serieFicha`, mismo `api/historial.js`), línea verde si el periodo sube y
  roja si baja, y el cambio del rango en el chip (1D sigue siendo 24 h).
  Además (`js/infomoneda.js`, CoinGecko `coins/{id}`, guardado 1 h): máximo y
  mínimo históricos con su distancia y fecha, valoración diluida, suministro
  (barra de lo emitido), categorías, descripción (texto plano; en inglés si no
  hay en español) y enlaces oficiales (solo https).
- **Buscador de monedas** (`js/buscador.js`, editor de posiciones): resultados en
  cada letra de un índice local (las 250 principales, renovado cada día y
  cargado a los 5 s de abrir la app, más las de la cartera); CoinGecko
  `/search` directo al proxy, fuera de la cola de precios, cancelando la
  anterior; populares con el campo vacío; flechas, Enter y Escape.
- **Acciones rápidas:** Más ⋯ (abre el menú de acciones) · Comprar · Vender ·
  Activo + (en escritorio, "Más acciones").
- **Menú de acciones:** Añadir alerta · Añadir billetera · Descargar PDF ·
  Compartir PDF · Guardar copia · Restaurar copia. (El CSV se quitó: la copia
  de seguridad lo sustituye entero.)
- **Copia de seguridad** (`js/copia.js`, Ajustes → Copia de seguridad y
  exportar): un JSON con posiciones, operaciones, alertas, billeteras, plan,
  historial y ajustes; restaurar reemplaza todo (con confirmación) y recarga.
  **La clave de CoinStats nunca va en la copia.** Aviso en Inicio si la última
  copia tiene más de 30 días (o nunca hubo y la app lleva una semana en uso);
  "Más tarde" lo pospone una semana.
- **Tablet y móvil en horizontal (700 a 1099 px, `css/tablet.css`):** la app de
  móvil a dos columnas: Inicio (saldo, gráfico y acciones a todo el ancho; el
  resto en columnas), Analítica, Plan y Noticias; Ajustes y la ficha, en una
  columna centrada. Solo CSS: por debajo manda el móvil y desde 1100 px el
  escritorio.
- **Analítica:** mejores y peores en un bloque con selector "Desde la compra /
  Últimas 24 h"; si todos ganan, la lista se llama "Los que menos ganan".
  Compras y ventas: solo los meses con actividad, en barras con su importe.
  El anillo de distribución se toca (o se pasa el ratón): resalta el trozo y el
  centro dice nombre, % y valor. **Mapa de la cartera** (treemap,
  `CryptoFinance.mapaRectangulos` + `renderMapaCartera`): 12 monedas como
  mucho y el resto en "Otros", área = peso, color = cambio en 24 h (gris en 0,
  más intenso hasta ±8 %); tocar un bloque abre su ficha. En tablet ocupa las
  dos columnas y en escritorio tiene su banda (`data-esc-hueco="mapa"`).
- **Mejoras visuales (v35):** mini gráfico de 7 días en cada activo (lista de
  Inicio desde 360 px y columna "7 d" de la tabla; viene de
  `sparkline_in_7d` de `coins/markets` y se guarda reducido en la fila);
  línea discontinua de lo invertido en el gráfico del saldo
  (`CryptoFinance.serieInvertido`); compras y ventas como puntos y precio
  medio como línea en el gráfico de la ficha (solo si caben en la escala);
  saldo que cuenta hasta el valor nuevo; esqueletos en el primer arranque;
  imagen de perfil en Apariencia: iniciales, emoji o foto (recortada a 128 px
  en JPEG, en `prefs.avatarFoto`, así que viaja en la copia de seguridad).
- **Plan (móvil):** cada activo con su logo, cantidad y precio medio cortos, y
  una barra del precio medio al objetivo más alto con el siguiente objetivo.
- **Noticias:** etiqueta "Impacto alto / medio / bajo" y separadores por día
  (Hoy, Ayer...; en escritorio no).
- **Escritorio (desde 1100 px):** toda la app en una página, en bandas a todo el
  ancho: cabecera fija · aviso de copia (si toca) · saldo y gráfico | resumen y
  rendimiento · mercado · posiciones (tabla) · análisis (distribución | mejores
  y peores | comparativa, y debajo las categorías en columnas; por debajo de
  1500 px, comparativa y categorías a todo el ancho) · mapa de la cartera ·
  compras y ventas (el resumen se queda fijo al bajar por la lista) · plan
  (tabla, una fila por activo; sus líneas pequeñas se parten por los "·") ·
  noticias. El aviso "Sincronizando..." sale abajo a la izquierda. Ajustes en panel lateral y la
  ficha de un activo también. Comprobar de 1100 a 2560 px.
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

- **Lo que el usuario NO quiere (no proponerlo):** notificaciones del sistema,
  botón de deshacer, informe fiscal, sincronizar entre dispositivos y más redes
  de billetera.

- **Clave de CoinStats DENTRO de la app:** Vercel le pedía plan Pro para las
  variables de entorno, así que el usuario pega su clave en Ajustes →
  Billeteras. Se guarda solo en su dispositivo (`COINSTATS_KEY_STORAGE`, fuera
  de prefs y datos) y la app la manda en la cabecera `X-CoinStats-Key` a
  `api/wallet.js`, que la reenvía a CoinStats y no la guarda. Con clave propia
  la respuesta no se cachea en la CDN. Si CoinStats la rechaza o no hay
  créditos, se lee sin CoinStats y la app avisa (`warning`). **Nunca meter la
  clave en el repositorio: es público.**
- **CoinStats en el servidor (alternativa):** el modo sin
  cuenta solo mira 9 redes y las 500 monedas principales, y al usuario le
  faltaban muchos activos. Con `COINSTATS_API_KEY` en Vercel (+ Redeploy) el
  lector usa CoinStats (`/wallet/balance`, `connectionId=all`, 40 créditos por
  lectura): todos los tokens en 100+ redes. Formato verificado con su OpenAPI
  oficial (paquete npm `coinstats-cli`) y con una respuesta real de 215 tokens.
  La clave se genera en https://openapi.coinstats.app. Las billeteras se
  releen solas como mucho cada hora (`WALLET_STALE_MS`) para no gastar
  créditos. Lo que CoinGecko no lista sale sin marcar en la vista previa.
- **Pendiente de billeteras:** direcciones de otras redes (Tron, TON, XRP,
  Cardano, Sui…): CoinStats las lee, pero la app aún solo acepta 0x, Solana y
  Bitcoin; y xpub de Bitcoin (CoinStats lo soporta).
- **Lector de billeteras SIN cuenta (respaldo):** Alchemy no dejaba crear
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
- **Clave de CoinGecko:** `COINGECKO_API_KEY` en Vercel (sin confirmar si ya
  está puesta). Funciona sin ella, pero con menos llamadas por minuto: el
  gráfico del saldo puede tardar en completarse con muchas monedas, y sin ella
  no hay precio histórico por fecha de más de un año. La clave Demo es gratis.
- **Billeteras, fase 2:** xpub de Bitcoin (Ledger/Trezor), escanear QR, coste
  estimado por fecha de llegada de cada token, más redes (Tron, TON, Sui).

- **GitHub Pages:** el workflow ya no existe, pero la copia vieja sigue servida
  hasta poner Settings → Pages → Source en *None*.

## Cómo quiero que trabajes

- Antes de cambios grandes, revisa el código afectado y dime qué has encontrado.
- Verifica en el navegador a **375px y 320px**, en tablet (**700 a 1099px**,
  también en horizontal) y en escritorio (**1100 a 2560px**), en claro y oscuro: visibilidad real, sin scroll horizontal y
  consola sin errores.
- Sube cada bloque terminado y confírmame que el despliegue ha ido bien.
- Si algo de lo que pido choca con lo que ya existe, **dímelo antes de hacerlo**.
