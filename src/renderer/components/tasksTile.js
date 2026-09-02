/**
 * src/renderer/components/tasksTile.js
 * --------------------------------------------------------------
 * Tile de Tareas: lista de pendientes del workspace con navegación
 * interna en dos pantallas (lista → detalle) con animación de
 * deslizamiento. No usa modales globales; todo ocurre dentro del tile.
 *
 * Las tareas NO se guardan en el perfil: son archivos `.md` reales en
 * `.ybento/tasks/` dentro del proyecto (ver src/main/tasksOps.js).
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { toast } from './toast.js';
import { openLaunchTemplate } from './launchTemplateModal.js';
import { renderTextInto } from './fileViewer.js';

export function createTasksTile(tile) {
  // ── Estado de vista ────────────────────────────────────────────────
  let currentTask = null;

  // ── Header (siempre visible, doble como handle de arrastre) ───────
  const titleEl = h('span', {
    class: 'flex-1 min-w-0 truncate text-fg-muted',
  }, 'Tareas');

  const countEl = h('span', { class: 'text-[10px] text-fg-subtle shrink-0' }, '');

  const backBtn = h('button', {
    class: 'hidden inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
    title: 'Volver a la lista',
    onClick: () => showList(),
  }, svgIcon('chevron-left', { size: 15 }));

  const iconEl = svgIcon('tasks', { size: 13 });

  const settingsBtn = h('button', {
    class: 'inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
    title: 'Editar la plantilla del launchText',
    onClick: () => openLaunchTemplate(cwd(), () => {}),
  }, svgIcon('settings', { size: 13 }));

  const refreshBtn = h('button', {
    class: 'inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
    title: 'Recargar desde disco',
    onClick: () => load(),
  }, svgIcon('refresh', { size: 13 }));

  const saveBtn = h('button', {
    class: 'hidden inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-accent hover:bg-accent-soft text-white transition shrink-0',
    title: 'Guardar (Ctrl+S)',
    onClick: () => saveDetail(),
  }, [svgIcon('save', { size: 12 }), h('span', {}, 'Guardar')]);

  const header = h('div', {
    class: 'flex items-center gap-1.5 pl-7 pr-1 py-1 border-b border-line shrink-0 text-xs',
  }, [backBtn, iconEl, titleEl, countEl, settingsBtn, refreshBtn, saveBtn]);

  // ── Pantalla 1: Lista ──────────────────────────────────────────────
  const listEl = h('div', { class: 'flex-1 min-h-0 overflow-y-auto px-1.5 pb-2' });

  const input = h('input', {
    type: 'text',
    placeholder: 'Nueva tarea…  (Enter)',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent',
  });

  // w-1/2 sobre un track de width:200% = 100% del contenedor visible
  const listScreen = h('div', {
    class: 'flex flex-col h-full w-1/2 shrink-0',
  }, [
    h('div', { class: 'px-1.5 py-1.5 shrink-0' }, [input]),
    listEl,
  ]);

  // ── Pantalla 2: Detalle ────────────────────────────────────────────
  const titleInput = h('input', {
    type: 'text',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent shrink-0',
    placeholder: 'Título de la tarea',
    spellcheck: false,
  });

  const notesInput = h('textarea', {
    class: 'flex-1 min-h-0 w-full bg-bg-elev border border-line rounded-md p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none',
    placeholder: 'Descripción de la tarea. Acepta Markdown.\n\nEs el cuerpo del .md, así que también podés editarlo fuera de Bento.',
    spellcheck: false,
  });

  const previewDiv = h('div', {
    class: 'hidden flex-1 min-h-0 overflow-auto border border-line rounded-md p-3 text-sm',
  });

  let previewing = false;

  const previewBtn = h('button', {
    class: 'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border border-line hover:bg-bg-elev transition shrink-0',
    onClick: () => {
      previewing = !previewing;
      notesInput.classList.toggle('hidden', previewing);
      previewDiv.classList.toggle('hidden', !previewing);
      previewBtn.querySelector('span').textContent = previewing ? 'Editar' : 'Vista previa';
      if (previewing) {
        renderTextInto(previewDiv, { name: 'task.md', raw: notesInput.value || '_(sin descripción)_' });
      }
    },
  }, [svgIcon('file', { size: 12 }), h('span', {}, 'Vista previa')]);

  const relPathEl = h('span', { class: 'text-[10px] text-fg-subtle truncate max-w-[60%]' });

  const detailScreen = h('div', {
    class: 'flex flex-col h-full w-1/2 shrink-0 px-2 pt-2 pb-2 gap-2',
  }, [
    titleInput,
    h('div', { class: 'flex items-center gap-1.5 shrink-0' }, [previewBtn, h('span', { class: 'flex-1' }), relPathEl]),
    notesInput,
    previewDiv,
  ]);

  // ── Slide track ────────────────────────────────────────────────────
  // El track mide 200% del contenedor y se desplaza con translateX(-50%)
  // para revelar la pantalla de detalle. La transición es CSS puro.
  const slideTrack = h('div', {
    class: 'flex h-full',
    style: 'width: 200%; transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1); will-change: transform;',
  }, [listScreen, detailScreen]);

  // ── Raíz del tile ──────────────────────────────────────────────────
  const el = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: 'tasks' },
  }, [
    h('div', { class: 'flex flex-col h-full' }, [
      header,
      h('div', { class: 'flex-1 min-h-0 overflow-hidden relative' }, [slideTrack]),
    ]),
  ]);

  const cwd = () => state.profile?.cwd || null;

  // ── Transiciones de pantalla ───────────────────────────────────────
  function showList({ skipLoad = false } = {}) {
    currentTask = null;
    // Header: volver al estado de lista
    backBtn.classList.add('hidden');
    iconEl.classList.remove('hidden');
    settingsBtn.classList.remove('hidden');
    refreshBtn.classList.remove('hidden');
    saveBtn.classList.add('hidden');
    countEl.classList.remove('hidden');
    titleEl.textContent = 'Tareas';
    // Slide hacia la izquierda → muestra la lista
    slideTrack.style.transform = 'translateX(0)';
    // Resetear estado del detalle
    previewing = false;
    notesInput.classList.remove('hidden');
    previewDiv.classList.add('hidden');
    if (previewBtn.querySelector('span')) previewBtn.querySelector('span').textContent = 'Vista previa';
    if (!skipLoad) load();
  }

  function showDetail(task) {
    currentTask = task;
    // Poblar el formulario
    titleInput.value = task.title;
    notesInput.value = task.notes || '';
    relPathEl.textContent = task.relPath;
    relPathEl.title = task.relPath;
    // Resetear vista previa
    previewing = false;
    notesInput.classList.remove('hidden');
    previewDiv.classList.add('hidden');
    if (previewBtn.querySelector('span')) previewBtn.querySelector('span').textContent = 'Vista previa';
    // Header: modo detalle (título de la tarea)
    titleEl.textContent = task.title;
    backBtn.classList.remove('hidden');
    iconEl.classList.add('hidden');
    settingsBtn.classList.add('hidden');
    refreshBtn.classList.add('hidden');
    saveBtn.classList.remove('hidden');
    countEl.classList.add('hidden');
    // Slide hacia el detalle (–50% del track de 200% = –100% del contenedor)
    slideTrack.style.transform = 'translateX(-50%)';
    // Foco al textarea tras la animación
    setTimeout(() => notesInput.focus(), 230);
  }

  // ── Guardar detalle ────────────────────────────────────────────────
  async function saveDetail() {
    if (!currentTask) return;
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return toast.error('La tarea necesita un título');
    }
    try {
      await window.yusepe.tasks.update(cwd(), currentTask.id, {
        title,
        notes: notesInput.value,
      });
      toast.success('Tarea guardada');
      await refreshAndNotify();
      showList({ skipLoad: true });
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  // Atajos de teclado en el detalle
  for (const field of [titleInput, notesInput]) {
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveDetail();
      }
      // Escape vuelve a la lista (solo si no está en modo previa, donde
      // sería más intuitivo cerrar la previa primero)
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!previewing) showList();
      }
    });
  }
  // En el campo título, Enter guarda
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveDetail(); }
  });

  // ── Renderizado de la lista ────────────────────────────────────────
  function renderEmpty(msg) {
    listEl.innerHTML = '';
    listEl.append(h('p', { class: 'text-fg-subtle text-xs px-1.5 py-3 text-center' }, msg));
  }

  function renderTask(task) {
    const box = h('span', {
      class: 'w-3.5 h-3.5 rounded-[4px] border shrink-0 grid place-items-center transition ' +
        (task.done ? 'bg-accent border-accent text-white' : 'border-line text-transparent'),
    }, svgIcon('check', { size: 9 }));

    const checkBtn = h('button', {
      class: 'shrink-0 pt-0.5 rounded',
      title: task.done ? 'Marcar como pendiente' : 'Marcar como hecha',
      onClick: () => toggle(task),
    }, [box]);

    const titleBtn = h('button', {
      class: 'flex-1 min-w-0 text-left text-xs leading-snug break-words ' +
        (task.done ? 'line-through text-fg-subtle' : 'text-fg'),
      title: 'Abrir detalle',
      onClick: () => showDetail(task),
    }, [
      h('span', {}, task.title),
      task.notes
        ? h('span', { class: 'ml-1.5 align-middle inline-flex text-fg-subtle', title: 'Tiene descripción' },
          svgIcon('file', { size: 10 }))
        : null,
    ]);

    return h('div', {
      class: 'group flex items-start gap-2 rounded px-1.5 py-1 hover:bg-bg-elev',
      title: task.relPath,
    }, [
      checkBtn,
      titleBtn,
      h('button', {
        class: 'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-accent/10 transition',
        title: 'Copiar launchText para el agente',
        onClick: () => copyLaunchText(task),
      }, svgIcon('copy', { size: 12 })),
      h('button', {
        class: 'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition',
        title: 'Eliminar tarea',
        onClick: () => remove(task),
      }, svgIcon('trash', { size: 12 })),
    ]);
  }

  let watching = false;
  let watchPending = false;
  async function ensureWatching() {
    const root = cwd();
    if (watching || watchPending || !root) return;
    watchPending = true;
    try {
      watching = await window.yusepe.tasks.watch(root);
    } catch {
      /* sin vigilancia, queda el botón de recargar a mano */
    } finally {
      watchPending = false;
    }
  }

  async function load() {
    const root = cwd();
    input.disabled = !root;
    if (!root) {
      countEl.textContent = '';
      return renderEmpty('Este workspace no tiene carpeta asociada, así que no hay dónde guardar tareas.');
    }

    let tasks;
    try {
      tasks = await window.yusepe.tasks.list(root);
    } catch (err) {
      countEl.textContent = '';
      return renderEmpty(err?.message || String(err));
    }

    ensureWatching();

    const pending = tasks.filter((t) => !t.done).length;
    countEl.textContent = tasks.length ? `${pending}/${tasks.length}` : '';

    if (!tasks.length) return renderEmpty('Sin tareas todavía. Escribí arriba para agregar la primera.');

    listEl.innerHTML = '';
    for (const task of tasks) listEl.append(renderTask(task));
  }

  async function refreshAndNotify() {
    await load();
    bus.emit('tasks:changed', { tileId: tile.id });
  }

  async function mutate(fn) {
    try {
      await fn();
      await refreshAndNotify();
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  function add(title) {
    return mutate(async () => {
      await window.yusepe.tasks.create(cwd(), title);
      input.value = '';
    });
  }

  function toggle(task) {
    return mutate(() => window.yusepe.tasks.setDone(cwd(), task.id, !task.done));
  }

  function remove(task) {
    return mutate(() => window.yusepe.tasks.remove(cwd(), task.id));
  }

  async function copyLaunchText(task) {
    try {
      const text = await window.yusepe.tasks.launchText(cwd(), task.id);
      await window.yusepe.clipboard.writeText(text);
      toast.success('launchText copiado — pegáselo a tu agente');
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const title = input.value.trim();
      if (title) add(title);
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  load();

  const offChanged = bus.on('tasks:changed', (payload) => {
    if (payload?.tileId !== tile.id) load();
  });

  const offDisk = window.yusepe.tasks.onChangedOnDisk(({ cwd: changed }) => {
    if (changed === cwd()) load();
  });

  return {
    root: el,
    shutdown: () => {
      offChanged();
      offDisk();
      if (watching) window.yusepe.tasks.unwatch(cwd());
    },
  };
}
