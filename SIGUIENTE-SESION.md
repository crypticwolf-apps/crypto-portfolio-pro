# Prompt para continuar en otra sesión

Copia todo lo que hay debajo de la línea y pégalo al empezar la sesión nueva.

---

Continúo el desarrollo de mi app **Crypto Portfolio Pro**.

## El proyecto

- **Carpeta:** `D:\Mega\Proyectos\Proyecto mixto\Portafolio Crypto`
- **Qué es:** PWA de cartera de criptomonedas en JavaScript vanilla, **sin build**.
  Ficheros: `index.html`, `app.js` (~8.400 líneas), `styles.css`, `i18n.js`,
  `finance.js` (cálculos puros + tests con Vitest), `sw.js`.
- **Repositorio:** `crypticwolf-apps/crypto-portfolio-pro` (**público**, no metas
  secretos). Se publica en GitHub Pages mediante un workflow de Actions.
- **Web:** https://crypticwolf-apps.github.io/crypto-portfolio-pro/
- **Idioma:** todo en español y sin acentos en código e i18n, por convención previa.

## Reglas de trabajo (importantes)

1. **Tres copias:** la raíz es la fuente. Tras cada cambio hay que copiar los
   ficheros tocados a `crypto-portfolio-pwa\` y `android-build\www\`.
2. **Subir al terminar cada bloque:** `git add` → `commit` → `git fetch` +
   `git rebase origin/main` → `push`. Nunca `--force`.
3. **Verificar el despliegue:** `gh run list --limit 1`. GitHub falla a veces con
   429/503 al descargar sus propias acciones; se arregla con
   `gh run rerun --failed` (no es fallo del código).
4. **Verificar en el navegador antes de dar nada por bueno**, comprobando
   **visibilidad real** (altura > 0), no solo que el HTML exista en el DOM.

## Trampas ya conocidas (no repetirlas)

- **Especificidad CSS:** hay muchas reglas con ámbito
  `:root[data-density="compact"]` (la vista compacta está siempre activa). Una
  regla nueva sin ese prefijo **queda anulada** y parece que el cambio no se
  aplica. Declara los cambios con el mismo prefijo.
- **Visibilidad de pestañas:** la regla que muestra la pestaña activa
  **enumera los nombres uno a uno**
  (`body[data-active-tab="X"] .tab-section[data-tab="X"]`). Si añades o renombras
  una pestaña hay que añadirla ahí, o quedará invisible aunque su HTML exista.
- **TDZ:** `init()` se llama a mitad de `app.js` (~línea 350). Cualquier `const`
  que se use en el arranque debe declararse **antes** de esa llamada.
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

Pestañas: **Portafolio · Noticias · Plan · Analítica · Más**. Portafolio va en el
centro del menú inferior, destacado y sobresaliendo con relieve 3D.

**Noticias** lee el feed del proyecto hermano *Crypto Atalaya*
(`https://cryptoatalaya.com/data/feed.json`), generado por su bot de Telegram.
Solo lectura, sin claves. El CORS ya está habilitado en el Caddy de ese servidor
(`Access-Control-Allow-Origin: *` limitado a `/data/*`; `/api/*` no lo lleva a
propósito). Muestra hora, categoría, titular e impacto 0-100, con cuerpo
desplegable, filtros por categoría y copia local para leer sin conexión.

Acciones rápidas actuales de Portafolio: **Añadir · Comprar · Vender · Plan**.
El menú inferior "Añadir" (lo abre `#quickAddBtn`) contiene: Nueva posición,
Registrar compra, Registrar venta, Añadir alerta, Descargar PDF, Importar CSV.

> Ya hecho en la sesión anterior: en la cabecera de **Noticias** hay enlaces al
> canal de Telegram y a la web de Crypto Atalaya, y el pie de "Más" describe el
> canal con ambos enlaces.

## Lo que quiero hacer ahora

### 1. Acciones rápidas de Portafolio

- **Sustituir el botón "Plan" por uno de "Añadir activo"**: icono **símbolo +** y
  debajo la etiqueta **"Activo"**. Debe crear una posición nueva directamente
  (ya existe `handleAddRow`).
- **Cambiar el botón "Añadir"** (`#quickAddBtn`): icono de **engranaje** y
  etiqueta **"Ajustes"**. Sigue abriendo el mismo menú inferior.

Resultado: **Ajustes ⚙ · Comprar · Vender · Activo +**

### 2. Menú inferior (barra de navegación)

Sustituir la pestaña **"Más"** (icono de tres puntos) por **"Ajustes"** con icono
de **engranaje**, a juego con el botón anterior.

> Los dos "Ajustes" son **independientes a propósito**: el de acciones rápidas
> abre el menú inferior y la pestaña lleva a la seccion de preferencias. No hay
> que unificarlos.

### 3. Menú "Añadir" (el que abre el engranaje)

- **Quitar** "Nueva posición" (ahora tiene su propio botón +).
- **Quitar** "Registrar compra" y "Registrar venta" (redundantes: ya están en las
  acciones rápidas).
- **Añadir** "Exportar CSV" (ya existe `handleExportCsv`).
- **Añadir** "Compartir PDF": enviar el PDF **directamente** con la hoja de
  compartir del móvil (Web Share API con ficheros,
  `navigator.canShare({ files })`), **sin descargarlo**. Si el dispositivo no lo
  admite, caer a la descarga actual. Base: `handleDownloadPdf`.

Resultado del menú: **Añadir alerta · Descargar PDF · Compartir PDF ·
Exportar CSV · Importar CSV**.

### 4. Ordenación de Posiciones

La opción actual **"Beneficio / Pérdida"** (`sort.pnl`) ordena en realidad por
**porcentaje** (`pnlPct`), lo cual confunde.

- Renombrarla a algo inequívoco de rendimiento, p. ej. **"Rentabilidad %"**.
- **Añadir una opción nueva** que ordene por **beneficio/pérdida en dinero total**
  de cada activo (`metrics.pnlUsd`), con nombre distinto y claro, p. ej.
  **"Ganancia en dinero"**.

`SORT_OPTIONS` está en `app.js`; el `switch` de comparación cerca de la línea
7288; las etiquetas en `i18n.js` (`sort.*`).

## Cómo quiero que trabajes

- Antes de cambios grandes, revisa el código afectado y dime qué has encontrado.
- Verifica en el navegador a **375px y 320px**: visibilidad real, sin scroll
  horizontal y consola sin errores.
- Sube cada bloque terminado y confírmame que el despliegue ha ido bien.
- Si algo de lo que pido choca con lo que ya existe, **dímelo antes de hacerlo**.
