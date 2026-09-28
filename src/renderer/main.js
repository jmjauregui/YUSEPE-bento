/**
 * src/renderer/main.js
 * --------------------------------------------------------------
 * Entry point. Pantalla de perfiles al abrir + gestión CRUD.
 * Nombres de perfil únicos validados en create y rename.
 * --------------------------------------------------------------
 */
import { ProfileManager } from './core/profileManager.js';
import { state } from './core/state.js';
import { bus } from './core/eventBus.js';
import { renderBento, closeFocusedTile, focusNeighbor, moveFocusedTile } from './components/bentoGrid.js';
import { TileFactory } from './components/tile.js';
import { openAddToSpace } from './components/addToSpace.js';
import { openSettings } from './components/settings.js';
import { openModal, promptModal, confirmModal } from './components/modal.js';
import { toast } from './components/toast.js';
import { h } from './utils/dom.js';
import { svgIcon } from './utils/icons.js';
import { initTheme } from './core/theme.js';
import { initTooltips } from './core/tooltip.js';
import * as liveTiles from './core/liveTiles.js';
import { initFileTreeSidebar, toggleFileTreeSidebar } from './components/fileTreeSidebar.js';
import { openGitPanel } from './components/gitPanel.js';
import { openAgentPanel } from './components/agentPanel.js';
import { openWorkspaceManager } from './components/workspaceManager.js';
import { pickTemplate } from './components/templatePicker.js';
import { instantiateTemplate } from './core/layoutTemplates.js';
import { openCommandPalette } from './components/commandPalette.js';
import { openQuickOpenFile } from './components/quickOpenFile.js';
import { openShortcutsCheatsheet } from './components/shortcutsCheatsheet.js';
import { initSnippetsSidebar, toggleSnippetsSidebar } from './components/snippetsSidebar.js';
import { initLoopSidebar, toggleLoopSidebar } from './components/loopSidebar.js';

const $ = (sel) => document.querySelector(sel);

const profileSelect = $('#profile-select');
const profileScreen = $('#profile-screen');
const profileList = $('#profile-list');
const bento = $('#bento');
const backBtn = $('#btn-back-profiles');
const workspaceTabsEl = $('#workspace-tabs');

const ADD_BTN_IDS = ['btn-add-to-space', 'btn-toggle-explorer', 'btn-git', 'btn-agents', 'btn-workspace-manager', 'btn-toggle-snippets', 'btn-toggle-loop'];

/** Abre el picker nativo de carpeta. Devuelve la ruta o null si se canceló. */
async function pickFolder() {
  return window.yusepe.dialog.pickFolder();
}

/* ---------- Switch entre pantalla de perfiles y bento ---------- */

function showView() {
  if (state.profile) {
    profileScreen.classList.add('hidden');
    backBtn.classList.remove('hidden');
    renderBento();
  } else {
    bento.classList.add('hidden');
    backBtn.classList.add('hidden');
    profileScreen.classList.remove('hidden');
    renderProfileList();
  }
  updateAddButtonsState();
}

function updateAddButtonsState() {
  const hasProfile = !!state.profile;
  for (const id of ADD_BTN_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.disabled = !hasProfile;
    btn.title = hasProfile ? '' : 'Crea un workspace primero';
  }
}

/* ---------- Listado de perfiles ---------- */

const profileSearch = $('#profile-search');
let allProfiles = [];

async function renderProfileList() {
  allProfiles = await ProfileManager.refresh();
  renderFilteredProfiles();
}

