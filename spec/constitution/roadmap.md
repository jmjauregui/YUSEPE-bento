# Roadmap

## Hecho ✅

1. **001 · Bento Grid core** — grid de 12 columnas (24 desde 028) con auto-placement, resize push/pull y drag libre.
2. **002 · Perfiles / Workspaces** — CRUD de perfiles, persistencia JSON atómica, migración de gridVersion.
3. **003 · Terminal (node-pty + xterm.js)** — terminal real con OSC 52 write, bracketed paste, copy-on-select.
4. **004 · Webview tiles** — webview por tile con partición aislada, permisos denegados por defecto.
5. **005 · Live tiles** — terminales y webviews persisten entre cambios de workspace (no se destruyen).
6. **006 · Explorador de archivos** — listado, búsqueda (dotfiles incluidos), preview, escritura, renombrar, duplicar, papelera.
7. **007 · Panel Git** — status, diff, stage/unstage, commit, push, fetch, pull, branches.
8. **008 · Panel de Agentes** — lectura/escritura de instruction files (CLAUDE.md, AGENTS.md…).
9. **009 · Tareas** — lista por workspace en `.md` reales, frontmatter, notas, launch template.
10. **010 · Snippets** — librería global de comandos multi-línea, ejecución en terminal activa.
11. **011 · CLI `ybento`** — `estado`, `bandeja`, `enviar`; wrapper sin dependencia de Node del usuario.
12. **012 · Loop multiagente** — mensajería entre terminales con reparto automático, presencia, cruces, sello de commit.
13. **013 · Loop: sonidos y notificaciones OS** — ≥5 sonidos sintéticos seleccionables + notificación cuando @usuario recibe mensaje.
14. **014 · Loop: estado del panel por workspace** — el panel abierto/cerrado es independiente por perfil.
15. **015 · Loop: modo configurable** — "Un loop a la vez" vs "Loops simultáneos", persiste en localStorage.
16. **016 · Loop: bindings por workspace** — en modo simultáneo, agentes del mismo nombre en workspaces distintos no se pisan.
17. **017 · Wallpaper picker** — buscador Pexels, posición, opacidad; API key solo en proceso main.
18. **018 · Tema claro/oscuro** — persistido, propagado a webviews y nativeTheme.
19. **019 · Calculadora tile** — calculadora básica embebida.
20. **020 · Tooltip propio** — reemplaza el nativo de Chromium (lento); un nodo reutilizado, delegado en document.

## Siguiente 🔜

_(vacío — definir la próxima feature en `tasks.md` raíz antes de crear la carpeta de feature)_

## Hecho ✅ (continuación)

21. **021 · fix: Scroll del textarea del compositor** — el textarea del compositor conserva su posición de scroll tras cada refresh del panel.
22. **022 · fix: El cursor del compositor salta al final** — el textarea se crea una sola vez en vez de destruirse y recrearse cada 1,5 s; en cada refresh solo se repintan las pills. El cursor se queda donde el usuario lo deja.
23. **023 · fix: Se pierde la selección del hilo** — `renderStream` pasa a render incremental keyado por `msg.id`: se appendea solo lo nuevo en vez de rehacer las 200 filas. La selección sobrevive y se puede copiar del hilo.
24. **025 · fix: Mensajes entre agentes quedan escritos pero sin enviar** — el Enter llegaba dentro de la ventana de pegado del TUI en mensajes de más de 2550 chars: `whenIdle()` en `createWriteQueue` + `Promise.race` en el dispatcher, para que espere al drenaje real (e229f21). Incluye la regresión que introdujo ese mismo fix — `dispose()` dejaba los `whenIdle()` sin resolver y colgaba el reparto entero del workspace — cerrada con `notifyIdle()` en `clear()` y el cinturón `IDLE_TIMEOUT_MS` (9cf2501).
25. **027 · fix: Instrumentación pasiva B1/B2 para diagnosticar truncamiento** — `loopDiag.js` con ventana de captura acotada a la entrega; `ybento diag @agente` imprime veredicto en texto. El bug de truncamiento sigue abierto; esta entrada cierra la instrumentación (ae6aaac).
26. **028 · feature: Reordenar las pills de agentes con drag and drop** — mantener 1 s una pill la levanta y se arrastra a otra posición; el roster sigue el mismo orden. El orden se guarda por proyecto en `.ybento/config/loop.json`. La pill arrastrada nunca se mueve en el DOM (se corren las otras, `crossingMoves`), así no pierde la captura del puntero; el repintado del panel se suspende desde el pointerdown.
27. **030 · fix: Puerto fijo del dev server** — `npm run dev` usa el 5987 con `strictPort`, lejos del 5173 que suele estar tomado; si está ocupado falla con un error claro en vez de saltar de puerto en silencio (d3f02d0).
28. **031 · feature: El roster de la cabina como acordeón** — se ve al abrir la cabina y se oculta a los 5 s; un botón junto al del protocolo lo abre o cierra. Nunca se cierra por un evento: al vencer la cuenta consulta hover y foco en ese momento. Cerrado, un punto rojo/ámbar avisa de agentes que no reciben o están trabados (cdd4914).
29. **032 · feature: Copiar un mensaje del hilo** — ícono en el encabezado de cada mensaje que copia su texto completo (sin encabezado ni hora), alcanzable con Tab y sin romper la selección (dd08d7c).
30. **033 · fix: Tooltips de la topbar** — los íconos junto a "Agregar" perdían su tooltip al abrir un workspace; el texto vive ahora en `data-label` y el `title` nunca queda vacío (a9ee452).

