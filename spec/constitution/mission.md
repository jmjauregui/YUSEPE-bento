# Misión

> La [constitución](constitution.md) manda sobre este documento: qué es
> Bento, qué no es y cómo se gobierna se decide allá. Acá se baja a tierra.

## Qué construimos

YUSEPE Bento es **el cockpit para orquestar agentes de IA**: una app de escritorio (Electron) donde el flujo con agentes de código —terminales reales, agentes que se hablan entre sí, tareas que alimentan al agente— vive en un Bento Grid redimensionable y reorganizable a mano. El resto de las piezas (explorador, Git, webapps, snippets) existen para servir a ese flujo.

Piezas principales del producto:

1. **Loop multiagente** — varias terminales con agentes distintos (Claude Code, opencode…) que se envían mensajes entre sí con el CLI `ybento`. Es el centro del producto.
2. **Tareas + launchText** — tareas como `.md` versionados en git y texto listo para pasarle al agente.
3. **Bento Grid** — grid de 48 columnas (12 hasta v1.5.3) redimensionable a mano; los tiles se colocan, mueven y empujan entre sí.
4. **Tiles funcionales** — terminal (node-pty), webview, calculadora, explorador de archivos, panel Git, panel de Agentes, Tareas.
5. **Workspaces / Perfiles** — cada perfil tiene su propio grid, carpeta de proyecto (cwd), wallpaper y estado de tiles.
6. **Snippets** — librería global de comandos/rutinas multi-línea ejecutables en la terminal activa.

## Para quién

- **El dev que trabaja con agentes de código** (Claude Code, opencode, Codex…) y quiere orquestar varios en paralelo desde una sola app, en vez de malabarear terminales y ventanas a mano.
- Que acepta un flujo opinado: Bento propone uno, no se adapta a cualquiera.

## Principios

- **El escritorio es la fuente de verdad** — todo persiste en archivos reales (JSON, `.md`, `.jsonl`); sin base de datos externa.
- **Vanilla JS sin frameworks de UI** — reactividad manual vía `Proxy` + event bus; sin React/Vue/Svelte. Se añade complejidad solo cuando el valor es claro.
- **Seguridad por defecto** — CSP estricta, `contextIsolation: true`, permisos de webview denegados por defecto, no se sube `.env` al repo.
- **Sin magia silenciosa** — si algo puede fallar de forma difícil de diagnosticar (entrega de mensajes, quoting en terminal), se documenta explícitamente en el CLAUDE.md.
- **Los tests cubren la lógica crítica, no la UI** — Vitest sin DOM; la interfaz se verifica a mano.

## Qué NO es

Las líneas rojas están en la [constitución, sección 2](constitution.md#2-qué-no-es-bento): no es un editor de código, no es para reproducir contenido, no es un browser, no es un gestor de workspaces genérico. Además, en lo técnico:

- No es un gestor de ventanas del sistema operativo (no mueve ventanas nativas ajenas).
- No es una plataforma multiusuario ni tiene backend en la nube.
- No usa frameworks de UI reactivos (React, Vue, Svelte, Solid…).