function renderFilteredProfiles() {
  profileList.innerHTML = '';

  if (!allProfiles.length) {
    profileList.innerHTML =
      '<p class="text-sm text-fg-subtle">No hay workspaces. Crea el primero.</p>';
    return;
  }

  const query = (profileSearch?.value || '').trim().toLowerCase();
  // Orden: visitados más recientemente primero; los nunca abiertos, al final
  // por fecha de edición.
  const sorted = [...allProfiles].sort((a, b) =>
    (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
  const filtered = query
    ? sorted.filter((p) =>
      p.name.toLowerCase().includes(query) || (p.cwd || '').toLowerCase().includes(query))
    : sorted;

  if (!filtered.length) {
    profileList.innerHTML =
      '<p class="text-sm text-fg-subtle">Sin resultados para tu búsqueda.</p>';
    return;
  }

  for (const p of filtered) {
    profileList.append(createProfileRow(p));
  }
}

function createProfileRow(profile) {
  const visited = profile.lastOpenedAt
    ? `Última visita: ${formatRelative(profile.lastOpenedAt)}`
    : 'Nunca abierto';

  return h('div', {
    class:
      'group relative flex items-center gap-3 px-4 py-3 rounded-lg border border-line bg-bg-soft hover:bg-bg-elev transition cursor-pointer',
    onClick: async () => {
      await ProfileManager.load(profile.id);
      profileSelect.value = profile.id;
      showView();
    },
  }, [
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', { class: 'text-sm text-fg truncate' }, profile.name),
      h('div', { class: 'text-xs text-fg-subtle truncate' }, profile.cwd || 'Sin carpeta de inicio'),
    ]),
    h('div', { class: 'text-[11px] text-fg-subtle whitespace-nowrap shrink-0 group-hover:hidden' }, visited),
    h('div', {
      class: 'hidden group-hover:flex gap-1 shrink-0',
    }, [
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1.5 py-1 rounded',
        title: 'Carpeta de inicio',
        onClick: (e) => { e.stopPropagation(); changeCwd(profile); },
      }, svgIcon('folder', { size: 15 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1.5 py-1 rounded',
        title: 'Renombrar',
        onClick: (e) => { e.stopPropagation(); renameProfile(profile); },
      }, svgIcon('edit', { size: 15 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1.5 py-1 rounded',
        title: 'Exportar a un archivo .json',
        onClick: (e) => { e.stopPropagation(); exportProfile(profile); },
      }, svgIcon('export', { size: 15 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-red-400 px-1.5 py-1 rounded',
        title: 'Eliminar',
        onClick: (e) => { e.stopPropagation(); deleteProfile(profile); },
      }, svgIcon('trash', { size: 15 })),
    ]),
  ]);
}

function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `hace ${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
  return `hace ${Math.floor(mo / 12)} año${Math.floor(mo / 12) > 1 ? 's' : ''}`;
}

/* ---------- Gestión CRUD de perfiles ---------- */

async function refreshProfileSelect(selectId = null) {
  await ProfileManager.refresh();
  profileSelect.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— Seleccionar —';
  profileSelect.append(blank);
  for (const p of state.profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelect.append(opt);
  }
  if (selectId) profileSelect.value = selectId;
}

async function createNewProfile() {
  const name = await promptModal({
    title: 'Nuevo workspace',
    label: 'Nombre del workspace (debe ser único).',
    placeholder: 'ej. Trabajo',
    confirmLabel: 'Crear',
  });
  if (!name) return;
  try {
    if (await ProfileManager.exists(name)) {
      openModal({ title: 'Nombre duplicado', body: `Ya existe un workspace llamado "${name}".` });
      return;
    }
    const confirmed = await confirmModal({
      title: 'Carpeta de inicio',
      body: 'Elige la carpeta donde deben iniciarse las terminales de este espacio de trabajo (opcional).',
      confirmLabel: 'Elegir carpeta',
      cancelLabel: 'Omitir',
    });
    const cwd = confirmed ? await pickFolder() : null;

    // Tercer paso: plantilla de distribución. Cerrar el selector sin
    // elegir cancela la creación (no queda un workspace a medias).
    const template = await pickTemplate();
    if (!template) return;
    const tiles = instantiateTemplate(template);

    const p = await ProfileManager.create(name, cwd, tiles);
    await refreshProfileSelect(p.id);
    await ProfileManager.load(p.id);
    showView();
  } catch (err) {
    openModal({ title: 'Error', body: `${err?.message || err}` });
  }
}

async function changeCwd(profile) {
  const cwd = await pickFolder();
  if (!cwd) return;
  await ProfileManager.setCwd(profile.id, cwd);
  renderProfileList();
}

async function renameProfile(profile) {
  const name = await promptModal({
    title: 'Renombrar workspace',
    label: 'Nuevo nombre (debe ser único).',
    defaultValue: profile.name,
    confirmLabel: 'Guardar',
  });
  if (!name || name === profile.name) return;
  try {
    if (await ProfileManager.exists(name)) {
      openModal({ title: 'Nombre duplicado', body: `Ya existe un workspace llamado "${name}".` });
      return;
    }
    await ProfileManager.rename(profile.id, name);
    await refreshProfileSelect();
    renderProfileList();
  } catch (err) {
    openModal({ title: 'Error', body: `${err?.message || err}` });
  }
}

async function deleteProfile(profile) {
  const confirmed = await confirmModal({
    title: 'Eliminar workspace',
    body: `¿Eliminar "${profile.name}"? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!confirmed) return;
  await ProfileManager.remove(profile.id);
  removeOpenTab(profile.id);
  await refreshProfileSelect();
  renderProfileList();
  renderWorkspaceTabs();
}

