# Barra de navegación en tiles webview · diseño

Fecha: 2026-09-29 · Pedido de Abel: «quiero que el navegador que estamos usando para Netflix tenga barra de navegación para poder usarlo realmente como un navegador».

## Problema

El tile webview (`src/renderer/components/webviewTile.js`) es un `<webview>` que llena el 100% del tile, sin encabezado. Sirve para apps (Discord, Netflix) pero no para navegar: no hay forma de escribir una dirección, volver atrás ni recargar.

## Decisiones tomadas con Abel

- **Alcance: toggle por tile, encendida en navegadores.** Un campo `nav: boolean` en el tile del perfil. Nace `true` en tiles creados con «URL manual» (`TileFactory.fromUrl`) y `false` en los del catálogo (`TileFactory.fromApp`). Los tiles existentes sin el campo se comportan como `false`: Netflix y Discord no cambian hasta que se encienda a mano.
- Descartado: barra única en la topbar de la ventana (ambigua con varios webviews) y tipo de tile nuevo «Navegador».

## Diseño

### Barra (`src/renderer/components/webviewNavBar.js`)

Franja de 32 px arriba del `<webview>`, dentro del nodo `.tile` (el tile pasa a ser `flex-col`: barra + webview que ocupa el resto). Contenido de izquierda a derecha:

1. Espaciador de 28 px: ahí vive el grip de mover (`.tile-handle-move`, absolute top-left 28×28).
2. Botones ‹ (atrás), › (adelante), ↻ (recargar; muestra ✕ mientras carga y detiene). Atrás/adelante se deshabilitan según `canGoBack()`/`canGoForward()`.
3. Campo de dirección (`<input>`): muestra la URL actual; se refresca en `did-navigate`, `did-navigate-in-page` y `did-start-loading`. Enter navega con `resolveAddress(texto)`; Escape restaura la URL actual y devuelve el foco al webview.
4. Botón «ocultar barra» (⌄): pone `nav:false`.

La barra no existe en el DOM cuando `nav` es `false` (no solo oculta): el tile queda idéntico al actual.

### Resolver dirección (`src/renderer/core/browserNav.js`, módulo puro, sin DOM)

- `resolveAddress(texto)`: `normalizeUrl` (ya existe) si parece URL; si no, búsqueda en Google `https://www.google.com/search?q=<encodeURIComponent>`; vacío → `null`.
- `navDefaultFor(origen)`: `'manual' → true`, `'app' → false`.
- `navEnabled(tile)`: `tile.nav === true` (undefined y false → false).
- `historyState({ canGoBack, canGoForward, isLoading })`: devuelve el estado que la barra pinta (habilitados y el rótulo del botón recargar/detener). Existe para testear la lógica sin DOM.

### Encender/apagar

- Botón ⌄ en la barra → `ProfileManager.updateTile(id, { nav: false })`.
- Menú **Tile › Barra de dirección** con acelerador `CmdOrCtrl+L` → `menu:tile-action { type: 'address-bar' }` → en el renderer, si el tile enfocado es webview: pone `nav:true` si estaba apagada y enfoca el campo de dirección. Si ya estaba encendida, solo enfoca el campo (comportamiento de navegador).
- Administrador del workspace: columna «Barra» con un interruptor por tile webview (junto al zoom).
- `tile:updated` ya dispara `renderBento()`; el nodo del tile se reutiliza (`liveTiles`), así que montar/desmontar la barra se hace **en el propio tile** escuchando `tile:updated` con su id y comparando `nav`. El `<webview>` nunca se mueve del DOM (moverlo recarga el guest).

### Persistencia de la URL

Con `nav:true`, en `did-navigate` (no en `did-navigate-in-page`) se guarda `url` en el perfil con debounce de 500 ms vía `ProfileManager.updateTile`. Con `nav:false` no se guarda nada (comportamiento actual). El campo `title` no cambia.

### Estilo

Barra `bg-bg-soft` con borde inferior `border-line`; botones de 24 px, texto `text-fg-soft`; campo con fondo `bg-bg-elev`, radio 6 px, `font-size 12px`, sin outline salvo foco (`ring accent`). Deshabilitados a 35 % de opacidad.

## Fuera de alcance (anotar en roadmap como siguiente paso)

Pestañas dentro del tile, historial visible, abrir en otro tile los enlaces `target=_blank` (hoy `allowpopups=false` los ignora), favoritos.

## Tests

- Unitarios (`src/renderer/core/browserNav.test.js`, vitest node): `resolveAddress` (URL con y sin esquema, texto con espacios → búsqueda, vacío → null), `navDefaultFor`, `navEnabled` (true/false/undefined), `historyState`.
- E2E (`e2e/navbar.mjs`, agregado a `npm run e2e`): siembra un perfil con dos webviews `about:blank`, uno `nav:true` y otro sin campo. Verifica que solo el primero pinta `.webview-navbar`; enfoca el segundo, dispara la acción de menú `address-bar` por IPC (o `Cmd+L` con `page.keyboard`), verifica que aparece la barra y que el perfil en disco quedó con `nav:true` en ese tile; pulsa ⌄ y verifica que desaparece y el disco vuelve a `nav:false`.