31. **029 · fix: El aviso de cruce ya no lista todos los mensajes al usuario** — la cabina sella cada mensaje con el último que mostraba, y el aviso corta en 5 (3a444f6).
32. **034 · feature: Scroll vertical del workspace** — el grid scrollea cuando las filas ya no entran, con autoscroll al arrastrar y al estirar, coordenadas corregidas y barra del mismo diseño que la de xterm (6b54d5d).
33. **035 · feature: Redimensionar un tile desde cualquier borde** — izquierda, arriba y las cuatro esquinas, resolviendo el crecimiento por espejo sobre las funciones ya testeadas del grid (6b54d5d).
34. **036 · feature: Observador de inactividad del loop** — mide la salida de cada terminal y avisa a un agente designado (o al usuario) cuando el loop se frenó; umbral configurable, un aviso por episodio, nunca escribe en un pty (a7ed33e).

35. **037 · feature: Estado por agente en el hilo del loop** — punto pegado al nombre en las pills y el roster: verde disponible, rojo ocupado (medido por la salida real del pty, no por la etiqueta), ámbar trabado, gris caído. Titileo con una fase global; el punto del acordeón pasa a un solo color de alerta con el texto en palabras (2304727).
36. **039 · feature: Buscador en el hilo del loop** — Ctrl+F filtra el hilo sobre todo el historial y resalta; flechas que arrancan en el resultado más reciente y suben, sin dar la vuelta; el texto se busca literal y el atajo no se le roba a las terminales (2304727).

26. **028 · Grid de 24 → 48 columnas** — resolución del grid ×2 en ambos ejes (v3: 24 columnas, filas de 35px) y luego columnas ×2 más (v4: 48 columnas, filas iguales) para repartos finos en monitores anchos; `gridVersion: 4` con migración encadenada v1→v2→v3→v4 al cargar (perfiles de versiones más nuevas no se tocan); tamaños por defecto de tiles nuevos ×2. Propuesta P2 de Abel (rama `feature/grid-24-columnas`).

27. **029 · Plantillas de distribución** — tercer paso en "Nuevo workspace": elegir una plantilla (incorporadas: vacío, dos terminales, cuatro columnas, cuatro + panel, terminal + tareas) o una guardada por el usuario desde el administrador ("Guardar distribución como plantilla", en `<userData>/layout-templates.json`). Módulo puro `core/layoutTemplates.js` con validación (grilla, kinds, solapes); `storage.create` acepta tiles iniciales. Propuesta P5 de Abel.
28. **030 · Catálogo: categoría Comunicación** — Discord, WhatsApp Web, Slack y Telegram Web en "Agregar al espacio". Propuesta P4 de Abel.