/** Exporta un perfil puntual a un .json (diálogo nativo de guardado). */
async function exportProfile(profile) {
  try {
    const result = await ProfileManager.export(profile.id);
    if (result && result.canceled) return;
    toast.success(`"${profile.name}" exportado`);
  } catch (err) {
    toast.error(`No se pudo exportar: ${err?.message || err}`);
  }
}

/** Exporta el workspace activo (usado desde el Command Palette). */
async function exportActiveProfile() {
  if (!state.profile) return;
  await exportProfile(state.profile);
}

/** Importa un workspace desde un .json exportado previamente (id nuevo, nombre deduplicado). */
async function importProfile() {
  try {
    const result = await ProfileManager.import();
    if (result.canceled) return;
    renderProfileList();
    toast.success(`"${result.profile.name}" se agregó a tus workspaces`);
  } catch (err) {
    toast.error(`No se pudo importar: ${err?.message || err}`);
  }
}

/* ---------- Tabs de workspaces (estilo VSCode) ---------- */
// La tira muestra el workspace activo (resaltado) + los que quedaron con
// tiles vivos (terminales/webviews) en segundo plano — ver core/liveTiles.js.
// Clic en un tab inactivo = cambiar de workspace. La × cierra el tab:
// mata sus procesos (con confirmación). Cerrar el activo te devuelve al
// listado de workspaces.

// openTabIds: workspaces "abiertos" como tabs, en orden. Persisten aunque
// no tengan tiles vivos y aunque estés en la pantalla de listado (hub), así
// no se pierde el contexto de navegación al volver atrás. Un workspace con
// tiles vivos en segundo plano también aparece como tab aunque nunca se haya
// activado en esta sesión. Vive en memoria (scope de sesión, igual que
// liveTiles) — no se persiste entre reinicios.
let openTabIds = [];

function addOpenTab(id) {
  if (id && !openTabIds.includes(id)) openTabIds.push(id);
}

function removeOpenTab(id) {
  openTabIds = openTabIds.filter((x) => x !== id);
}

// Orden final de tabs: los abiertos explícitamente, más los que estén
// corriendo en segundo plano sin haber sido registrados. Se filtran los
// que ya no existen como perfil (p. ej. borrados).
function tabOrder() {
  const ids = [...openTabIds];
  for (const id of liveTiles.runningProfileIds()) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.filter((id) => state.profiles.some((p) => p.id === id));
}

