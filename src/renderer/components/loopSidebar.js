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
import { openModal, closeModal, confirmModal } from './modal.js';
import { ProfileManager } from '../core/profileManager.js';
import * as liveTiles from '../core/liveTiles.js';
import { focusTileById } from './bentoGrid.js';
import { labelFor } from './workspaceManager.js';
import { applySavedWidth, makeResizeHandle } from '../utils/resizableSidebar.js';
import { toast } from './toast.js';
import { notifyUserMessage } from '../core/loopNotify.js';

const WIDTH_OPTS = {
  storageKey: 'yusepe:loop-width',
  // El panel está pegado al borde derecho, así que su borde "interior" —
  // por donde se agarra para agrandarlo — es el izquierdo.
  edge: 'left',
  min: 300,
  max: 900,
  defaultWidth: 384,
};

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
let rosterEl = null;
let streamEl = null;
let composerEl = null;
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

/* ---------- Modo del loop: un loop a la vez vs. simultáneos ---------- */

const LOOP_MODE_KEY = 'yusepe:loop-mode';

export function getLoopMode() {
  const v = localStorage.getItem(LOOP_MODE_KEY);
  return v === 'multi' ? 'multi' : 'single';
}

export function setLoopMode(mode) {
  localStorage.setItem(LOOP_MODE_KEY, mode === 'multi' ? 'multi' : 'single');
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

const cwd = () => state.profile?.cwd || null;

export function initLoopSidebar() {
  panelEl = document.getElementById('loop-sidebar');
  if (!panelEl) return;

  applySavedWidth(panelEl, WIDTH_OPTS);
  buildChrome();

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
    if (cwd()) window.yusepe.loop.start(cwd());
    // Restaurar el estado abierto/cerrado guardado para este workspace.
    if (savedOpenState(state.profile?.id)) openSidebar();
    else closeSidebar();
  });
  bus.on('workspace:left', () => {
    // Guardar el estado actual antes de salir, para restaurarlo al volver.
    persistOpenState(state.profile?.id, isOpen);
    // En modo "un loop a la vez", detener el dispatcher de este workspace.
    // En modo "loops simultáneos", dejarlo corriendo para que los agentes
    // de este workspace sigan recibiendo mensajes aunque no estemos acá.
    if (getLoopMode() === 'single') {
      window.yusepe.loop.stop(cwd());
    }
  });
  bus.on('profile:cleared', () => { closeSidebar(); window.yusepe.loop.stop(); });

  // Cambios en disco (los postea el CLI de cada agente, desde otro proceso).
  window.yusepe.loop.onChanged(() => { if (isOpen) refresh(); checkNotify(); });
  window.yusepe.loop.onDelivered(() => { if (isOpen) refresh(); checkNotify(); });
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

export function isLoopSidebarOpen() {
  return isOpen;
}

export function toggleLoopSidebar() {
  if (!state.profile) return;
  if (isOpen) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  if (!panelEl) return;
  if (!cwd()) {
    toast.error('Este workspace no tiene carpeta asignada — el loop guarda sus mensajes en .ybento/loop/');
    return;
  }
  isOpen = true;
  persistOpenState(state.profile?.id, true);
  panelEl.classList.remove('hidden');
  refresh();
}

function closeSidebar() {
  if (!panelEl) return;
  isOpen = false;
  persistOpenState(state.profile?.id, false);
  panelEl.classList.add('hidden');
}

/* ---------- Estructura ---------- */

