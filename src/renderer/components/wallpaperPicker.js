/**
 * src/renderer/components/wallpaperPicker.js
 * --------------------------------------------------------------
 * Sección de fondo de pantalla del workspace activo, embebida dentro
 * del modal de Configuración (ver components/settings.js): imagen
 * propia (desde disco) o buscador de Pexels, + transparencia de
 * las terminales sobre esa imagen.
 * --------------------------------------------------------------
 */
import { h, debounce } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { ProfileManager } from '../core/profileManager.js';
import { searchPhotos } from '../core/pexels.js';

/** Devuelve el nodo de la sección. Si no hay workspace activo, un aviso. */
export function buildWallpaperSection() {
  const profile = state.profile;
  if (!profile) {
    return h('p', { class: 'text-xs text-fg-subtle' },
      'Abrí un espacio de trabajo para personalizar su fondo.');
  }

  const currentEl = h('div', {});
  const uploadError = h('p', { class: 'text-red-400 text-[10px] mt-1 hidden' });

  const uploadBtn = h('button', {
    class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-line hover:bg-bg-elev transition',
    onClick: doUploadLocal,
  }, [svgIcon('upload', { size: 14 }), h('span', {}, 'Subir imagen propia')]);

  const searchInput = h('input', {
    type: 'text',
    placeholder: 'Buscar en Pexels (ej. "forest", "minimal")…',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mt-3 focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const resultsEl = h('div', { class: 'grid grid-cols-4 gap-2 mt-2 max-h-[28vh] overflow-y-auto content-start' });

  searchInput.addEventListener('input', debounce(doSearch, 400));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  renderCurrent();

  return h('div', {}, [currentEl, uploadBtn, uploadError, searchInput, resultsEl]);

  async function doUploadLocal() {
    uploadError.classList.add('hidden');
    try {
      const picked = await window.yusepe.dialog.pickImage();
      if (!picked) return;
      await applyWallpaper({
        url: picked.dataUrl,
        photographerName: null,
        photographerUrl: null,
      });
    } catch (err) {
      uploadError.textContent = err?.message || String(err);
      uploadError.classList.remove('hidden');
    }
  }

  async function doSearch() {
    const query = searchInput.value.trim();
    resultsEl.innerHTML = '';
    if (!query) return;
    resultsEl.append(h('p', { class: 'text-fg-subtle text-xs col-span-4' }, 'Buscando…'));
    try {
      const photos = await searchPhotos(query);
      resultsEl.innerHTML = '';
      if (!photos.length) {
        resultsEl.append(h('p', { class: 'text-fg-subtle text-xs col-span-4' }, 'Sin resultados.'));
        return;
      }
      for (const photo of photos) {
        resultsEl.append(h('button', {
          class: 'aspect-video rounded-md overflow-hidden border border-line hover:ring-2 hover:ring-accent transition bg-bg-elev',
          title: `Foto de ${photo.photographerName} en Pexels`,
          onClick: () => applyPexelsPhoto(photo),
        }, [
          h('img', { src: photo.thumb, class: 'w-full h-full object-cover', alt: '' }),
        ]));
      }
    } catch (err) {
      resultsEl.innerHTML = '';
      resultsEl.append(h('p', { class: 'text-red-400 text-xs col-span-4' }, err?.message || String(err)));
    }
  }

  /**
   * La foto se pide al CDN de Pexels a la medida REAL de la pantalla
   * (resolución física: px CSS × devicePixelRatio). Las variantes fijas
   * (`large2x` = 1880px) quedan cortas en pantallas 2K/4K y el `cover`
   * las estira borrosas; el CDN redimensiona el original al ancho pedido
   * (sin upscalear más allá del original) y sirve un archivo mucho más
   * liviano que el original crudo.
   */
  function optimalUrl(photo) {
    if (!photo.original) return photo.full;
    const px = Math.ceil(window.screen.width * (window.devicePixelRatio || 1));
    return `${photo.original}?auto=compress&cs=tinysrgb&w=${px}`;
  }

  async function applyPexelsPhoto(photo) {
    await applyWallpaper({
      url: optimalUrl(photo),
      photographerName: photo.photographerName,
      photographerUrl: photo.photographerUrl,
    });
  }

  async function applyWallpaper({ url, photographerName, photographerUrl }) {
    // El spread conserva los ajustes de imagen (zoom/fit/encuadre/blur/
    // dim/opacity) al cambiar de foto; sólo se pisan la URL y el crédito.
    const saved = await ProfileManager.setWallpaper(profile.id, {
      ...(profile.wallpaper || {}),
      opacity: profile.wallpaper?.opacity ?? 0.55,
      url,
      photographerName,
      photographerUrl,
    });
    profile.wallpaper = saved.wallpaper;
    renderCurrent();
  }

  function renderCurrent() {
    currentEl.innerHTML = '';
    const wp = profile.wallpaper;
    if (!wp) {
      currentEl.append(h('p', { class: 'text-xs text-fg-subtle mb-2' },
        'Este workspace no tiene fondo de pantalla configurado.'));
      return;
    }

    const preview = h('div', {
      class: 'w-full h-28 rounded-md bg-cover bg-center border border-line mb-2',
      style: `background-image: url(${wp.url})`,
    });
    currentEl.append(preview);

    if (wp.photographerName) {
      currentEl.append(h('a', {
        href: wp.photographerUrl,
        class: 'text-[10px] text-fg-subtle hover:underline',
        onClick: (e) => { e.preventDefault(); window.yusepe.shell.openExternal(wp.photographerUrl); },
      }, `Foto de ${wp.photographerName} en Pexels`));
    }

    // --- Ajustes de imagen. Todos se guardan con merge sobre el objeto
    // wallpaper y se aplican en vivo: setWallpaper emite
    // profile:wallpaper-changed y bentoGrid re-aplica la capa. Cada
    // control tiene su propio debounce para no pisarse entre sí.
    async function savePatch(patch) {
      const saved = await ProfileManager.setWallpaper(profile.id, { ...profile.wallpaper, ...patch });
      profile.wallpaper = saved.wallpaper;
    }

    function sliderRow(labelFor, { min, max, step, value, key }) {
      const label = h('span', { class: 'text-xs text-fg-subtle' }, labelFor(value));
      const slider = h('input', {
        type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
        class: 'w-full accent-accent',
      });
      const persist = debounce(() => savePatch({ [key]: Number(slider.value) }), 150);
      slider.addEventListener('input', () => {
        label.textContent = labelFor(Number(slider.value));
        persist();
      });
      return h('div', { class: 'mt-1' }, [label, slider]);
    }

    const FITS = [['cover', 'Rellenar'], ['contain', 'Ajustar'], ['fill', 'Estirar']];
    const currentFit = FITS.some(([v]) => v === wp.fit) ? wp.fit : 'cover';
    const fitRow = h('div', { class: 'flex items-center gap-1.5 mt-2' }, [
      h('span', { class: 'text-xs text-fg-subtle mr-1' }, 'Modo:'),
      ...FITS.map(([val, lbl]) => h('button', {
        class: 'text-xs px-2 py-1 rounded-md border transition '
          + (val === currentFit ? 'border-accent text-accent' : 'border-line hover:bg-bg-elev'),
        onClick: async () => { await savePatch({ fit: val }); renderCurrent(); },
      }, lbl)),
    ]);

    const POSITIONS = [
      'top left', 'top', 'top right',
      'left', 'center', 'right',
      'bottom left', 'bottom', 'bottom right',
    ];
    const currentPos = POSITIONS.includes(wp.position) ? wp.position : 'center';
    const posGrid = h('div', { class: 'grid grid-cols-3 gap-1 w-16' }, POSITIONS.map((p) => h('button', {
      title: `Encuadre: ${p}`,
      class: 'h-4 rounded-sm border transition '
        + (p === currentPos ? 'bg-accent border-accent' : 'border-line hover:bg-bg-elev'),
      onClick: async () => { await savePatch({ position: p }); renderCurrent(); },
    })));
    const posRow = h('div', { class: 'flex items-center gap-2 mt-2' }, [
      h('span', { class: 'text-xs text-fg-subtle' }, 'Encuadre:'), posGrid,
    ]);

    const removeBtn = h('button', {
      class: 'text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition mt-2',
      onClick: async () => {
        const saved = await ProfileManager.setWallpaper(profile.id, null);
        profile.wallpaper = saved.wallpaper;
        renderCurrent();
      },
    }, 'Quitar fondo');

    currentEl.append(
      sliderRow((v) => `Transparencia de terminales: ${Math.round(v * 100)}%`,
        { min: 0.15, max: 1, step: 0.05, value: wp.opacity ?? 0.55, key: 'opacity' }),
      sliderRow((v) => `Zoom del fondo: ${Math.round(v * 100)}%`,
        { min: 0.5, max: 2, step: 0.05, value: Number(wp.zoom) || 1, key: 'zoom' }),
      sliderRow((v) => `Difuminado: ${v}px`,
        { min: 0, max: 20, step: 1, value: Number(wp.blur) || 0, key: 'blur' }),
      sliderRow((v) => `Oscurecer: ${Math.round(v * 100)}%`,
        { min: 0, max: 0.7, step: 0.05, value: Number(wp.dim) || 0, key: 'dim' }),
      fitRow,
      posRow,
      removeBtn,
    );
  }
}
