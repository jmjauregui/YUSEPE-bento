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
import { getLoopMode, setLoopMode } from './loopSidebar.js';

export function openSettings() {
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

  const themeRow = h('div', { class: 'flex items-center justify-between mb-4' }, [
    h('span', { class: 'text-sm text-fg' }, 'Tema'),
    h('div', { class: 'flex gap-1' }, [
      themeButton('dark', 'moon', 'Oscuro'),
      themeButton('light', 'sun', 'Claro'),
    ]),
  ]);

  function buildLoopModeSection() {
    const MODES = [
      {
        id: 'single',
        label: 'Un loop a la vez',
        desc: 'Al cambiar de espacio, el loop del anterior se pausa.',
      },
      {
        id: 'multi',
        label: 'Loops simultáneos',
        desc: 'Los agentes de todos los espacios siguen activos aunque no estés ahí.',
      },
    ];

    let currentMode = getLoopMode();

    const rows = MODES.map((mode) => {
      const radio = h('input', {
        type: 'radio',
        name: 'loop-mode',
        value: mode.id,
        class: 'w-3 h-3 mt-0.5 shrink-0 cursor-pointer',
        style: 'accent-color: var(--color-accent)',
      });
      if (mode.id === currentMode) radio.checked = true;

      radio.addEventListener('change', () => {
        currentMode = mode.id;
        setLoopMode(mode.id);
      });

      return h('label', {
        class: 'flex items-start gap-2 py-1 cursor-pointer select-none',
      }, [
        radio,
        h('div', {}, [
          h('div', { class: 'text-xs text-fg' }, mode.label
            + (mode.id === 'single' ? ' (predeterminado)' : '')),
          h('div', { class: 'text-[10px] text-fg-subtle leading-relaxed mt-0.5' }, mode.desc),
        ]),
      ]);
    });

    return h('div', {}, [
      h('span', { class: 'text-sm text-fg block mb-1' }, 'Modo del loop'),
      h('div', { class: 'space-y-1' }, rows),
    ]);
  }

  function buildSoundSection() {
    let currentId = getSound();

    const rows = SOUNDS.map((sound) => {
      const radio = h('input', {
        type: 'radio',
        name: 'loop-sound',
        value: sound.id,
        class: 'w-3 h-3 cursor-pointer',
        style: 'accent-color: var(--color-accent)',
      });
      if (sound.id === currentId) radio.checked = true;

      radio.addEventListener('change', () => {
        currentId = sound.id;
        setSound(sound.id);
      });

      const previewBtn = sound.id !== 'none'
        ? h('button', {
          class: 'ml-auto text-[10px] text-fg-muted hover:text-fg transition px-1',
          title: 'Escuchar',
          onClick: (e) => { e.preventDefault(); playSound(sound.id); },
        }, '▶')
        : null;

      return h('label', {
        class: 'flex items-center gap-2 py-1 cursor-pointer select-none',
      }, [radio, h('span', { class: 'text-xs text-fg' }, sound.label), ...(previewBtn ? [previewBtn] : [])]);
    });

    return h('div', {}, [
      h('div', { class: 'flex items-center justify-between mb-1' }, [
        h('span', { class: 'text-sm text-fg' }, 'Notificaciones del loop'),
      ]),
      h('p', { class: 'text-[11px] text-fg-subtle mb-2 leading-relaxed' },
        'Sonido cuando un agente te escribe a vos en el loop. Usá ▶ para preescuchar.'),
      h('div', { class: 'space-y-0.5' }, rows),
    ]);
  }

  const body = h('div', {}, [
    themeRow,
    h('div', { class: 'border-t border-line my-4' }),
    buildLoopModeSection(),
    h('div', { class: 'border-t border-line my-4' }),
    buildSoundSection(),
    h('div', { class: 'border-t border-line my-4' }),
    h('label', { class: 'text-sm text-fg block mb-1' }, 'Fondo de este espacio'),
    buildWallpaperSection(),
  ]);

  openModal({ title: 'Configuración', body, size: 'lg' });
}
