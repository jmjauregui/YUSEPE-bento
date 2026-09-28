/**
 * src/renderer/core/layoutTemplates.js
 * --------------------------------------------------------------
 * Plantillas de distribución: listas de tiles con posición y tamaño en
 * la grilla (ver core/layout.js) que se instancian al crear un workspace.
 * Hay plantillas incorporadas (abajo) y plantillas del usuario, guardadas
 * en main (templatesOps.js) a partir de un workspace existente.
 *
 * Módulo puro: sin DOM ni IPC, testeable en layoutTemplates.test.js.
 * --------------------------------------------------------------
 */
import { GRID_COLS } from './layout.js';

/** Alto "de referencia" de una distribución que llena la ventana (filas). */
export const TEMPLATE_ROWS = 20;

export const KINDS = ['terminal', 'webview', 'tasks', 'calculator', 'file'];

/** Campos de un tile que describen la distribución (todo lo demás es del workspace). */
const TEMPLATE_TILE_FIELDS = ['kind', 'title', 'col', 'row', 'colSpan', 'rowSpan', 'command', 'url', 'zoom'];

const term = (title, col, row, colSpan, rowSpan) => ({ kind: 'terminal', title, col, row, colSpan, rowSpan });

export const BUILTIN_TEMPLATES = [
  {
    id: 'vacio', builtin: true, name: 'Empezar en blanco',
    description: 'Sin tiles. Agregas lo que quieras después.',
    tiles: [],
  },
  {
    id: 'dos-terminales', builtin: true, name: 'Dos terminales',
    description: 'Dos terminales lado a lado, a toda la altura.',
    tiles: [term('Terminal 1', 1, 1, 24, 20), term('Terminal 2', 25, 1, 24, 20)],
  },
  {
    id: 'cuatro-columnas', builtin: true, name: 'Cuatro columnas',
    description: 'Cuatro terminales en columnas iguales. Pensada para monitores anchos.',
    tiles: [
      term('Terminal 1', 1, 1, 12, 20), term('Terminal 2', 13, 1, 12, 20),
      term('Terminal 3', 25, 1, 12, 20), term('Terminal 4', 37, 1, 12, 20),
    ],
  },
  {
    id: 'cuatro-mas-panel', builtin: true, name: 'Cuatro terminales + panel',
    description: 'Cuatro terminales angostas y, a la derecha, un navegador arriba y Discord abajo.',
    tiles: [
      term('Terminal 1', 1, 1, 8, 20), term('Terminal 2', 9, 1, 8, 20),
      term('Terminal 3', 17, 1, 8, 20), term('Terminal 4', 25, 1, 8, 20),
      { kind: 'webview', title: 'Navegador', url: 'https://www.google.com', col: 33, row: 1, colSpan: 16, rowSpan: 10 },
      { kind: 'webview', title: 'Discord', url: 'https://discord.com/app', col: 33, row: 11, colSpan: 16, rowSpan: 10 },
    ],
  },
  {
    id: 'terminal-tareas', builtin: true, name: 'Terminal principal + tareas',
    description: 'Una terminal grande arriba; abajo, una terminal auxiliar y las tareas del workspace.',
    tiles: [
      term('Terminal', 1, 1, 48, 14),
      term('Auxiliar', 1, 15, 24, 6),
      { kind: 'tasks', title: 'Tareas', col: 25, row: 15, colSpan: 24, rowSpan: 6 },
    ],
  },
];

const isPosInt = (n) => Number.isInteger(n) && n >= 1;

function overlaps(a, b) {
  return a.col < b.col + b.colSpan && a.col + a.colSpan > b.col
    && a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
}

/**
 * Valida una plantilla: nombre, `tiles` array, kinds conocidos, geometría
 * entera y positiva, dentro de las GRID_COLS columnas y sin solapes.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateTemplate(template) {
  if (!template || typeof template !== 'object') return { ok: false, error: 'Plantilla inválida.' };
  if (!template.name || !String(template.name).trim()) return { ok: false, error: 'La plantilla necesita un nombre.' };
  if (!Array.isArray(template.tiles)) return { ok: false, error: 'La plantilla necesita una lista de tiles.' };

  for (const [i, t] of template.tiles.entries()) {
    const label = t?.title || `tile ${i + 1}`;
    if (!t || !KINDS.includes(t.kind)) return { ok: false, error: `${label}: tipo desconocido "${t?.kind}".` };
    if (![t.col, t.row, t.colSpan, t.rowSpan].every(isPosInt)) {
      return { ok: false, error: `${label}: posición o tamaño inválidos.` };
    }
    if (t.col + t.colSpan - 1 > GRID_COLS) {
      return { ok: false, error: `${label}: se sale de las ${GRID_COLS} columnas de la grilla.` };
    }
  }
  for (let i = 0; i < template.tiles.length; i++) {
    for (let j = i + 1; j < template.tiles.length; j++) {
      if (overlaps(template.tiles[i], template.tiles[j])) {
        const a = template.tiles[i].title || `tile ${i + 1}`;
        const b = template.tiles[j].title || `tile ${j + 1}`;
        return { ok: false, error: `${a} y ${b} se solapan.` };
      }
    }
  }
  return { ok: true };
}

/**
 * Crea los tiles de un workspace nuevo a partir de una plantilla: ids
 * nuevos, `createdAt`, y solo los campos de distribución. No muta la
 * plantilla. Lanza si la plantilla no es válida.
 */
export function instantiateTemplate(template, { newId = () => crypto.randomUUID(), now = Date.now } = {}) {
  const check = validateTemplate(template);
  if (!check.ok) throw new Error(check.error);
  return template.tiles.map((t) => ({ id: newId(), createdAt: now(), ...pickTemplateFields(t) }));
}

/**
 * Extrae la distribución de un workspace existente como plantilla (sin
 * id: lo asigna el almacén al guardarla). Descarta ids, cwd, fechas y
 * cualquier otro dato que pertenezca al workspace y no a la distribución.
 */
export function templateFromProfile(profile, { name, description = '' } = {}) {
  return {
    name,
    description,
    tiles: (profile?.tiles || []).map(pickTemplateFields),
  };
}

function pickTemplateFields(tile) {
  const out = {};
  for (const key of TEMPLATE_TILE_FIELDS) {
    if (tile[key] != null) out[key] = tile[key];
  }
  return out;
}
