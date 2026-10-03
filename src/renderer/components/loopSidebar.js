/**
 * src/renderer/components/loopSidebar.js
 * --------------------------------------------------------------
 * Panel lateral del loop multiagente: quiénes están en el loop y qué se
 * están diciendo. Flota del lado derecho, mismo patrón que el panel de
 * snippets (ver snippetsSidebar.js).
 *
 * Es una conversación **grupal**: todos los mensajes del workspace en un
 * solo hilo, con `de -> para` visible en cada uno. No hay hilos separados
 * por par de agentes a propósito — el valor de mirar esto es entender la
 * cadena completa (el usuario pide, claudio hace, opencito revisa, vuelve
 * a claudio), y partirla en conversaciones sueltas la escondería.
 *
 * Los mensajes del usuario van alineados a la derecha y los de los agentes
 * a la izquierda, que es la convención de cualquier chat: se lee de un
 * vistazo quién habló sin tener que leer el encabezado.
 *
 * Ojo con la división de responsabilidades: acá NO se reparte nada. Pegar
 * el mensaje en la terminal destino lo hace el proceso main
 * (main/loopDispatcher.js), porque los mensajes los postean también otros
 * procesos (el CLI de cada agente) y hace falta alguien vigilando el disco.
 * Este panel sólo muestra y postea.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { applyAgentOrder, pressOutcome, insertionIndex, trackPress, crossingMoves, shouldReorder, HOLD_MS, SLOP_PX } from '../core/agentOrder.js';
import { isAbsent, rowFlags, rosterAlert, createRosterAccordion, observerOptionsSignature } from '../core/rosterAccordion.js';
import { createOrderLoader } from '../core/orderLoader.js';
import { openModal, closeModal, confirmModal } from './modal.js';
import { ProfileManager } from '../core/profileManager.js';
import * as liveTiles from '../core/liveTiles.js';
import { focusTileById } from './bentoGrid.js';
import { pickTerminal } from './terminalPicker.js';
import { labelFor } from './workspaceManager.js';
import { thinkingPhrase, workingFor, thinkingLine } from '../core/loopThinking.js';
import { renderMarkdown } from '../core/markdown.js';
import {
  badgeLabel, cursorAtEnd, ensureCursor, saveCursor, unreadSummary, unreadTitle,
} from '../core/loopUnread.js';
import { applySavedWidth, makeResizeHandle } from '../utils/resizableSidebar.js';
import { getPanelPosition, panelLayout, expandClip, ALL_POSITION_CLASSES } from '../core/panelPosition.js';
import { toast } from './toast.js';
import { notifyUserMessage } from '../core/loopNotify.js';
import { createCopyFeedback } from '../core/copyFeedback.js';
import { pushObserverThreshold } from '../core/observerSettings.js';
import { activityState } from '../core/loopActivity.js';
import { agentDotState } from '../core/agentDot.js';
import { matchMessages, highlightInPlace, initialNavIndex, moveNavIndex, navLabel } from '../core/loopSearch.js';
import { composerPad, isAtBottom } from '../core/loopScroll.js';

let resizeHandleEl = null;

/**
 * A partir de acá un mensaje se colapsa. Los reportes de QA entre agentes
 * son largos *y* necesarios, pero tres seguidos tapan la conversación
 * entera: se muestra el principio y se despliega a pedido.
 */
const LONG_MESSAGE_CHARS = 420;

/**
 * Colores de identidad. Se eligen a mano en el editor del agente y sirven
 * para una sola cosa: distinguir de un vistazo quién habló en el hilo.
 *
 * Ningún verde, ámbar ni rojo puro a propósito — esos tres ya significan
 * algo en el roster (libre / ocupado / caído) y reusarlos como identidad
 * haría que un agente "se vea caído" por su color.
 */
const PALETTE = [
  '#4aa3f0', // azul
  '#a78bfa', // violeta
  '#f472b6', // rosa
  '#22d3ee', // cian
  '#fb923c', // naranja
  '#2dd4bf', // turquesa
  '#e879f9', // fucsia
  '#94a3b8', // gris
];

/**
 * Color de un agente: el que eligió, o uno derivado de su nombre.
 *
 * El fallback derivado evita la migración: los agentes que ya estaban en el
 * loop antes de que esto existiera se ven distintos desde el primer render,
 * sin tener que abrir el editor de cada uno. Es estable porque depende sólo
 * del nombre, así que el color de @dev es el mismo en cada workspace.
 */
/**
 * Rol recortado para usar en un tooltip.
 *
 * Desde que el rol es un textarea la gente escribe prompts de varios
 * párrafos ahí, y un tooltip con eso adentro tapa media pantalla.
 */
function clampRole(role, max = 160) {
  const text = String(role || '').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function colorOf(agent) {
  if (agent?.color) return agent.color;
  const name = agent?.name || '';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/**
 * Mensajes que el usuario desplegó a mano.
 *
 * Vive fuera del render porque `refresh()` redibuja el hilo completo cada
 * vez que algo cambia en disco — sin esto, un mensaje que acabás de abrir
 * se volvería a cerrar solo apenas otro agente postee.
 */
const expanded = new Set();

let panelEl = null;
/**
 * Vista expandida (spec 037): el MISMO panel en modo de ancho completo,
 * con 3 columnas. No es otro componente a propósito: roster, hilo y
 * compositor son los mismos nodos reacomodados por CSS, así el render
 * incremental del hilo (023), el borrador (022) y los no leídos (034)
 * siguen siendo un único estado.
 */
let isExpanded = false;
let expandBtn = null;
let tilesListEl = null;
let tasksSlotEl = null;
let termSlotEl = null;
/** Lo montado en la columna derecha: `{ profileId, tasks, termRoot }`. */
let rightMounted = null;

/** Emoji de avatar por agente, para el hilo (sólo se ve expandido). */
let agentEmojis = {};

/** "@claudio está contando cabellos…": agentes en `working` (ver loopThinking). */
let thinkingEl = null;
let thinkingTimer = null;
let thinkingTick = 0;
let thinkingAgents = [];

let rosterEl = null;
let rosterBtnEl = null;
let lastRosterAlert = null;
let accordion = null;
let streamEl = null;
let composerEl = null;
let composerRO = null;   // ResizeObserver sobre composerEl (045)
let emptyEl = null;
let isOpen = false;

/** A quién le escribe el usuario. Se recuerda entre mensajes. */
let target = null;

/* Estado del compositor persistente (spec 022, ruta C).
 * El textarea se crea una vez; sólo las pills se repintan en cada refresh. */
let currentAgents = [];
let composerBoxEl = null;
let pillsContainerEl = null;
let composerInput = null;
let composerSendBtn = null;
let composerNoAgentsEl = null;

/* Estado del render incremental del hilo (spec 023).
 * Ids en el orden del DOM y firma de colores para detectar cuándo reconstruir. */
let renderedIds = [];
let renderedSig = null;

/* Nodo persistente del selector de designado (036, corrección del desplegable) */
let rosterListEl = null;         // sub-div que renderRoster vacía y rehace
let observerSelectEl = null;     // <select> que nunca se destruye
let observerSig = null;          // última firma con la que se dibujaron las opciones
let pendingObserverUpdate = null; // { sig, agents } esperando a que el select pierda el foco

/* Estado y nodos del buscador en el hilo (039) */
let searchState = null;  // null | { query, all, results, activeIndex }
let searchBarEl = null;
let searchInputEl = null;
let searchCountEl = null;
let searchLupaBtn = null;
let navPrevBtn = null;   // ‹ hacia el más nuevo
let navNextBtn = null;   // › hacia el más viejo
// Forzar scroll al fondo en el próximo renderStream, incluso si atBottom era false.
// Se prende cuando la búsqueda se cierra (con panel visible u oculto).
let forceBottomNextRender = false;

/* Indicador de actividad por agente (037 v2) */
let currentPresence = {};
const streaks = new Map();       // streakStartedAt por nombre: se limpia al cambiar de workspace
let blinkOn = false;             // fase global del titileo
let blinkTimer = null;           // único setInterval para todos los puntos
const blinkingDots = new Set();  // nodos <span> que están titilando ahora

/* Orden de las pills guardado por el usuario.
 * Se carga al entrar al workspace (una sola lectura de disco, no en cada poll). */
let agentOrder = { cwd: null, names: [] };

/* Agente designado para recibir avisos del observador en este workspace. */
let observerAgent = null;

/* Arrastre activo: no-null sólo mientras el usuario sostiene una pill. */
let dragState = null;

/* Estado pendiente: pointerdown en curso, antes de que venza el timer de HOLD_MS.
 * renderPills lo respeta igual que dragState para no destruir la pill bajo el dedo.
 * Todas las salidas del gesto pasan por endDrag, que lo limpia con pressState.abort(). */
let pressState = null;

/* ---------- Modo del loop: un loop a la vez vs. simultáneos ---------- */

const LOOP_MODE_KEY = 'yusepe:loop-mode';

export function getLoopMode() {
  const v = localStorage.getItem(LOOP_MODE_KEY);
  return v === 'multi' ? 'multi' : 'single';
}

export function setLoopMode(mode) {
  localStorage.setItem(LOOP_MODE_KEY, mode === 'multi' ? 'multi' : 'single');
}

/* ---------- Cómo se abre: panel lateral o expandido ---------- */

const LOOP_OPEN_VIEW_KEY = 'yusepe:loop-open-view';

/** 'side' (panel lateral, default) o 'expanded' (vista de ancho completo). */
export function getLoopOpenView() {
  try { return localStorage.getItem(LOOP_OPEN_VIEW_KEY) === 'expanded' ? 'expanded' : 'side'; } catch { return 'side'; }
}
export function setLoopOpenView(view) {
  try { localStorage.setItem(LOOP_OPEN_VIEW_KEY, view === 'expanded' ? 'expanded' : 'side'); } catch { /* noop */ }
}

/* ---------- Estado abierto/cerrado por workspace ---------- */

const LOOP_OPEN_KEY = 'yusepe:loop-open';

function readOpenStates() {
  try { return JSON.parse(localStorage.getItem(LOOP_OPEN_KEY) || '{}'); }
  catch { return {}; }
}

function persistOpenState(profileId, open) {
  if (!profileId) return;
  const states = readOpenStates();
  states[profileId] = open;
  localStorage.setItem(LOOP_OPEN_KEY, JSON.stringify(states));
}

function savedOpenState(profileId) {
  return profileId ? (readOpenStates()[profileId] ?? false) : false;
}

/**
 * Timestamp del mensaje más reciente para el que ya sonó la notificación.
 * Se fija a Date.now() al cargar el workspace para no disparar sonidos
 * sobre mensajes históricos que ya estaban en el archivo.
 */
let lastNotifiedAt = 0;

/**
 * No leídos del usuario (spec 034). `lastMessages` es la última ventana
 * leída del disco: "marcar todo como leído" marca hasta ahí, así un mensaje
 * que llegó y todavía no se vio sigue sin leer.
 */
let unread = { count: 0, forUser: false, ids: new Set() };
let lastMessages = [];
let markReadBtn = null;
let unreadPillEl = null;

const cwd = () => state.profile?.cwd || null;

function orderFor(c) {
  return agentOrder.cwd === c ? agentOrder.names : [];
}

const loadOrder = createOrderLoader({
  getCwd: cwd,
  fetchOrder: (c) => window.yusepe.loop.getOrder(c),
  onLoaded: ({ cwd: c, names }) => { agentOrder = { cwd: c, names }; },
});

export function initLoopSidebar() {
  panelEl = document.getElementById('loop-sidebar');
  if (!panelEl) return;

  buildChrome();
  applyPanelPosition(getPanelPosition());

  // Ctrl+F: abrir buscador del loop salvo que el foco esté en una terminal.
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'f' || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if (document.activeElement?.closest('[data-kind="terminal"]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) openSidebar();
    openSearch();
  }, true);

  // Escape y pérdida de foco terminan cualquier arrastre activo.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (dragState || pressState)) { e.preventDefault(); endDrag(false); }
  });
  window.addEventListener('blur', () => { if (dragState || pressState) endDrag(false); });

  bus.on('loop:position-changed', (pos) => applyPanelPosition(pos));

  // El repartidor vive en main y vigila el disco: se arranca al entrar a un
  // workspace y se corta al salir, tenga o no el panel abierto — el loop
  // tiene que seguir andando con el panel cerrado.
  bus.on('profile:loaded', () => {
    target = null;
    // Resetear el render incremental: ids de otro workspace no deben colarse.
    renderedIds = [];
    renderedSig = null;
    // No notificar mensajes que ya existían al abrir el workspace.
    lastNotifiedAt = Date.now();
    // Cargar el orden guardado para este workspace (una lectura de disco).
    loadOrder();
    // Cerrar búsqueda al cambiar workspace: la consulta no tiene sentido en otro hilo.
    searchState = null;
    if (searchBarEl) searchBarEl.classList.add('hidden');
    if (searchInputEl) searchInputEl.value = '';
    // Resetear rachas y reloj: el nuevo workspace arranca con estado limpio.
    currentPresence = {};
    streaks.clear();
    stopBlinkClock();
    // Resetear el designado; se carga async al entrar al workspace.
    observerAgent = null;
    applyUnread(null);
    if (cwd()) {
      window.yusepe.loop.getObserverAgent(cwd()).then((name) => {
        observerAgent = name;
        if (isOpen) refresh();
      }).catch(() => {});
      pushObserverThreshold();
      window.yusepe.loop.start(cwd());
      updateUnread();
    }
    // Restaurar el estado abierto/cerrado guardado para este workspace.
    if (savedOpenState(state.profile?.id)) openSidebar({ animate: false });
    else closeSidebar();
    // Expandido, la vista pasa a ser la del workspace nuevo.
    if (isExpanded && isOpen) { mountRight(); renderTilesList(); }
  });
  bus.on('tile:*', () => { if (isExpanded) renderTilesList(); });
  bus.on('workspace:left', () => {
    // Las piezas de la columna derecha son de este workspace: se sueltan
    // (la terminal sigue viva, ver unmountRight).
    unmountRight();
    // Si hay un arrastre (o presión pendiente) en curso, terminarlo antes de cambiar.
    if (dragState || pressState) endDrag(false);
    // Guardar el estado actual antes de salir, para restaurarlo al volver.
    persistOpenState(state.profile?.id, isOpen);
    // Parar el reloj: los puntos del workspace que dejamos no titilan en background.
    stopBlinkClock();
    // En modo "un loop a la vez", detener el dispatcher de este workspace.
    // En modo "loops simultáneos", dejarlo corriendo para que los agentes
    // de este workspace sigan recibiendo mensajes aunque no estemos acá.
    if (getLoopMode() === 'single') {
      window.yusepe.loop.stop(cwd());
    }
  });
  bus.on('profile:cleared', () => { closeSidebar(); window.yusepe.loop.stop(); applyUnread(null); });

  // Cambios en disco (los postea el CLI de cada agente, desde otro proceso).
  // Con el panel cerrado, igual hay que actualizar el contador del botón:
  // es justamente cuando más fácil se pierde un mensaje.
  window.yusepe.loop.onChanged(() => { if (isOpen) refresh(); else updateUnread(); checkNotify(); });
  window.yusepe.loop.onDelivered(() => { if (isOpen) refresh(); else updateUnread(); checkNotify(); });
  // Un agente que se cae no genera ningún cambio en disco, así que sin
  // este aviso el panel lo seguiría mostrando en verde.
  window.yusepe.loop.onPresence(({ agent, present }) => {
    if (isOpen) refresh();
    if (!present) {
      toast.warning(`@${agent} dejó de correr en su terminal — sus mensajes quedan pendientes`);
    }
  });
}