function renderWorkspaceTabs() {
  if (!workspaceTabsEl) return;
  const activeId = state.activeProfileId;
  const order = tabOrder();

  workspaceTabsEl.innerHTML = '';
  for (const id of order) {
    const isActive = id === activeId;
    const profile = state.profiles.find((p) => p.id === id);
    const name = profile?.name || 'Workspace';
    const count = liveTiles.countForProfile(id);

    // tabindex="0" es clave: hace el tab focuseable. Si un <webview> tiene el
    // foco, Chromium consume el primer click sobre un elemento NO focuseable
    // (lo usa solo para desenfocar el guest) y nunca llega a JS. Al ser
    // focuseable, el click lo enfoca y se procesa normal.
    const tab = h('div', {
      tabindex: '0',
      role: 'button',
      class:
        'group flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-t-md text-xs shrink-0 border-b-2 transition cursor-pointer focus:outline-none ' +
        (isActive
          ? 'bg-bg-elev text-fg border-accent'
          : 'bg-transparent text-fg-subtle border-transparent hover:bg-bg-elev/60 hover:text-fg'),
      title: isActive
        ? `${name} (activo)`
        : count
          ? `${name} · ${count} tile(s) en segundo plano — clic para abrir`
          : `${name} — clic para abrir`,
      onMousedown: (e) => {
        if (e.button === 0 && !isActive) activateProfile(id);
      },
      // Enter/Espacio también activan (accesibilidad de tab focuseable).
      onKeydown: (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isActive) {
          e.preventDefault();
          activateProfile(id);
        }
      },
    }, [
      h('span', {
        class:
          'w-1.5 h-1.5 rounded-full shrink-0 ' +
          (isActive ? 'bg-accent' : count ? 'bg-accent/50' : 'bg-transparent'),
      }),
      h('span', { class: 'truncate max-w-[11rem]' }, name),
      h('button', {
        class:
          'inline-flex items-center rounded p-0.5 text-fg-subtle hover:text-red-400 hover:bg-red-400/10 transition ' +
          (isActive ? '' : 'opacity-0 group-hover:opacity-100'),
        title: `Cerrar "${name}"`,
        // stopPropagation en mousedown para que el × no dispare el cambio de
        // tab (que también escucha mousedown); el cierre corre en click.
        onMousedown: (e) => { e.stopPropagation(); },
        onClick: (e) => { e.stopPropagation(); closeWorkspaceTab(id, name, isActive); },
      }, svgIcon('close', { size: 13 })),
    ]);
    workspaceTabsEl.append(tab);
  }
}

async function closeWorkspaceTab(profileId, name, isActive) {
  const count = liveTiles.countForProfile(profileId);
  // Solo confirmamos si hay procesos vivos que matar; cerrar un tab sin
  // nada corriendo no destruye nada, no vale interrumpir.
  if (count) {
    // Cerrar el workspace entero SÍ puede matar terminales de un loop —
    // a diferencia de borrar un tile suelto, acá es un acto deliberado
    // sobre todo el espacio. No se bloquea, pero se avisa: un loop a
    // medias es lo que uno menos quiere cortar sin querer.
    const inLoop = (state.profile?.id === profileId ? state.profile.tiles || [] : [])
      .filter((t) => t.loopAgent)
      .map((t) => `@${t.loopAgent}`);

    const confirmed = await confirmModal({
      title: 'Cerrar workspace',
      body: `¿Cerrar "${name}"? Esto terminará ${count} tile(s) (terminales y/o webviews con procesos en ejecución).`
        + (inLoop.length
          ? ` Incluye ${inLoop.length} terminal(es) que están en el loop: ${inLoop.join(', ')}.`
          : ''),
      confirmLabel: 'Cerrar',
      danger: true,
    });
    if (!confirmed) return;
  }

  // Al cerrar el activo, saltamos al tab vecino que quede; si no queda
  // ninguno, volvemos al listado de workspaces.
  const next = isActive ? tabOrder().find((id) => id !== profileId) : null;

  removeOpenTab(profileId);
  liveTiles.killWorkspace(profileId);

  if (isActive) {
    if (next) {
      activateProfile(next);
    } else {
      profileSelect.value = '';
      ProfileManager.clear();
    }
  } else {
    renderWorkspaceTabs();
  }
}

/* ---------- Event handlers ---------- */

async function activateProfile(id) {
  await ProfileManager.load(id);
  profileSelect.value = id;
  showView();
}

profileSelect.addEventListener('change', (e) => {
  const id = e.target.value;
  if (!id) {
    ProfileManager.clear();
    return;
  }
  activateProfile(id);
});

$('#btn-new-profile').addEventListener('click', createNewProfile);
$('#btn-profile-new')?.addEventListener('click', createNewProfile);
$('#btn-profile-import')?.addEventListener('click', importProfile);
profileSearch?.addEventListener('input', renderFilteredProfiles);

backBtn.addEventListener('click', () => {
  profileSelect.value = '';
  ProfileManager.clear();
});

/* ---------- Topbar: añadir tiles / configuración ---------- */

