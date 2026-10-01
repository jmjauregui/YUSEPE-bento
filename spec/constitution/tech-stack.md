# Tech stack y convenciones

## Tecnologías

- **Lenguaje:** JavaScript (ES modules, sin TypeScript)
- **Runtime / framework:** Electron (proceso main + renderer con contextIsolation)
- **Build:** electron-vite (HMR en renderer, autoreload en main)
- **UI:** Vanilla JS + TailwindCSS — sin framework de componentes
- **Reactividad:** `Proxy` manual + `core/eventBus.js` (pub/sub con wildcards)
- **Terminal:** node-pty (proceso nativo) + xterm.js
- **Tests:** Vitest ≥2 (environment: 'node', sin DOM); los tests corren sin Electron
- **Linter:** ESLint 9 flat config (`eslint.config.mjs`)
- **Formato:** Prettier (configurado pero no enforceado en CI todavía)
- **Empaquetado:** electron-builder 24.13.3 (pin — no actualizar sin revisar)

## Archivos / módulos clave

- `src/main/index.js` — BrowserWindow, CSP, menú, nativeTheme, dialog
- `src/main/ipc.js` — todos los handlers IPC agrupados por dominio
- `src/main/storage.js` — persistencia JSON atómica de perfiles
- `src/main/loopDispatcher.js` — reparte mensajes del loop a terminales (vigila disco)
- `src/main/loopOps.js` — operaciones de disco del loop (messages.jsonl, status.json)
- `src/main/explorerFs.js` — filesystem del explorador (resolveSafe contra path traversal)
- `src/main/agentOps.js` — lectura/escritura de instruction files (mismo resolveSafe)
- `src/main/tasksOps.js` — app de Tareas (.md por tarea en .ybento/tasks/)
- `src/main/snippetsOps.js` — librería global de snippets
- `src/cli/run.js` — CLI `ybento` (corre con Node, fuera de Electron)
- `src/preload/index.js` — expone window.yusepe.* vía contextBridge
- `src/renderer/core/layout.js` — lógica pura del grid (sin DOM)
- `src/renderer/core/profileManager.js` — CRUD de perfiles/tiles
- `src/renderer/core/eventBus.js` — pub/sub con wildcards
- `src/renderer/core/liveTiles.js` — tiles vivos que persisten entre workspaces
- `src/renderer/components/loopSidebar.js` — panel UI del loop multiagente
- `src/renderer/components/settings.js` — modal de configuración de la app

## Comandos

- `npm run dev` — electron-vite dev (HMR renderer, autoreload main)
- `npm test` — vitest run (suite completa)
- `npm run lint` — eslint sobre src/ + configs
- `npm run lint:fix` — eslint --fix
- `npm run build` — build de producción → out/
- `npm run package:win` — empaquetar Windows (nsis)
- `npm run package:mac` — empaquetar macOS (dmg + zip)
- `npm run package:linux` — empaquetar Linux (AppImage + deb)
- `npm run rebuild` — recompila node-pty contra la versión de Electron

## Modelo de datos / dominio

- **Perfil** — `{ id, name, cwd, tiles[], gridVersion, wallpaper? }` — persiste en `<userData>/profiles/`.
- **Tile** — `{ id, type, col, row, colSpan, rowSpan, ...tipo-específico }` — vive dentro del perfil.
- **gridVersion** — controla migraciones de layout (v1=6 cols → v2=12 cols); nunca mutar la migración existente, añadir nueva versión.
- **Loop message** — `{ from, to, text, createdAt, seenUpTo, headAt, replyTo? }` — append-only en `messages.jsonl`.
- **Loop status** — `{ agents: [{name, role, tileId, state, color}], waiting: [] }` — reescrito entero con lock en `status.json`.
- **Task** — frontmatter `title/done/createdAt` + cuerpo libre en `.ybento/tasks/<id>.md`.

## Convenciones

- **Sin comentarios salvo WHY no obvio** — los identificadores bien nombrados documentan el qué; los comentarios explican el porqué de decisiones no evidentes.
- **IPC agrupado por dominio** — todos los handlers en `ipc.js`, salvo los que necesitan `dialog` + `mainWindow` (van en `main/index.js`).
- **resolveSafe en explorerFs y agentOps** — toda ruta relativa se valida contra el root para bloquear path traversal. Si tocás uno, revisá el otro.
- **Tests junto al módulo** — `foo.js` + `foo.test.js` en el mismo directorio.
- **Escritura atómica** — toda escritura crítica en disco usa `.tmp` + rename (storage.js) o append-only (messages.jsonl).
- **Español en UI y comentarios** — el código y los identificadores en inglés; la UI, los mensajes y los comentarios en español.
- **Event bus para comunicación inter-componente** — no imports directos entre componentes de UI; se usa `bus.emit`/`bus.on`.

## Estilo visual

- **Tokens CSS** — colores definidos como variables CSS en `:root` y `:root[data-theme]`; nunca colores hardcodeados.
- **TailwindCSS** — clases de utilidad; los tokens propios del proyecto se exponen como `--color-*` y se usan vía `text-fg`, `bg-surface`, etc.
- **Dark/light mode** — `data-theme="dark"/"light"` en `<html>`; los webviews respetan `prefers-color-scheme` vía `nativeTheme.themeSource`.
- **Sin dependencias de UI externas** — no añadir librerías de componentes (shadcn, MUI, etc.).

## Límites duros

- **No matar ni cerrar Bento sin confirmación explícita del usuario.**
- **No subir `.env` ni `.env.*` al repo** — las API keys (Pexels) van solo en `.env` ignorado por git.
- **No leer el portapapeles desde la terminal (OSC 52 readText deshabilitado)** — cualquier proceso podría exfiltrar el portapapeles.
- **No compartir sesión entre webviews** — cada `<webview>` tiene su propia partición `persist:yusepe-<tileId>`.
- **No actualizar electron-builder a 26.x** — rompe el empaquetado (`ERR_REQUIRE_ESM`).
- **No actualizar vitest a v4** — requiere Node 20+; el proyecto soporta Node 18.
- **WALLPAPER_POSITIONS whitelist + clamp()** para cualquier valor del JSON de wallpaper que vaya a un `style` inline.
- **No añadir framework de UI reactivo** (React, Vue, Svelte…) — la arquitectura es vanilla JS deliberadamente.