function buildChrome() {
  panelEl.innerHTML = '';
  // Resetear estado persistente: el DOM fue destruido, hay que recrearlo.
  currentAgents = []; composerBoxEl = null; pillsContainerEl = null;
  composerInput = null; composerSendBtn = null; composerNoAgentsEl = null;
  renderedIds = []; renderedSig = null;

  const title = h('div', { class: 'text-xs text-fg-soft flex-1 flex items-center gap-1.5' }, [
    h('span', { class: 'text-accent-soft flex items-center' }, svgIcon('loop', { size: 14 })),
    h('span', {}, 'Loop'),
  ]);

  const header = h('div', { class: 'flex items-center gap-1.5 px-2 py-1.5 border-b border-line shrink-0' }, [
    title,
    h('button', {
      class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
      title: 'Protocolo que leen los agentes (.ybento/loop/skill.md)',
      onClick: openSkillEditor,
    }, svgIcon('file', { size: 14 })),
    h('button', {
      class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
      title: 'Cerrar loop',
      onClick: closeSidebar,
    }, svgIcon('close', { size: 15 })),
  ]);

  rosterEl = h('div', { class: 'shrink-0 border-b border-line px-1.5 py-1.5' });
  streamEl = h('div', { class: 'flex-1 overflow-y-auto px-2 py-2 space-y-2' });
  emptyEl = h('div', { class: 'hidden px-3 py-6 text-center text-[11px] text-fg-subtle leading-relaxed' });
  composerEl = h('div', { class: 'shrink-0 border-t border-line p-2' });

  panelEl.append(
    header, rosterEl, streamEl, emptyEl, composerEl,
    makeResizeHandle({ panel: panelEl, ...WIDTH_OPTS }),
  );
  panelEl.classList.add('flex', 'flex-col');
}

async function refresh() {
  if (!cwd()) return;
  try {
    const [agents, messages, presence] = await Promise.all([
      window.yusepe.loop.agents(cwd()),
      window.yusepe.loop.messages(cwd(), { limit: 200 }),
      window.yusepe.loop.presence(cwd()),
    ]);
    renderRoster(agents, presence || {});
    renderStream(messages, agents);
    renderComposer(agents);
  } catch (err) {
    streamEl.innerHTML = '';
    // Sincronizar el estado con el DOM que acabamos de vaciar.
    renderedIds = [];
    renderedSig = null;
    streamEl.append(h('p', { class: 'text-xs text-red-400 px-1' }, err?.message || String(err)));
  }
}

/* ---------- Roster de terminales ---------- */

/**
 * Verde = libre, ámbar = ocupado, rojo = su terminal volvió al prompt.
 *
 * El rojo es el caso que más importa: significa que el proceso del agente
 * terminó, así que no se le entrega nada y sus mensajes quedan pendientes.
 * Sin este aviso, el loop se ve normal mientras nadie contesta.
 */
function stateDot(agent, presence) {
  if (presence && presence.present === false) {
    return h('span', {
      class: 'w-1.5 h-1.5 rounded-full shrink-0 bg-red-400',
      title: `Su terminal volvió al prompt (${presence.foreground}): el agente ya no está corriendo. `
        + 'Los mensajes le quedan pendientes hasta que lo vuelvas a levantar.',
    });
  }
  const working = agent.state === 'working';
  return h('span', {
    class: `w-1.5 h-1.5 rounded-full shrink-0 ${working ? 'bg-amber-400' : 'bg-emerald-400'}`,
    title: working
      ? 'Ocupado: los mensajes le quedan en la bandeja hasta que se libere'
      : 'Libre: recibe mensajes en su terminal',
  });
}

