/**
 * src/renderer/components/fileTile.js
 * --------------------------------------------------------------
 * Tile de archivo fijado: deja un archivo del workspace a la vista
 * dentro del mosaico, al lado de las terminales y los webviews. Sirve
 * para tener presente un archivo de código, un PDF o una imagen sin
 * abrir el modal cada vez.
 *
 * Se crea desde el botón "Fijar" del modal de preview (fileTreeSidebar)
 * o desde "Agregar al espacio" (addToSpace).
 *
 * El contenido lo dibuja fileViewer.js, el mismo módulo que usa el
 * modal: un archivo se ve igual fijado que abierto.
 *
 * A diferencia de terminales y webviews, este tile NO es un "live tile":
 * no hay proceso ni estado en memoria que valga la pena preservar entre
 * workspaces — se destruye y se vuelve a leer del disco, que es barato.
 *
 * Lo que se persiste en el perfil es solo `relPath` + `name`; la ruta
 * absoluta se resuelve contra el cwd del workspace en cada render, así
 * el tile sigue funcionando si el proyecto se mueve de carpeta.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { fileIconEl } from '../core/fileIcons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';

export function createFileTile(tile) {
  const entry = { name: tile.name, relPath: tile.relPath };

  const body = h('div', { class: 'flex-1 min-h-0 overflow-auto p-2 text-xs' });

  const headerBtn = (icon, title, onClick) => h('button', {
    class: 'inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
    title,
    onClick,
  }, svgIcon(icon, { size: 13 }));

  // pl-7 le deja la esquina superior izquierda al handle de arrastre del
  // grid (.tile-handle-move, 28px) — si no, el header se lo come.
  const header = h('div', {
    class: 'flex items-center gap-1.5 pl-7 pr-1 py-1 border-b border-line shrink-0 text-xs',
    title: tile.relPath,
  }, [
    fileIconEl(tile.name),
    h('span', { class: 'truncate flex-1 min-w-0 text-fg-muted' }, tile.name),
    headerBtn('refresh', 'Recargar desde disco', () => load()),
    // Se pide por el bus en vez de importar fileTreeSidebar: ese módulo ya
    // importa tile.js (para "Fijar"), así que importarlo acá cerraría un
    // ciclo de imports.
    headerBtn('edit', 'Abrir en el modal (editar)', () => bus.emit('file:open-modal', entry)),
  ]);

  // La raíz DEBE llevar class 'tile' + dataset.tileId, como todos los tiles:
  // `.tile` aporta el `position: relative` contra el que se posicionan los
  // handles de mover/redimensionar que agrega bentoGrid, y el fondo opaco
  // (sin él se ve el wallpaper del workspace a través del contenido).
  const el = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: 'file' },
  }, [
    h('div', { class: 'flex flex-col h-full' }, [header, body]),
  ]);

  // La vigilancia sólo se puede armar sobre una carpeta que ya existe, y no
  // la creamos sólo por mirar — mismo patrón que tasksTile.js.
  let watching = false;
  let watchPending = false;
  async function ensureWatching(root) {
    if (watching || watchPending) return;
    watchPending = true;
    try {
      watching = await window.yusepe.explorer.watch(root, tile.relPath);
    } catch {
      /* si no se puede vigilar, queda el botón de recargar a mano */
    } finally {
      watchPending = false;
    }
  }

  async function load() {
    const root = state.profile?.cwd;
    if (!root) {
      body.innerHTML = '';
      body.append(h('p', { class: 'text-fg-subtle text-xs p-2' },
        'El workspace no tiene carpeta asociada.'));
      return;
    }
    // Import perezoso: fileViewer arrastra pdf.js y marked, y así el tile no
    // los carga hasta que realmente hay un archivo que mostrar.
    const { mountFileView } = await import('./fileViewer.js');
    await mountFileView(body, entry, { root, maxHeight: 'max-h-full' });
    ensureWatching(root);
  }

  load();

  // Si el archivo se edita desde el modal, el tile que lo muestra quedó viejo.
  const offChanged = bus.on('file:changed', (payload) => {
    if (payload?.relPath === tile.relPath) load();
  });

  // El archivo cambió por fuera de Bento (agente, editor externo, git) —
  // los MD/HTML fijados se usan de forma informativa y no vale la pena
  // pedirle al usuario que los refresque a mano cada vez.
  const offDisk = window.yusepe.explorer.onChangedOnDisk(({ root, relPath }) => {
    if (root === state.profile?.cwd && relPath === tile.relPath) load();
  });

  return {
    root: el,
    shutdown: () => {
      offChanged();
      offDisk();
      if (watching) window.yusepe.explorer.unwatch(state.profile?.cwd, tile.relPath);
    },
  };
}
