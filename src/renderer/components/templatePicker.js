/**
 * src/renderer/components/templatePicker.js
 * --------------------------------------------------------------
 * Selector de plantilla de distribución (tercer paso de "Nuevo
 * workspace"): tarjetas con una miniatura de la grilla, nombre y
 * descripción. Primero las incorporadas (core/layoutTemplates.js), luego
 * las guardadas por el usuario (main/templatesOps.js), que se pueden
 * borrar desde acá.
 *
 * `pickTemplate()` resuelve con la plantilla elegida, o con `null` si se
 * cierra el modal sin elegir (Esc, ×, clic fuera, "Cancelar").
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal, confirmModal } from './modal.js';
import { BUILTIN_TEMPLATES, TEMPLATE_ROWS, validateTemplate } from '../core/layoutTemplates.js';
import { GRID_COLS } from '../core/layout.js';
import { bus } from '../core/eventBus.js';

const KIND_CLASS = {
  terminal: 'bg-accent/70',
  webview: 'bg-sky-400/60',
  tasks: 'bg-amber-400/60',
  calculator: 'bg-emerald-400/60',
  file: 'bg-fuchsia-400/60',
};

/** Miniatura de la distribución: una celda de la grilla = un cuadradito. */
export function templateThumbnail(template) {
  const rows = Math.max(TEMPLATE_ROWS, ...template.tiles.map((t) => t.row + t.rowSpan - 1));
  const grid = h('div', {
    class: 'rounded border border-line bg-bg-elev/60 p-1',
    style: `display:grid;grid-template-columns:repeat(${GRID_COLS},1fr);grid-template-rows:repeat(${rows},4px);gap:1px;`,
  });
  for (const t of template.tiles) {
    grid.append(h('div', {
      class: `rounded-[2px] ${KIND_CLASS[t.kind] || 'bg-fg-subtle/40'}`,
      style: `grid-column:${t.col} / span ${t.colSpan};grid-row:${t.row} / span ${t.rowSpan};`,
      title: t.title || t.kind,
    }));
  }
  if (!template.tiles.length) {
    grid.append(h('div', {
      class: 'text-[10px] text-fg-subtle flex items-center justify-center',
      style: `grid-column:1 / span ${GRID_COLS};grid-row:1 / span ${rows};`,
    }, 'vacío'));
  }
  return grid;
}

async function loadUserTemplates() {
  try {
    const list = await window.yusepe.templates.list();
    return (list || []).filter((t) => validateTemplate(t).ok);
  } catch (err) {
    bus.emit('toast', { type: 'error', message: `No se pudieron leer las plantillas guardadas: ${err?.message || err}` });
    return [];
  }
}

export function pickTemplate() {
  return new Promise((resolve) => {
    let settled = false;
    // Mientras el selector cierra el modal por su cuenta (para mostrar un
    // confirm y reabrirse), el onClose del modal no debe resolver `null`.
    let ignoreClose = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const onClose = () => { if (!ignoreClose) finish(null); };

    const list = h('div', { class: 'grid grid-cols-2 gap-3 max-h-[62vh] overflow-auto pr-1' });
    const body = h('div', {}, [
      h('p', { class: 'text-xs text-fg-subtle mb-3' },
        'Elige cómo quieres que arranque el workspace. Todo se puede mover y redimensionar después.'),
      list,
      h('button', {
        class: 'mt-3 w-full bg-bg-elev hover:bg-line text-fg-soft text-sm py-2 rounded-md transition',
        onClick: () => { finish(null); closeModal(); },
      }, 'Cancelar'),
    ]);

    openModal({ title: 'Distribución del workspace', body, size: 'lg', onClose });

    render();

    async function render() {
      list.innerHTML = '';
      for (const t of BUILTIN_TEMPLATES) list.append(card(t, false));
      const mine = await loadUserTemplates();
      if (settled) return;
      if (mine.length) {
        list.append(h('div', { class: 'col-span-2 text-[11px] font-medium text-fg-subtle uppercase tracking-wide mt-1' }, 'Mis plantillas'));
        for (const t of mine) list.append(card(t, true));
      }
    }

    function card(template, deletable) {
      const el = h('button', {
        type: 'button',
        class: 'text-left rounded-lg border border-line hover:border-accent hover:bg-bg-elev/60 p-3 transition flex flex-col gap-2 focus:outline-none focus:ring-1 focus:ring-accent',
        // Resolver ANTES de cerrar: closeModal() dispara onClose, que de
        // otro modo resolvería null y cancelaría la creación.
        onClick: () => { finish(template); closeModal(); },
      }, [
        templateThumbnail(template),
        h('div', { class: 'flex items-start gap-2' }, [
          h('div', { class: 'flex-1 min-w-0' }, [
            h('div', { class: 'text-sm font-medium truncate' }, template.name),
            template.description
              ? h('div', { class: 'text-xs text-fg-subtle leading-snug' }, template.description)
              : null,
            h('div', { class: 'text-[10px] text-fg-subtle mt-1' },
              template.tiles.length ? `${template.tiles.length} tile(s)` : 'sin tiles'),
          ]),
          deletable ? h('span', {
            class: 'inline-flex items-center justify-center w-6 h-6 rounded border border-line hover:border-red-400 hover:bg-red-400/10 hover:text-red-400 text-fg-muted transition shrink-0',
            title: 'Borrar esta plantilla',
            role: 'button',
            onClick: async (e) => {
              e.stopPropagation();
              e.preventDefault();
              // El confirm abre su propio modal encima; al volver, se
              // reabre el selector con la lista actualizada.
              ignoreClose = true;
              closeModal();
              ignoreClose = false;
              const ok = await confirmModal({
                title: 'Borrar plantilla',
                body: `¿Borrar la plantilla "${template.name}"? Los workspaces ya creados con ella no cambian.`,
                confirmLabel: 'Borrar',
                danger: true,
              });
              if (ok) {
                try { await window.yusepe.templates.delete(template.id); }
                catch (err) { bus.emit('toast', { type: 'error', message: err?.message || String(err) }); }
              }
              if (settled) return;
              openModal({ title: 'Distribución del workspace', body, size: 'lg', onClose });
              render();
            },
          }, svgIcon('trash', { size: 13 })) : null,
        ]),
      ]);
      return el;
    }
  });
}