/**
 * Revisa si llegaron mensajes nuevos dirigidos al usuario y, si es así,
 * dispara la notificación sonora + la de sistema (cuando la ventana no
 * tiene foco). Se llama desde los handlers onChanged / onDelivered,
 * independientemente de si el panel está abierto o no.
 */
async function checkNotify() {
  if (!cwd() || !lastNotifiedAt) return;
  try {
    const messages = await window.yusepe.loop.messages(cwd(), { limit: 20 });
    const fresh = messages.filter(
      (m) => m.to === 'usuario' && new Date(m.createdAt).getTime() > lastNotifiedAt,
    );
    if (!fresh.length) return;
    lastNotifiedAt = Math.max(...fresh.map((m) => new Date(m.createdAt).getTime()));
    const last = fresh[fresh.length - 1];
    await notifyUserMessage(last.from);
  } catch {
    // No bloquear la UI si la notificación falla
  }
}

/* ---------- No leídos ---------- */

async function updateUnread() {
  if (!cwd()) return;
  try {
    applyUnread(await window.yusepe.loop.messages(cwd(), { limit: 200 }));
  } catch { /* el contador no vale romper nada */ }
}

/**
 * `null` = limpiar sin tocar el cursor (cambio de workspace, antes de leer
 * sus mensajes). Con `[]` se fijaría el cursor de un workspace con historial
 * en "nada leído" y aparecería todo el historial como nuevo.
 */
function applyUnread(messages) {
  lastMessages = messages || [];
  unread = messages && cwd()
    ? unreadSummary(messages, ensureCursor(cwd(), messages))
    : { count: 0, forUser: false, ids: new Set() };
  paintUnreadBadge();
  paintUnreadStream();
  paintMarkReadBtn();
}

function markAllRead() {
  if (!cwd()) return;
  saveCursor(cwd(), cursorAtEnd(lastMessages));
  applyUnread(lastMessages);
}

/** Contador en el botón del loop de la barra superior. */
function paintUnreadBadge() {
  const badge = document.getElementById('loop-unread-badge');
  if (!badge) return;
  badge.textContent = badgeLabel(unread.count);
  badge.classList.toggle('hidden', !unread.count);
  // Acento si alguno es para vos; neutro si son sólo charlas entre agentes.
  badge.classList.toggle('is-user', unread.forUser);

  // Contador de la pastilla: misma variable, un solo cálculo.
  if (unreadPillEl) {
    const label = badgeLabel(unread.count);
    unreadPillEl.textContent = label;
    unreadPillEl.classList.toggle('hidden', !label);
    unreadPillEl.setAttribute('aria-label', unreadTitle(unread.count));
  }
}

/**
 * Marcas sobre los nodos ya pintados, sin rehacer el hilo: así marcar todo
 * como leído no hace perder el scroll ni la selección (spec 023).
 */
function paintUnreadStream() {
  if (!streamEl) return;
  let first = true;
  for (const row of streamEl.children) {
    const is = unread.ids.has(row.dataset.id);
    row.classList.toggle('is-unread', is);
    row.classList.toggle('is-unread-user', is && row.dataset.to === 'usuario');
    row.classList.toggle('is-unread-first', is && first);
    if (is) first = false;
  }
}

function paintMarkReadBtn() {
  if (!markReadBtn) return;
  markReadBtn.disabled = !unread.count;
  // El contador de no leídos viaja en la pastilla del título (047), no aquí.
}

export function isLoopSidebarOpen() {
  return isOpen;
}

export function toggleLoopSidebar() {
  if (!state.profile) return;
  if (isOpen) closeSidebar();
  else openSidebar();
}

function openSidebar({ animate = true } = {}) {
  if (!panelEl) return;
  if (!cwd()) {
    toast.error('Este workspace no tiene carpeta asignada — el loop guarda sus mensajes en .ybento/loop/');
    return;
  }
  isOpen = true;
  document.getElementById('btn-toggle-loop')?.classList.add('is-active');
  persistOpenState(state.profile?.id, true);
  panelEl.classList.remove('hidden');
  // Preferencia de Configuración: abrir directo en la vista expandida.
  // Al restaurar un workspace no se anima (no fue un gesto del usuario).
  if (getLoopOpenView() === 'expanded' && !isExpanded) setExpanded(true, { animate });
  accordion?.open();
  if (composerRO && composerEl) composerRO.observe(composerEl);
  // Recargar el orden al abrir el panel (cubre el caso de que el workspace
  // estuviera cargado pero el panel cerrado cuando se guardó el orden).
  loadOrder().then(() => refresh());
}

function closeSidebar() {
  if (!panelEl) return;
  if (isExpanded) setExpanded(false, { animate: false });
  renderThinking([], {});
  if (dragState || pressState) endDrag(false);
  accordion?.close();
  isOpen = false;
  document.getElementById('btn-toggle-loop')?.classList.remove('is-active');
  persistOpenState(state.profile?.id, false);
  panelEl.classList.add('hidden');
  // Cerrar búsqueda: el panel estuvo cerrado y no tiene sentido dejarla abierta.
  if (searchState) {
    searchState = null;
    renderedIds = [];
    renderedSig = null;
    forceBottomNextRender = true;
  }
  if (searchBarEl) searchBarEl.classList.add('hidden');
  if (searchInputEl) searchInputEl.value = '';
  // Parar el reloj del titileo: nada titila con el panel cerrado.
  stopBlinkClock();
  composerRO?.disconnect();
}

/* ---------- Posición del panel (038) ---------- */

/**
 * Cambia la posición del panel sin destruir ni reconstruir el Chrome.
 * Solo se reemplaza el handle de redimensionado, que depende del borde.
 */
function applyPanelPosition(pos) {
  if (!panelEl) return;
  const layout = panelLayout(pos, window.innerHeight);

  // Quitar todas las clases de posicionamiento posibles y poner las nuevas.
  panelEl.classList.remove(...ALL_POSITION_CLASSES);
  panelEl.classList.add(...layout.classes.split(' '));

  // Limpiar el tamaño del eje opuesto: si era horizontal, height queda suelta;
  // si era vertical, width queda suelto. Sin esto el panel quedaría mal dimensionado.
  if (layout.axis === 'y') {
    panelEl.style.width = '';
  } else {
    panelEl.style.height = '';
  }

  // Aplicar el tamaño guardado para el eje activo.
  applySavedWidth(panelEl, {
    storageKey: layout.storageKey,
    min: layout.min,
    max: layout.max,
    defaultWidth: layout.defaultSize,
    axis: layout.axis,
  });

  // Expandido: sin asa. Al contraer se recrea en el borde que corresponde.
  if (isExpanded) {
    if (resizeHandleEl && resizeHandleEl.parentNode) {
      resizeHandleEl.parentNode.removeChild(resizeHandleEl);
    }
    resizeHandleEl = null;
    return;
  }

  // Reemplazar SÓLO el nodo del handle — el resto del chrome no se toca.
  const newHandle = makeResizeHandle({
    panel: panelEl,
    storageKey: layout.storageKey,
    edge: layout.handleEdge,
    min: layout.min,
    max: layout.max,
    defaultWidth: layout.defaultSize,
    axis: layout.axis,
  });
  if (resizeHandleEl && resizeHandleEl.parentNode) {
    resizeHandleEl.parentNode.replaceChild(newHandle, resizeHandleEl);
  } else {
    panelEl.append(newHandle);
  }
  resizeHandleEl = newHandle;
}

/* ---------- "Está pensando…" ---------- */

/**
 * Una línea por agente en `working` (y con su agente vivo en la terminal),
 * arriba del compositor. Es la retroalimentación que faltaba: mandás un
 * mensaje, el agente lo lee con `ybento leer` (032) y pasa a working — y
 * desde ese momento se ve que alguien lo está atendiendo.
 *
 * Va en el compositor y no en el hilo: el render incremental del hilo
 * (023) cuenta un nodo por mensaje.
 */
// thinkingAgents: [{ agent, dotState }] — decisión 044-B, agentDotState en vez de state === 'working'
function renderThinking(agents, presence) {
  if (!thinkingEl) return;
  const now = Date.now();
  thinkingAgents = agents.map((a) => {
    const pres = presence[a.name];
    const actResult = activityState({
      now,
      lastDataAtByAgent: { [a.name]: pres?.lastDataAt },
      streakStartedAt: streaks.get(a.name) ?? null,
    });
    const dotState = agentDotState({
      activity: actResult ?? { state: 'idle', streakStartedAt: null, sinceMs: 0 },
      absent: isAbsent(pres),
      working: a.state === 'working',
      stuckMs: now - new Date(a.updatedAt).getTime(),
    });
    if (dotState.color !== 'red' && dotState.color !== 'amber') return null;
    return { agent: a, dotState };
  }).filter(Boolean);

  if (!thinkingAgents.length) {
    thinkingEl.classList.add('hidden');
    thinkingEl.replaceChildren();
    clearInterval(thinkingTimer);
    thinkingTimer = null;
    return;
  }
  thinkingEl.classList.remove('hidden');
  paintThinking();
  // Las frases rotan cada pocos segundos, como el indicador de Claude Code.
  thinkingTimer ??= setInterval(() => { thinkingTick += 1; paintThinking(); }, 2800);
}

