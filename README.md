# YUSEPE Bento

Cockpit de código en un **Bento Grid** dinámico: espacios de trabajo locales,
terminales reales (node-pty), webapps embebidas, explorador de archivos,
panel de Git, panel de Agentes de IA y una app de tareas que se conecta con
tu agente de código — todo redimensionable y reorganizable a mano, con tema
claro/oscuro y persistencia de sesiones entre workspaces.

Construido con **Electron + electron-vite + Vanilla JS + TailwindCSS**.

---

## 1. Instalación

```bash
npm install
```

> `postinstall` corre `electron-rebuild` automáticamente para compilar
> `node-pty` contra la versión de Electron del proyecto. Si falla (por
> ejemplo, sin toolchain de compilación nativa), la app sigue funcionando
> pero sin terminales — correlo a mano cuando tengas el entorno listo:
> ```bash
> npm run rebuild
> ```
> En Windows puede hacer falta **Visual Studio Build Tools** para compilar
> módulos nativos.

---

## 2. Desarrollo

```bash
npm run dev       # Modo desarrollo (HMR en renderer, autoreload en main)
npm run build     # Build de producción (out/)
npm run preview   # Previsualizar el build de producción
npm test          # Suite de tests (Vitest)
npm run test:watch
npm run lint      # ESLint 9 (flat config)
npm run lint:fix
```

> **Al tocar `src/main/` o `src/preload/`, reiniciá `npm run dev`.** Solo el
> renderer tiene HMR real: main y preload viven en el proceso de Electron y
> el preload se inyecta una única vez al crear la ventana. Un preload viejo
> con un renderer nuevo da errores del tipo `X is not a function` o
> `No handler registered for '...'`.

Los datos de perfiles se guardan en:
- macOS:   `~/Library/Application Support/yusepe-bento/profiles/`
- Windows: `%APPDATA%\yusepe-bento\profiles\`
- Linux:   `~/.config/yusepe-bento/profiles/`

Cada perfil es un JSON (`<id>.json`) + un índice ligero (`_index.json`),
con escrituras atómicas (`.tmp` + `rename`) y deduplicación automática del
índice al leer.

---

## 3. Estructura

```
src/
├── main/                     # Proceso Main de Electron
│   ├── index.js              # BrowserWindow, CSP, menú + accelerators, nativeTheme, dialog
│   ├── ipc.js                # Handlers IPC agrupados por dominio
│   ├── storage.js            # Persistencia JSON atómica de perfiles (+ migración de grid)
│   ├── explorerFs.js         # FS del explorador: listar, leer, crear, renombrar, duplicar
│   ├── agentOps.js           # Archivos de instrucciones de IA (CLAUDE.md, AGENTS.md, …)
│   ├── tasksOps.js           # App de tareas: .md en .ybento/tasks + launchText
│   ├── gitOps.js             # status/diff/stage/commit/push/fetch/pull/ramas
│   ├── snippetsOps.js        # Librería de snippets (global a la app)
│   ├── pexelsOps.js          # Búsqueda de wallpapers (la API key nunca llega al renderer)
│   └── toolDetector.js       # Detecta CLIs instaladas (claude, lazygit, nvim, …)
├── preload/
│   └── index.js              # contextBridge → window.yusepe.*
└── renderer/
    ├── index.html
    ├── main.js               # Entry point: listado de workspaces, topbar, tabs, wiring
    ├── style.css             # Tokens de tema (CSS vars) + Bento Grid
    ├── core/                 # Lógica pura, sin DOM
    │   ├── eventBus.js       # Pub/sub minimalista con wildcards ('tile:*')
    │   ├── state.js          # Estado reactivo (Proxy)
    │   ├── profileManager.js # CRUD de perfiles/tiles, orquesta cambios de workspace
    │   ├── layout.js         # Grid: auto-placement, push/pull resize, drag libre
    │   ├── liveTiles.js      # Registro de tiles vivos (terminal/webview) entre workspaces
    │   ├── theme.js          # Tema claro/oscuro (persistido + nativeTheme vía IPC)
    │   ├── fileIcons.js      # Iconos por tipo de archivo (Material Icon Theme)
    │   ├── codeHighlight.js  # highlight.js "core" con lenguajes elegidos a mano
    │   ├── appLibrary.js     # Catálogo dinámico de webapps
    │   └── pexels.js         # Wrapper del IPC de wallpapers
    ├── components/
    │   ├── bentoGrid.js      # Render incremental, resize, drag, empty state, wallpaper
    │   ├── tile.js           # Factoría de tiles + dispatcher de render
    │   ├── terminal.js       # Tile terminal (xterm.js + pty, persistente)
    │   ├── webviewTile.js    # Tile <webview> (persistente, partición por tile)
    │   ├── calculator.js
    │   ├── fileTile.js       # Tile de archivo fijado
    │   ├── tasksTile.js      # Tile de tareas del workspace
    │   ├── fileViewer.js     # Render de archivos (md/código/csv/svg/imagen/pdf) — compartido
    │   ├── fileTreeSidebar.js# Panel del árbol de archivos (+ menú contextual)
    │   ├── gitPanel.js
    │   ├── agentPanel.js
    │   ├── snippetsSidebar.js
    │   ├── workspaceManager.js
    │   ├── addToSpace.js     # Modal "Agregar al espacio"
    │   ├── commandPalette.js
    │   ├── quickOpenFile.js  # ⌘P estilo VSCode
    │   ├── shortcutsCheatsheet.js
    │   ├── taskDetailModal.js
    │   ├── launchTemplateModal.js
    │   ├── wallpaperPicker.js
    │   ├── settings.js
    │   ├── toast.js
    │   └── modal.js          # Modal genérico + promptModal/confirmModal
    └── utils/
        ├── dom.js            # Helpers: h(), debounce, uid, escapeHtml
        └── icons.js          # Set único de iconos monoline (SF Symbols-like)