/** Hace cuánto que no cambia de estado, en texto corto. */
function sinceLabel(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

/**
 * A partir de acá, un agente en `working` probablemente se colgó o murió a
 * mitad de la tarea. No se toca solo — se avisa y se ofrece liberarlo,
 * porque un agente que de verdad está trabajando duro no debería perder su
 * turno por un umbral arbitrario.
 */
const STUCK_WORKING_MS = 15 * 60 * 1000;

function renderRoster(agents, presence = {}) {
  rosterEl.innerHTML = '';

  if (!agents.length) {
    rosterEl.append(h('p', { class: 'text-[10px] text-fg-subtle px-1.5 py-1 leading-relaxed' },
      'Ninguna terminal está en el loop todavía.'));
  }

  for (const agent of agents) rosterEl.append(agentRow(agent, presence[agent.name]));

  rosterEl.append(h('button', {
    class: 'w-full mt-1 text-[11px] px-2 py-1.5 rounded-md border border-line hover:bg-bg-elev transition text-fg-muted',
    onClick: openAddAgent,
  }, '+ Sumar una terminal al loop'));
}

function agentRow(agent, presence) {
  const tile = (state.profile?.tiles || []).find((t) => t.id === agent.tileId);
  const absent = presence?.present === false;
  const stuck = agent.state === 'working'
    && Date.now() - new Date(agent.updatedAt).getTime() > STUCK_WORKING_MS;

  // Segunda línea: normalmente el rol, pero si algo anda mal eso pasa a ser
  // lo importante — un rol prolijo no sirve de nada si el agente está caído.
  let subtitle;
  if (absent) {
    subtitle = h('div', { class: 'text-[10px] text-red-400/90 truncate' },
      `terminal en el prompt (${presence.foreground}) — no recibe`);
  } else if (stuck) {
    subtitle = h('div', { class: 'text-[10px] text-amber-400/90 truncate' },
      `ocupado ${sinceLabel(agent.updatedAt)} — ¿se colgó?`);
  } else if (agent.role) {
    subtitle = h('div', { class: 'text-[10px] text-fg-subtle truncate' }, agent.role);
  } else {
    subtitle = h('div', { class: 'text-[10px] text-fg-subtle/60 italic truncate' }, 'sin rol descrito');
  }

  // Mismo borde de color que sus burbujas en el hilo: es lo que enseña qué
  // color es de quién, sin necesidad de una leyenda aparte.
  const tint = colorOf(agent);

  return h('div', {
    class: 'group flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md hover:bg-bg-elev transition cursor-pointer',
    style: `border-left: 3px solid ${tint}`,
    // El rol se ve cortado a una línea en la fila, así que el tooltip es el
    // único lugar donde se puede leer sin abrir el editor.
    title: [
      clampRole(agent.role),
      tile ? 'Ir a su terminal' : 'Su terminal ya no está en este workspace',
    ].filter(Boolean).join('\n\n'),
    onClick: () => { if (tile) focusTileById(tile.id); },
  }, [
    stateDot(agent, presence),
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', {
        class: 'text-xs truncate font-medium',
        style: `color: color-mix(in srgb, ${tint} 75%, var(--color-fg))`,
      }, `@${agent.name}`),
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
function rebuildStream(messages, colors) {
  streamEl.innerHTML = '';
  for (const msg of messages) streamEl.append(messageRow(msg, colors));
  renderedIds = messages.map((m) => m.id);
  renderedSig = JSON.stringify(colors);
}

function renderStream(messages, agents) {
  // Calcular ANTES de tocar el DOM: innerHTML='' recorta scrollTop a 0.
  const atBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 40;

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
  const sig = JSON.stringify(colors);

  // RED: la firma de colores cambió (agente renombrado, color editado,
  // agente nuevo o que salió). Evento raro, siempre disparado por el usuario
  // desde un modal, no por el poll — el parpadeo es aceptable.
  if (sig !== renderedSig) {
    rebuildStream(messages, colors);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  const newIds = messages.map((m) => m.id);

  // ¿Qué ids de renderedIds siguen en la lista nueva?
  const kept = renderedIds.filter((id) => newIds.includes(id));

  // RED: todos los ids previos desaparecieron (archivo borrado o workspace
  // cambiado pese al reset en profile:loaded).
  if (renderedIds.length > 0 && kept.length === 0) {
    rebuildStream(messages, colors);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  // RED: los ids que sobreviven no son un prefijo de newIds.
  // Ocurre si el archivo fue truncado o si una lectura parcial corrió los seq
  // (caso documentado en spec 023: la clave es id, no seq).
  if (kept.some((id, i) => id !== newIds[i])) {
    rebuildStream(messages, colors);
    if (atBottom) queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    return;
  }

  // RED: el DOM difiere de renderedIds (por ejemplo, el catch de refresh()
  // borró streamEl sin resetear el estado, o cualquier otro camino que toque
  // streamEl sin avisar). Previene que el hilo se congele en el cartel de error.
  if (streamEl.children.length !== renderedIds.length) {
    rebuildStream(messages, colors);
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

function messageRow(msg, colors = {}) {
  const mine = msg.from === 'usuario';
  const forMe = msg.to === 'usuario';

  const who = mine
    ? `vos → @${msg.to}`
    : (forMe ? `@${msg.from} → vos` : `@${msg.from} → @${msg.to}`);

  const body = h('div', { class: 'text-xs text-fg whitespace-pre-wrap break-words select-text cursor-text' }, msg.text);

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
  ]);

  const parts = [header, body];

  if (msg.text.length > LONG_MESSAGE_CHARS) parts.push(collapseToggle(msg, body));

  // Borde izquierdo grueso + un lavado del mismo color sobre el fondo del
  // tile. Se tiñe el fondo y no el texto porque estos mensajes son reportes
  // largos: el texto tiene que seguir leyéndose con el contraste de siempre,
  // en tema claro y oscuro.
  const bubble = h('div', {
    class: [
      'max-w-[85%] rounded-lg px-2.5 py-1.5 border',
      mine
        ? 'bg-accent/15 border-accent/30'
        : (forMe ? 'bg-bg-elev border-accent/20' : 'bg-bg-elev border-line'),
    ].join(' '),
    style: tint
      ? `border-left: 3px solid ${tint}; background: color-mix(in srgb, ${tint} 10%, var(--color-bg-elev));`
      : null,
  }, parts);

  return h('div', { class: `flex ${mine ? 'justify-end' : 'justify-start'}` }, [bubble]);
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

  pillsContainerEl = h('div', { class: 'flex flex-wrap gap-1 mb-1.5' });

  composerInput = h('textarea', {
    rows: '2',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2 py-1.5 text-xs resize-none '
      + 'focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-fg-subtle/70',
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
      await window.yusepe.loop.post(cwd(), { from: 'usuario', to, text });
      target = to;
      await refresh();
    } catch (err) {
      composerInput.value = raw;
      // Asignar .value por código no dispara 'input', así que resize() no corre
      // sola: el borrador vuelve pero la caja queda en la altura mínima con
      // overflow oculto. Hay que llamarla explícitamente.
      resize();
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
    class: 'mt-1.5 w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-md '
      + 'bg-accent hover:bg-accent-soft text-white transition',
    onClick: send,
  }, [svgIcon('send', { size: 12 }), h('span', {}, 'Enviar')]);

  composerBoxEl = h('div', {}, [pillsContainerEl, composerInput, composerSendBtn]);
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
    const fixed = pillsContainerEl.offsetHeight + composerSendBtn.offsetHeight + 20;
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
  };
}

/**
 * Repinta sólo las pills y actualiza placeholder y etiqueta del botón.
 * El textarea no se toca: el caret, el borrador y el historial sobreviven.
 */
function renderPills(agents) {
  currentAgents = agents;

  // Re-targetear si el destino ya no está en el loop.
  if (!agents.some((a) => a.name === target)) target = agents[0]?.name || null;

  pillsContainerEl.innerHTML = '';
  for (const agent of agents) {
    pillsContainerEl.append(h('button', {
      class: [
        'text-[10px] px-1.5 py-0.5 rounded-full border transition',
        agent.name === target
          ? 'bg-accent/20 border-accent/40 text-fg'
          : 'border-line hover:bg-bg-elev',
      ].join(' '),
      style: agent.name === target
        ? null
        : `color: color-mix(in srgb, ${colorOf(agent)} 75%, var(--color-fg))`,
      title: clampRole(agent.role) || `Escribirle a @${agent.name}`,
      onClick: () => {
        target = agent.name;
        // currentAgents, no agents: puede haber llegado un agente nuevo entre
        // el render de estas pills y el momento del click.
        renderPills(currentAgents);
        composerInput?.focus();
      },
    }, `@${agent.name}`));
  }

  if (composerInput) {
    composerInput.placeholder = `Mensaje para @${target}…  (Enter envía)`;
  }
  if (composerSendBtn) {
    const span = composerSendBtn.querySelector('span');
    if (span) span.textContent = `Enviar a @${target}`;
  }
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

/* ---------- Cómo distinguir una terminal de otra ---------- */

/**
 * Mini-mapa del mosaico con este tile marcado.
 *
 * Varias terminales en la misma carpeta y sin comando precargado se ven
 * idénticas en una lista ("Terminal 1", "Terminal 2"…). Lo único que el
 * usuario tiene en la cabeza es *dónde* está cada una en pantalla, así que
 * eso es lo que hay que mostrar.
 */
function miniMap(tile) {
  const tiles = state.profile?.tiles || [];
  const rows = Math.max(4, ...tiles.map((t) => (t.row || 0) + (t.rowSpan || 1)));

  const cells = tiles.map((other) => {
    const isThis = other.id === tile.id;
    return h('div', {
      class: isThis ? 'rounded-[1px] bg-accent' : 'rounded-[1px] bg-fg-subtle/25',
      style: `grid-column: ${(other.col || 0) + 1} / span ${other.colSpan || 1};`
        + `grid-row: ${(other.row || 0) + 1} / span ${other.rowSpan || 1};`,
    });
  });

  return h('div', {
    class: 'shrink-0 grid gap-[1px] w-12 h-9 p-[2px] rounded border border-line bg-bg-elev',
    style: `grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(${rows}, 1fr);`,
  }, cells);
}

/**
 * Última línea con contenido de la terminal.
 *
 * Es lo más identificatorio que hay: el prompt, el comando que corrió, o el
 * banner del agente que tiene adentro. Se lee del buffer de xterm (ver el
 * `meta.term` que registra terminal.js).
 */
function lastOutputLine(tile) {
  const entry = liveTiles.get(tile.id);
  const term = entry?.meta?.term;

  let text = '';
  try {
    const buf = term?.buffer?.active;
    if (buf) {
      const from = buf.baseY + buf.cursorY;
      for (let i = from; i >= 0 && i > from - 60; i--) {
        const line = buf.getLine(i)?.translateToString(true).trim();
        if (line) { text = line; break; }
      }
    }
  } catch { /* si xterm cambia de API, no vale romper el picker por esto */ }

  return h('div', {
    class: `text-[10px] truncate mt-0.5 font-mono ${text ? 'text-fg-subtle' : 'text-fg-subtle/50 italic'}`,
  }, text || 'sin salida todavía');
}

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

  const list = h('div', { class: 'space-y-1' }, candidates.map((tile) => h('button', {
    class: 'w-full text-left px-3 py-2 rounded-md border border-line hover:bg-bg-elev transition flex items-center gap-3',
    onClick: () => { closeModal(); openAgentEditor(null, tile, taken); },
  }, [
    miniMap(tile),
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', { class: 'text-sm text-fg flex items-center gap-1.5' }, [
        h('span', { class: 'text-accent-soft flex items-center shrink-0' }, svgIcon('terminal', { size: 13 })),
        h('span', { class: 'truncate' }, labelFor(tile)),
        h('span', { class: 'text-[10px] text-fg-subtle shrink-0' }, `${tile.colSpan}x${tile.rowSpan}`),
      ]),
      lastOutputLine(tile),
    ]),
  ])));

  openModal({
    title: 'Elegí la terminal que entra al loop',
    body: h('div', {}, [
      h('p', { class: 'text-xs text-fg-subtle mb-3' },
        'El recuadro marca dónde está cada una en el mosaico, y abajo se ve su última línea.'),
      list,
    ]),
  });
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

      await window.yusepe.loop.register(cwd(), {
        name, role: roleInput.value.trim(), tileId: tile?.id || existing?.tileId || null, color,
      });
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