function paintThinking() {
  thinkingEl.replaceChildren(...thinkingAgents.map(({ agent, dotState }) => {
    const tint = colorOf(agent);
    const elapsed = workingFor(agent.updatedAt);
    const line = thinkingLine({ dot: dotState, phrase: thinkingPhrase(agent.name, thinkingTick) });
    if (!line) return null;

    if (line.kind === 'problem') {
      return h('div', { class: 'loop-thinking-row' }, [
        h('span', { class: 'loop-thinking-icon' }, agent.emoji || '●'),
        h('span', {
          class: 'font-medium',
          style: `color: color-mix(in srgb, ${tint} 75%, var(--color-fg))`,
        }, `@${agent.name}`),
        h('span', { class: 'text-amber-400/80 ml-1' }, ` — ${line.text}`),
      ]);
    }

    return h('div', { class: 'loop-thinking-row' }, [
      h('span', { class: 'loop-thinking-icon' }, agent.emoji || '●'),
      h('span', {
        class: 'font-medium',
        style: `color: color-mix(in srgb, ${tint} 75%, var(--color-fg))`,
      }, `@${agent.name}`),
      h('span', {}, ` está ${line.text}`),
      h('span', { class: 'loop-dots', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i')]),
      ...(elapsed ? [h('span', { class: 'text-fg-subtle/70 ml-1' }, `· ${elapsed}`)] : []),
    ]);
  }).filter(Boolean));
}

/* ---------- Vista expandida (spec 037) ---------- */

/**
 * Tamaños de las columnas de la vista expandida, arrastrables y guardados
 * por usuario. Viven como variables CSS en el panel (el grid las lee), así
 * arrastrar no re-renderiza nada: la terminal se re-ajusta sola con su
 * ResizeObserver.
 */
const SPLITS = {
  left:  { key: 'yusepe:loop-x-left',  css: '--loop-left-w',  unit: 'px', def: 280, min: 200, max: 560 },
  right: { key: 'yusepe:loop-x-right', css: '--loop-right-w', unit: 'px', def: 380, min: 260, max: 900 },
  tasks: { key: 'yusepe:loop-x-tasks', css: '--loop-tasks-h', unit: '%',  def: 50,  min: 12,  max: 88 },
};
/** El chat del centro nunca queda más angosto que esto. */
const MIN_CENTER_PX = 380;

function readSplit(name) {
  const cfg = SPLITS[name];
  let v = NaN;
  try { v = parseFloat(localStorage.getItem(cfg.key)); } catch { /* sin storage: default */ }
  return Number.isFinite(v) ? Math.min(cfg.max, Math.max(cfg.min, v)) : cfg.def;
}

function writeSplit(name, value, persist = false) {
  const cfg = SPLITS[name];
  panelEl.style.setProperty(cfg.css, `${value}${cfg.unit}`);
  if (persist) { try { localStorage.setItem(cfg.key, String(Math.round(value))); } catch { /* noop */ } }
}

/**
 * Divisor arrastrable. `compute(e, start)` devuelve el valor nuevo a partir
 * del evento y de lo medido al empezar; doble clic vuelve al default.
 */
function makeSplitter(name, { axis, className, begin, compute }) {
  const handle = h('div', {
    class: `loop-splitter ${className}`,
    dataset: { axis },
    title: 'Arrastrá para cambiar el tamaño (doble clic restablece)',
  });
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = begin(e);
    let last = readSplit(name);
    const cfg = SPLITS[name];
    const onMove = (ev) => {
      last = Math.min(cfg.max, Math.max(cfg.min, compute(ev, start)));
      writeSplit(name, last);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-loop', 'resizing-loop-row');
      writeSplit(name, last, true);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add(axis === 'row' ? 'resizing-loop-row' : 'resizing-loop');
  });
  handle.addEventListener('dblclick', () => writeSplit(name, SPLITS[name].def, true));
  return handle;
}

function buildSplitters(rightEl) {
  const panelWidth = () => panelEl.getBoundingClientRect().width;
  const leftHandle = makeSplitter('left', {
    axis: 'col',
    className: 'loop-splitter-left',
    begin: (e) => ({ x: e.clientX, w: readCurrent('left'), other: readCurrent('right') }),
    compute: (e, st) => Math.min(st.w + (e.clientX - st.x), panelWidth() - st.other - MIN_CENTER_PX),
  });
  const rightHandle = makeSplitter('right', {
    axis: 'col',
    className: 'loop-splitter-right',
    // Pegado al borde derecho: crece cuando el mouse va a la izquierda.
    begin: (e) => ({ x: e.clientX, w: readCurrent('right'), other: readCurrent('left') }),
    compute: (e, st) => Math.min(st.w - (e.clientX - st.x), panelWidth() - st.other - MIN_CENTER_PX),
  });
  const rowHandle = makeSplitter('tasks', {
    axis: 'row',
    className: 'loop-splitter-row',
    begin: () => rightEl.getBoundingClientRect(),
    compute: (e, rect) => ((e.clientY - rect.top) / rect.height) * 100,
  });
  return { leftHandle, rightHandle, rowHandle };
}

/** Valor vigente de un split (lo que está aplicado en el panel, o el guardado). */
function readCurrent(name) {
  const v = parseFloat(panelEl.style.getPropertyValue(SPLITS[name].css));
  return Number.isFinite(v) ? v : readSplit(name);
}

let expandAnim = null;

/**
 * Expandir/contraer con animación: el panel queda anclado a la derecha y
 * su borde izquierdo "barre" hacia la izquierda (o vuelve), con un
 * clip-path. Se anima el recorte y no el ancho porque el layout cambia de
 * flex a grid de 3 columnas — eso no se interpola; el recorte sí, y sin
 * re-layout en cada frame (las terminales no se re-ajustan 60 veces).
 */
function setExpanded(on, { animate = true } = {}) {
  if (on === isExpanded && !expandAnim) return;
  expandAnim?.cancel();
  expandAnim = null;
  isExpanded = on;
  expandBtn.lastChild.textContent = on ? 'Contraer' : 'Expandir';
  expandBtn.title = on ? 'Volver al panel lateral' : 'Ver el loop a pantalla completa, con tareas y una terminal';

  // Decisión C: expandir/contraer cierra la búsqueda por el camino de cierre de la 039.
  if (searchState) {
    searchState = null;
    renderedIds = [];
    renderedSig = null;
    refresh();
  }

  const pos = getPanelPosition();
  const layout = panelLayout(pos, window.innerHeight);
  const storedSize = parseInt(
    typeof localStorage !== 'undefined' ? (localStorage.getItem(layout.storageKey) || '') : '',
    10,
  );
  const size = Number.isFinite(storedSize) && storedSize > 0 ? storedSize : layout.defaultSize;
  const available = layout.axis === 'x' ? window.innerWidth : (window.innerHeight - 48); // 48 = topbar

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = animate && !reduce && !panelEl.classList.contains('hidden') && panelEl.animate;
  const opts = { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
  const followLast = () => queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });

  if (on) {
    panelEl.classList.add('is-expanded');
    applyPanelPosition(pos); // elimina el asa (isExpanded ya es true)
    mountRight();
    renderTilesList();
    followLast();
    if (canAnimate) {
      const { from, to } = expandClip(pos, { available, size });
      expandAnim = panelEl.animate([{ clipPath: from }, { clipPath: to }], opts);
      expandAnim.onfinish = () => { expandAnim = null; };
    }
    return;
  }

  const finish = () => {
    expandAnim = null;
    panelEl.classList.remove('is-expanded');
    applyPanelPosition(pos); // recrea el asa en el borde de la posición vigente
    unmountRight();
    followLast();
  };
  if (!canAnimate) { finish(); return; }
  panelEl.classList.add('is-collapsing');
  const { from: collapseTo } = expandClip(pos, { available, size });
  expandAnim = panelEl.animate(
    [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: collapseTo }],
    { ...opts, duration: 130, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
  expandAnim.onfinish = () => { panelEl.classList.remove('is-collapsing'); finish(); };
  expandAnim.oncancel = () => panelEl.classList.remove('is-collapsing');
}

/** Terminales y archivos fijados del workspace; clic → contraer y enfocar. */
function renderTilesList() {
  if (!tilesListEl) return;
  const tiles = (state.profile?.tiles || []).filter((t) => t.kind === 'terminal' || t.kind === 'file');
  tilesListEl.replaceChildren(...(tiles.length ? tiles.map((tile) => h('button', {
    class: 'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-fg-soft hover:bg-bg-elev hover:text-fg transition',
    onClick: () => { setExpanded(false); focusTileById(tile.id); },
  }, [
    h('span', { class: 'text-fg-subtle shrink-0 flex items-center' }, svgIcon(tile.kind === 'file' ? 'file' : 'terminal', { size: 13 })),
    h('span', { class: 'truncate flex-1' }, labelFor(tile)),
    ...(tile.loopAgent ? [h('span', { class: 'text-[10px] text-accent-soft shrink-0' }, `@${tile.loopAgent}`)] : []),
  ])) : [h('p', { class: 'text-[11px] text-fg-subtle px-2' }, 'Este espacio no tiene terminales ni archivos fijados.')]));
}

/**
 * Tareas + una terminal propia de esta vista. La terminal usa un id fijo por
 * workspace (`loop-term-<profileId>`) y se registra en liveTiles con su
 * profileId: así se re-adjunta igual al volver, `killWorkspace` la mata al
 * cerrar el workspace, y el traspaso a otra ventana (031) la reconecta por
 * el mismo id. No está en profile.tiles, así que el mosaico no la ve.
 */
async function mountRight() {
  const profile = state.profile;
  if (!profile || rightMounted?.profileId === profile.id) return;
  unmountRight();
  const mounted = { profileId: profile.id, tasks: null, termRoot: null };
  rightMounted = mounted;

  if (!profile.cwd) {
    tasksSlotEl.replaceChildren(h('p', { class: 'text-xs text-fg-subtle p-3' },
      'Este espacio no tiene carpeta: las tareas viven en .ybento/tasks/ del proyecto.'));
  }

  // Import perezoso: terminal.js y tasksTile.js no hacen falta hasta expandir.
  const [{ createTasksTile }, { createTerminalTile }] = await Promise.all([
    import('./tasksTile.js'), import('./terminal.js'),
  ]);
  if (rightMounted !== mounted) return; // se contrajo o cambió el workspace mientras cargaba

  if (profile.cwd) {
    mounted.tasks = createTasksTile({ id: `loop-tasks-${profile.id}`, kind: 'tasks' });
    tasksSlotEl.replaceChildren(mounted.tasks.root);
  }
  const term = await createTerminalTile(
    { id: `loop-term-${profile.id}`, kind: 'terminal', title: 'Terminal', cwd: profile.cwd || undefined },
    profile.id,
  );
  if (rightMounted !== mounted) return;
  mounted.termRoot = term.root;
  termSlotEl.replaceChildren(term.root);
  requestAnimationFrame(() => { try { liveTiles.get(`loop-term-${profile.id}`)?.meta?.fit?.fit(); } catch { /* noop */ } });
}

/** Suelta la columna derecha. La terminal NO muere: se aparca como los tiles vivos. */
function unmountRight() {
  if (!rightMounted) return;
  try { rightMounted.tasks?.shutdown?.(); } catch { /* noop */ }
  if (rightMounted.termRoot) document.getElementById('tile-holding-area')?.append(rightMounted.termRoot);
  tasksSlotEl?.replaceChildren();
  termSlotEl?.replaceChildren();
  rightMounted = null;
}

/* ---------- Estructura ---------- */

function buildChrome() {
  composerRO?.disconnect();
  composerRO = null;
  panelEl.innerHTML = '';
  // Resetear estado persistente: el DOM fue destruido, hay que recrearlo.
  currentAgents = []; composerBoxEl = null; pillsContainerEl = null;
  composerInput = null; composerSendBtn = null; composerNoAgentsEl = null;
  renderedIds = []; renderedSig = null;
  rosterListEl = null; observerSelectEl = null; observerSig = null; pendingObserverUpdate = null;
  searchState = null; searchBarEl = null; searchInputEl = null; searchCountEl = null; searchLupaBtn = null; navPrevBtn = null; navNextBtn = null; forceBottomNextRender = false;
  unreadPillEl = null;
  currentPresence = {};
  streaks.clear();
  stopBlinkClock();

  unreadPillEl = h('span', { class: 'hidden tabular-nums text-[10px]' });
  const title = h('span', { class: 'loop-title shrink-0 whitespace-nowrap flex items-center gap-1' }, [
    h('span', { class: 'loop-title-icon flex items-center' }, svgIcon('loop', { size: 14 })),
    h('span', {}, 'Loop de agentes'),
    unreadPillEl,
  ]);

  rosterBtnEl = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
    'aria-expanded': 'true',
    'aria-label': 'Agentes del loop',
    title: 'Agentes del loop',
    onClick: () => accordion?.toggle(),
  }, svgIcon('agents', { size: 14 }));

  searchLupaBtn = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
    'aria-label': 'Buscar en el hilo',
    title: 'Buscar en el hilo (Ctrl+F)',
    onClick: openSearch,
  }, svgIcon('search', { size: 14 }));

  markReadBtn = h('button', {
    class: 'inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg px-1.5 py-0.5 rounded shrink-0 '
      + 'disabled:opacity-40 disabled:hover:text-fg-muted',
    'aria-label': 'Todo leído',
    title: 'Marcar todo como leído',
    onClick: markAllRead,
  }, [svgIcon('check', { size: 12 }), h('span', { class: 'loop-markread-label' }, 'Todo leído')]);

  expandBtn = h('button', {
    class: 'inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg px-1.5 py-0.5 rounded shrink-0 '
      + 'border border-line hover:bg-bg-elev transition',
    'aria-label': 'Expandir loop',
    title: 'Ver el loop a pantalla completa, con tareas y una terminal',
    onClick: () => setExpanded(!isExpanded),
  }, [svgIcon('external', { size: 11 }), h('span', { class: 'loop-expand-label' }, 'Expandir')]);

  const skillBtn = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
    'aria-label': 'Protocolo del loop',
    title: 'Protocolo que leen los agentes (.ybento/loop/skill.md)',
    onClick: openSkillEditor,
  }, svgIcon('file', { size: 14 }));

  const hueco = h('span', { class: 'flex-1 loop-spacer' });

  const iconRow = h('div', { class: 'flex items-center gap-1.5 px-2 py-1.5' }, [
    expandBtn,
    rosterBtnEl,
    searchLupaBtn,
    skillBtn,
    hueco,
    markReadBtn,
    title,
    h('button', {
      class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
      'aria-label': 'Cerrar loop de agentes',
      title: 'Cerrar loop de agentes',
      onClick: closeSidebar,
    }, svgIcon('close', { size: 15 })),
  ]);

  searchInputEl = h('input', {
    type: 'text',
    placeholder: 'Buscar en el hilo…',
    class: 'flex-1 min-w-0 text-xs bg-transparent outline-none text-fg placeholder:text-fg-subtle',
  });
  searchCountEl = h('span', { class: 'text-[10px] text-fg-subtle shrink-0 tabular-nums' });
  navPrevBtn = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed px-0.5 shrink-0',
    title: 'Resultado anterior (Shift+Enter)',
    onClick: () => moveNav('prev'),
  }, '‹');
  navNextBtn = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed px-0.5 shrink-0',
    title: 'Resultado siguiente (Enter)',
    onClick: () => moveNav('next'),
  }, '›');
  navPrevBtn.disabled = true;
  navNextBtn.disabled = true;
  searchBarEl = h('div', { class: 'hidden flex items-center gap-1.5 px-2 pb-1.5' });
  searchBarEl.append(
    searchInputEl,
    navPrevBtn,
    searchCountEl,
    navNextBtn,
    h('button', {
      class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
      title: 'Cerrar búsqueda (Esc)',
      onClick: closeSearch,
    }, svgIcon('close', { size: 12 })),
  );
  searchInputEl.addEventListener('input', onSearchInput);
  searchInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearch(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? moveNav('prev') : moveNav('next');
    }
  });

  const header = h('div', { class: 'loop-header shrink-0' }, [iconRow, searchBarEl]);

  rosterEl = h('div', {
    id: 'loop-roster',
    class: 'loop-roster shrink-0 border-b border-line px-1.5 py-1.5',
  });
  rosterBtnEl.setAttribute('aria-controls', 'loop-roster');

  // Sub-nodos persistentes: rosterListEl se vacía en cada poll, observerSelectEl no.
  rosterListEl = h('div', {});
  observerSelectEl = h('select', {
    class: 'mt-2 w-full text-[11px] px-2 py-1 rounded-md border border-line bg-bg text-fg-soft cursor-pointer hidden',
  });
  observerSelectEl.addEventListener('change', () => {
    const name = observerSelectEl.value || null;
    observerAgent = name;
    // Actualizar la firma para que el próximo poll no rehaga las opciones innecesariamente.
    observerSig = observerOptionsSignature(
      Array.from(observerSelectEl.options).slice(1).map((o) => ({ name: o.value })),
      name,
    );
    window.yusepe.loop.setObserverAgent(cwd(), name).catch((err) => {
      toast.error(`No se pudo guardar el agente designado: ${err?.message ?? String(err)}`);
    });
    refresh();
  });
  observerSelectEl.addEventListener('blur', () => {
    if (pendingObserverUpdate) {
      const { sig, agents } = pendingObserverUpdate;
      applyObserverOptions(agents, sig);
    }
  });
  rosterEl.append(rosterListEl, observerSelectEl);

  // El roster nunca se cierra por un evento — sólo al vencer la cuenta con
  // isHeld() false. mouseleave y focusout sólo rearman a 5 s (release).
  rosterEl.addEventListener('mouseleave', () => accordion?.release());
  rosterEl.addEventListener('focusout', (e) => {
    if (!rosterEl.contains(e.relatedTarget)) accordion?.release();
  });

  accordion = createRosterAccordion({
    isHeld: () => rosterEl.matches(':hover') || rosterEl.contains(document.activeElement),
    onChange: (open) => {
      if (open) {
        rosterEl.classList.remove('hidden');
      } else {
        rosterEl.classList.add('hidden');
      }
      rosterBtnEl.setAttribute('aria-expanded', String(open));
      // Actualizar el punto inmediatamente al cambiar estado, sin esperar el poll.
      applyAlertDot(lastRosterAlert, open);
    },
  });

  streamEl = h('div', { class: 'loop-stream flex-1 overflow-y-auto px-2 py-2 space-y-2' });
  emptyEl = h('div', { class: 'loop-empty hidden px-3 py-6 text-center text-[11px] text-fg-subtle leading-relaxed' });
  composerEl = h('div', { class: 'loop-composer shrink-0 px-2.5 pt-1 pb-2.5' });
  thinkingEl = h('div', { class: 'loop-thinking hidden', 'aria-live': 'polite' });
  composerEl.append(thinkingEl);

  // Sólo en la vista expandida (el CSS los oculta en el panel lateral).
  tilesListEl = h('div', { class: 'flex-1 overflow-y-auto space-y-0.5 loop-tiles' });
  const leftEl = h('div', { class: 'loop-left flex-col min-h-0 px-2 py-2' }, [
    h('div', { class: 'loop-col-title' }, 'Terminales y documentos'),
    tilesListEl,
    h('button', {
      class: 'mt-2 w-full text-xs font-medium text-white py-2 rounded-md bg-red-600 hover:bg-red-700 transition',
      onClick: closeSidebar,
    }, 'Cerrar chat de agentes'),
  ]);
  tasksSlotEl = h('div', { class: 'loop-slot loop-slot-tasks min-h-0 relative' });
  termSlotEl = h('div', { class: 'loop-slot flex-1 min-h-0 relative' });
  const rightEl = h('div', { class: 'loop-right flex-col min-h-0' });
  const { leftHandle, rightHandle, rowHandle } = buildSplitters(rightEl);
  rightEl.append(
    tasksSlotEl,
    rowHandle,
    h('div', { class: 'loop-col-title px-2 pt-1' }, 'Terminal'),
    termSlotEl,
  );
  for (const name of Object.keys(SPLITS)) writeSplit(name, readSplit(name));

  resizeHandleEl = null; // applyPanelPosition lo recreará
  panelEl.append(header, rosterEl, streamEl, emptyEl, composerEl, leftEl, rightEl, leftHandle, rightHandle);
  panelEl.classList.add('flex', 'flex-col');

  // ResizeObserver sobre composerEl (045): publica --loop-composer-h y, si
  // el usuario estaba al fondo, lo mantiene ahí cuando el compositor crece.
  // wasAtBottom se mide ANTES de escribir la variable: el padding nuevo
  // mueve el fondo y la medición posterior sería siempre "no estaba al fondo".
  composerRO = new ResizeObserver(() => {
    const wasAtBottom = isAtBottom(streamEl);
    const pad = composerPad(composerEl.offsetHeight, { streamH: streamEl.clientHeight });
    panelEl.style.setProperty('--loop-composer-h', `${pad}px`);
    if (wasAtBottom) streamEl.scrollTop = streamEl.scrollHeight;
  });
  composerRO.observe(composerEl);
}

