/**
 * src/renderer/components/terminal.js
 * --------------------------------------------------------------
 * Terminal SIN header. xterm.js llena el 100% del tile.
 * node-pty en el main process, IPC para I/O.
 * --------------------------------------------------------------
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import { h, debounce, escapeHtml } from '../utils/dom.js';
import { bus } from '../core/eventBus.js';
import { state } from '../core/state.js';
import * as liveTiles from '../core/liveTiles.js';

/**
 * Lee la paleta de la terminal desde las variables CSS del tema activo.
 * Si hay un wallpaper de workspace activo (--term-tile-opacity < 1), el
 * fondo se vuelve semitransparente con esa misma opacidad para dejarlo
 * ver (estilo Warp) — ver bentoGrid.js `applyWallpaper`.
 */
function readTermTheme() {
  const style = getComputedStyle(document.documentElement);
  const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const opacity = parseFloat(v('--term-tile-opacity', '1')) || 1;
  // Ojo: este color NO lo parsea el navegador, lo parsea xterm con su propio
  // regex, y ese sólo acepta la forma con comas: `rgba(r, g, b, a)`. Un
  // `rgb(r g b / a)` moderno —que es como se consumen estas variables desde
  // CSS— xterm no lo entiende y cae al fondo opaco, así que la terminal deja
  // de dejar ver el wallpaper. Los canales se normalizan a comas acá.
  const bgRgb = v('--color-term-bg-rgb', '22 22 25').split(/[\s,]+/).filter(Boolean).join(', ');
  return {
    background: opacity < 1 ? `rgba(${bgRgb}, ${opacity})` : v('--color-term-bg', '#161619'),
    foreground: v('--color-term-fg', '#e6e6ea'),
    cursor: v('--color-term-cursor', '#0a84ff'),
    selectionBackground: v('--color-term-selection', '#14375f'),
  };
}