29. **031 · Workspaces en ventanas independientes** — botón ↗ en la pestaña, menú contextual "Abrir en ventana nueva" o arrastrar la pestaña fuera de la ventana: el workspace pasa a una `BrowserWindow` propia SIN matar sus terminales (los ptys cambian de dueño en main y la ventana nueva repinta los últimos 256 KB de salida). Un workspace vive en una sola ventana a la vez (reclamos por ventana, toast si otra lo tiene); diálogos y atajos van a la ventana enfocada; al cerrar una ventana se sueltan sus workspaces y se matan sus ptys. `main/multiWindow.js` puro con tests; E2E `e2e/windows.mjs`. Propuesta P1 de Abel.

## Backlog / ideas 💡

- **Loop: chunking de mensajes largos** — se descartó en sesión 2025-08; el usuario prefiere pasar el mensaje completo sin fragmentar.
- **Editor de código integrado** — tile tipo editor (Monaco u otro); no es prioridad core.
- **Exportar/importar workspaces** — ya existe export/import de perfil; mejorar UX del flujo.
- **Auto-`.gitignore` de `.ybento`** — dejado fuera de alcance a propósito; las tareas se commitean.

## Propuestas de Abel · 2026-09-26 💡

Surgidas de usar Bento con cuatro terminales de Claude (mac + mini) en un monitor ultrawide. Diagnóstico leído en el código de v1.5.3; ninguna está empezada.

- **P7 · Color de actividad en las terminales** — **HECHO 2026-09-29** (rama `feature/terminal-actividad`, spec `docs/superpowers/specs/2026-09-29-terminal-actividad-design.md`). `core/activityState.js` (puro, 9 tests): idle → working con salida útil (tras 3 s de arranque, ≥ 20 bytes o 3 fragmentos chicos en 1 s) → done tras 1,5 s sin salida si el tile no tiene el foco → idle al enfocarlo. CSS `.is-working` (borde cobre tenue + fondo 6 % más claro) y `.is-done` (borde salvia + punto). MEDIDO: Claude Code ocioso emite 7 fragmentos al arrancar y ninguno en 19 s. E2E `e2e/actividad.mjs` 6/6.
- **P6 · Barra de navegación en los webviews** — **HECHO 2026-09-29** (rama `feature/barra-navegacion`, spec `docs/superpowers/specs/2026-09-29-barra-navegacion-webview-design.md`). Campo `nav` por tile: «URL manual» nace con barra, apps del catálogo sin barra, tiles viejos sin cambio. ‹ › ↻ [dirección] ⌄ encima del `<webview>`; Cmd+L (menú Tile › Barra de dirección) la enciende y enfoca; interruptor en el administrador del workspace; con la barra encendida la última URL queda en el perfil. Siguientes pasos no incluidos: pestañas dentro del tile, historial, abrir en otro tile los enlaces `target=_blank` (hoy `allowpopups=false` los ignora), favoritos.
- **P3 · DRM (Widevine) en los webviews** — Netflix y similares fallan con M7701-1003 porque Electron estándar no trae el CDM; el permiso `mediaKeySystem` ya está habilitado en `index.js` pero no hay módulo en el bundle. Requiere (1) cambiar `electron` por la distribución de castLabs (`@castlabs/electron-releases`) en `package.json`, (2) firma VMP vía EVS de castLabs (cuenta necesaria) en el pipeline de `electron-builder`, (3) redistribuir. Es cambio de build y distribución, no de código de la app. Alternativa mientras tanto: PiP de Safari/Chrome sobre Bento. **Hecho 2026-09-28** en `feature/widevine-netflix`: Electron de castLabs + firma VMP (`npm run vmp-sign`, cuenta EVS `corpusia`). Gotcha medido el mismo día: el servidor de componentes de Google ya no entrega el CDM a Chromium 130 (Electron 33): `components.whenReady()` falla en 3 s con `not-installed`; con castLabs v41.10.7 y v44.1.0 el CDM se instala en 11 s. Por eso se subió a v44.1.0+wvcus (Chromium 152, node-pty reconstruido con ABI 149). Regla: mantener el Electron de castLabs dentro de las 3 majors soportadas, o Netflix vuelve a caer en instalaciones nuevas.