async function refresh() {
  if (!cwd()) return;
  try {
    const [agents, messages, presence] = await Promise.all([
      window.yusepe.loop.agents(cwd()),
      window.yusepe.loop.messages(cwd(), { limit: 200 }),
      window.yusepe.loop.presence(cwd()),
    ]);
    const ordered = applyAgentOrder(agents, orderFor(cwd()));
    currentPresence = presence || {};
    renderRoster(ordered, currentPresence);
    renderStream(messages, ordered);
    renderThinking(agents, presence || {});
    applyUnread(messages);
    renderComposer(ordered);
  } catch (err) {
    streamEl.innerHTML = '';
    // Sincronizar el estado con el DOM que acabamos de vaciar.
    renderedIds = [];
    renderedSig = null;
    streamEl.append(h('p', { class: 'text-xs text-red-400 px-1' }, err?.message || String(err)));
  }
}

/* ---------- Reloj de titileo compartido (037 v2) ---------- */

function stopBlinkClock() {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
  blinkingDots.clear();
}

function startBlinkClock() {
  if (blinkTimer) return;
  blinkTimer = setInterval(() => {
    blinkOn = !blinkOn;
    for (const el of blinkingDots) {
      if (!el.isConnected) { blinkingDots.delete(el); continue; }
      el.style.opacity = blinkOn ? '1' : '0.2';
    }
    if (blinkingDots.size === 0) stopBlinkClock();
  }, 500);
}

/**
 * Crea el <span> del punto de estado para un agente.
 * Los puntos con blink: true se registran en blinkingDots y arrancan el reloj.
 */
function makeAgentDot(dotState) {
  const bgColor = {
    green: 'bg-emerald-400',
    red:   'bg-red-400',
    amber: 'bg-amber-400',
    gray:  'bg-slate-400/50',
  }[dotState.color] ?? 'bg-slate-400/50';

  const el = h('span', {
    class: `w-1.5 h-1.5 rounded-full shrink-0 ${bgColor}`,
    title: dotState.label,
    'aria-label': dotState.label,
  });

  if (dotState.blink) {
    el.style.opacity = blinkOn ? '1' : '0.2';
    blinkingDots.add(el);
    startBlinkClock();
  }
  return el;
}

/* ---------- Buscador en el hilo (039) ---------- */

function openSearch() {
  if (!searchBarEl) return;
  searchBarEl.classList.remove('hidden');
  searchInputEl?.focus();
  if (searchState) return;
  // Mostrar "buscando…" mientras se carga el hilo completo.
  if (searchCountEl) searchCountEl.textContent = 'buscando…';
  const c = cwd();
  if (!c) return;
  window.yusepe.loop.messages(c, { limit: 0 }).then((all) => {
    // Tomar lo que haya tipeado el usuario mientras llegaba el hilo.
    const query = searchInputEl?.value ?? '';
    searchState = { query, all, results: matchMessages(all, query) };
    renderSearchResults();
  }).catch(() => {
    if (searchCountEl) searchCountEl.textContent = '';
  });
}

