/**
 * src/renderer/components/shortcutsCheatsheet.js
 * --------------------------------------------------------------
 * Overlay con todos los atajos de teclado de la app, agrupados por
 * dominio. Se abre con `?` (keydown global, ver main.js), con `Cmd/Ctrl+/`
 * desde el menú, o desde el Command Palette.
 *
 * La lista es la fuente de verdad "de cara al usuario" de los accelerators
 * definidos en src/main/index.js (setupMenu). Si agregás/cambiás un
 * accelerator allá, actualizá también acá — no hay derivación automática
 * porque los del menú viven en el proceso main y no se exponen al renderer.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { openModal } from './modal.js';

const isMac = window.yusepe.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';
const SHIFT = isMac ? '⇧' : 'Shift';
const ARROWS = '←↑↓→';

const GROUPS = [
  {
    title: 'Navegación',
    items: [
      [[MOD, 'P'], 'Ir a archivo (fuzzy-find)'],
      [[MOD, SHIFT, 'P'], 'Command Palette'],
      [[MOD, 'K'], 'Agregar al espacio'],
      [[MOD, '1–9'], 'Ir al espacio N'],
    ],
  },
  {
    title: 'Tiles',
    items: [
      [[MOD, 'T'], 'Nueva terminal'],
      [[MOD, 'B'], 'Nueva calculadora'],
      [[MOD, 'W'], 'Cerrar tile enfocado'],
      [[MOD, 'L'], 'Barra de dirección del webview enfocado'],
    ],
  },
  {
    title: 'Mosaico',
    items: [
      [[MOD, ALT, ARROWS], 'Mover el foco entre tiles'],
      [[MOD, ALT, SHIFT, ARROWS], 'Mover el tile enfocado'],
    ],
  },
  {
    title: 'App',
    items: [
      [[MOD, ','], 'Configuración'],
      [[MOD, '/'], 'Este panel de atajos'],
      [['?'], 'Este panel de atajos'],
      [['Esc'], 'Cerrar modal / búsqueda'],
    ],
  },
];

function keyCap(label) {
  return h('kbd', {
    class:
      'inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-md ' +
      'border border-line bg-bg-elev text-fg-soft text-[11px] font-medium shadow-sm',
  }, label);
}

export function openShortcutsCheatsheet() {
  const body = h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5' });

  for (const group of GROUPS) {
    const rows = group.items.map(([keys, desc]) =>
      h('div', { class: 'flex items-center justify-between gap-3 py-1' }, [
        h('span', { class: 'text-sm text-fg-soft min-w-0 truncate' }, desc),
        h('span', { class: 'flex items-center gap-1 shrink-0' }, keys.map(keyCap)),
      ]),
    );
    body.append(h('div', {}, [
      h('p', { class: 'text-[10px] text-fg-subtle uppercase tracking-wide mb-1' }, group.title),
      ...rows,
    ]));
  }

  openModal({ title: 'Atajos de teclado', body, size: 'md' });
}
