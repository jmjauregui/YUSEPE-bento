/**
 * src/renderer/utils/resizableSidebar.js
 * --------------------------------------------------------------
 * Handle de redimensionado para paneles laterales (estilo VSCode).
 *
 * Vive acá y no dentro de un componente porque hay paneles en los cuatro
 * bordes de la ventana y la única diferencia entre ellos es el eje y el signo
 * del arrastre.
 *
 * El tamaño se guarda en localStorage por panel, así cada uno recuerda el
 * suyo entre sesiones.
 * --------------------------------------------------------------
 */
import { h } from './dom.js';

/**
 * Calcula el nuevo tamaño dado el arrastre, sin tocar el DOM.
 * Pura: se puede testear sin montar nada.
 *
 * El signo depende del borde: los bordes left y top "crecen" cuando el
 * puntero retrocede (pointerStart > pointer), los bordes right y bottom
 * cuando avanza.
 */
export function sizeFromDelta({ edge, start, pointerStart, pointer, min, max }) {
  const delta = (edge === 'left' || edge === 'top') ? pointerStart - pointer : pointer - pointerStart;
  return Math.min(max, Math.max(min, start + delta));
}

/** Tamaño guardado, acotado al rango — o el default si no hay nada. */
export function applySavedWidth(panel, { storageKey, min, max, defaultWidth, axis = 'x' }) {
  const saved = parseInt(localStorage.getItem(storageKey), 10);
  const size = Number.isFinite(saved)
    ? Math.min(max, Math.max(min, saved))
    : defaultWidth;
  if (axis === 'y') {
    panel.style.height = `${size}px`;
  } else {
    panel.style.width = `${size}px`;
  }
}

/**
 * Crea el handle. Hay que agregarlo al panel (que debe ser `relative` o
 * `fixed`, porque el handle se posiciona absoluto contra él).
 *
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {string} opts.storageKey
 * @param {'left'|'right'|'top'|'bottom'} opts.edge  borde donde va el handle
 * @param {'x'|'y'} [opts.axis]  eje de redimensionado (default 'x')
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {number} opts.defaultWidth
 * @param {() => void} [opts.onResize] por si el contenido necesita recalcular
 */
export function makeResizeHandle({
  panel, storageKey, edge, min, max, defaultWidth, axis = 'x', onResize = () => {},
}) {
  const handle = h('div', {
    class: 'sidebar-resize-handle',
    dataset: { edge },
    title: 'Arrastrá para redimensionar (doble click restablece)',
  });

  let pointerStart = 0;
  let startSize = 0;

  const onMove = (e) => {
    const pointer = axis === 'y' ? e.clientY : e.clientX;
    const size = sizeFromDelta({ edge, start: startSize, pointerStart, pointer, min, max });
    if (axis === 'y') {
      panel.style.height = `${size}px`;
    } else {
      panel.style.width = `${size}px`;
    }
    onResize();
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('resizing-sidebar', 'resizing-sidebar-x', 'resizing-sidebar-y');
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(storageKey, String(Math.round(axis === 'y' ? rect.height : rect.width)));
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    pointerStart = axis === 'y' ? e.clientY : e.clientX;
    const rect = panel.getBoundingClientRect();
    startSize = axis === 'y' ? rect.height : rect.width;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add('resizing-sidebar', axis === 'y' ? 'resizing-sidebar-y' : 'resizing-sidebar-x');
  });

  handle.addEventListener('dblclick', () => {
    if (axis === 'y') {
      panel.style.height = `${defaultWidth}px`;
    } else {
      panel.style.width = `${defaultWidth}px`;
    }
    localStorage.setItem(storageKey, String(defaultWidth));
    onResize();
  });

  return handle;
}
