/**
 * src/renderer/components/settings.js
 * --------------------------------------------------------------
 * Modal de Configuración: tema claro/oscuro, notificaciones del loop
 * y fondo de pantalla del workspace activo.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal } from './modal.js';
import { getTheme, applyTheme } from '../core/theme.js';
import { buildWallpaperSection } from './wallpaperPicker.js';
import { SOUNDS, getSound, setSound, playSound } from '../core/loopNotify.js';
import { getLoopMode, setLoopMode, getLoopOpenView, setLoopOpenView } from './loopSidebar.js';
import { getDictationLanguage, setDictationLanguage, getDictationQuality, setDictationQuality } from '../core/dictation.js';
import { DICTATION_LANGUAGES, DICTATION_MODELS } from '../core/dictationText.js';
import { autoArrangeTiles } from './bentoGrid.js';
import { state } from '../core/state.js';
import { toast } from './toast.js';

export function openSettings() {
  // Layout estilo Ajustes de macOS: grupos con filas "nombre a la izquierda,
  // control a la derecha". Las opciones excluyentes son <select> y no listas
  // de radios: con 6 sonidos y 2 modos, los radios se comían el modal.
  const SELECT_CLASS = 'bg-bg-elev border border-line rounded-md text-xs text-fg px-2 py-1.5 '
    + 'focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer';

  function row(label, hint, control) {
    return h('div', { class: 'flex items-center justify-between gap-4 py-2.5' }, [
      h('div', { class: 'min-w-0' }, [
        h('div', { class: 'text-sm text-fg' }, label),
        ...(hint ? [hint instanceof Node ? hint
          : h('div', { class: 'text-[11px] text-fg-subtle leading-relaxed mt-0.5' }, hint)] : []),
      ]),
      h('div', { class: 'shrink-0 flex items-center gap-1.5' }, control),
    ]);
  }

  function group(title, rows) {
    return h('section', { class: 'mb-5' }, [
      h('h3', { class: 'text-[11px] uppercase tracking-wide text-fg-subtle mb-1.5' }, title),
      h('div', { class: 'rounded-lg border border-line px-3 divide-y divide-line' }, rows),
    ]);
  }

  function select(options, current, onChange) {
    const el = h('select', { class: SELECT_CLASS }, options.map(([value, label]) =>
      h('option', { value }, label)));
    el.value = current;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function themeButton(mode, iconName, label) {
    const active = getTheme() === mode;
    return h('button', {
      class: `inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition ${
        active
          ? 'border-accent bg-accent/20 text-accent-soft'
          : 'border-line hover:bg-bg-elev text-fg-soft'
      }`,
      onClick: () => { applyTheme(mode); closeModal(); openSettings(); },
    }, [svgIcon(iconName, { size: 14 }), h('span', {}, label)]);
  }

  const themeRow = row('Tema', null, [themeButton('dark', 'moon', 'Oscuro'), themeButton('light', 'sun', 'Claro')]);

  function loopModeRow() {
    const DESCS = {
      single: 'Al cambiar de espacio, el loop del anterior se pausa.',
      multi: 'Los agentes de todos los espacios siguen activos aunque no estés ahí.',
    };
    const hint = h('div', { class: 'text-[11px] text-fg-subtle leading-relaxed mt-0.5' }, DESCS[getLoopMode()]);
    const control = select(
      [['multi', 'Loops simultáneos'], ['single', 'Un loop a la vez']],
      getLoopMode(),
      (mode) => { setLoopMode(mode); hint.textContent = DESCS[mode]; },
    );
    return row('Modo del loop de agentes', hint, [control]);
  }

  function openViewRow() {
    const control = select(
      [['side', 'Panel lateral'], ['expanded', 'Expandido (pantalla completa)']],
      getLoopOpenView(),
      (view) => setLoopOpenView(view),
    );
    return row('Abrir el loop de agentes', 'Cómo aparece al abrirlo. Siempre podés cambiar con Expandir / Contraer.', [control]);
  }

  function dictationRows() {
    const lang = select(Object.entries(DICTATION_LANGUAGES).map(([k, v]) => [k, v.label]),
      getDictationLanguage(), setDictationLanguage);
    const quality = select(Object.entries(DICTATION_MODELS).map(([k, v]) => [k, `${v.label} (~${v.sizeMb} MB)`]),
      getDictationQuality(), setDictationQuality);
    return [
      row('Idioma del dictado', 'El 🎤 de la caja del loop. Todo corre en tu máquina.', [lang]),
      row('Calidad del dictado', '"Preciso" entiende mejor la jerga técnica, pero descarga más y tarda más.', [quality]),
    ];
  }

  function soundRow() {
    const preview = h('button', {
      class: 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-line text-[10px] '
        + 'text-fg-muted hover:text-fg hover:bg-bg-elev transition disabled:opacity-40',
      title: 'Escuchar',
      onClick: () => playSound(control.value),
    }, '▶');
    const control = select(SOUNDS.map((x) => [x.id, x.label]), getSound(), (id) => {
      setSound(id);
      preview.disabled = id === 'none';
      if (id !== 'none') playSound(id);
    });
    preview.disabled = control.value === 'none';
    return row('Sonido de aviso', 'Cuando un agente te escribe a vos en el loop.', [control, preview]);
  }

  // Reordenar (spec 035): en "Este espacio", arriba del fondo para que se
  // vea sin scrollear.
  function arrangeRow() {
    const count = state.profile?.tiles?.length || 0;
    return row('Reordenar tiles',
      'Grilla pareja que llena la pantalla. Las terminales siguen vivas; el acomodo manual se pierde.',
      [h('button', {
        // Rojo: destaca la función y avisa que pisa el acomodo manual.
        class: 'inline-flex items-center gap-1.5 text-xs font-medium text-white px-2.5 py-1.5 rounded-md '
          + 'bg-red-500 hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500',
        disabled: !count,
        onClick: () => {
          if (autoArrangeTiles()) toast.success(`${count} tile${count === 1 ? '' : 's'} reordenado${count === 1 ? '' : 's'}`);
        },
      }, [svgIcon('grid', { size: 14 }), h('span', {}, 'Reordenar')])]);
  }

  const body = h('div', {}, [
    group('General', [themeRow, loopModeRow(), openViewRow(), soundRow(), ...dictationRows()]),
    state.profile
      ? group('Este espacio', [
        arrangeRow(),
        h('div', { class: 'py-2.5' }, [
          h('div', { class: 'text-sm text-fg mb-2' }, 'Fondo'),
          buildWallpaperSection(),
        ]),
      ])
      : h('p', { class: 'text-xs text-fg-subtle' }, 'Abrí un espacio de trabajo para configurar su fondo y su distribución.'),
  ]);

  openModal({ title: 'Configuración', body, size: 'lg' });
}
