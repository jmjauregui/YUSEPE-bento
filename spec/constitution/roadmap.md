# Roadmap

## Hecho ✅

1. **001 · Bento Grid core** — grid de 12 columnas con auto-placement, resize push/pull y drag libre.
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

## Backlog / ideas 💡

- **Loop: chunking de mensajes largos** — se descartó en sesión 2025-08; el usuario prefiere pasar el mensaje completo sin fragmentar.
- **Editor de código integrado** — tile tipo editor (Monaco u otro); no es prioridad core.
- **Exportar/importar workspaces** — ya existe export/import de perfil; mejorar UX del flujo.
- **Auto-`.gitignore` de `.ybento`** — dejado fuera de alcance a propósito; las tareas se commitean.