export async function createTerminalTile(tile, profileId) {
  // Si esta terminal ya está viva (el usuario volvió a este workspace),
  // reutilizamos el mismo nodo/proceso en vez de crear uno nuevo:
  // scrollback y el shell en ejecución quedan intactos.
  const cached = liveTiles.get(tile.id);
  if (cached) {
    queueMicrotask(() => { try { cached.meta.fit.fit(); } catch { /* noop */ } });
    // La asociación nombre->pty del loop vive en memoria del proceso main
    // (el ptyId muere con la terminal, la identidad no), así que hay que
    // rehacerla al volver a este workspace o el repartidor no sabría a qué
    // terminal pegarle.
    if (tile.loopAgent && cached.meta?.ptyId) {
      window.yusepe.loop.bind(tile.loopAgent, cached.meta.ptyId, state.profile?.cwd);
    }
    return { root: cached.node, shutdown: () => {} };
  }

  // Contenedor que llena el tile. Sin fondo propio a propósito: así el
  // fondo (semi)transparente del .tile — ver estilo `.tile[data-kind=
  // 'terminal']` — se ve por debajo de xterm cuando hay wallpaper activo.
  const body = h('div', {
    class: 'absolute inset-0',
  });

  // Badge con el nombre en el loop (@claudio). Sin esto, varias terminales
  // en la misma carpeta son indistinguibles a simple vista — que es
  // exactamente el problema cuando hay un loop andando y querés saber quién
  // es quién. `pointer-events-none` para no robarle clicks a xterm.
  const badge = h('div', {
    class: 'absolute top-1 right-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] font-mono '
      + 'bg-accent/20 text-accent-soft border border-accent/30 pointer-events-none select-none',
  });

  const paintBadge = (name) => {
    badge.textContent = name ? `@${name}` : '';
    badge.classList.toggle('hidden', !name);
  };
  paintBadge(tile.loopAgent);

  const offLoop = bus.on('loop:binding-changed', ({ tileId, name }) => {
    if (tileId === tile.id) paintBadge(name);
  });

  const root = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: 'terminal' },
  }, [body, badge]);

  let term = null;
  let fit = null;
  let ptyId = null;
  let offData = null;
  let offExit = null;
  let offTheme = null;

  queueMicrotask(async () => {
    try {
      term = new Terminal({
        fontFamily: 'JetBrains Mono, Menlo, monospace',
        fontSize: 13,
        cursorBlink: true,
        theme: readTermTheme(),
        allowProposedApi: true,
      });

      offTheme = bus.on('theme:changed', () => {
        if (term) term.options.theme = readTermTheme();
      });
      fit = new FitAddon();
      term.loadAddon(fit);

      // OSC 52: el programa de adentro puede escribir el portapapeles con
      // una secuencia de escape — es como copian Claude Code (selección
      // propia con mouse capturado), tmux, nvim y las sesiones SSH
      // remotas. Escribir va por el IPC de siempre; leer queda deshabilitado
      // a propósito: cualquier proceso corriendo en la terminal podría
      // exfiltrar el portapapeles con un printf.
      term.loadAddon(new ClipboardAddon(undefined, {
        writeText: (_sel, text) => window.yusepe.clipboard.writeText(text),
        readText: () => Promise.resolve(''),
      }));
      term.open(body);
      fit.fit();

      // El pegado SIEMPRE pasa por term.paste(), nunca crudo al pty:
      // xterm normaliza `\r\n` -> `\r` y envuelve en bracketed paste
      // cuando el programa de adentro lo pidió (Claude Code, opencode…).
      // Sin eso, cada salto de línea de un log pegado es un Enter dentro
      // del TUI y el mensaje se parte en varios (verificado con sonda).
      const pasteFromClipboard = () => {
        navigator.clipboard.readText()
          .then((t) => { if (t) term.paste(t); })
          .catch(() => { /* sin permiso de lectura: no hay nada que pegar */ });
      };

      // Portapapeles estilo Windows Terminal. Ctrl+C con selección copia
      // (y deselecciona); sin selección sigue siendo SIGINT — no se pierde
      // la forma de interrumpir un proceso. Ctrl+Shift+C/V quedan como
      // atajos explícitos: el del menú (CmdOrCtrl+C) no sirve para esto
      // — se lo tiene prohibido registrar fuera de macOS, ver main/index.js
      // — y xterm no trae ningún atajo de portapapeles propio.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
        const k = e.key.toLowerCase();
        if (k === 'c' && !e.shiftKey) {
          const sel = term.getSelection();
          if (!sel) return true; // sin selección: SIGINT como siempre
          window.yusepe.clipboard.writeText(sel);
          term.clearSelection();
        } else if (k === 'c' && e.shiftKey) {
          const sel = term.getSelection();
          if (sel) window.yusepe.clipboard.writeText(sel);
        } else if (k === 'v' && e.shiftKey) {
          pasteFromClipboard();
        } else {
          return true;
        }
        e.preventDefault();
        return false;
      });

      // Copiar al seleccionar, como QuickEdit/Windows Terminal: soltar el
      // mouse con algo seleccionado ya lo deja en el portapapeles, sin
      // atajo. El debounce espera a que el arrastre termine — el evento
      // dispara en cada movimiento — y saltea la selección vacía para no
      // pisar el portapapeles al deseleccionar.
      const copyOnSelect = debounce(() => {
        const sel = term?.getSelection();
        if (sel) window.yusepe.clipboard.writeText(sel);
      }, 150);
      term.onSelectionChange(copyOnSelect);

      // Click derecho: copiar/pegar con menú nativo, como cualquier
      // terminal de Windows. El pegado va por el mismo camino seguro.
      body.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const sel = term?.getSelection() || '';
        const choice = await window.yusepe.menu.popup([
          { id: 'copy', label: 'Copiar', enabled: !!sel },
          { id: 'paste', label: 'Pegar' },
        ]);
        if (choice === 'copy' && sel) window.yusepe.clipboard.writeText(sel);
        else if (choice === 'paste') pasteFromClipboard();
      });

      // `agent` hace que el pty nazca con YBENTO_AGENT/YBENTO_ROOT en el
      // entorno, así el CLI `ybento` ya sabe quién es sin que el agente
      // tenga que pasar `--as` en cada comando. Ver main/loopShim.js.
      const { ptyId: id, cwdMissing } = await window.yusepe.pty.create({
        cols: term.cols,
        rows: term.rows,
        cwd: tile.cwd || undefined,
        agent: tile.loopAgent || undefined,
        // La raíz del loop es la del workspace, no la del tile: el tile
        // puede estar parado en una subcarpeta y `.ybento/loop/` vive en
        // la raíz del proyecto.
        loopRoot: state.profile?.cwd || tile.cwd || undefined,
      });
      ptyId = id;

      offData = window.yusepe.pty.onData(ptyId, (data) => term.write(data));
      offExit = window.yusepe.pty.onExit(ptyId, (code) => {
        term.writeln(`\r\n\x1b[2m[proceso finalizado con código ${code}]\x1b[0m`);
      });

      term.onData((d) => window.yusepe.pty.input(ptyId, d));
      const debouncedResize = debounce(({ cols, rows }) => {
        window.yusepe.pty.resize(ptyId, cols, rows);
      }, 80);
      term.onResize(debouncedResize);

      const ro = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* noop */ }
      });
      ro.observe(body);
      root._disposers = [() => ro.disconnect()];

      term.writeln('\x1b[2mInicializando shell…\x1b[0m');
      if (cwdMissing) {
        term.writeln(`\x1b[33mLa carpeta del workspace no existe: ${cwdMissing}\x1b[0m`);
        term.writeln('\x1b[33mLa terminal arranca en tu carpeta de usuario.\x1b[0m');
      }
      term.focus();

      // Terminal precargada: escribe el comando en el shell apenas arranca.
      if (tile.command) {
        setTimeout(() => window.yusepe.pty.input(ptyId, `${tile.command}\r`), 300);
      }

      // Registra la terminal como "viva": persiste entre cambios de
      // workspace. Solo `killReal` (borrado del tile o kill de workspace)
      // termina el proceso de verdad.
      // `term` va en el meta para que la UI pueda mirar lo que hay en
      // pantalla — el picker del loop muestra la última línea de cada
      // terminal, que es lo único que las distingue de verdad cuando son
      // varios shells pelados en la misma carpeta.
      liveTiles.register(tile.id, {
        profileId, kind: 'terminal', node: root, kill: killReal, meta: { fit, ptyId, term },
      });

      // El mismo binding nombre→ptyId que la rama cached rehace al volver
      // al workspace (línea 52), pero acá es la primera vez que nace la
      // terminal: el dispatcher todavía no sabe a qué pty pegarle. Sin
      // esto, los mensajes llegan al disco pero el dispatcher los descarta
      // porque bindings.get(name) devuelve undefined.
      if (tile.loopAgent) {
        window.yusepe.loop.bind(tile.loopAgent, ptyId, state.profile?.cwd);
      }
    } catch (err) {
      // Sólo sugerir recompilar cuando el problema ES node-pty: para
      // cualquier otro fallo ese consejo despista (p.ej. un cwd inválido).
      const msg = String(err.message || err);
      const hint = msg.includes('node-pty')
        ? 'Ejecuta <code>npm run rebuild</code> para compilar node-pty.<br/>'
        : '';
      body.innerHTML = `<div class="p-3 text-xs text-fg-muted">
        No se pudo iniciar la terminal.<br/>
        ${hint}
        <pre class="mt-2 text-[10px] text-fg-subtle">${escapeHtml(msg)}</pre>
      </div>`;
      bus.emit('terminal:error', { tileId: tile.id, error: String(err.message || err) });
    }
  });

  async function killReal() {
    try { offData?.(); offExit?.(); offTheme?.(); offLoop?.(); } catch { /* noop */ }
    if (ptyId) { try { window.yusepe.pty.kill(ptyId); } catch { /* noop */ } ptyId = null; }
    term?.dispose();
    term = null;
    (root._disposers || []).forEach((fn) => { try { fn(); } catch { /* noop */ } });
  }

  // Al desmontar el tile (cambio de workspace) NO se mata el proceso —
  // solo se quita del DOM. El kill real vive en el registry (killReal)
  // y se dispara explícitamente desde ProfileManager.removeTile / killWorkspace.
  return { root, shutdown: () => {} };
}