```

---

## 4. Funcionalidad

### Espacios de trabajo
- Cada workspace tiene nombre único, tiles con posición manual
  (`col/row/colSpan/rowSpan`) y una **carpeta (`cwd`)** opcional donde
  arrancan sus terminales y contra la que se resuelve todo el resto
  (explorador, git, agentes, tareas).
- La topbar muestra una **tira de tabs** (estilo VSCode) con el workspace
  activo y los que quedaron con tiles vivos en segundo plano. Clic cambia de
  workspace; la × lo cierra (mata sus procesos, con confirmación solo si hay
  algo vivo que perder).

### Bento Grid
- Grid manual de 12 columnas, filas automáticas (`minmax(70px, 1fr)`).
  Perfiles guardados con la resolución anterior (6 columnas) se migran
  automáticamente al abrirlos (`gridVersion`, ver `main/storage.js`).
- **Resize** arrastrando bordes/esquina: si el crecimiento choca con un
  vecino lo **encoge** (push) en vez de bloquear el gesto; al encogerlo, el
  vecino se **expande** para llenar el hueco (`core/layout.js`).
- **Mover** arrastrando el grip (⠿); los tiles tapados se reacomodan solos.
  Al cerrar un tile los demás compactan sin dejar huecos.
- El espacio libre muestra la marca de agua de Bento y, con el workspace
  vacío, los comandos básicos (estilo welcome de VSCode).
- **Wallpaper por workspace** (buscador de Pexels en Configuración) con
  transparencia opcional de las terminales encima, estilo Warp.

### Tipos de tile
`terminal` · `webview` · `calculator` · `file` (archivo fijado) · `tasks`

> Toda factoría de tiles devuelve `{ root, shutdown? }`, y `root` **debe**
> llevar `class: 'tile'` + `dataset.tileId`: de ahí salen el fondo opaco y el
> `position: relative` contra el que se anclan los handles de mover/
> redimensionar que agrega `bentoGrid`. Ver el contrato en `components/tile.js`.

### Terminales y webviews persistentes entre workspaces
- Al cambiar de workspace, las terminales (proceso pty real) y los webviews
  **no se destruyen**: quedan vivos en segundo plano (`core/liveTiles.js`) y
  se re-adjuntan tal cual al volver (scrollback, shell en ejecución, sesión
  de la página — todo intacto).
- Truco para los webviews: en vez de sacarlos del DOM (lo que Electron
  interpreta como destruir el guest), se mueven a una zona oculta
  (`#tile-holding-area`, `display:none`) que sigue dentro del documento.
