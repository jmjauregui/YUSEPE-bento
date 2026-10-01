/**
 * src/renderer/components/modal.js
 * --------------------------------------------------------------
 * Modal genérico + promptModal (reemplazo de prompt) + confirmModal.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';

const root = () => document.getElementById('modal-root');
const panelEl = () => document.getElementById('modal-panel');
const titleEl = () => document.getElementById('modal-title');
const bodyEl = () => document.getElementById('modal-body');
const closeBtn = () => document.getElementById('modal-close');

const SIZE_CLASSES = {
  md: 'w-[520px] max-w-[92vw]',
  lg: 'w-[880px] max-w-[92vw]',
};

let escListener = null;
// Callback de cierre del modal actual (Esc, ×, clic fuera o closeModal()).
// Lo usan los selectores que devuelven una promesa, para resolver `null`
// cuando el usuario cierra sin elegir (ver templatePicker.js).
let onCloseCb = null;

/**
 * `size`: 'md' (default, prompts/confirms) | 'lg' (preview de archivos/código).
 * `onClose`: se invoca una sola vez cuando el modal se cierra por cualquier vía.
 */
export function openModal({ title, body, size = 'md', onClose = null }) {
  onCloseCb = typeof onClose === 'function' ? onClose : null;
  titleEl().textContent = title;
  bodyEl().innerHTML = '';
  if (body instanceof Node) bodyEl().append(body);
  else bodyEl().textContent = String(body ?? '');

  const panel = panelEl();
  for (const cls of Object.values(SIZE_CLASSES)) panel.classList.remove(...cls.split(' '));
  panel.classList.add(...(SIZE_CLASSES[size] || SIZE_CLASSES.md).split(' '));

  root().classList.remove('hidden');
  closeBtn().onclick = closeModal;

  escListener = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escListener);

  root().onclick = (e) => { if (e.target === root()) closeModal(); };
}

export function closeModal() {
  root().classList.add('hidden');
  bodyEl().innerHTML = '';
  if (escListener) {
    document.removeEventListener('keydown', escListener);
    escListener = null;
  }
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) { try { cb(); } catch { /* noop */ } }
}

/** Reemplazo de window.prompt(). Resuelve con string o null. */
export function promptModal({
  title = 'Introduce un valor',
  label = '',
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'Aceptar',
} = {}) {
  return new Promise((resolve) => {
    const input = h('input', {
      type: 'text',
      placeholder,
      value: defaultValue,
      class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent',
    });
    const error = h('div', { class: 'text-xs text-red-400 mt-2 hidden' });

    const finish = (value) => { closeModal(); resolve(value); };

    const submit = h('button', {
      class: 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
      onClick: () => {
        const v = input.value.trim();
        if (!v) {
          error.textContent = 'El valor no puede estar vacío';
          error.classList.remove('hidden');
          return;
        }
        finish(v);
      },
    }, confirmLabel);

    const body = h('div', {}, [
      label && h('p', { class: 'text-xs text-fg-muted mb-2' }, label),
      input,
      error,
      submit,
    ]);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit.click();
      if (e.key === 'Escape') finish(null);
    });

    openModal({ title, body });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

/** Modal de confirmación. Resuelve con true/false. */
export function confirmModal({
  title = 'Confirmar',
  body = '',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const confirm = h('button', {
      class: danger
        ? 'mt-3 w-full bg-red-600 hover:bg-red-700 text-white text-sm py-2 rounded-md transition'
        : 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
      onClick: () => { closeModal(); resolve(true); },
    }, confirmLabel);

    const cancel = h('button', {
      class: 'mt-2 w-full bg-bg-elev hover:bg-line text-fg-soft text-sm py-2 rounded-md transition',
      onClick: () => { closeModal(); resolve(false); },
    }, cancelLabel);

    const bodyContent = typeof body === 'string'
      ? h('p', { class: 'text-sm text-fg-soft' }, body)
      : body;

    openModal({ title, body: h('div', {}, [bodyContent, confirm, cancel]) });
  });
}
