/**
 * src/renderer/components/terminalPeek.js
 * --------------------------------------------------------------
 * "Abrir terminal" (spec 038): trae una terminal del mosaico a un modal por
 * encima de todo —también del loop expandido— para contestar un permiso o
 * mirar qué está haciendo un agente sin salir del loop.
 *
 * Es LA terminal, no una copia: el mismo nodo vivo (xterm + su pty) se
 * mueve al modal y al cerrar vuelve a su lugar exacto. Es el mismo truco con
 * el que Bento ya mueve terminales sin matarlas (cambio de workspace, vista
 * expandida). Teclea el usuario, viendo la pregunta: nada de teclas a ciegas.
 *
 * Esc NO cierra: dentro de la terminal, Esc es del agente (en Claude Code
 * interrumpe). Se cierra con ×, clic afuera o ⇧Esc.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { bus } from '../core/eventBus.js';
import * as liveTiles from '../core/liveTiles.js';
import { toast } from './toast.js';

let open = null; // { tileId, node, home, next, overlay, offs }

function fitSoon(tileId) {
  requestAnimationFrame(() => {
    try { liveTiles.get(tileId)?.meta?.fit?.fit(); } catch { /* noop */ }
  });
}

/**
 * Abre la terminal `tileId` en el modal.
 * @param {string} tileId
 * @param {{ title?: string }} [opts]
 */
export function openTerminalPeek(tileId, { title = 'Terminal' } = {}) {
  closeTerminalPeek();
  const entry = liveTiles.get(tileId);
  if (!entry || entry.kind !== 'terminal' || !entry.node) {
    toast.error('Esa terminal no está abierta en este workspace.');
    return;
  }

  const node = entry.node;
  const host = h('div', { class: 'peek-host' });
  const close = () => closeTerminalPeek();
  const panel = h('div', { class: 'peek-panel', onClick: (e) => e.stopPropagation() }, [
    h('div', { class: 'peek-header' }, [
      h('span', { class: 'text-accent-soft flex items-center' }, svgIcon('terminal', { size: 14 })),
      h('span', { class: 'flex-1 truncate' }, title),
      h('span', { class: 'text-[10px] text-fg-subtle', 'data-no-tip': '' }, '⇧Esc cierra'),
      h('button', {
        class: 'inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition',
        title: 'Cerrar y devolver la terminal a su lugar',
        onClick: close,
      }, svgIcon('close', { size: 14 })),
    ]),
    host,
  ]);
  const overlay = h('div', { class: 'peek-overlay', onClick: close }, [panel]);

  open = {
    tileId,
    node,
    // Dónde vivía: para devolverla al mismo lugar del mosaico.
    home: node.parentNode,
    next: node.nextSibling,
    overlay,
    offs: [],
  };

  host.append(node);
  node.classList.add('is-peeked');
  document.body.append(overlay);
  fitSoon(tileId);
  requestAnimationFrame(() => { try { entry.meta?.term?.focus(); } catch { /* noop */ } });

  // ⇧Esc cierra. En captura, antes de que xterm se quede con la tecla.
  const onKey = (e) => {
    if (e.key === 'Escape' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      closeTerminalPeek();
    }
  };
  window.addEventListener('keydown', onKey, true);
  open.offs.push(() => window.removeEventListener('keydown', onKey, true));

  // Si el workspace cambia o la terminal se borra con el modal abierto, se
  // cierra solo: nunca queda una terminal "secuestrada" fuera del mosaico.
  open.offs.push(bus.on('workspace:left', close));
  open.offs.push(bus.on('tile:removed', ({ id } = {}) => { if (id === tileId) close(); }));
  open.offs.push(bus.on('live-tiles:changed', () => { if (!liveTiles.get(tileId)) close(); }));
}

/** Cierra el modal y devuelve la terminal a su lugar (o a la zona de espera). */
export function closeTerminalPeek() {
  if (!open) return;
  const { tileId, node, home, next, overlay, offs } = open;
  open = null;
  offs.forEach((off) => { try { off(); } catch { /* noop */ } });

  node.classList.remove('is-peeked');
  if (home?.isConnected) {
    home.insertBefore(node, next?.parentNode === home ? next : null);
  } else {
    // El lugar original ya no está (workspace cambiado): a la zona de espera,
    // como cualquier terminal viva de otro workspace.
    document.getElementById('tile-holding-area')?.append(node);
  }
  overlay.remove();
  fitSoon(tileId);
}

export function isTerminalPeekOpen() {
  return !!open;
}