- Solo se mata un tile de verdad al borrarlo puntualmente o al cerrar su
  workspace desde los tabs — nunca al simple cambio de workspace.

### Explorador de archivos (panel lateral)
- Árbol del workspace, redimensionable, con iconos por tipo de archivo y
  buscador recursivo. **Muestra todos los archivos**, dotfiles incluidos.
- Cabecera estilo VSCode: **nuevo archivo**, **nueva carpeta**, **refrescar**
  y **colapsar todo**. Crear abre un input inline en el árbol (no un modal) y
  acepta rutas anidadas (`utils/foo.js` crea las carpetas intermedias).
- **Menú contextual nativo** (clic derecho): renombrar, duplicar, eliminar
  (a la Papelera vía `shell.trashItem`, recuperable), copiar ruta relativa o
  absoluta, nuevo archivo/carpeta acá, revelar en Finder.
- Clic en un archivo abre un preview en modal con resaltado de sintaxis:
  Markdown renderizado, CSV como tabla, SVG, imágenes y PDF (pdf.js sobre
  `<canvas>`), y edición en línea para texto.
- **Fijar**: deja el archivo como un tile del mosaico. Modal y tile comparten
  el mismo renderizador (`components/fileViewer.js`).

### App de tareas (tile)
- Lista de pendientes del workspace, respaldada en **archivos `.md` reales**
  en `.ybento/tasks/` del proyecto — uno por tarea, con frontmatter mínimo
  (`title`/`done`/`createdAt`) y cuerpo libre para la descripción.
- **No hay índice: el estado es el directorio.** Los `.md` se editan a mano,
  se versionan con git y no hay dos fuentes de verdad que se desincronicen.
  `.ybento` **no** se agrega al `.gitignore`: las tareas viajan con el repo.
- Clic en el título abre el detalle (título + descripción en Markdown con
  vista previa). El checkbox completa.
- **launchText**: el botón de cada tarea copia un texto listo para pegarle a
  tu agente de código, armado con la plantilla del proyecto
  (`.ybento/launch-template.md`, editable desde el tile). Variables:
  `{{task_title}}`, `{{task_route}}`, `{{task_notes}}`, `{{project_root}}`.
  El default le pide al agente marcar la tarea como completada al terminar,
  con lo que la lista se mantiene sola.
- El tile vigila `.ybento/tasks/` con `fs.watch` y relee solo: los `.md` los
  escribe también el agente, no solo Bento.

### Panel de Git
Status, diff, stage/unstage por archivo o todo, descartar, commit, push,
fetch, pull, listar/cambiar/crear ramas — el ciclo de sync completo sin
salir a lazygit. Ver `main/gitOps.js`.

### Panel de Agentes
Detecta y edita los archivos de instrucciones que leen los asistentes de IA
(`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`,
`copilot-instructions.md`) y lista los subagentes de Claude Code en
`.claude/agents/*.md`. Ver `main/agentOps.js`.

### Snippets (panel lateral)
Librería de comandos/rutinas multi-línea, **global a la app** (no por
workspace) — vive en `<userData>/snippets.json`. Un click lo tipea y ejecuta
línea por línea en la terminal enfocada, como si se hubiera tipeado a mano.

### Agregar al espacio (`⌘/Ctrl + K`)
Modal único con: nueva terminal, terminal precargada (ejecuta un comando al
abrirse), tareas, calculadora, URL manual, fijar archivo, y un catálogo de
webapps con UI tipo marketplace (buscador + filtro por categoría).