function closeSearch() {
  searchState = null;
  if (searchBarEl) searchBarEl.classList.add('hidden');
  if (searchInputEl) searchInputEl.value = '';
  if (searchCountEl) searchCountEl.textContent = '';
  // Reset del render incremental: al volver al hilo normal, la 023 reconstruye.
  renderedIds = [];
  renderedSig = null;
  forceBottomNextRender = true;
  refresh();
}

function onSearchInput() {
  if (!searchState || !searchInputEl) return;
  const query = searchInputEl.value;
  if (query === searchState.query) return;
  searchState = { ...searchState, query, results: matchMessages(searchState.all, query) };
  renderSearchResults();
}

function renderSearchResults() {
  if (!searchState || !streamEl) return;
  const { query, results } = searchState;
  const colors = Object.fromEntries((currentAgents || []).map((a) => [a.name, colorOf(a)]));

  streamEl.innerHTML = '';
  renderedIds = [];
  renderedSig = null;

  if (!results.length) {
    searchState.activeIndex = -1;
    updateNavButtons();
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = query
      ? `Sin resultados para "${query}".`
      : 'Sin mensajes todavía.';
    if (searchCountEl) searchCountEl.textContent = query ? '0 resultados' : '';
    return;
  }

  emptyEl.classList.add('hidden');
  for (const msg of results) {
    // Los mensajes largos que coinciden se muestran desplegados.
    if ((msg.text?.length ?? 0) > LONG_MESSAGE_CHARS && !expanded.has(msg.id)) {
      expanded.add(msg.id);
    }
    streamEl.append(messageRow(msg, colors, query));
  }

  // Índice activo: el más reciente (abajo). El contador muestra la posición.
  const activeIndex = initialNavIndex(results);
  searchState.activeIndex = activeIndex;
  updateNavButtons();
  if (searchCountEl) {
    searchCountEl.textContent = query ? navLabel(activeIndex, results.length) : '';
  }
  // Aplicar anillo al activo y hacer scroll hasta él.
  queueMicrotask(() => applyNavActive(-1, activeIndex, results.length));
}

function updateNavButtons() {
  if (!navPrevBtn || !navNextBtn) return;
  const { activeIndex = -1, results = [] } = searchState ?? {};
  const len = results.length;
  // La función pura es la única fuente de la regla: si mover no cambia el índice, el extremo fue alcanzado.
  navPrevBtn.disabled = moveNavIndex(activeIndex, len, 'prev') === activeIndex;
  navNextBtn.disabled = moveNavIndex(activeIndex, len, 'next') === activeIndex;
}

/**
 * Toca SÓLO dos burbujas: quita el anillo del índice viejo y lo pone en el nuevo.
 * Pasa `oldIndex = -1` para saltar la limpieza (por ejemplo al init).
 */
function applyNavActive(oldIndex, newIndex, len) {
  if (!streamEl) return;
  if (oldIndex >= 0 && oldIndex < len) {
    const oldRow = streamEl.children[oldIndex];
    if (oldRow) oldRow.querySelector('.group')?.style.setProperty('outline', '');
  }
  if (newIndex >= 0 && newIndex < len) {
    const newRow = streamEl.children[newIndex];
    if (newRow) {
      const bubble = newRow.querySelector('.group');
      if (bubble) bubble.style.setProperty('outline', '2px solid var(--color-accent)');
      newRow.scrollIntoView({ block: 'center' });
    }
  }
}

function moveNav(dir) {
  if (!searchState || searchState.results.length === 0) return;
  const { activeIndex, results } = searchState;
  const newIndex = moveNavIndex(activeIndex, results.length, dir);
  if (newIndex === activeIndex) return; // en el extremo, ya está clavado
  applyNavActive(activeIndex, newIndex, results.length);
  searchState.activeIndex = newIndex;
  updateNavButtons();
  if (searchCountEl) searchCountEl.textContent = navLabel(newIndex, results.length);
}

/* ---------- Roster de terminales ---------- */

/** Hace cuánto que no cambia de estado, en texto corto. */
function sinceLabel(iso, now) {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

/**
 * Pinta o borra el punto de alerta en el botón del acordeón.
 * Un solo color (ámbar): el rojo está reservado para "ocupado" en los puntos
 * por agente. El texto dice qué pasa y a cuántos agentes afecta.
 */
function applyAlertDot(alert, rosterOpen) {
  if (!rosterBtnEl) return;
  const existing = rosterBtnEl.querySelector('[data-alert-dot]');
  if (existing) existing.remove();
  if (!alert || rosterOpen) return;

  let tip;
  if (alert.kind === 'both') {
    tip = `${alert.down} ${alert.down === 1 ? 'agente caído' : 'agentes caídos'} y `
        + `${alert.stuck} ${alert.stuck === 1 ? 'trabado' : 'trabados'}`;
  } else if (alert.kind === 'down') {
    tip = `${alert.count} ${alert.count === 1 ? 'agente caído' : 'agentes caídos'}`;
  } else {
    tip = `${alert.count} ${alert.count === 1 ? 'agente trabado' : 'agentes trabados'}`;
  }

  const dot = h('span', {
    'data-alert-dot': '',
    class: 'absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400',
    title: tip,
  });
  rosterBtnEl.style.position = 'relative';
  rosterBtnEl.append(dot);
}

/** Rehace las <option> del selector persistente y actualiza la firma. */
function applyObserverOptions(agents, sig) {
  observerSig = sig;
  pendingObserverUpdate = null;
  while (observerSelectEl.firstChild) observerSelectEl.removeChild(observerSelectEl.firstChild);
  const optNone = h('option', { value: '' }, 'Avisos a: ninguno');
  optNone.selected = !observerAgent;
  observerSelectEl.append(optNone);
  for (const a of agents) {
    const opt = h('option', { value: a.name }, `Avisos a: @${a.name}`);
    if (a.name === observerAgent) opt.selected = true;
    observerSelectEl.append(opt);
  }
  if (agents.length > 0) observerSelectEl.classList.remove('hidden');
  else observerSelectEl.classList.add('hidden');
}

/** Actualiza el selector sólo cuando la firma cambia; aplaza si el select tiene foco. */
function updateObserverSelect(agents) {
  if (!observerSelectEl) return;
  const sig = observerOptionsSignature(agents, observerAgent);
  if (sig === observerSig) return;
  if (observerSelectEl === document.activeElement) {
    pendingObserverUpdate = { sig, agents };
    return;
  }
  applyObserverOptions(agents, sig);
}

function renderRoster(agents, presence = {}) {
  // Un solo `now` para filas y punto — C5: "exactamente el mismo".
  const now = Date.now();
  rosterListEl.innerHTML = '';

  if (!agents.length) {
    rosterListEl.append(h('p', { class: 'text-[10px] text-fg-subtle px-1.5 py-1 leading-relaxed' },
      'Ninguna terminal está en el loop todavía.'));
  }

  for (const agent of agents) {
    const pres = presence[agent.name];
    const actResult = activityState({
      now,
      lastDataAtByAgent: { [agent.name]: pres?.lastDataAt },
      streakStartedAt: streaks.get(agent.name) ?? null,
    });
    streaks.set(agent.name, actResult.streakStartedAt);
    rosterListEl.append(agentRow(agent, pres, now, actResult));
  }

  rosterListEl.append(h('button', {
    class: 'w-full mt-1 text-[11px] px-2 py-1.5 rounded-md border border-line hover:bg-bg-elev transition text-fg-muted',
    onClick: openAddAgent,
  }, '+ Sumar una terminal al loop'));

  // Actualizar el selector persistente sólo si la firma cambió (y sin cerrarlo).
  updateObserverSelect(agents);

  // Actualizar el punto del botón del acordeón — flujo de datos, nunca toca
  // el controlador (criterio 4 de la spec).
  if (rosterBtnEl) {
    const alert = rosterAlert(agents, presence, now);
    lastRosterAlert = alert;

    let label = 'Agentes del loop';
    if (alert) {
      if (alert.kind === 'both') {
        label += ` — ${alert.down} ${alert.down === 1 ? 'caído' : 'caídos'} y ${alert.stuck} trabado${alert.stuck !== 1 ? 's' : ''}`;
      } else if (alert.kind === 'down') {
        label += ` — ${alert.count} ${alert.count === 1 ? 'agente caído' : 'agentes caídos'}`;
      } else {
        label += ` — ${alert.count} ${alert.count === 1 ? 'agente trabado' : 'agentes trabados'}`;
      }
    }
    // Sólo reescribir si cambió — evita pelea con tooltip.js, que roba el
    // `title` en el hover y no lo devuelve hasta que el puntero salga.
    if (rosterBtnEl.getAttribute('aria-label') !== label) {
      rosterBtnEl.setAttribute('aria-label', label);
      rosterBtnEl.setAttribute('title', label);
    }
    applyAlertDot(alert, accordion?.isOpen);
  }
}

function agentRow(agent, presence, now, actResult) {
  const tile = (state.profile?.tiles || []).find((t) => t.id === agent.tileId);
  const { subtitle: problem, showRelease: stuck } = rowFlags(agent, presence, now);
  const stuckMs = now - new Date(agent.updatedAt).getTime();
  const dotState = agentDotState({
    activity: actResult ?? { state: 'idle', streakStartedAt: null, sinceMs: 0 },
    absent: isAbsent(presence),
    working: agent.state === 'working',
    stuckMs,
  });

  // Segunda línea: normalmente el rol, pero si algo anda mal eso pasa a ser
  // lo importante — un rol prolijo no sirve de nada si el agente está caído.
  let subtitle;
  if (problem === 'absent') {
    subtitle = h('div', { class: 'text-[10px] text-red-400/90 truncate' },
      `terminal en el prompt (${presence.foreground}) — no recibe`);
  } else if (problem === 'stuck') {
    subtitle = h('div', { class: 'text-[10px] text-amber-400/90 truncate' },
      `ocupado ${sinceLabel(agent.updatedAt, now)} — ¿se colgó?`);
  } else if (agent.role) {
    subtitle = h('div', { class: 'text-[10px] text-fg-subtle truncate' }, agent.role);
  } else {
    subtitle = h('div', { class: 'text-[10px] text-fg-subtle/60 italic truncate' }, 'sin rol descrito');
  }

  // Mismo borde de color que sus burbujas en el hilo: es lo que enseña qué
  // color es de quién, sin necesidad de una leyenda aparte.
  const tint = colorOf(agent);

  return h('div', {
    class: 'group flex items-center gap-1.5 pl-2 pr-1.5 py-1.5 mb-1 rounded-md hover:bg-bg-elev transition cursor-pointer',
    style: `border-left: 3px solid ${tint}`,
    // El rol se ve cortado a una línea en la fila, así que el tooltip es el
    // único lugar donde se puede leer sin abrir el editor.
    title: [
      clampRole(agent.role),
      tile ? 'Ir a su terminal' : 'Su terminal ya no está en este workspace',
    ].filter(Boolean).join('\n\n'),
    onClick: () => { if (tile) focusTileById(tile.id); },
  }, [
    makeAgentDot(dotState),
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', {
        class: 'text-xs truncate font-medium flex items-center gap-0.5',
        style: `color: color-mix(in srgb, ${tint} 75%, var(--color-fg))`,
      }, [
        `${agent.emoji ? `${agent.emoji} ` : ''}@${agent.name}`,
        ...(agent.name === observerAgent
          ? [h('span', {
            class: 'ml-0.5 text-[9px] text-fg-subtle shrink-0',
            title: 'Agente designado para avisos del observador',
          }, '◉')]
          : []),
      ]),
      subtitle,
    ]),
    h('div', { class: 'hidden group-hover:flex gap-0.5 shrink-0' }, [
      // Sólo aparece cuando hace falta: liberar a mano un agente que quedó
      // colgado en `working`, para que su bandeja vuelva a fluir.
      ...(stuck ? [h('button', {
        class: 'inline-flex items-center text-amber-400 hover:text-fg px-1',
        title: `Marcar a @${agent.name} como libre (su bandeja está frenada)`,
        onClick: async (e) => {
          e.stopPropagation();
          await window.yusepe.loop.setState(cwd(), agent.name, 'waiting');
          refresh();
        },
      }, svgIcon('refresh', { size: 12 }))] : []),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1',
        title: 'Editar nombre y rol',
        onClick: (e) => { e.stopPropagation(); openAgentEditor(agent, tile); },
      }, svgIcon('edit', { size: 12 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-red-400 px-1',
        title: 'Sacar del loop',
        onClick: (e) => { e.stopPropagation(); removeAgent(agent, tile); },
      }, svgIcon('close', { size: 12 })),
    ]),
  ]);
}

