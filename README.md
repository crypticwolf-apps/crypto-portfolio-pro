# Crypto Portfolio Pro

Aplicación web (PWA instalable, y APK para Android) para seguir una cartera de criptomonedas: precios en vivo, billeteras leídas por su dirección pública, un plan de salida con objetivos, analítica, alertas, noticias y copia de seguridad.

Web: https://cartera.cryptoatalaya.com/

## Características

- **Inicio:** saldo total con su cambio en el periodo (1D, 1S, 1M, 3M, 1A, Todo) y un gráfico del saldo reconstruido con los precios pasados de cada moneda y lo que tenías en cada fecha (compras y ventas registradas y fecha de compra), con una línea discontinua de lo invertido. El cambio del periodo no cuenta como ganancia el dinero metido o sacado. El saldo cuenta hasta el valor nuevo al cambiar y, en el primer arranque, se ven siluetas mientras llegan los precios. Lista de activos con un mini gráfico de 7 días, resumen de hoy, reparto y datos de mercado (BTC, ETH, dominancia, miedo y codicia).
- **Gráficos táctiles:** en el saldo y en la ficha de cada moneda, al tocar y arrastrar (o pasar el ratón) se ven el valor y la fecha de cada momento. La ficha usa precios reales de CoinGecko y pinta la línea en verde o rojo según suba o baje el periodo.
- **Ficha de cada moneda:** precio y gráfico real con tus compras y ventas marcadas y tu precio medio, tu posición, objetivos, mercado (con máximo y mínimo históricos), suministro, categorías, descripción y enlaces oficiales.
- **Precios en vivo** por WebSocket (Binance y otros) y CoinGecko a través de un proxy propio con caché y límite de peticiones.
- **Billeteras:** importa los tokens de una dirección pública (EVM, Solana, Bitcoin) y los mantiene al día.
- **Compras y ventas:** registro de operaciones con coste medio y beneficio realizado.
- **Plan:** objetivos TP1/TP2/TP3 por activo y salida progresiva (cuánto vender en cada objetivo y cuánto se saca).
- **Analítica:** distribución en un anillo que se toca (el centro dice nombre, % y valor), mapa de la cartera (cada moneda del tamaño de su peso y del color de su cambio en 24 h), mejores y peores, categorías, comparativa y rendimiento por periodos.
- **Alertas** de precio por activo, para todos o del valor total.
- **Noticias** del canal de Crypto Atalaya.
- **Copia de seguridad** (en Ajustes y en el menú de acciones rápidas): un archivo JSON con todo (posiciones, operaciones, alertas, billeteras, plan, historial y ajustes) para guardarlo o pasarlo a otro dispositivo; aviso en Inicio si hace más de 30 días de la última. La clave de CoinStats nunca va en la copia.
- **PDF** de la cartera con resumen y gráfico, para descargar o compartir.
- **Apariencia:** imagen de perfil (iniciales, un emoji o una foto), tema claro, oscuro (negro puro) o automático, 6 colores de acento, tamaño de texto y bloques de Inicio ordenables. Moneda base USD o EUR.
- **Tablet y móvil en horizontal** (700 a 1099 px): la app de móvil a dos columnas.
- **Versión de escritorio** (desde 1100 px): toda la app en una página, en bandas a todo el ancho (saldo y gráfico, mercado, posiciones, análisis, compras y ventas, el plan en una tabla y noticias), con Ajustes en un panel lateral.
- Guardado automático en el dispositivo (`localStorage`) y funcionamiento sin conexión (service worker).

## Estructura

- `index.html` y `js/`: la app en 25 scripts clásicos por tema, cargados en orden (`config.js` el primero y `arranque.js` el último). `css/`: estilos (sistema visual, base y una hoja por pantalla). `i18n.js`: textos. `sw.js` y `manifest.webmanifest`: PWA.
- `finance.js`: cálculos puros (compras, ventas, coste medio, saldo e invertido en el tiempo, rentabilidad del periodo y reparto del mapa de la cartera), con pruebas.
- `wallet-core.js` y `api/wallet.js`: lector de billeteras (lógica en el navegador y servidor en Vercel). Con `COINSTATS_API_KEY` lee todos los tokens en 100+ redes; sin ella, usa Alchemy si hay `ALCHEMY_API_KEY`, y si no, los nodos públicos de cada red y mempool.space.
- `api/cg.js`: proxy de CoinGecko (clave en `COINGECKO_API_KEY`, solo rutas permitidas, caché). `api/historial.js`: precios pasados de varias monedas en una sola petición, sobre la misma rejilla de tiempo, para el gráfico del saldo.
- `tests/`: pruebas de extremo a extremo en navegador (`npm run test:e2e`) y unitarias con Vitest (`finance.test.js`, `tests/*.test.js`). Se ejecutan solas en cada push (GitHub Actions).
- `android-build/` (solo en local): proyecto Capacitor para generar el APK (la web vive en `android-build/www`).

Las claves de las APIs viven solo en las variables de entorno de Vercel; el repositorio es público.

## Uso en local

1. `npm install` (solo para las pruebas).
2. Sirve la carpeta con un servidor estático (por ejemplo `npx serve .`) y abre `http://localhost`. Desde `file://` la app funciona, pero sin service worker y llamando al proxy publicado.
3. Pruebas: `npm run test:all`.
