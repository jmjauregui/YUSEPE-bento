/**
 * src/renderer/components/snippetsSidebar.js
 * --------------------------------------------------------------
 * Panel lateral de snippets (estilo Termius): librería global de
 * comandos/rutinas multi-línea, ocultable igual que el árbol de
 * archivos (ver fileTreeSidebar.js), pero flotando del lado derecho.
 *
 * Click en un snippet lo tipea+ejecuta en la terminal enfocada (o la
 * primera terminal del workspace si ninguna está enfocada) — cada línea
 * del script se manda seguida de `\r` (carriage return, lo que pty
 * espera como "Enter"), como si el usuario la hubiera tipeado a mano.
 * Los snippets NO pertenecen a un workspace puntual: viven en
 * <userData>/snippets.json (ver main/snippetsOps.js), disponibles desde
 * cualquier terminal de cualquier perfil.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { openModal, closeModal, confirmModal } from './modal.js';
import * as liveTiles from '../core/liveTiles.js';
import { focusTileById, getFocusedTileId } from './bentoGrid.js';
import { pickTerminal } from './terminalPicker.js';

let panelEl = null;
let listEl = null;
let statusEl = null;
let isOpen = false;

export function initSnippetsSidebar() {
  panelEl = document.getElementById('snippets-sidebar');
  if (!panelEl) return;

  buildChrome();
  bus.on('profile:cleared', closeSidebar);
}

export function isSnippetsSidebarOpen() {
  return isOpen;
}

export function toggleSnippetsSidebar() {
  if (!state.profile) return;
  if (isOpen) closeSidebar();
  else openSidebar();
}

function buildChrome() {
  panelEl.innerHTML = '';

  const closeBtn = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
    title: 'Cerrar snippets',
    onClick: closeSidebar,
  }, svgIcon('close', { size: 15 }));

  const title = h('div', { class: 'text-xs text-fg-soft flex-1 flex items-center gap-1.5' }, [
    h('span', { class: 'text-accent-soft flex items-center' }, svgIcon('snippets', { size: 14 })),
    h('span', {}, 'Snippets'),
  ]);

  const header = h('div', { class: 'flex items-center gap-1.5 px-2 py-1.5 border-b border-line' }, [title, closeBtn]);

  const newBtn = h('button', {
    class: 'w-[calc(100%-1rem)] mx-2 mt-2 text-xs px-2.5 py-1.5 rounded-md border border-line hover:bg-bg-elev transition',
    onClick: () => openSnippetEditor(),
  }, '+ Nuevo snippet');

  statusEl = h('div', { class: 'hidden mx-2 mt-2 text-[10px] text-accent-soft bg-accent/10 border border-accent/30 rounded px-2 py-1' });

  listEl = h('div', { class: 'flex-1 overflow-y-auto text-xs py-2 px-1.5' });

  panelEl.append(header, newBtn, statusEl, listEl);
  panelEl.classList.add('flex', 'flex-col');
}

function openSidebar() {
  if (!panelEl) return;
  isOpen = true;
  panelEl.classList.remove('hidden');
  renderList();
}

function closeSidebar() {
  if (!panelEl) return;
  isOpen = false;
  panelEl.classList.add('hidden');
}

function flashStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
  clearTimeout(statusEl._timer);
  statusEl._timer = setTimeout(() => statusEl.classList.add('hidden'), 2500);
}

async function renderList() {
  listEl.innerHTML = '';
  listEl.append(h('p', { class: 'text-fg-subtle text-xs px-1.5' }, 'Cargando…'));

  let snippets;
  try {
    snippets = await window.yusepe.snippets.list();
  } catch (err) {
    listEl.innerHTML = '';
    listEl.append(h('p', { class: 'text-red-400 text-xs px-1.5' }, err?.message || String(err)));
    return;
  }

  listEl.innerHTML = '';
  if (!snippets.length) {
    listEl.append(h('p', { class: 'text-fg-subtle text-xs px-1.5' },
      'Sin snippets todavía. Creá uno con "+ Nuevo snippet".'));
    return;
  }
  for (const snippet of snippets) listEl.append(snippetRow(snippet));
}

function snippetRow(snippet) {
  const lines = (snippet.script || '').split('\n').filter((l) => l.trim());
  const preview = lines[0] || '(vacío)';
  const extra = lines.length > 1 ? ` (+${lines.length - 1} línea${lines.length > 2 ? 's' : ''})` : '';

  return h('div', {
    class: 'group relative px-2 py-1.5 rounded-md hover:bg-bg-elev cursor-pointer border border-transparent hover:border-line transition mb-0.5',
    title: 'Click para ejecutar en la terminal enfocada (o elegir cuál, si hay varias)',
    onClick: () => runSnippet(snippet),
  }, [
    h('div', { class: 'flex items-center gap-1.5' }, [
      h('span', { class: 'text-accent-soft shrink-0 flex items-center' }, svgIcon('snippets', { size: 12 })),
      h('span', { class: 'text-xs text-fg truncate flex-1' }, snippet.name),
      h('div', { class: 'hidden group-hover:flex gap-0.5 shrink-0' }, [
        h('button', {
          class: 'inline-flex items-center text-fg-muted hover:text-fg px-1',
          title: 'Editar',
          onClick: (e) => { e.stopPropagation(); openSnippetEditor(snippet); },
        }, svgIcon('edit', { size: 13 })),
        h('button', {
          class: 'inline-flex items-center text-fg-muted hover:text-red-400 px-1',
          title: 'Eliminar',
          onClick: (e) => { e.stopPropagation(); deleteSnippet(snippet); },
        }, svgIcon('trash', { size: 13 })),
      ]),
    ]),
    h('div', { class: 'text-[10px] text-fg-subtle truncate mt-0.5 font-mono' }, `${preview}${extra}`),
  ]);
}

async function deleteSnippet(snippet) {
  const confirmed = await confirmModal({
    title: 'Eliminar snippet',
    body: `¿Eliminar "${snippet.name}"? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!confirmed) return;
  await window.yusepe.snippets.delete(snippet.id);
  renderList();
}

function openSnippetEditor(existing) {
  const nameInput = h('input', {
    type: 'text',
    value: existing?.name || '',
    placeholder: 'Nombre del snippet',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const scriptArea = h('textarea', {
    placeholder: 'cd mi-carpeta\ngit pull\nnpm run build',
    class: 'w-full h-48 bg-bg-elev border border-line rounded-md p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent',
    spellcheck: 'false',
  });
  scriptArea.value = existing?.script || '';
  const error = h('div', { class: 'text-xs text-red-400 mt-2 hidden' });

  const saveBtn = h('button', {
    class: 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
    onClick: async () => {
      const name = nameInput.value.trim();
      if (!name) {
        error.textContent = 'El nombre no puede estar vacío';
        error.classList.remove('hidden');
        return;
      }
      try {
        if (existing) await window.yusepe.snippets.update(existing.id, { name, script: scriptArea.value });
        else await window.yusepe.snippets.create({ name, script: scriptArea.value });
        closeModal();
        renderList();
      } catch (err) {
        error.textContent = err?.message || String(err);
        error.classList.remove('hidden');
      }
    },
  }, existing ? 'Guardar cambios' : 'Crear snippet');

  openModal({
    title: existing ? `Editar snippet: ${existing.name}` : 'Nuevo snippet',
    body: h('div', {}, [
      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Nombre'),
      nameInput,
      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Script (una línea por comando — se ejecuta línea por línea, como si la tipearas a mano)'),
      scriptArea,
      error,
      saveBtn,
    ]),
  });
  setTimeout(() => nameInput.focus(), 0);
}

/** Cada línea + `\r` (carriage return = "Enter" para el pty). */
function toPtyInput(script) {
  const lines = (script || '').replace(/\r\n/g, '\n').split('\n');
  return `${lines.join('\r')}\r`;
}

async function runSnippet(snippet) {
  const tiles = state.profile?.tiles || [];
  const focusedId = getFocusedTileId();
  const terminals = tiles.filter((t) => t.kind === 'terminal');
  let target = terminals.find((t) => t.id === focusedId);

  // Sin terminal enfocada y más de una candidata: silenciosamente elegir
  // "la primera" es justo lo que manda un comando a donde el usuario no
  // esperaba. Misma guía visual que el loop al elegir terminal.
  if (!target && terminals.length > 1) {
    target = await pickTerminal(terminals, {
      title: `Ejecutar "${snippet.name}" en…`,
      hint: 'No hay ninguna terminal enfocada — elegí a cuál mandarle el comando.',
    });
    if (!target) return;
  } else if (!target) {
    target = terminals[0];
  }

  if (!target) {
    flashStatus('No hay ninguna terminal en este workspace.');
    return;
  }

  const entry = liveTiles.get(target.id);
  const ptyId = entry?.kind === 'terminal' ? entry.meta?.ptyId : null;
  if (!ptyId) {
    flashStatus('La terminal todavía no está lista — probá de nuevo en un segundo.');
    return;
  }

  focusTileById(target.id);
  window.yusepe.pty.input(ptyId, toPtyInput(snippet.script));
}
