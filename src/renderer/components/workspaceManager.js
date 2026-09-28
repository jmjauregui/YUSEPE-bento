/**
 * src/renderer/components/workspaceManager.js
 * --------------------------------------------------------------
 * Panel "Administrador del workspace" (🧰): tabla con todos los tiles
 * del workspace activo — nombre, tamaño (colSpan x rowSpan) y, por tipo:
 *   - terminal: comando precargado, editable — "Aplicar" lo persiste y,
 *     si la terminal ya está viva, lo tipea y ejecuta ahí mismo.
 *   - webview: URL editable, prellenada con la URL *actual* de navegación
 *     (no la de creación) — "Usar esta URL" navega ahí y la fija como URL
 *     principal del tile (lo que carga la próxima vez que se abra).
 *     Además, control de zoom a nivel Chromium (setZoomFactor), que
 *     funciona incluso en sitios que bloquean el zoom del navegador.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { bus } from '../core/eventBus.js';
import { state } from '../core/state.js';
import { openModal, promptModal } from './modal.js';
import { ProfileManager } from '../core/profileManager.js';
import * as liveTiles from '../core/liveTiles.js';
import { normalizeUrl } from './webviewTile.js';
import { templateFromProfile, validateTemplate } from '../core/layoutTemplates.js';

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

function liveWebview(tileId) {
  const entry = liveTiles.get(tileId);
  return entry?.kind === 'webview' ? entry.meta?.webview : null;
}

function livePtyId(tileId) {
  const entry = liveTiles.get(tileId);
  return entry?.kind === 'terminal' ? entry.meta?.ptyId : null;
}

export function labelFor(tile) {
  if (tile.kind === 'terminal') {
    if (tile.command) {
      const lastSegment = tile.command.split(/&&|;|\|/).pop().trim();
      const short = lastSegment.split(/\s+/)[0] || '';
      return short ? `Terminal (${short})` : 'Terminal';
    }
    return 'Terminal';
  }
  if (tile.kind === 'webview') return tile.title || 'Webview';
  if (tile.kind === 'calculator') return 'Calculadora';
  return tile.kind;
}

export function openWorkspaceManager() {
  if (!state.profile) {
    openModal({
      title: 'Administrador del workspace',
      body: h('p', { class: 'text-sm text-fg-soft' },
        'Crea o selecciona un workspace primero.'),
    });
    return;
  }

  const table = h('table', { class: 'w-full text-xs border-collapse' });

  // "Guardar distribución como plantilla": la geometría de los tiles de
  // este workspace queda disponible en el selector de "Nuevo workspace".
  const saveTemplateBtn = h('button', {
    class: 'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-line hover:bg-bg-elev transition',
    title: 'Guarda la posición y tamaño de estos tiles como plantilla para crear otros workspaces iguales',
    onClick: saveAsTemplate,
  }, [svgIcon('save', { size: 13 }), h('span', {}, 'Guardar distribución como plantilla')]);

  openModal({
    title: 'Administrador del workspace',
    body: h('div', {}, [
      h('p', { class: 'text-xs text-fg-subtle mb-3' },
        'Tiles abiertos en este espacio de trabajo.'),
      h('div', { class: 'max-h-[62vh] overflow-auto' }, [table]),
      h('div', { class: 'mt-3 flex justify-end' }, [saveTemplateBtn]),
    ]),
    size: 'lg',
  });

  async function saveAsTemplate() {
    const profile = state.profile;
    if (!profile) return;
    const tiles = profile.tiles || [];
    // Reabrir el administrador después: promptModal usa el mismo modal.
    const name = await promptModal({
      title: 'Guardar como plantilla',
      label: tiles.length
        ? `Se guardará la distribución de ${tiles.length} tile(s). Nombre de la plantilla:`
        : 'Este workspace no tiene tiles: la plantilla quedará vacía. Nombre de la plantilla:',
      placeholder: 'ej. Cuatro terminales + Discord',
      confirmLabel: 'Guardar',
    });
    if (!name) { openWorkspaceManager(); return; }
    const template = templateFromProfile(profile, { name });
    const check = validateTemplate(template);
    if (!check.ok) {
      bus.emit('toast', { type: 'error', message: `No se pudo guardar la plantilla: ${check.error}` });
      openWorkspaceManager();
      return;
    }
    try {
      await window.yusepe.templates.create(template);
      bus.emit('toast', { type: 'success', message: `Plantilla "${name}" guardada. La verás al crear un workspace.` });
    } catch (err) {
      bus.emit('toast', { type: 'error', message: err?.message || String(err) });
    }
    openWorkspaceManager();
  }

  render();

  function render() {
    const tiles = state.profile.tiles || [];
    table.innerHTML = '';

    table.append(h('thead', {}, [
      h('tr', { class: 'text-left text-fg-subtle border-b border-line' }, [
        h('th', { class: 'py-1.5 pr-2 font-medium w-40' }, 'Nombre'),
        h('th', { class: 'py-1.5 pr-2 font-medium w-16' }, 'Tamaño'),
        h('th', { class: 'py-1.5 pr-2 font-medium' }, 'Comando / URL'),
        h('th', { class: 'py-1.5 pr-2 font-medium w-36' }, 'Zoom'),
        h('th', { class: 'py-1.5 pr-2 font-medium w-10' }, ''),
      ]),
    ]));

    const tbody = h('tbody', {});
    if (!tiles.length) {
      tbody.append(h('tr', {}, [
        h('td', { colspan: '5', class: 'py-4 text-fg-subtle text-center' },
          'Este workspace no tiene tiles abiertos.'),
      ]));
    } else {
      for (const tile of tiles) tbody.append(row(tile));
    }
    table.append(tbody);
  }

  function row(tile) {
    const tr = h('tr', { class: 'border-b border-line/60 align-top' });
    tr.append(
      h('td', { class: 'py-2 pr-2 whitespace-nowrap truncate' }, labelFor(tile)),
      h('td', { class: 'py-2 pr-2 whitespace-nowrap text-fg-subtle' }, `${tile.colSpan || 1}x${tile.rowSpan || 1}`),
      commandOrUrlCell(tile),
      zoomCell(tile),
      actionsCell(tile),
    );
    return tr;
  }

  function actionsCell(tile) {
    const td = h('td', { class: 'py-2 pr-1 whitespace-nowrap text-right' });
    td.append(h('button', {
      class: 'inline-flex items-center justify-center w-6 h-6 rounded border border-line hover:border-red-400 hover:bg-red-400/10 hover:text-red-400 text-fg-muted transition',
      title: 'Eliminar tile',
      onClick: async () => {
        try {
          await ProfileManager.removeTile(tile.id);
        } catch (err) {
          // Terminal protegida por pertenecer a un loop.
          bus.emit('toast', { type: 'error', message: err?.message || String(err) });
          return;
        }
        render();
      },
    }, svgIcon('trash', { size: 13 })));
    return td;
  }

  function commandOrUrlCell(tile) {
    const td = h('td', { class: 'py-2 pr-2' });

    if (tile.kind === 'terminal') {
      const input = h('input', {
        type: 'text',
        value: tile.command || '',
        placeholder: '(shell interactivo, sin comando precargado)',
        class: 'w-full bg-bg-elev border border-line rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent',
      });
      const applyBtn = h('button', {
        class: 'text-[10px] px-2 py-1 rounded border border-line hover:bg-bg-elev transition shrink-0',
        title: 'Guarda el comando (se precargará la próxima vez) y, si la terminal ya está corriendo, lo ejecuta ahora mismo',
        onClick: async () => {
          const value = input.value.trim();
          await ProfileManager.updateTile(tile.id, { command: value || null });
          const ptyId = livePtyId(tile.id);
          if (value && ptyId) window.yusepe.pty.input(ptyId, `${value}\r`);
        },
      }, '▶ Aplicar');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBtn.click(); });
      td.append(h('div', { class: 'flex items-center gap-1' }, [input, applyBtn]));
      return td;
    }

    if (tile.kind === 'webview') {
      let current = tile.url || '';
      const webview = liveWebview(tile.id);
      if (webview) { try { current = webview.getURL() || current; } catch { /* noop */ } }

      const input = h('input', {
        type: 'text',
        value: current,
        class: 'w-full bg-bg-elev border border-line rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent',
      });
      const pinBtn = h('button', {
        class: 'inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-line hover:bg-bg-elev transition shrink-0',
        title: 'Navega ahí y la fija como URL principal del tile (la que carga la próxima vez que se abra)',
        onClick: async () => {
          const normalized = normalizeUrl(input.value);
          if (!normalized) {
            input.classList.add('ring-1', 'ring-red-400');
            return;
          }
          input.classList.remove('ring-1', 'ring-red-400');
          input.value = normalized;
          await ProfileManager.updateTile(tile.id, { url: normalized });
          const wv = liveWebview(tile.id);
          if (wv) { try { await wv.loadURL(normalized); } catch { /* noop */ } }
        },
      }, [svgIcon('pin', { size: 12 }), h('span', {}, 'Usar esta URL')]);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') pinBtn.click(); });
      td.append(h('div', { class: 'flex items-center gap-1' }, [input, pinBtn]));
      return td;
    }

    td.append(h('span', { class: 'text-fg-subtle' }, '—'));
    return td;
  }

  function zoomCell(tile) {
    const td = h('td', { class: 'py-2 pr-2 whitespace-nowrap' });
    if (tile.kind !== 'webview') {
      td.append(h('span', { class: 'text-fg-subtle' }, '—'));
      return td;
    }

    let factor = tile.zoom || 1;
    const webview = liveWebview(tile.id);
    if (webview) { try { factor = webview.getZoomFactor() || factor; } catch { /* noop */ } }

    const label = h('span', { class: 'text-fg-soft w-9 inline-block text-center' }, `${Math.round(factor * 100)}%`);

    async function setZoom(next) {
      factor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      const wv = liveWebview(tile.id);
      if (wv) { try { wv.setZoomFactor(factor); } catch { /* noop */ } }
      label.textContent = `${Math.round(factor * 100)}%`;
      await ProfileManager.updateTile(tile.id, { zoom: factor });
    }

    td.append(h('div', { class: 'flex items-center gap-1' }, [
      h('button', {
        class: 'w-6 h-6 rounded border border-line hover:bg-bg-elev text-xs leading-none',
        title: 'Alejar (achica el contenido del tile)',
        onClick: () => setZoom(factor - ZOOM_STEP),
      }, '－'),
      label,
      h('button', {
        class: 'w-6 h-6 rounded border border-line hover:bg-bg-elev text-xs leading-none',
        title: 'Acercar (agranda el contenido del tile)',
        onClick: () => setZoom(factor + ZOOM_STEP),
      }, '＋'),
      h('button', {
        class: 'text-[10px] px-1.5 py-1 rounded border border-line hover:bg-bg-elev text-fg-subtle transition',
        title: 'Restablecer zoom',
        onClick: () => setZoom(1),
      }, '100%'),
    ]));
    return td;
  }
}
