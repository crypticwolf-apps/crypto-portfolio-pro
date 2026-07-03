# Crypto Portfolio Pro

Aplicación web (PWA instalable) para gestionar inversiones en criptomonedas: tabla editable de posiciones, precios en vivo desde CoinGecko, objetivos de take profit con señales y alertas, gráficos de distribución y evolución, y exportación CSV/PDF.

## Características

- Tabla avanzada: búsqueda asistida contra CoinGecko, favoritos, ordenación por columna, columnas mostrables/ocultables (persistidas).
- Precios en vivo con auto-refresh configurable (15s – 24h), límite de peticiones y reintentos con backoff.
- Señales de TP por fila y alertas al alcanzar objetivos (TP1/TP2/TP3).
- Resumen e insights: PnL agregado, top/peores activos (actual y 24h), activo más volátil.
- Barra fija al hacer scroll con valor total, PnL y estado de API/guardado.
- Gráficos (Chart.js, carga diferida): dona de distribución y línea de evolución con rangos 1h–total.
- Moneda base USD/EUR con conversión del portafolio, 3 idiomas (es/en/fr), tema claro/oscuro.
- Importación/exportación CSV y PDF con resumen, KPIs y gráfico de distribución.
- Guardado automático en `localStorage`; funciona offline como PWA (service worker con cache del app shell).

## Estructura

- Carpeta raíz y `crypto-portfolio-pwa/`: la app (copias sincronizadas). `index.html`, `app.js`, `i18n.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, iconos.
- `android-build/`: proyecto Capacitor para generar el APK (la web vive en `android-build/www`). Ver `crypto-portfolio-pwa/COMO-GENERAR-APK.md`.

## Uso

1. Sirve la carpeta con un servidor estático y abre `http://localhost` (necesario para el service worker; desde `file://` la app funciona pero sin PWA).
2. Añade o edita posiciones; los precios se sincronizan automáticamente.
3. Usa «Actualizar precios» para forzar una sincronización completa.

## Nota

Si el navegador bloquea llamadas a la API desde `file://`, sirve la carpeta con un servidor estático local (por ejemplo `npx serve .`).