### Administrador del workspace
Tabla de todos los tiles del workspace activo: nombre, tamaño, comando/URL
editable en línea, control de zoom por webview (a nivel Chromium, funciona
incluso en sitios que bloquean el zoom) y borrado.

### Command Palette (`⌘/Ctrl + Shift + P`) y Quick Open (`⌘/Ctrl + P`)
El Command Palette salta a otro workspace, enfoca un tile o dispara acciones
rápidas. El Quick Open es un fuzzy-find de archivos del workspace, estilo
VSCode.

### Importar / exportar workspaces
Cada workspace se exporta a un `.json` portable e importa de vuelta — genera
un id nuevo siempre y resuelve colisiones de nombre con un sufijo.

### Tema claro/oscuro
Toggle en Configuración (`⌘/Ctrl + ,`), persistido en `localStorage`. Afecta
la UI vía variables CSS, la paleta de xterm.js, y — vía
`nativeTheme.themeSource` en el main — el `prefers-color-scheme` de **todos**
los `<webview>`.

---

## 5. Seguridad

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- CSP estricta vía `onHeadersReceived` (incluye `connect-src` para el fetch
  de la librería de apps).
- Permisos de `<webview>` denegados por defecto (`setPermissionRequestHandler`).
- Cada `<webview>` aislado en su propia partición `persist:yusepe-<tileId>`.
- **Path traversal**: todo acceso al FS (explorador, agentes, tareas) resuelve
  las rutas contra el `cwd` del workspace y valida que no escapen
  (`resolveSafe`). Las operaciones destructivas usan `resolveEntryPath`, que
  además rechaza la raíz del workspace. Cubierto por tests.
- La API key de Pexels se inyecta en build-time en el **proceso main** y nunca
  llega al bundle del renderer.

## 6. IPC

API expuesta en `window.yusepe` mediante `contextBridge`:

`profiles` · `pty` · `tools` · `explorer` · `git` · `agents` · `tasks` ·
`pexels` · `snippets` · `shell` · `theme` · `window` · `dialog` ·
`clipboard` · `menu`

Canales nombrados y agrupados por dominio (`profiles:*`, `pty:*`,
`explorer:*`, `git:*`, `agents:*`, `tasks:*`, …).

## 7. Bus de eventos

`bus.on('tile:*', handler)` con wildcards. Eventos clave: `profile:loaded`,
`workspace:left` (cambio de workspace — dispara el desmontaje no-destructivo
de tiles persistentes), `tile:added/removed/updated`, `theme:changed`,
`live-tiles:changed`, `tasks:changed`, `file:changed`.

---

## 8. Tests

Vitest cubre la lógica pura y de persistencia crítica, sin depender de
Electron ni del DOM. **179 tests** en 8 archivos:

| Archivo | Qué cubre |
|---|---|
| `core/layout.test.js` | auto-placement, push/pull resize, drag libre |
| `core/liveTiles.test.js` | registro/kill de tiles vivos entre workspaces |
| `core/eventBus.test.js` | pub/sub, wildcards, resiliencia a errores |
| `main/storage.test.js` | CRUD de perfiles sobre disco real (incluye la regresión del índice duplicado) |
| `main/pathSafety.test.js` | `resolveSafe` en explorerFs **y** agentOps: `..`, rutas absolutas, hermanos con prefijo |
| `main/explorerFs.test.js` | crear/renombrar/duplicar; que nada pise trabajo del usuario (`fs.rename` sí lo haría) |
| `main/tasksOps.test.js` | tareas sobre disco real, launchText, watcher, y `.md` editados a mano |
| `main/snippetsOps.test.js` | CRUD de snippets |

Los módulos del main que se testean **no importan `electron`** a propósito:
así corren bajo vitest sin mocks. Lo que necesita `shell`/`clipboard` vive en
`ipc.js`.

```bash
npm test
npx vitest run src/main/tasksOps.test.js   # un solo archivo
```