/* ---------- Hilo de mensajes ---------- */

/**
 * Reconstrucción completa del hilo: borra todo y rehace desde cero.
 * Es la "red" del render incremental — se usa cuando el caso feliz
 * no aplica (firma de colores cambió, ids fuera de orden, archivo rehecho).
 * El peor caso sigue siendo el comportamiento anterior.
 */
function rebuildStream(messages, colors, sig) {
  streamEl.innerHTML = '';
  for (const msg of messages) streamEl.append(messageRow(msg, colors));
  renderedIds = messages.map((m) => m.id);
  renderedSig = sig;
}

function renderStream(messages, agents) {
  // En modo búsqueda el hilo está congelado: no tocarlo hasta cerrar.
  if (searchState) return;

  // Consumir la bandera de una sola vez: fuerza scroll al fondo sí o sí,
  // sin depender de atBottom (funciona incluso con el panel recién revelado).
  const forceBottom = forceBottomNextRender;
  if (forceBottom) forceBottomNextRender = false;

  // Calcular ANTES de tocar el DOM: innerHTML='' recorta scrollTop a 0.
  const atBottom = forceBottom || isAtBottom(streamEl);

  if (!messages.length) {
    // Vacío explícito: sin esto los nodos persistentes quedan como fantasmas.
    streamEl.innerHTML = '';
    renderedIds = [];
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = agents.length
      ? 'Sin mensajes todavía. Escribile a una terminal desde abajo y arranca el loop.'
      : 'Sumá al menos una terminal para empezar.';
    return;
  }
  emptyEl.classList.add('hidden');

  // El color es el del *emisor*: lo que se busca al barrer el hilo es
  // "qué dijo @qa", no a quién se lo dijo.
  const colors = Object.fromEntries(agents.map((a) => [a.name, colorOf(a)]));
  agentEmojis = Object.fromEntries(agents.map((a) => [a.name, a.emoji || null]));
  // Si cambia un color o un emoji, las burbujas ya pintadas quedan viejas.
  const sig = JSON.stringify([colors, agentEmojis]);

  // RED: la firma de colores cambió (agente renombrado, color editado,
  // agente nuevo o que salió). Evento raro, siempre disparado por el usuario
  // desde un modal, no por el poll — el parpadeo es aceptable.
  if (sig !== renderedSig) {
    rebuildStream(messages, colors, sig);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  const newIds = messages.map((m) => m.id);

  // ¿Qué ids de renderedIds siguen en la lista nueva?
  const kept = renderedIds.filter((id) => newIds.includes(id));

  // RED: todos los ids previos desaparecieron (archivo borrado o workspace
  // cambiado pese al reset en profile:loaded).
  if (renderedIds.length > 0 && kept.length === 0) {
    rebuildStream(messages, colors, sig);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  // RED: los ids que sobreviven no son un prefijo de newIds.
  // Ocurre si el archivo fue truncado o si una lectura parcial corrió los seq
  // (caso documentado en spec 023: la clave es id, no seq).
  if (kept.some((id, i) => id !== newIds[i])) {
    rebuildStream(messages, colors, sig);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  // RED: el DOM difiere de renderedIds (por ejemplo, el catch de refresh()
  // borró streamEl sin resetear el estado, o cualquier otro camino que toque
  // streamEl sin avisar). Previene que el hilo se congele en el cartel de error.
  if (streamEl.children.length !== renderedIds.length) {
    rebuildStream(messages, colors, sig);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  // Camino incremental.

  // 1. Sacar por arriba los ids que ya no están en la ventana de 200.
  const toRemove = renderedIds.length - kept.length;
  if (toRemove > 0) {
    // Medir altura total de las filas que salen ANTES de quitarlas.
    let removedHeight = 0;
    for (let i = 0; i < toRemove; i++) {
      const el = streamEl.children[i];
      if (el) removedHeight += el.offsetHeight;
    }
    for (let i = 0; i < toRemove; i++) {
      if (streamEl.firstChild) streamEl.removeChild(streamEl.firstChild);
    }
    // Compensar scrollTop para que la posición de lectura no salte.
    if (!atBottom) streamEl.scrollTop = Math.max(0, streamEl.scrollTop - removedHeight);
  }

  // 2. Appendear los ids nuevos (los que no estaban en DOM).
  const renderedSet = new Set(renderedIds);
  for (const msg of messages) {
    if (!renderedSet.has(msg.id)) streamEl.append(messageRow(msg, colors));
  }

  renderedIds = newIds;

  if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
}

function messageRow(msg, colors = {}, query = '') {
  const mine = msg.from === 'usuario';
  const forMe = msg.to === 'usuario';

  const who = mine
    ? `vos → @${msg.to}`
    : (forMe ? `@${msg.from} → vos` : `@${msg.from} → @${msg.to}`);

  // Los agentes escriben en Markdown. Pasa por el renderizador seguro de la
  // app (el texto de un agente no puede volverse código): `breaks` porque
  // sus reportes van línea por línea, y sin imágenes en el hilo.
  // El buscador aplica DESPUÉS, recorriendo nodos de texto con highlightInPlace
  // (nunca construyendo HTML: si lo hiciera el texto de un agente volvería a
  // ser código y rompería la garantía de renderMarkdown).
  const body = h('div', { class: 'loop-msg prose-bento text-xs text-fg break-words select-text cursor-text' });
  body.innerHTML = renderMarkdown(msg.text, { breaks: true, images: false });
  if (query) highlightInPlace(body, query);

  // El nombre del emisor va en su color; el resto del encabezado queda
  // apagado. Así el color aparece dos veces (borde y nombre) y se aprende
  // solo a quién pertenece sin tener que ir al roster.
  const tint = mine ? null : colors[msg.from];
  const header = h('div', { class: 'text-[10px] text-fg-subtle mb-0.5 flex items-center gap-1' }, [
    h('span', { class: 'truncate' }, tint
      ? [h('span', {
        class: 'font-semibold',
        // Mezclado hacia --color-fg: en tema oscuro eso aclara el color y
        // en claro lo oscurece, así el nombre se lee en los dos sin tener
        // que mantener dos paletas.
        style: `color: color-mix(in srgb, ${tint} 75%, var(--color-fg))`,
      }, `@${msg.from}`),
      forMe ? ' → vos' : ` → @${msg.to}`]
      : who),
    h('span', { class: 'text-fg-subtle/60 shrink-0' }, formatTime(msg.createdAt)),
    copyButton(msg),
  ]);

  const parts = [header, body];

  if (msg.text.length > LONG_MESSAGE_CHARS) parts.push(collapseToggle(msg, body));

  // Borde izquierdo grueso + un lavado del mismo color sobre el fondo del
  // tile. Se tiñe el fondo y no el texto porque estos mensajes son reportes
  // largos: el texto tiene que seguir leyéndose con el contraste de siempre,
  // en tema claro y oscuro.
  const bubble = h('div', {
    class: [
      'group loop-bubble max-w-[85%] rounded-lg px-2.5 py-1.5 border',
      mine
        ? 'bg-accent/15 border-accent/30'
        : (forMe ? 'bg-bg-elev border-accent/20' : 'bg-bg-elev border-line'),
    ].join(' '),
    style: tint
      ? `border-left: 3px solid ${tint}; background: color-mix(in srgb, ${tint} 10%, var(--color-bg-elev));`
      : null,
  }, parts);

  // Avatar estilo red social: el emoji del agente (o su inicial). Siempre se
  // crea, pero el CSS sólo lo muestra en la vista expandida — en el panel
  // lateral el ancho es para el texto.
  const avatar = mine ? null : h('div', {
    class: 'loop-avatar',
    style: tint ? `border-color: ${tint}; background: color-mix(in srgb, ${tint} 18%, var(--color-bg-elev));` : null,
    title: `@${msg.from}`,
  }, agentEmojis[msg.from] || msg.from.charAt(0).toUpperCase());

  // data-id / data-to: los usa paintUnreadStream para marcar sin redibujar.
  return h('div', {
    class: `loop-row flex ${mine ? 'justify-end' : 'justify-start'}`,
    'data-id': msg.id,
    'data-to': msg.to,
  }, avatar ? [avatar, bubble] : [bubble]);
}

/**
 * Botón "Ver más / Ver menos" de un mensaje largo.
 *
 * Alterna en el lugar en vez de redibujar el hilo: desplegar un reporte de
 * QA no debería hacerte perder la posición del scroll en la conversación.
 */
function collapseToggle(msg, body) {
  const lines = msg.text.split('\n').length;
  const hint = lines > 3 ? `${lines} líneas` : `${Math.round(msg.text.length / 100) / 10}k caracteres`;

  const button = h('button', {
    class: 'mt-1 text-[10px] text-accent-soft hover:text-fg transition',
  });

  const paint = () => {
    const isOpen = expanded.has(msg.id);
    body.classList.toggle('loop-msg-clamp', !isOpen);
    button.textContent = isOpen ? 'Ver menos' : `Ver más (${hint})`;
  };

  button.addEventListener('click', () => {
    if (expanded.has(msg.id)) expanded.delete(msg.id);
    else expanded.add(msg.id);
    paint();
  });

  paint();
  return button;
}

function copyButton(msg) {
  const feedback = createCopyFeedback({
    onState(state) {
      const icon = state === 'done' ? 'check' : state === 'failed' ? 'warning' : 'copy';
      const label = state === 'done' ? 'Copiado' : state === 'failed' ? 'No se pudo copiar' : 'Copiar mensaje';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.replaceChildren(svgIcon(icon));
      if (state === 'failed') toast.error('No se pudo copiar el mensaje');
    },
  });

  const btn = h('button', {
    class: 'ml-auto inline-flex items-center justify-center w-5 h-5 rounded text-fg-subtle hover:text-fg transition opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 select-none',
    'aria-label': 'Copiar mensaje',
    title: 'Copiar mensaje',
  }, [svgIcon('copy')]);

  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => {
    feedback.run(() => window.yusepe.clipboard.writeText(msg.text));
  });

  return btn;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ---------- Composer ---------- */

/**
 * Crea una sola vez el textarea, el botón y sus listeners (spec 022, ruta C).
 *
 * Al no destruir el textarea en cada refresh, el caret, el historial de
 * deshacer y la composición IME sobreviven al poll de 1,5 s. `send()` lee
 * `currentAgents` en el momento del envío — no captura el parámetro —, así
 * un agente sumado después del primer render se reconoce en el atajo
 * "@nombre texto" en vez de ir silenciosamente al destinatario equivocado.
 */
function ensureComposerBox() {
  if (composerBoxEl) return;

  // Caja estilo chat moderno (referencia: el input de Claude): una sola
  // tarjeta redondeada con el texto arriba y, adentro, una barra con los
  // destinatarios a la izquierda y un botón circular de enviar a la derecha.
  // El botón azul de ancho completo se comía la atención del hilo.
  pillsContainerEl = h('div', { class: 'flex flex-wrap gap-1 min-w-0' });

  composerInput = h('textarea', {
    rows: '2',
    class: 'w-full bg-transparent border-0 px-1 py-0.5 text-sm text-fg resize-none leading-relaxed '
      + 'focus:outline-none placeholder:text-fg-subtle/70',
    spellcheck: 'false',
  });

  const send = async () => {
    const raw = composerInput.value.trim();
    if (!raw) return;

    // Un `@nombre` al principio manda sobre la pill elegida.
    const match = raw.match(/^@([a-z0-9][a-z0-9_-]*)\s+([\s\S]+)$/i);
    // Lee currentAgents en el momento del envío, no el closure del primer render.
    const to = match && currentAgents.some((a) => a.name === match[1].toLowerCase())
      ? match[1].toLowerCase()
      : target;
    const text = match && to === match[1].toLowerCase() ? match[2] : raw;

    composerInput.value = '';
    composerInput._reset?.();
    try {
      // seenUpTo: último id renderizado al escribir — es el "hasta dónde leí" del humano.
      await window.yusepe.loop.post(cwd(), { from: 'usuario', to, text, seenUpTo: renderedIds.at(-1) ?? null });
      target = to;
      await refresh();
    } catch (err) {
      composerInput.value = raw;
      // Asignar .value por código no dispara 'input', así que resize() no corre
      // sola: el borrador vuelve pero la caja queda en la altura mínima con
      // overflow oculto. Hay que llamarla explícitamente.
      resize();
      paintSend();
      toast.error(err?.message || String(err));
    }
  };

  composerInput.addEventListener('keydown', (e) => {
    // Enter envía; Shift+Enter hace salto de línea (convención de chat).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  composerSendBtn = h('button', {
    class: 'loop-send shrink-0',
    onClick: send,
  }, svgIcon('arrow-up', { size: 15 }));
  // El botón se "enciende" sólo cuando hay algo para mandar.
  const paintSend = () => composerSendBtn.classList.toggle('is-ready', !!composerInput.value.trim());
  composerInput.addEventListener('input', paintSend);

  const toolbar = h('div', { class: 'flex items-end justify-between gap-2 mt-1.5' }, [
    pillsContainerEl, composerSendBtn,
  ]);
  composerBoxEl = h('div', {}, [
    h('div', { class: 'loop-input' }, [composerInput, toolbar]),
    h('p', { class: 'text-[10px] text-fg-subtle/70 text-center mt-1.5' }, 'Enter envía · Shift+Enter, nueva línea'),
  ]);
  composerEl.append(composerBoxEl);

  // Medir minH con el textarea vacío: es el estado legítimo al crear la caja.
  // La maniobra value=''→medir→value=draft que causaba el bug desaparece aquí.
  composerInput.style.height = 'auto';
  const minH = composerInput.scrollHeight;
  composerInput.style.height = `${minH}px`;

  // maxH se calcula perezosamente en resize(): así es correcto ante cambios
  // de alto de ventana, ancho del panel (las pills reenvuelven) y cantidad
  // de agentes, sin necesitar un ResizeObserver.
  const resize = () => {
    const prevScroll = composerInput.scrollTop;
    composerInput.style.height = 'auto';
    const natural = composerInput.scrollHeight;
    const maxComposer = panelEl.offsetHeight * 0.33;
    const fixed = toolbar.offsetHeight + 48;
    const maxH = Math.max(minH, maxComposer - fixed);
    const next = Math.min(Math.max(natural, minH), maxH);
    composerInput.style.height = `${next}px`;
    composerInput.style.overflowY = natural > maxH ? 'auto' : 'hidden';
    if (natural > maxH) composerInput.scrollTop = prevScroll;
  };

  composerInput.addEventListener('input', resize);

  composerInput._reset = () => {
    composerInput.style.height = `${minH}px`;
    composerInput.style.overflowY = 'hidden';
    paintSend();
  };
}

/**
 * Termina el arrastre activo (o la presión pendiente). Es la ÚNICA función que
 * pone dragState = null y pressState = null.
 *
 * Todas las salidas del gesto pasan por acá:
 *   pointerup (con y sin cambio), pointercancel, lostpointercapture,
 *   Escape, blur de ventana, cierre del panel, cambio de workspace.
 *
 * `commit = true`  → leer el DOM y guardar si el orden cambió.
 * `commit = false` → descartar (el DOM se reconstruye con el orden anterior).
 */
async function endDrag(commit) {
  if (!dragState && !pressState) return;

  // Cancelar el timer y limpiar el estado pendiente si existe.
  if (pressState) { pressState.abort(); pressState = null; }

  if (!dragState) {
    // No repintar: si el gesto fue un tap, el click que llega después lo repinta.
    // Si fue cancel/Escape/blur, el poll repinta en ≤1,5 s como mucho.
    // (Repintar aquí hace innerHTML='' dentro del pointerup y destruye la pill
    // antes de que Chromium despache el click — H16.)
    return;
  }

  const { pillEl, preOrderNames } = dragState;
  dragState = null;

  // Quitar el estado visual de "levantada".
  pillEl.style.transform = '';
  pillEl.style.boxShadow = '';
  pillEl.style.cursor = '';
  pillEl.style.zIndex = '';
  pillEl.style.position = '';

  if (commit && pillsContainerEl && cwd()) {
    const domNames = Array.from(pillsContainerEl.children)
      .map((el) => el.dataset.agent);

    // applyAgentOrder garantiza que agentes llegados durante el drag queden
    // al final y que agentes que se fueron no aparezcan.
    const newOrdered = applyAgentOrder(currentAgents, domNames);
    const newNames = newOrdered.map((a) => a.name);

    // Lo que se mostraba antes del drag (mismo cálculo que refresh usó).
    const prevNames = applyAgentOrder(currentAgents, preOrderNames).map((a) => a.name);

    if (newNames.join(',') !== prevNames.join(',')) {
      agentOrder = { cwd: cwd(), names: newNames };
      try {
        await window.yusepe.loop.setOrder(cwd(), newNames);
      } catch {
        toast.error('No se pudo guardar el orden de las pills — al reiniciar volverá el orden anterior');
      }
      refresh(); // actualiza el roster con el nuevo orden
    }
  }

  // currentAgents = lista más reciente (puede incluir un agente sumado durante
  // el drag si dirty se marcó).
  renderPills(currentAgents);
}

/**
 * Repinta sólo las pills y actualiza placeholder y etiqueta del botón.
 * El textarea no se toca: el caret, el borrador y el historial sobreviven.
 *
 * currentAgents SE ASIGNA ANTES DEL CORTE para que send() siempre tenga
 * la lista al día aunque el repintado quede suspendido por un drag.
 */
function renderPills(agents) {
  currentAgents = agents; // SIEMPRE primero: send() lo necesita al día

  // Re-targetear si el destino ya no está en el loop.
  if (!agents.some((a) => a.name === target)) target = agents[0]?.name || null;

  // H13: actualizar placeholder y botón aunque el DOM quede suspendido, para
  // que "Enviar a @x" refleje siempre el destinatario actual.
  if (composerInput) composerInput.placeholder = `Mensaje para @${target}…  (Enter envía)`;
  if (composerSendBtn) {
    const span = composerSendBtn.querySelector('span');
    if (span) span.textContent = `Enviar a @${target}`;
  }

  // Durante un arrastre (o presión pendiente) el DOM pertenece al gesto;
  // marcar dirty para repintar cuando termine.
  if (dragState || pressState) { if (dragState) dragState.dirty = true; return; }

  if (!pillsContainerEl) return;

  // Lee streaks.get() pero NO escribe: renderRoster() escribe la racha en cada vuelta y
  // siempre corre antes (ver refresh()). Si algún día se saltea renderRoster con el roster
  // cerrado, los puntos leerían null y titilarian para siempre — en ese caso extraer un
  // helper computeStreak(agent, pres, now) que lea y escriba, y usarlo en ambos sitios.
  pillsContainerEl.innerHTML = '';
  const now = Date.now();
  for (const agent of agents) {
    const pres = currentPresence[agent.name];
    const actResult = activityState({
      now,
      lastDataAtByAgent: { [agent.name]: pres?.lastDataAt },
      streakStartedAt: streaks.get(agent.name) ?? null,
    });
    const stuckMs = now - new Date(agent.updatedAt).getTime();
    const dotState = agentDotState({
      activity: actResult,
      absent: isAbsent(pres),
      working: agent.state === 'working',
      stuckMs,
    });
    const dot = makeAgentDot(dotState);

    const pill = h('button', {
      class: [
        'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border transition select-none',
        agent.name === target
          ? 'bg-accent/20 border-accent/40 text-fg'
          : 'border-line hover:bg-bg-elev',
      ].join(' '),
      style: agent.name === target
        ? null
        : `color: color-mix(in srgb, ${colorOf(agent)} 75%, var(--color-fg))`,
      title: clampRole(agent.role) || `Escribirle a @${agent.name}`,
      'aria-label': `@${agent.name} — ${dotState.label}`,
    });
    pill.dataset.agent = agent.name;
    pill.append(dot, `@${agent.name}`);

    attachPillGesture(pill, agent);
    pillsContainerEl.append(pill);
  }
}

/**
 * Adjunta el gesto de puntero a una pill.
 *
 * Tres resultados posibles:
 *   'tap'    → pointerdown + pointerup sin moverse ni llegar al segundo
 *   'cancel' → se movió más de SLOP_PX antes del segundo
 *   'lift'   → aguantó el segundo → drag
 *
 * El resultado se guarda en pill._gestureOutcome y se reinicia en cada
 * pointerdown. No hay bandera pegajosa que espere al click: si el puntero
 * se suelta fuera de la pill y el click nunca llega, el valor viejo se pisa
 * en el próximo pointerdown.
 */
function attachPillGesture(pill, agent) {
  let pressData = null;

  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pill.setPointerCapture(e.pointerId);
    pill._gestureOutcome = null; // reiniciar en cada pointerdown

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;

    pressData = {
      pointerId,
      startX,
      startY,
      movedPx: 0,
      lifted: false,
      timer: setTimeout(() => {
        if (!pressData || pressData.pointerId !== pointerId) return;
        // H11(i): si el poll destruyó la pill durante la espera, no crear dragState.
        if (!pill.isConnected) { pressData = null; pressState = null; return; }
        pressData.lifted = true;
        pill.style.transform = 'scale(1.08)';
        pill.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        pill.style.cursor = 'grabbing';
        pill.style.zIndex = '50';
        pill.style.position = 'relative';
        dragState = {
          pillEl: pill,
          pointerId,
          preOrderNames: [...orderFor(cwd())], // H14: snapshot del workspace actual
          dirty: false,
          lastReorderPt: null, // histéresis: punto del último reordenamiento
        };
      }, HOLD_MS),
    };

    // H11(ii): registrar el estado pendiente desde el pointerdown para que
    // renderPills no destruya la pill durante el segundo de espera.
    pressState = { abort: () => { clearTimeout(pressData?.timer); pressData = null; } };
  });

  pill.addEventListener('pointermove', (e) => {
    if (!pressData || e.pointerId !== pressData.pointerId) return;

    const dx = e.clientX - pressData.startX;
    const dy = e.clientY - pressData.startY;
    pressData.movedPx = trackPress(pressData.movedPx, dx, dy);

    // Cancelar el timer si se movió demasiado antes del segundo.
    if (!pressData.lifted && pressData.movedPx > SLOP_PX) {
      clearTimeout(pressData.timer);
      pressData.timer = null;
    }

    // Reordenar las otras pills durante el arrastre (v2: la pill capturada NO se mueve).
    if (dragState?.pillEl === pill && pillsContainerEl) {
      const otherPills = Array.from(pillsContainerEl.children).filter((el) => el !== pill);
      const rects = otherPills.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
      });
      const nuevo = insertionIndex(rects, { x: e.clientX, y: e.clientY });
      const point = { x: e.clientX, y: e.clientY };
      if (shouldReorder(point, dragState.lastReorderPt)) {
        const moves = crossingMoves([...pillsContainerEl.children], pill, nuevo);
        if (moves.length) {
          for (const mv of moves) pillsContainerEl.insertBefore(mv.node, mv.before);
          dragState.lastReorderPt = point;
        }
      }
    }
  });

  pill.addEventListener('pointerup', (e) => {
    if (!pressData || e.pointerId !== pressData.pointerId) return;
    // Capturar antes de que endDrag limpie pressData vía pressState.abort().
    const pd = pressData;
    pill._gestureOutcome = pressOutcome({ lifted: pd.lifted, movedPx: pd.movedPx });
    endDrag(dragState?.pillEl === pill);
  });

  pill.addEventListener('pointercancel', (e) => {
    if (!pressData || e.pointerId !== pressData.pointerId) return;
    pill._gestureOutcome = 'cancel';
    endDrag(false);
  });

  pill.addEventListener('lostpointercapture', (e) => {
    if (!pressData || e.pointerId !== pressData.pointerId) return;
    endDrag(false);
  });

  pill.addEventListener('click', (e) => {
    // Activación por teclado (Enter / Espacio): e.detail === 0.
    if (e.detail === 0) {
      target = agent.name;
      renderPills(currentAgents);
      composerInput?.focus();
      return;
    }
    // Activación por puntero: sólo si el gesto fue un tap limpio.
    if (pill._gestureOutcome === 'tap') {
      target = agent.name;
      renderPills(currentAgents);
      composerInput?.focus();
    }
  });
}

