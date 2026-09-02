# Misión

## Qué construimos

YUSEPE Bento es una app de escritorio (Electron) que funciona como hub de espacios de trabajo personales ("perfiles") con un Bento Grid dinámico y redimensionable. Resuelve el problema de tener decenas de herramientas dispersas integrando terminales reales, navegador embebido, explorador de archivos, panel Git, tareas, snippets y un loop multiagente en una sola ventana organizable.

Piezas principales del producto:

1. **Bento Grid** — grid de 12 columnas redimensionable a mano; los tiles se colocan, mueven y empujan entre sí.
2. **Tiles funcionales** — terminal (node-pty), webview, calculadora, explorador de archivos, panel Git, panel de Agentes, Tareas.
3. **Loop multiagente** — varias terminales con agentes distintos (Claude Code, opencode…) que se envían mensajes entre sí con el CLI `ybento`.
4. **Workspaces / Perfiles** — cada perfil tiene su propio grid, carpeta de proyecto (cwd), wallpaper y estado de tiles.
5. **Snippets** — librería global de comandos/rutinas multi-línea ejecutables en la terminal activa.

## Para quién

- **Desarrollador individual** que trabaja en varios proyectos y quiere un único hub en vez de múltiples ventanas de terminal + browser.
- **Usuario de agentes de IA** (Claude Code, opencode) que quiere orquestar varios agentes en paralelo desde una sola app.

## Principios

- **El escritorio es la fuente de verdad** — todo persiste en archivos reales (JSON, `.md`, `.jsonl`); sin base de datos externa.
- **Vanilla JS sin frameworks de UI** — reactividad manual vía `Proxy` + event bus; sin React/Vue/Svelte. Se añade complejidad solo cuando el valor es claro.
- **Seguridad por defecto** — CSP estricta, `contextIsolation: true`, permisos de webview denegados por defecto, no se sube `.env` al repo.
- **Sin magia silenciosa** — si algo puede fallar de forma difícil de diagnosticar (entrega de mensajes, quoting en terminal), se documenta explícitamente en el CLAUDE.md.
- **Los tests cubren la lógica crítica, no la UI** — Vitest sin DOM; la interfaz se verifica a mano.

## Qué NO es

- No es un gestor de ventanas del sistema operativo (no mueve ventanas nativas ajenas).
- No es un IDE completo (el editor de código no es una pieza core; hay webview para eso).
- No es una plataforma multiusuario ni tiene backend en la nube.
- No usa frameworks de UI reactivos (React, Vue, Svelte, Solid…).
