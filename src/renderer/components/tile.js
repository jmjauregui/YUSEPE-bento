/**
 * src/renderer/components/tile.js
 * --------------------------------------------------------------
 * Factoría de tiles. Nuevos tiles incluyen colSpan/rowSpan
 * para el grid manual de 48 columnas.
 * --------------------------------------------------------------
 */
import { ProfileManager } from '../core/profileManager.js';
import { uid } from '../utils/dom.js';
import { createWebviewTile, normalizeUrl } from './webviewTile.js';
import { createCalculatorTile } from './calculator.js';
import { createTerminalTile } from './terminal.js';
import { createFileTile } from './fileTile.js';
import { createTasksTile } from './tasksTile.js';

/**
 * Contrato de toda factoría de tiles: devuelve `{ root, shutdown? }` donde
 * `root` es el elemento del tile en sí — no un wrapper interno. Ese nodo
 * DEBE tener:
 *
 *   class: 'tile'                       -> `position: relative` (los handles
 *                                          de mover/redimensionar que agrega
 *                                          bentoGrid son absolute y se
 *                                          posicionan contra él) + el fondo
 *                                          opaco del tile.
 *   dataset: { tileId: t.id, kind }     -> identifica el tile en el DOM.
 *
 * Sin la clase `tile` el tile se ve translúcido (deja pasar el wallpaper) y
 * no se puede ni mover ni redimensionar.
 */
const factories = {
  webview:    (t, profileId) => createWebviewTile(t, profileId),
  calculator: (t) => createCalculatorTile(t),
  terminal:   async (t, profileId) => createTerminalTile(t, profileId),
  file:       (t) => createFileTile(t),
  tasks:      (t) => createTasksTile(t),
};

export async function addTile({ kind, ...rest }) {
  const tile = {
    id: uid(),
    kind,
    createdAt: Date.now(),
    ...rest,
  };
  await ProfileManager.addTile(tile);
  return tile;
}

export const TileFactory = {
  fromUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    return addTile({
      kind: 'webview',
      url,
      title: domainOf(url),
      colSpan: 16,
      rowSpan: 8,
    });
  },

  calculator() {
    return addTile({ kind: 'calculator', colSpan: 16, rowSpan: 8 });
  },

  /**
   * Lista de tareas del workspace. No guarda nada en el perfil: las tareas
   * son .md en `.ybento/tasks/` del proyecto (ver main/tasksOps.js).
   */
  tasks() {
    return addTile({ kind: 'tasks', title: 'Tareas', colSpan: 12, rowSpan: 10 });
  },

  terminal(cwd = null) {
    return addTile({ kind: 'terminal', colSpan: 24, rowSpan: 8, cwd: cwd || null });
  },

  /** Terminal que ejecuta `command` automáticamente al abrirse. */
  terminalPreloaded(command, cwd = null) {
    return addTile({
      kind: 'terminal',
      colSpan: 24,
      rowSpan: 8,
      cwd: cwd || null,
      command: command || null,
    });
  },

  /**
   * Archivo fijado en el mosaico. Se guarda `relPath` (no la ruta absoluta):
   * se resuelve contra el cwd del workspace en cada render, así el tile
   * sobrevive a que el proyecto cambie de carpeta.
   */
  file(entry) {
    return addTile({
      kind: 'file',
      relPath: entry.relPath,
      name: entry.name,
      title: entry.name,
      colSpan: 16,
      rowSpan: 10,
    });
  },

  fromApp(app) {
    return addTile({
      kind: 'webview',
      url: app.url,
      title: app.name,
      icon: app.icon,
      appId: app.id,
      colSpan: 16,
      rowSpan: 8,
    });
  },
};

export function removeTileById(tileId) {
  return ProfileManager.removeTile(tileId);
}

/**
 * Renderiza un tile y devuelve { node, dispose }.
 */
export async function renderTile(tile, profileId) {
  const factory = factories[tile.kind];
  if (!factory) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.tileId = tile.id;
    el.dataset.kind = 'unknown';
    el.innerHTML = `<div class="p-3 text-xs text-fg-muted">Tile desconocido: ${tile.kind}</div>`;
    return { node: el, dispose: null };
  }
  const out = await factory(tile, profileId);
  return { node: out.root, dispose: out.shutdown || null };
}

function domainOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); }
  catch { return url; }
}