function renderComposer(agents) {
  if (!agents.length) {
    // Ocultar la caja (no destruirla: el borrador sobrevive).
    if (composerBoxEl) composerBoxEl.classList.add('hidden');
    if (!composerNoAgentsEl) {
      composerNoAgentsEl = h('p', { class: 'text-[10px] text-fg-subtle px-1' },
        'Sumá una terminal al loop para poder escribirle.');
      composerEl.prepend(composerNoAgentsEl);
    } else {
      composerNoAgentsEl.classList.remove('hidden');
    }
    return;
  }

  // Ocultar el mensaje orientativo si estaba visible.
  if (composerNoAgentsEl) composerNoAgentsEl.classList.add('hidden');

  ensureComposerBox();
  composerBoxEl.classList.remove('hidden');
  renderPills(agents);
}

/* ---------- Alta y edición de agentes ---------- */

// El mini-mapa + última línea para distinguir terminales vive en
// terminalPicker.js — compartido con snippetsSidebar.js.

/** Terminales del workspace que todavía no están en el loop. */
function freeTerminals(agents) {
  const taken = new Set(agents.map((a) => a.tileId).filter(Boolean));
  return (state.profile?.tiles || []).filter((t) => t.kind === 'terminal' && !taken.has(t.id));
}

async function openAddAgent() {
  const agents = await window.yusepe.loop.agents(cwd());
  const candidates = freeTerminals(agents);

  if (!candidates.length) {
    toast.error('No hay terminales libres en este workspace. Abrí una terminal primero.');
    return;
  }

  // Con una sola candidata no tiene sentido hacer elegir: se va derecho al
  // formulario que importa (nombre y rol).
  const taken = agents.map(colorOf);

  if (candidates.length === 1) {
    openAgentEditor(null, candidates[0], taken);
    return;
  }

  const tile = await pickTerminal(candidates, { title: 'Elegí la terminal que entra al loop' });
  if (tile) openAgentEditor(null, tile, taken);
}