$('#btn-add-to-space').addEventListener('click', openAddToSpace);
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-toggle-explorer').addEventListener('click', toggleFileTreeSidebar);
$('#btn-git').addEventListener('click', openGitPanel);
$('#btn-agents').addEventListener('click', openAgentPanel);
$('#btn-workspace-manager').addEventListener('click', openWorkspaceManager);
$('#btn-toggle-snippets').addEventListener('click', toggleSnippetsSidebar);
$('#btn-toggle-loop').addEventListener('click', toggleLoopSidebar);

/* ---------- Menu accelerators (globales) ---------- */

window.yusepe.menu.onCloseTile(() => closeFocusedTile());
window.yusepe.menu.onCommandPalette(() => openCommandPalette());
window.yusepe.menu.onQuickOpenFile(() => openQuickOpenFile());
window.yusepe.menu.onShortcuts(() => openShortcutsCheatsheet());
window.yusepe.menu.onSwitchWorkspace((index) => {
  const p = state.profiles[index];
  if (p && p.id !== state.activeProfileId) activateProfile(p.id);
});
window.yusepe.menu.onAddToSpace(() => openAddToSpace());
window.yusepe.menu.onNewTerminal(() => TileFactory.terminal(state.profile?.cwd));
window.yusepe.menu.onNewCalc(() => TileFactory.calculator());
window.yusepe.menu.onSettings(() => openSettings());

// Navegación por teclado del mosaico (Cmd+Alt+Flecha = foco,
// Cmd+Alt+Shift+Flecha = mover). Ver components/bentoGrid.js.
window.yusepe.menu.onTileAction(({ type, dir }) => {
  if (type === 'focus') focusNeighbor(dir);
  else if (type === 'move') moveFocusedTile(dir);
});

// `?` abre el cheatsheet de atajos — salvo que estés tipeando en un campo
// o ya haya un modal abierto (para no pisar su Escape). Los `<webview>`
// corren en otro contexto, así que sus teclas no llegan acá.
document.addEventListener('keydown', (e) => {
  if (e.key !== '?' || e.metaKey || e.ctrlKey) return;
  const t = e.target;
  const editable =
    t && (t.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  if (editable) return;
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && !modalRoot.classList.contains('hidden')) return;
  e.preventDefault();
  openShortcutsCheatsheet();
});

/* ---------- Command Palette: acciones que necesitan funciones privadas
   de este módulo (crear/exportar/importar workspace) ---------- */

bus.on('workspace:create-requested', createNewProfile);
bus.on('workspace:export-requested', exportActiveProfile);
bus.on('workspace:import-requested', importProfile);

/* ---------- Reactividad ---------- */

bus.on('profile:loaded', () => {
  addOpenTab(state.activeProfileId);
  showView();
  renderWorkspaceTabs();
});

bus.on('profile:cleared', () => {
  showView();
  renderWorkspaceTabs();
});

bus.on('profile:renamed', () => {
  refreshProfileSelect();
  renderWorkspaceTabs();
});

bus.on('live-tiles:changed', renderWorkspaceTabs);

bus.on('tile:added',   () => renderBento());
bus.on('tile:removed', () => renderBento());
bus.on('tile:updated', () => renderBento());

bus.on('calc:result', ({ value }) => {
  console.info('[bus] calc:result', value);
});

/* ---------- Bootstrap ---------- */

(async function init() {
  if (!window.yusepe) {
    profileScreen.classList.remove('hidden');
    profileList.innerHTML =
      '<p class="text-red-400 text-sm">El preload no cargó.</p>';
    return;
  }
  // Marca la plataforma para el CSS: en macOS reserva el hueco de los
  // traffic lights de la topbar (titleBarStyle:hiddenInset). En pantalla
  // completa los semáforos se ocultan, así que se libera ese hueco.
  if (window.yusepe.platform === 'darwin') {
    document.body.classList.add('platform-darwin');
    window.yusepe.window?.onFullscreen?.((isFs) => {
      document.body.classList.toggle('is-fullscreen', !!isFs);
    });
  }
  initTheme();
  initTooltips();
  initFileTreeSidebar();
  initSnippetsSidebar();
  initLoopSidebar();
  await refreshProfileSelect();
  showView();
  renderWorkspaceTabs();
  bus.emit('app:ready');
})();