CI (`.github/workflows/ci.yml`) corre lint + test + build en cada push/PR.

---

## 9. Empaquetado (electron-builder)

```bash
npm run package        # todas las plataformas configuradas
npm run package:mac    # solo macOS (dmg + zip)
npm run package:win    # solo Windows (nsis)
npm run package:linux  # solo Linux (AppImage + deb)
```

### Crear el ejecutable para Windows

```bash
nvm use 20.19.0        # Node 20 (mismo que CI); validá las instaladas con `nvm list`
npm install            # si todavía no instalaste dependencias
npm run package:win    # build de producción + instalador NSIS
```

El comando compila la app (`electron-vite build`) y genera el instalador en:

```
release\YUSEPE Bento Setup <versión>.exe    # instalador NSIS
release\win-unpacked\                       # app portable sin instalador
```

> Para que las terminales (node-pty) funcionen en el ejecutable hace falta
> compilar el módulo nativo con **Visual Studio Build Tools** instaladas y
> correr `npm run rebuild` antes de empaquetar. Sin eso, la app funciona
> igual pero sin terminales reales.

Config en `electron-builder.yml`. Notas:

- **node-pty** (módulo nativo) se excluye del `asar` (`asarUnpack`) porque
  sus binarios `.node` y el ejecutable `spawn-helper` necesitan existir como
  archivos reales en disco.
- **macOS sin firma**: `identity: null` (no hay cuenta de Apple Developer).
  El `.app` funciona, pero Gatekeeper pide *click derecho → Abrir* la primera
  vez. El build sale para la arquitectura de la máquina que empaqueta.
- `electron-builder@24.13.3` fijado a propósito: la rama 26.x falla al
  empaquetar (`ERR_REQUIRE_ESM` en `@noble/hashes`). Igual que `vitest@^2`,
  fijado porque la v4 requiere Node 20+ y este proyecto corre en Node 18.

## 10. Atajos de teclado

| Combinación            | Acción                          |
|------------------------|---------------------------------|
| `⌘/Ctrl + P`           | Ir a archivo (Quick Open)       |
| `⌘/Ctrl + Shift + P`   | Command Palette                 |
| `⌘/Ctrl + K`           | Agregar al espacio              |
| `⌘/Ctrl + T`           | Nueva terminal                  |
| `⌘/Ctrl + B`           | Nueva calculadora               |
| `⌘/Ctrl + ,`           | Configuración                   |
| `⌘/Ctrl + W`           | Cerrar el tile enfocado         |
| `⌘/Ctrl + 1…9`         | Ir al espacio 1…9               |
| `⌘/Ctrl + Alt + ←↑→↓`  | Mover el foco entre tiles       |
| `⌘/Ctrl + Alt + ⇧ + ←↑→↓` | Mover el tile enfocado       |
| `⌘/Ctrl + /` o `?`     | Cheatsheet de atajos            |
| `Escape`               | Cerrar modal                    |

> La lista de `components/shortcutsCheatsheet.js` es la fuente de verdad de
> cara al usuario; los accelerators reales viven en `setupMenu` de
> `main/index.js`. Si tocás uno, actualizá el otro.

---

## 11. Próximos pasos (roadmap)

- [x] Importar/exportar workspaces.
- [x] Navegación del mosaico por teclado + cheatsheet.
- [x] Panel de Git con el ciclo de sync completo.
- [x] Crear/renombrar/duplicar/eliminar desde el explorador.
- [x] Fijar archivos como tiles.
- [x] App de tareas con launchText.
- [ ] Enviar el launchText directo a la terminal enfocada (hoy copia al
      portapapeles; `snippetsSidebar.js` ya resuelve el envío).
- [ ] Firma/notarización de macOS (requiere cuenta de Apple Developer).
- [ ] Auto-update (electron-updater).
- [ ] Prettier: commit one-shot de `npm run format` y sumar `format:check` a CI.
- [ ] Ícono real de la app (`build/icon.png`).