/**
 * Alta/edición de un agente. El rol no es decorativo: los otros agentes lo
 * leen para saber a quién dirigirse, así que el formulario lo pide con un
 * ejemplo en vez de dejarlo como un campo opcional cualquiera.
 */
function openAgentEditor(existing, tile, taken = []) {
  const nameInput = h('input', {
    type: 'text',
    value: existing?.name || '',
    placeholder: 'claudio',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-1 focus:ring-accent',
  });
  // Textarea y no input: el rol terminó siendo el prompt del agente ("sos un
  // dev que recibe requerimientos del TL…"), y en una línea no se puede ni
  // releer lo que se escribió. `resize-y` porque hay roles de dos renglones
  // y otros de quince.
  const roleInput = h('textarea', {
    rows: '5',
    placeholder: 'codifica y gestiona archivos',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mb-1 leading-relaxed '
      + 'resize-y min-h-[4.5rem] focus:outline-none focus:ring-1 focus:ring-accent',
    spellcheck: 'false',
  });
  roleInput.value = existing?.role || '';

  // Color de identidad. Editando, arranca en el que ya se ve en el hilo (el
  // suyo o el derivado de su nombre). Dando de alta no hay nombre todavía
  // del cual derivarlo, así que se propone el primer color de la paleta que
  // no esté usando otro agente — que es justo el punto de tener colores.
  let color = existing
    ? colorOf(existing)
    : (PALETTE.find((c) => !taken.includes(c)) || PALETTE[0]);

  const swatches = h('div', { class: 'flex flex-wrap gap-1.5 mb-1' });
  const paintSwatches = () => {
    swatches.innerHTML = '';
    for (const option of PALETTE) {
      const active = option === color;
      swatches.append(h('button', {
        class: `w-7 h-7 rounded-full border-2 transition ${
          active ? 'border-fg scale-110' : 'border-transparent hover:border-line'}`,
        style: `background: ${option}`,
        title: active ? 'Color actual' : 'Usar este color',
        onClick: () => { color = option; paintSwatches(); },
      }));
    }
  };
  paintSwatches();

  // Emoji de avatar (se ve en el hilo expandido y en el roster). Campo libre
  // para pegar cualquiera, más una tira de sugerencias para no tener que
  // abrir el selector del sistema. La validación de verdad está en loopOps.
  const emojiInput = h('input', {
    type: 'text',
    value: existing?.emoji || '',
    maxlength: '16',
    placeholder: '🙂',
    class: 'w-14 h-10 bg-bg-elev border border-line rounded-md text-center text-xl focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const EMOJI_PICKS = ['🤖', '🧠', '🦾', '👾', '🦊', '🐙', '🦉', '🐝', '🚀', '⚡', '🔧', '🛠️',
    '🧪', '🔍', '📐', '🎨', '🧭', '🛡️', '📦', '🐳', '🔥', '🌱', '👩‍💻', '🧙'];
  const emojiRow = h('div', { class: 'flex items-start gap-2 mb-1' }, [
    emojiInput,
    h('div', { class: 'flex flex-wrap gap-0.5 flex-1' }, [
      ...EMOJI_PICKS.map((e) => h('button', {
        class: 'w-7 h-7 rounded-md text-base hover:bg-bg-elev transition',
        title: `Usar ${e}`,
        onClick: () => { emojiInput.value = e; },
      }, e)),
      h('button', {
        class: 'h-7 px-2 rounded-md text-[10px] text-fg-subtle hover:text-fg hover:bg-bg-elev transition',
        onClick: () => { emojiInput.value = ''; },
      }, 'Sin emoji'),
    ]),
  ]);

  const error = h('div', { class: 'text-xs text-red-400 mt-2 hidden' });

  const save = async () => {
    const name = nameInput.value.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
      error.textContent = 'El nombre va sin espacios ni acentos: letras, números, guiones. Ej: claudio';
      error.classList.remove('hidden');
      return;
    }

    try {
      // Renombrar es dar de baja y de alta: el nombre ES la identidad en el
      // mailbox, así que el viejo no puede quedar colgado recibiendo.
      if (existing && existing.name !== name) {
        await window.yusepe.loop.unregister(cwd(), existing.name);
      }

      const saved = await window.yusepe.loop.register(cwd(), {
        name, role: roleInput.value.trim(), tileId: tile?.id || existing?.tileId || null, color,
        emoji: emojiInput.value.trim(),
      });
      if (emojiInput.value.trim() && !saved?.emoji) {
        toast.warning('Ese texto no es un emoji: el agente quedó sin avatar.');
      }
      // El protocolo tiene que existir antes del primer mensaje: es la ruta
      // que el repartidor le pasa al agente al pegarle en la terminal.
      await window.yusepe.loop.ensureSkill(cwd());

      if (tile) await bindTerminal(tile, name);

      closeModal();
      if (isOpen) refresh();
      else toggleLoopSidebar();
      toast.success(`@${name} está en el loop`);
    } catch (err) {
      error.textContent = err?.message || String(err);
      error.classList.remove('hidden');
    }
  };

  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') roleInput.focus(); });
  // En el textarea Enter tiene que hacer salto de línea — es un prompt de
  // varios renglones, no un campo. Guardar pasa a Cmd/Ctrl+Enter.
  roleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });

  openModal({
    title: existing ? `Editar @${existing.name}` : 'Sumar terminal al loop',
    body: h('div', {}, [
      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Nombre'),
      nameInput,
      h('p', { class: 'text-[10px] text-fg-subtle/70 mb-3' },
        'Así la llaman las otras terminales: "@claudio revisá esto".'),

      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Rol'),
      roleInput,
      h('p', { class: 'text-[10px] text-fg-subtle/70 mb-3' },
        'Qué se encarga de hacer. Lo leen los otros agentes para saber a quién dirigirse, '
        + 'así que conviene ser concreto: "valida código fuente" dice más que "ayudante". '
        + 'Cmd/Ctrl+Enter para guardar.'),

      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Color'),
      swatches,
      h('label', { class: 'text-xs text-fg-subtle block mb-1 mt-3' }, 'Emoji'),
      emojiRow,
      h('p', { class: 'text-[10px] text-fg-subtle/70 mb-3' },
        'Su avatar en el hilo cuando el loop está expandido.'),
      h('p', { class: 'text-[10px] text-fg-subtle/70 mb-3' },
        'Con qué color se marcan sus mensajes en el hilo. Es sólo para distinguirlos de un '
        + 'vistazo — los agentes no lo ven.'),

      error,
      h('button', {
        class: 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
        onClick: save,
      }, existing ? 'Guardar cambios' : 'Sumar al loop'),
    ]),
  });
  setTimeout(() => nameInput.focus(), 0);
}

/**
 * Deja la terminal lista para actuar como agente.
 *
 * La asociación nombre->pty se le avisa a main (que es quien reparte), y
 * además se exporta la identidad dentro del shell que ya está corriendo:
 * las variables de entorno se fijan al crear el pty, así que una terminal
 * que ya estaba abierta cuando la sumaste no las tendría y el CLI le diría
 * "no sé quién sos".
 */
async function bindTerminal(tile, name) {
  await ProfileManager.updateTile(tile.id, { loopAgent: name });
  bus.emit('loop:binding-changed', { tileId: tile.id, name });

  const entry = liveTiles.get(tile.id);
  const ptyId = entry?.kind === 'terminal' ? entry.meta?.ptyId : null;
  if (!ptyId) return;

  await window.yusepe.loop.bind(name, ptyId, cwd());

  // El `export` sólo si la terminal está en el prompt del shell. Si adentro
  // ya hay un agente corriendo, ese texto le entra como si fuera un mensaje
  // del usuario — y encima no queda seteado, porque las herramientas del
  // agente lanzan sus propios procesos hijos del suyo, no del shell.
  // Pasó en campo: un agente terminó prefijando YBENTO_AGENT a mano en cada
  // comando sin entender por qué no persistía.
  const atPrompt = await window.yusepe.loop.atPrompt(ptyId);
  if (atPrompt) {
    window.yusepe.pty.input(ptyId,
      `export YBENTO_AGENT=${name} YBENTO_ROOT=${JSON.stringify(cwd())}\r`);
    return;
  }

  toast.warning(
    `@${name} quedó en el loop, pero su terminal ya tiene un agente corriendo: `
    + 'no va a heredar su identidad. Reinicialo para que la tome.',
    { duration: 9000 },
  );
}

async function removeAgent(agent, tile) {
  const confirmed = await confirmModal({
    title: 'Sacar del loop',
    body: `¿Sacar a @${agent.name} del loop? Su terminal sigue abierta, pero deja de recibir mensajes.`,
    confirmLabel: 'Sacar',
    danger: true,
  });
  if (!confirmed) return;

  await window.yusepe.loop.unregister(cwd(), agent.name);
  if (tile) {
    await ProfileManager.updateTile(tile.id, { loopAgent: null });
    bus.emit('loop:binding-changed', { tileId: tile.id, name: null });
  }
  refresh();
}

/* ---------- skill.md ---------- */

async function openSkillEditor() {
  const content = await window.yusepe.loop.skill(cwd());

  const area = h('textarea', {
    class: 'w-full h-80 bg-bg-elev border border-line rounded-md p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent',
    spellcheck: 'false',
  });
  area.value = content;

  openModal({
    title: 'Protocolo del loop (.ybento/loop/skill.md)',
    size: 'lg',
    body: h('div', {}, [
      h('p', { class: 'text-xs text-fg-subtle mb-3' },
        'Lo leen los agentes para saber cómo mandarse mensajes. Al pegarles un mensaje en '
        + 'la terminal se les pasa la ruta de este archivo, no su contenido.'),
      area,
      h('button', {
        class: 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
        onClick: async () => {
          await window.yusepe.loop.setSkill(cwd(), area.value);
          closeModal();
          toast.success('Protocolo guardado');
        },
      }, 'Guardar'),
    ]),
  });
}
