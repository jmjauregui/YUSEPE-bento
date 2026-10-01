/**
 * src/renderer/components/terminalPicker.js
 * --------------------------------------------------------------
 * Guía visual para elegir "cuál terminal" cuando hay más de una en el
 * workspace. Nació en loopSidebar.js (elegir qué terminal entra al loop)
 * y se separó para reusarla donde exista la misma ambigüedad — p.ej.
 * snippetsSidebar.js al ejecutar un comando sin terminal enfocada.
 *
 * Varias terminales en la misma carpeta y sin comando precargado se ven
 * idénticas en una lista ("Terminal 1", "Terminal 2"…). Lo único que el
 * usuario tiene en la cabeza es *dónde* está cada una en pantalla y qué fue
 * lo último que hizo, así que eso es lo que se muestra: un mini-mapa del
 * mosaico con el tile marcado + su última línea de salida.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import * as liveTiles from '../core/liveTiles.js';
import { GRID_COLS } from '../core/layout.js';
import { openModal, closeModal } from './modal.js';
import { labelFor } from './workspaceManager.js';

/** Mini-mapa del mosaico con este tile marcado. */
export function miniMap(tile) {
  const tiles = state.profile?.tiles || [];
  const rows = Math.max(4, ...tiles.map((t) => (t.row || 0) + (t.rowSpan || 1)));

  const cells = tiles.map((other) => {
    const isThis = other.id === tile.id;
    return h('div', {
      class: isThis ? 'rounded-[1px] bg-accent' : 'rounded-[1px] bg-fg-subtle/25',
      style: `grid-column: ${(other.col || 0) + 1} / span ${other.colSpan || 1};`
        + `grid-row: ${(other.row || 0) + 1} / span ${other.rowSpan || 1};`,
    });
  });

  return h('div', {
    class: 'shrink-0 grid gap-[1px] w-12 h-9 p-[2px] rounded border border-line bg-bg-elev',
    style: `grid-template-columns: repeat(${GRID_COLS}, 1fr); grid-template-rows: repeat(${rows}, 1fr);`,
  }, cells);
}

/**
 * Última línea con contenido de la terminal.
 *
 * Es lo más identificatorio que hay: el prompt, el comando que corrió, o el
 * banner del agente que tiene adentro. Se lee del buffer de xterm (ver el
 * `meta.term` que registra terminal.js).
 */
export function lastOutputLine(tile) {
  const entry = liveTiles.get(tile.id);
  const term = entry?.meta?.term;

  let text = '';
  try {
    const buf = term?.buffer?.active;
    if (buf) {
      const from = buf.baseY + buf.cursorY;
      for (let i = from; i >= 0 && i > from - 60; i--) {
        const line = buf.getLine(i)?.translateToString(true).trim();
        if (line) { text = line; break; }
      }
    }
  } catch { /* si xterm cambia de API, no vale romper el picker por esto */ }

  return h('div', {
    class: `text-[10px] truncate mt-0.5 font-mono ${text ? 'text-fg-subtle' : 'text-fg-subtle/50 italic'}`,
  }, text || 'sin salida todavía');
}

/**
 * Abre el modal de selección y resuelve con el tile elegido (o `null` si se
 * cierra sin elegir). Con un solo candidato no tiene sentido hacer elegir:
 * el llamador debería resolverlo derecho, sin pasar por acá.
 */
export function pickTerminal(candidates, { title = 'Elegí la terminal', hint } = {}) {
  return new Promise((resolvePick) => {
    const list = h('div', { class: 'space-y-1' }, candidates.map((tile) => h('button', {
      class: 'w-full text-left px-3 py-2 rounded-md border border-line hover:bg-bg-elev transition flex items-center gap-3',
      onClick: () => { closeModal(); resolvePick(tile); },
    }, [
      miniMap(tile),
      h('div', { class: 'flex-1 min-w-0' }, [
        h('div', { class: 'text-sm text-fg flex items-center gap-1.5' }, [
          h('span', { class: 'text-accent-soft flex items-center shrink-0' }, svgIcon('terminal', { size: 13 })),
          h('span', { class: 'truncate' }, labelFor(tile)),
          h('span', { class: 'text-[10px] text-fg-subtle shrink-0' }, `${tile.colSpan}x${tile.rowSpan}`),
        ]),
        lastOutputLine(tile),
      ]),
    ])));

    // Cerrar sin elegir (Escape/backdrop) no resuelve — mismo trato que
    // confirmModal/promptModal en este módulo: el llamador espera un click.
    openModal({
      title,
      body: h('div', {}, [
        h('p', { class: 'text-xs text-fg-subtle mb-3' },
          hint || 'El recuadro marca dónde está cada una en el mosaico, y abajo se ve su última línea.'),
        list,
      ]),
    });
  });
}
