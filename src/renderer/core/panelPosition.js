/**
 * src/renderer/core/panelPosition.js
 * --------------------------------------------------------------
 * Posición del panel del loop: los cuatro bordes (left/right/top/bottom).
 * Sólo lógica pura + localStorage — sin DOM, sin bus.
 * --------------------------------------------------------------
 */

export const POSITIONS = ['left', 'right', 'top', 'bottom'];
export const DEFAULT_POSITION = 'right';
const STORAGE_KEY = 'yusepe:loop-position';

export function getPanelPosition() {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return POSITIONS.includes(v) ? v : DEFAULT_POSITION;
}

export function setPanelPosition(pos) {
  const valid = POSITIONS.includes(pos) ? pos : DEFAULT_POSITION;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, valid);
  return valid;
}

// Clases de posición CSS + borde + eje de redimensionado por posición.
// Solo incluye clases que cambian con la posición; las fijas (fixed, z-40…) quedan en el HTML.
const LAYOUT = {
  right:  { classes: 'right-0 top-12 bottom-0 border-l', handleEdge: 'left',   axis: 'x', storageKey: 'yusepe:loop-width',  min: 300, max: 900, defaultSize: 384 },
  left:   { classes: 'left-0 top-12 bottom-0 border-r',  handleEdge: 'right',  axis: 'x', storageKey: 'yusepe:loop-width',  min: 300, max: 900, defaultSize: 384 },
  top:    { classes: 'left-0 right-0 top-12 border-b',   handleEdge: 'bottom', axis: 'y', storageKey: 'yusepe:loop-height', min: 180, max: null, defaultSize: 320 },
  bottom: { classes: 'left-0 right-0 bottom-0 border-t', handleEdge: 'top',    axis: 'y', storageKey: 'yusepe:loop-height', min: 180, max: null, defaultSize: 320 },
};

/**
 * Configuración de layout para una posición.
 * `max` del eje y es 70% de `windowHeight` (inyectable para tests sin DOM).
 * `max` del eje x es estático (900px).
 */
export function panelLayout(pos, windowHeight = (typeof window !== 'undefined' ? window.innerHeight : 800)) {
  const layout = LAYOUT[POSITIONS.includes(pos) ? pos : DEFAULT_POSITION];
  const max = layout.axis === 'y' ? Math.floor(windowHeight * 0.7) : layout.max;
  return { ...layout, max };
}

/**
 * Todas las clases de posicionamiento que puede poner cualquier posición.
 * Se usan para limpiar el estado anterior antes de aplicar el nuevo.
 */
export const ALL_POSITION_CLASSES = ['right-0', 'left-0', 'top-12', 'bottom-0', 'border-l', 'border-r', 'border-t', 'border-b'];

/**
 * Calcula los clipPath de inicio y fin para animar la expansión del panel.
 * El barrido entra desde el borde donde vive el panel y termina en pantalla completa.
 * `to` siempre es `inset(0 0 0 0)` (sin recorte).
 *
 * @param {string} pos - 'right' | 'left' | 'top' | 'bottom'
 * @param {{ available: number, size: number }} opts
 * @returns {{ from: string, to: string }}
 */
export function expandClip(pos, { available, size }) {
  const offset = Math.max(0, available - size);
  const validPos = POSITIONS.includes(pos) ? pos : DEFAULT_POSITION;
  const from = {
    right:  `inset(0 0 0 ${offset}px)`,
    left:   `inset(0 ${offset}px 0 0)`,
    top:    `inset(0 0 ${offset}px 0)`,
    bottom: `inset(${offset}px 0 0 0)`,
  }[validPos];
  return { from, to: 'inset(0 0 0 0)' };
}
