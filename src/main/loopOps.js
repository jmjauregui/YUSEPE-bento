/**
 * src/main/loopOps.js
 * --------------------------------------------------------------
 * Motor de mensajería y estados del "loop multiagente": varias terminales
 * con agentes distintos (Claude, opencode, …) que se mandan mensajes entre
 * sí para trabajar en conjunto — uno codea, otro revisa, y se reportan.
 *
 * Respaldado en archivos reales dentro del proyecto (`.ybento/loop/`),
 * mismo criterio que tasksOps.js: el disco es la fuente de verdad. Acá
 * tiene un valor extra — si el CLI falla, el agente todavía puede leer su
 * bandeja con un `Read` común, porque son archivos de texto en su propio
 * árbol de trabajo.
 *
 *   .ybento/loop/messages.jsonl  historial de mensajes (append-only)
 *   .ybento/loop/status.json     agentes registrados + su estado
 *   .ybento/loop/skill.md        protocolo que leen los agentes
 *
 * ¿Por qué `.jsonl` y no `.json` para los mensajes?
 *   Hay N escritores concurrentes (cada agente corre su propio proceso del
 *   CLI, más el propio Bento). Un JSON único obliga a leer-modificar-
 *   escribir, y dos agentes que postean a la vez se pisan el mensaje (lost
 *   update). Una línea por mensaje se agrega con `appendFile` en O_APPEND,
 *   que el SO serializa por sí solo. Un chat además ES un log: encaja.
 *
 * `status.json` sí es leer-modificar-escribir (es un mapa chico que se
 * reescribe entero), así que va protegido con un lock de archivo — ver
 * `withLock`.
 * --------------------------------------------------------------
 */
import { execFile } from 'child_process';
import { promises as fs, watch } from 'fs';
import path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);

export const LOOP_DIR = path.join('.ybento', 'loop');
export const MESSAGES_FILE = path.join(LOOP_DIR, 'messages.jsonl');
export const STATUS_FILE = path.join(LOOP_DIR, 'status.json');
export const SKILL_FILE = path.join(LOOP_DIR, 'skill.md');

const LOCK_FILE = path.join(LOOP_DIR, '.status.lock');

/** Estados que puede tener un agente. */
export const STATES = ['waiting', 'working'];

function resolveSafe(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath || '.');
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Ruta fuera del workspace');
  }
  return resolved;
}

/**
 * Normaliza el nombre de un agente (`@Claudio` -> `claudio`).
 *
 * El nombre ES la identidad en el mailbox, no el ptyId: si el usuario
 * reinicia la terminal el ptyId cambia, y si la identidad colgara de ahí
 * se perdería el hilo a mitad del loop.
 */
export function normalizeName(name) {
  const clean = String(name || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(clean)) {
    throw new Error(`Nombre de agente inválido: "${name}"`);
  }
  return clean;
}

/* ---------- Lock cooperativo para status.json ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Corre `fn` con exclusión mutua entre procesos.
 *
 * `open(..., 'wx')` falla si el archivo ya existe: eso es un lock atómico
 * y portable, sin dependencias. El lock guarda su fecha para poder romperlo
 * si quedó huérfano (un agente que crasheó a mitad de un cambio de estado
 * no puede congelar el loop entero para siempre).
 */
async function withLock(dir, fn) {
  const lock = path.join(dir, path.basename(LOCK_FILE));
  await fs.mkdir(dir, { recursive: true });

  const STALE_MS = 10_000;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const handle = await fs.open(lock, 'wx');
      await handle.writeFile(String(Date.now()), 'utf8');
      await handle.close();
      try {
        return await fn();
      } finally {
        await fs.unlink(lock).catch(() => {});
      }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const age = await fs.stat(lock).then((s) => Date.now() - s.mtimeMs).catch(() => 0);
      if (age > STALE_MS) await fs.unlink(lock).catch(() => {});
      await sleep(20);
    }
  }
  throw new Error('No se pudo tomar el lock de status.json');
}

/* ---------- status.json ---------- */

// Ojo: siempre un objeto nuevo. Una constante a nivel de módulo con
// `{ ...EMPTY }` sería copia superficial y `agents` quedaría compartido
// entre todos los workspaces — registrar un agente en uno lo haría
// aparecer en todos los demás.
const emptyStatus = () => ({ agents: {} });

async function readStatusRaw(cwd) {
  const file = resolveSafe(cwd, STATUS_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    // Un status.json corrupto (editado a mano, escritura a medias) no debe
    // tirar el loop abajo: se degrada a vacío y se reconstruye al registrar.
    return parsed && typeof parsed.agents === 'object' && parsed.agents
      ? { agents: parsed.agents }
      : emptyStatus();
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStatus();
    if (err instanceof SyntaxError) return emptyStatus();
    throw err;
  }
}

async function writeStatusRaw(cwd, status) {
  const file = resolveSafe(cwd, STATUS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

/** Muta status.json de forma atómica y con lock. */
async function updateStatus(cwd, mutate) {
  const dir = resolveSafe(cwd, LOOP_DIR);
  return withLock(dir, async () => {
    const status = await readStatusRaw(cwd);
    const result = await mutate(status);
    await writeStatusRaw(cwd, status);
    return result;
  });
}

/**
 * Color de identidad del agente: `#rrggbb` o nada.
 *
 * Se valida acá y no en el panel porque el renderer lo mete en un `style`
 * inline para pintar sus mensajes — un string arbitrario en `status.json`
 * (que es un archivo que el usuario y los agentes pueden editar a mano)
 * se convertiría en inyección de CSS. Cualquier cosa que no sea un hex se
 * descarta y el agente se queda con el color derivado de su nombre.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const safeColor = (value) => (HEX_COLOR.test(String(value || '')) ? String(value).toLowerCase() : null);

/**
 * Emoji de avatar del agente. Mismo criterio que el color: status.json se
 * edita a mano, así que se valida al escribir y al leer. Tiene que llevar
 * al menos un pictograma y nada de letras, espacios ni caracteres de
 * markup — un emoji compuesto (👩🏽‍💻, 🏳️‍🌈) mide varios code units, de ahí
 * el tope de 16 y no de 2.
 */
const EMOJI_OK = /^[^\s\p{L}\p{N}<>"'`\\&]{1,16}$/u;
const safeEmoji = (value) => {
  const s = String(value ?? '').trim();
  return EMOJI_OK.test(s) && /\p{Extended_Pictographic}/u.test(s) ? s : null;
};

/**
 * Registra (o actualiza) una terminal en el loop.
 *
 * `role` es la descripción corta que explica de qué se encarga — la leen
 * los otros agentes para saber a quién dirigirse ("opencito valida código
 * fuente"), así que no es decorativa.
 *
 * Registrar de nuevo un agente existente conserva su estado y su cursor:
 * renombrar el rol no debe reenviarle toda la bandeja.
 */
export async function registerAgent(cwd, { name, role = '', tileId = null, color = null, emoji } = {}) {
  const id = normalizeName(name);
  return updateStatus(cwd, (status) => {
    const prev = status.agents[id] || {};
    status.agents[id] = {
      name: id,
      role: String(role || prev.role || '').trim(),
      state: STATES.includes(prev.state) ? prev.state : 'waiting',
      tileId: tileId ?? prev.tileId ?? null,
      color: safeColor(color) ?? safeColor(prev.color),
      // `emoji: ''` lo borra; sin el campo, se conserva el que tenía.
      emoji: emoji === undefined ? safeEmoji(prev.emoji) : safeEmoji(emoji),
      cursor: prev.cursor ?? null,
      updatedAt: new Date().toISOString(),
    };
    return status.agents[id];
  });
}

/** Saca una terminal del loop. */
export async function unregisterAgent(cwd, name) {
  const id = normalizeName(name);
  return updateStatus(cwd, (status) => {
    delete status.agents[id];
    return { name: id };
  });
}

/**
 * Todos los agentes del loop, ordenados por nombre.
 *
 * El color se vuelve a sanear acá: `registerAgent` ya lo valida al escribir,
 * pero `status.json` es un archivo del proyecto que se edita a mano, así que
 * el camino de lectura no puede confiar en lo que haya en disco.
 */
export async function listAgents(cwd) {
  const status = await readStatusRaw(cwd);
  return Object.values(status.agents)
    .filter((a) => a && typeof a.name === 'string')
    .map((a) => ({ ...a, color: safeColor(a.color), emoji: safeEmoji(a.emoji) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Leo mi estado" — el primer paso del ciclo del agente. */
export async function getAgent(cwd, name) {
  const id = normalizeName(name);
  const status = await readStatusRaw(cwd);
  return status.agents[id] || null;
}

/**
 * Cambia el estado de un agente (`waiting` | `working`).
 *
 * Es lo que permite no pegarle un mensaje a una terminal ocupada: escribir
 * en el pty mientras el agente corre su tarea entrelaza el texto con su TUI
 * y rompe las dos cosas.
 */
export async function setAgentState(cwd, name, state) {
  const id = normalizeName(name);
  if (!STATES.includes(state)) {
    throw new Error(`Estado inválido: "${state}" (esperaba ${STATES.join(' | ')})`);
  }
  return updateStatus(cwd, (status) => {
    const agent = status.agents[id];
    if (!agent) throw new Error(`El agente "@${id}" no está registrado en el loop`);
    agent.state = state;
    agent.updatedAt = new Date().toISOString();
    return agent;
  });
}

/* ---------- messages.jsonl ---------- */

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Commit sobre el que se escribió un mensaje. `null` si no es un repo.
 *
 * Los agentes trabajan sobre el mismo árbol pero no en el mismo momento:
 * uno reporta un bug y el otro ya lo arregló y commiteó mientras tanto, así
 * que el reporte llega describiendo código que ya no existe. Pasó en campo
 * y se resolvió "hablando", que es justo lo que la herramienta debería
 * evitar. Sellando cada mensaje con el HEAD del momento, el desfase se ve.
 */
export async function readHead(cwd) {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null; // no es un repo, o git no está: el loop anda igual
  }
}

/**
 * ¿Hay cambios sin commitear? Lo que hace la diferencia entre "revisá esto"
 * y "revisá esto, pero está a medio escribir".
 *
 * Sin este dato, un QA puede arrancar sobre un árbol en movimiento y
 * reportar como bug algo que el otro estaba tipeando en ese momento. Se
 * ignoran los archivos sin trackear: los `.md` de tareas, notas sueltas y
 * scratch del propio loop no son trabajo a medias.
 */
export async function readDirty(cwd) {
  try {
    const { stdout } = await run(
      'git', ['status', '--porcelain', '--untracked-files=no'], { cwd },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/* ---------- Decisiones y permisos (spec 038) ---------- */

/**
 * Tipos de mensaje además del normal:
 *   - `question`: un agente le pide al usuario que decida entre opciones
 *     (`ybento preguntar`). El chat la muestra como tarjeta con botones.
 *   - `permission`: un agente quedó (o va a quedar) frenado en un diálogo de
 *     permiso de su TUI (`ybento permiso`, o el hook de Claude Code).
 * Son mensajes del loop como cualquier otro: mismo archivo, mismo hilo.
 */
export const MESSAGE_KINDS = ['question', 'permission'];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const MAX_OPTION_CHARS = 200;

/**
 * Valida los campos tipados de un mensaje nuevo. Lo que no cumple se
 * descarta (y para una pregunta, tira: una pregunta sin opciones válidas no
 * es una pregunta). `choice` sólo vale si responde a una pregunta real y
 * cae dentro de sus opciones.
 */
async function typedFields(cwd, { kind, options, choice, replyTo, sender }) {
  const out = {};
  if (kind && MESSAGE_KINDS.includes(kind) && sender !== 'usuario') {
    out.kind = kind;
    if (kind === 'question') {
      const opts = (Array.isArray(options) ? options : [])
        .map((o) => String(o ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS) {
        throw new Error(`Una pregunta lleva entre ${MIN_OPTIONS} y ${MAX_OPTIONS} opciones (vinieron ${opts.length}).`);
      }
      const long = opts.find((o) => o.length > MAX_OPTION_CHARS);
      if (long) throw new Error(`Cada opción va en hasta ${MAX_OPTION_CHARS} caracteres: "${long.slice(0, 40)}…"`);
      out.options = opts;
    }
  }
  if (sender === 'usuario' && replyTo && Number.isInteger(choice)) {
    const question = (await listMessages(cwd))[Number(replyTo) - 1];
    if (question?.kind === 'question' && choice >= 0 && choice < (question.options?.length || 0)) {
      out.choice = choice;
    }
  }
  return out;
}

/**
 * Deriva del hilo el estado de preguntas y permisos, sin guardarlo aparte:
 *   - pregunta → `answer` = { seq, choice, text } del primer mensaje del
 *     usuario que le responde (`replyTo`);
 *   - permiso → `attended` = el agente volvió a escribir después.
 * Reiniciar Bento o leer el `.jsonl` a mano da el mismo estado.
 */
export function annotateThread(messages) {
  for (const msg of messages) {
    if (msg.kind === 'question') {
      const reply = messages.find((m) => m.seq > msg.seq && m.from === 'usuario' && m.replyTo === msg.seq);
      msg.answer = reply ? { seq: reply.seq, choice: Number.isInteger(reply.choice) ? reply.choice : null, text: reply.text } : null;
    } else if (msg.kind === 'permission') {
      msg.attended = messages.some((m) => m.seq > msg.seq && m.from === msg.from);
    }
  }
  return messages;
}

/** La pregunta sin responder de un agente, o null. Una a la vez. */
export function openQuestion(messages, agent) {
  const id = normalizeName(agent);
  return [...messages].reverse().find((m) => m.kind === 'question' && m.from === id && !m.answer) || null;
}

/**
 * Postea un mensaje. `from` puede ser un agente o `usuario` (el humano
 * escribiendo desde el panel lateral).
 */
export async function postMessage(cwd, {
  from, to, text, replyTo = null, seenUpTo: seenByUser = null, kind = null, options = null, choice = null,
} = {}) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('El mensaje no puede estar vacío');

  const sender = from === 'usuario' ? 'usuario' : normalizeName(from);

  // Hasta dónde había leído el que escribe, en el momento de escribir.
  // Con esto se detectan los cruces: si A responde algo que fue escrito
  // antes de recibir el último mensaje de B, los dos hablaron a la vez y
  // ninguno de los dos se entera mirando sólo el texto.
  //
  // El agente tiene cursor en status.json. El humano no: lee el hilo en el
  // panel. Para él, "hasta dónde leyó" es el último mensaje que tenía en
  // pantalla al enviar, y lo manda el panel. Sin esto sus mensajes salían
  // todos con seenUpTo null (87 de 87, medido en campo) y no había forma de
  // saber si escribió viendo lo último de los agentes.
  const seenUpTo = sender === 'usuario'
    ? (typeof seenByUser === 'string' && /^[\w-]{1,64}$/.test(seenByUser) ? seenByUser : null)
    : (await getAgent(cwd, sender))?.cursor ?? null;

  const message = {
    id: makeId(),
    from: sender,
    to: normalizeName(to),
    text: body,
    seenUpTo,
    // A qué mensaje contesta. Sin esto, dos agentes discuten sin saber cuál
    // de las tres cosas que dijiste te está respondiendo el otro.
    replyTo: replyTo ? Number(replyTo) : null,
    ...(await typedFields(cwd, { kind, options, choice, replyTo, sender })),
    commit: await readHead(cwd),
    dirty: await readDirty(cwd),
    createdAt: new Date().toISOString(),
  };

  const file = resolveSafe(cwd, MESSAGES_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Una sola línea, sin saltos internos: los `\n` del texto van escapados
  // por JSON.stringify, así que una línea == un mensaje siempre.
  await fs.appendFile(file, `${JSON.stringify(message)}\n`, 'utf8');
  return message;
}

/**
 * Historial completo, en orden de llegada.
 *
 * Una línea ilegible se saltea en vez de tirar la lista abajo: el archivo
 * lo puede tocar el usuario, y un caracter de más no debería dejar el loop
 * sin bandeja.
 */
export async function listMessages(cwd, { to = null, limit = 0 } = {}) {
  const file = resolveSafe(cwd, MESSAGES_FILE);

  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      // `seq` se calcula al leer, por posición en el archivo, y no se
      // guarda: el archivo es append-only con N escritores, así que
      // repartir números en el momento de escribir necesitaría un contador
      // compartido. El orden del archivo ya es la verdad.
      if (msg && msg.id && msg.to) messages.push({ ...msg, seq: messages.length + 1 });
    } catch { /* línea corrupta: se ignora */ }
  }

  annotateThread(messages);
  const filtered = to ? messages.filter((m) => m.to === normalizeName(to)) : messages;
  return limit > 0 ? filtered.slice(-limit) : filtered;
}

/**
 * Un mensaje por referencia: `42`, `#42` o su id. `null` si no existe.
 *
 * Es lo que resuelve el aviso que pega el repartidor (`ybento leer 42`).
 * El `seq` sale de la posición en un archivo append-only, así que entre el
 * pegado y la lectura no se corre: sólo se agregan líneas al final.
 */
export async function findMessage(cwd, ref) {
  const key = String(ref ?? '').trim().replace(/^#/, '');
  if (!key) return null;
  const all = await listMessages(cwd);
  if (/^\d+$/.test(key)) return all[Number(key) - 1] || null;
  return all.find((m) => m.id === key) || null;
}

/**
 * Mensajes que el autor de `message` todavía no había recibido cuando lo
 * escribió — o sea, los que se cruzaron en el camino.
 *
 * Pasa de verdad y es invisible: dos agentes deciden lo mismo a la vez, o
 * uno responde una pregunta que el otro ya había contestado. Mirando sólo
 * el texto no hay forma de darse cuenta; comparando contra hasta dónde
 * había leído cada uno, sí.
 *
 * @param {object[]} all todos los mensajes, en orden (con su `seq`)
 */
export function crossedMessages(all, message) {
  // Un mensaje del usuario sin seenUpTo es de antes de que el panel lo
  // mandara: no hay dato, no es "nunca leyó nada". Tomarlo así marcaba como
  // no vistos TODOS los reportes que le habían mandado (campo, #307).
  if (message.from === 'usuario' && !message.seenUpTo) return [];

  const mine = all.findIndex((m) => m.id === message.id);
  if (mine === -1) return [];

  // Desde dónde venía leyendo: si nunca recibió nada, desde el principio.
  const seenIdx = message.seenUpTo
    ? all.findIndex((m) => m.id === message.seenUpTo)
    : -1;

  // Sólo los del destinatario al autor: el aviso dice "no vio TUS mensajes",
  // y lo que le escribió un tercero no es un cruce entre estos dos.
  return all.slice(seenIdx + 1, mine)
    .filter((m) => m.to === message.from && m.from === message.to);
}

/**
 * Mensajes pendientes para un agente: los posteriores a su cursor.
 *
 * El cursor es el id del último mensaje ya entregado. Como el archivo es
 * append-only, "posterior" es una posición bien definida y no depende de
 * relojes ni de contadores compartidos entre procesos.
 *
 * Si el cursor apunta a un id que ya no está (alguien truncó el archivo),
 * se entrega todo lo que haya: es preferible repetir un mensaje a que el
 * loop se quede mudo sin que nadie se entere.
 */
export async function inbox(cwd, name) {
  const id = normalizeName(name);
  const [agent, all] = await Promise.all([getAgent(cwd, id), listMessages(cwd)]);

  const cursor = agent?.cursor ?? null;
  const mine = all.filter((m) => m.to === id);
  if (!cursor) return mine;

  const at = mine.findIndex((m) => m.id === cursor);
  return at === -1 ? mine : mine.slice(at + 1);
}

/**
 * Marca hasta dónde se le entregó a un agente.
 *
 * Lo llama Bento después de pegar el mensaje en el pty, no el agente: si
 * el cursor avanzara solo por leer, un reinicio de Bento a mitad del pegado
 * se comería el mensaje.
 */
export async function markDelivered(cwd, name, messageId) {
  const id = normalizeName(name);
  return updateStatus(cwd, (status) => {
    const agent = status.agents[id];
    if (!agent) throw new Error(`El agente "@${id}" no está registrado en el loop`);
    agent.cursor = String(messageId);
    agent.updatedAt = new Date().toISOString();
    return agent;
  });
}

/**
 * Resumen barato para el agente: cuántos pendientes y cuál es el último.
 *
 * Existe para no gastar tokens: leer la bandeja entera en cada vuelta del
 * ciclo es caro, y casi siempre la respuesta es "no tenés nada".
 */
export async function inboxSummary(cwd, name) {
  const pending = await inbox(cwd, name);
  return {
    name: normalizeName(name),
    count: pending.length,
    last: pending.length ? pending[pending.length - 1] : null,
  };
}

/* ---------- skill.md ---------- */

/**
 * Protocolo que leen los agentes. Se escribe en el proyecto para que se
 * pueda editar a mano y viaje con el repo — el mensaje que Bento pega en la
 * terminal sólo lleva la *ruta* a este archivo, no el protocolo entero.
 */
/**
 * Versión del protocolo por defecto. Subirla cuando cambie DEFAULT_SKILL de
 * una forma que los agentes necesiten saber: los proyectos con un skill.md
 * más viejo ven en el panel "hay una versión nueva — actualizar".
 */
export const SKILL_VERSION = 3;
const SKILL_MARK = /<!--\s*ybento-skill\s+v(\d+)\s*-->/;

/** Versión de un skill.md: la marca del encabezado, o 1 si no tiene (anterior a la 038). */
export function skillVersion(text) {
  const m = String(text ?? '').match(SKILL_MARK);
  return m ? Number(m[1]) : 1;
}

export const DEFAULT_SKILL = `<!-- ybento-skill v${SKILL_VERSION} -->
# Protocolo del loop de Bento

Estás trabajando dentro de un **loop multiagente** de YUSEPE Bento: varias
terminales, cada una con un agente distinto, que se mandan mensajes para
trabajar en conjunto.

Tu nombre dentro del loop viene en el mensaje que recibiste (por ejemplo
\`@claudio\`). Usalo tal cual en los comandos.

## Comandos

\`\`\`bash
ybento estado                    # leo mi estado y quién más está en el loop
ybento estado working            # me marco ocupado (arranco una tarea)
ybento estado waiting            # me marco libre (terminé, puedo recibir)
ybento leer 42                   # leo el mensaje #42 completo (y quedo working)
ybento bandeja                   # mis mensajes pendientes
ybento enviar @opencito "texto"  # le mando un mensaje a otro agente
ybento enviar @usuario "texto"   # le aviso al humano
ybento enviar @opencito --re 7 "…"  # respondo puntualmente al mensaje #7
ybento preguntar "¿A o B?" --opcion "A" --opcion "B"  # le pido una decisión al usuario
ybento permiso "voy a correr X"  # aviso que vas a necesitar un permiso en la terminal
\`\`\`

Cuando alguien te escribe, **te llega solo un aviso** a esta terminal, de
una línea: quién te escribe, a qué responde, el número del mensaje y cómo
leerlo. El texto completo **no** viene en el aviso — leelo con:

\`\`\`bash
ybento leer 42
\`\`\`

Eso imprime el mensaje entero, con sus saltos de línea, y te marca
\`working\`. No contestes sólo con el aviso: no tiene el contenido.

Si tu herramienta te pide permiso cada vez que corrés \`ybento\`, pedile al
usuario que lo permita (en Claude Code: \`Bash(ybento:*)\`); si no, el loop
se frena esperando a que alguien apriete "aceptar". Si \`ybento\` falla, el
mensaje #n es la línea válida número n de \`.ybento/loop/messages.jsonl\`.

## Mensajes largos: no los pases como argumento

Un mensaje largo entre comillas es una bomba de tiempo: un backtick, un
\`$\` o un \`!\` dentro del texto los expande el shell **en silencio**, y
mandás algo distinto de lo que escribiste sin darte cuenta. Usá stdin:

\`\`\`bash
ybento enviar @claudio <<'FIN'
Texto libre y largo. Podés usar \`backticks\`, $variables y "comillas"
sin escapar nada: el heredoc con FIN entre comillas simples no toca nada.
FIN
\`\`\`

O desde un archivo, si ya lo tenías escrito:

\`\`\`bash
ybento enviar @claudio -f reporte-qa.md
\`\`\`

## Cuando necesitás algo del usuario

Hay dos casos y se piden distinto. **Nunca** los dejes sólo en tu terminal:
el usuario mira el chat del loop, no tu pantalla, y si no se entera quedás
frenado para siempre.

### Decisiones: preguntá por el loop, con opciones

Si para seguir necesitás que el usuario elija (qué enfoque, qué base de
datos, si borrar algo), **no uses la herramienta de preguntas de tu
terminal**. Preguntá con:

\`\`\`bash
ybento preguntar "¿Qué base de datos usamos para clientes?" \\
  --opcion "Postgres (la que ya está en el VPS)" \\
  --opcion "SQLite (más simple, un solo archivo)"
\`\`\`

- Entre 2 y 6 opciones, concretas y que se entiendan solas: el usuario las
  ve como botones en el chat. Siempre puede contestar otra cosa.
- **Una pregunta a la vez.** Si ya tenés una abierta, el comando falla:
  esperá la respuesta.
- Después de preguntar **terminá tu turno**: quedás en \`waiting\` y la
  respuesta te llega como cualquier mensaje, respondiendo a tu pregunta.

### Permisos: avisá y mandalo a la terminal

Los diálogos de permiso de tu herramienta ("¿querés ejecutar esto?") los
tiene que contestar el usuario **en tu terminal**. Mientras el diálogo está
abierto vos estás congelado y no podés avisar nada, así que avisá **antes**:
si vas a ejecutar algo que sabés que va a pedir permiso, primero corré

\`\`\`bash
ybento permiso "voy a correr las migraciones de la base (pide permiso)"
\`\`\`

y recién después ejecutalo. En el chat le aparece al usuario con un botón
para abrir tu terminal. (Si Bento instaló su hook en el proyecto, Claude
Code avisa solo cuando se abre el diálogo; avisar antes igual ayuda.)

## Cómo trabajar

1. Cuando recibas un aviso, leé el mensaje con \`ybento leer <n>\`. Eso ya
   te marca \`working\`.
2. Hacé la tarea que te pidieron.
3. Al terminar, reportá con \`ybento enviar\`. **Eso ya te devuelve a
   \`waiting\` solo** — no tenés que acordarte de nada. Si querés seguir
   ocupado después de avisar algo a mitad de camino, usá \`--ocupado\`.

## Reglas

- Sé concreto en los mensajes: el otro agente no ve tu pantalla ni tu
  historial, sólo el texto que le mandás. Incluí rutas de archivo y el
  error exacto si estás reportando una falla.
- Si revisaste algo y está bien, decilo y **avisale al usuario**, no le
  rebotes la pelota al otro agente. Un "todo ok" de ida y vuelta entre dos
  agentes no termina nunca.
- Si no sabés a quién dirigirte, mandale el mensaje a \`@usuario\`.
- Cada mensaje que recibís viene numerado (\`#7\`). Si aparece un aviso de
  que te escribieron **sin haber visto** un mensaje tuyo, se cruzaron:
  reconciliá las dos versiones antes de seguir, en vez de contestar como
  si el otro ya supiera lo que le dijiste.
- Si el aviso dice que el mensaje **se escribió sobre otro commit**, el
  árbol ya avanzó desde entonces. Antes de discutir un bug reportado así,
  fijate si no está arreglado ya: los dos trabajan sobre el mismo repo
  pero no necesariamente sobre la misma versión.
- Cuando reportes un problema, decí **sobre qué mirabas**: ruta y línea.
  "No anda el botón" obliga al otro a adivinar; "PageCanvas.tsx:347 con
  zoom 1 da stdDeviation 2.1" no. El commit no hace falta que lo pongas:
  cada mensaje ya viaja sellado con el suyo (\`[sobre a1b2c3d]\`).
- Si el sello dice \`+cambios sin commitear\`, el que escribió tenía trabajo
  a medio guardar. No arranques un QA sobre eso sin preguntar: vas a estar
  revisando código que todavía se está escribiendo.
- **Respondé con \`--re <n>\`** cuando contestes algo puntual. Sin eso el
  otro no sabe cuál de las tres cosas que dijo le estás respondiendo, y se
  terminan defendiendo posiciones que el otro ya había dado por cerradas.
- Usá **rutas absolutas** en tus comandos. Un \`cd\` te cambia el directorio
  de las llamadas siguientes, y un \`grep\` con ruta relativa que no matchea
  no falla: devuelve vacío, y parece que falta código.
`;

/** Lee el skill del proyecto; si todavía no existe, devuelve el default. */
export async function readSkill(cwd) {
  const file = resolveSafe(cwd, SKILL_FILE);
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return DEFAULT_SKILL;
    throw err;
  }
}

/** Guarda el skill (escritura atómica). */
export async function writeSkill(cwd, content) {
  const file = resolveSafe(cwd, SKILL_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, String(content ?? ''), 'utf8');
  await fs.rename(tmp, file);
  return { relPath: SKILL_FILE };
}

/**
 * Crea el skill si falta. No pisa el existente: si el usuario lo editó,
 * su versión manda.
 */
export async function ensureSkill(cwd) {
  const file = resolveSafe(cwd, SKILL_FILE);
  try {
    await fs.access(file);
    return { relPath: SKILL_FILE, created: false };
  } catch {
    await writeSkill(cwd, DEFAULT_SKILL);
    return { relPath: SKILL_FILE, created: true };
  }
}

/** Estado del protocolo del proyecto frente al de esta versión de Bento. */
export async function skillStatus(cwd) {
  const current = skillVersion(await readSkill(cwd));
  return { current, latest: SKILL_VERSION, outdated: current < SKILL_VERSION };
}

/** Reescribe el skill.md con el protocolo de esta versión (pisa ediciones a mano). */
export async function resetSkill(cwd) {
  return writeSkill(cwd, DEFAULT_SKILL);
}

/* ---------- Hook de permisos de Claude Code (spec 038) ---------- */

/**
 * Comando del hook. Corre dentro del proceso de Claude Code, que hereda el
 * entorno de la terminal de Bento (PATH con `ybento`, YBENTO_AGENT). El
 * `command -v` lo vuelve mudo si alguien abre el proyecto con Claude fuera
 * de Bento: sin ybento, el hook no hace nada en vez de fallar.
 */
export const PERMISSION_HOOK_COMMAND = 'command -v ybento >/dev/null 2>&1 && ybento permiso --hook || true';
const CLAUDE_LOCAL_SETTINGS = path.join('.claude', 'settings.local.json');

/**
 * Agrega a `.claude/settings.local.json` un hook `Notification` que avisa al
 * loop cuando Claude Code pide permiso. En el `.local` y no en el
 * `settings.json` del repo: depende de tener Bento, así que no es algo para
 * commitear al equipo. Hace merge (nunca pisa otros hooks) y es idempotente.
 */
export async function installPermissionHook(cwd) {
  const file = resolveSafe(cwd, CLAUDE_LOCAL_SETTINGS);
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`No pude leer ${CLAUDE_LOCAL_SETTINGS}: ${err.message}. Arreglalo a mano antes de instalar el hook.`);
    }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const groups = Array.isArray(settings.hooks.Notification) ? settings.hooks.Notification : [];

  const already = groups.some((g) => (g?.hooks || []).some((x) => x?.command === PERMISSION_HOOK_COMMAND));
  if (already) return { relPath: CLAUDE_LOCAL_SETTINGS, installed: false };

  groups.push({ hooks: [{ type: 'command', command: PERMISSION_HOOK_COMMAND }] });
  settings.hooks.Notification = groups;

  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
  return { relPath: CLAUDE_LOCAL_SETTINGS, installed: true };
}

/** ¿El hook ya está instalado en el proyecto? */
export async function hasPermissionHook(cwd) {
  try {
    const settings = JSON.parse(await fs.readFile(resolveSafe(cwd, CLAUDE_LOCAL_SETTINGS), 'utf8'));
    return (settings?.hooks?.Notification || []).some((g) => (g?.hooks || []).some((x) => x?.command === PERMISSION_HOOK_COMMAND));
  } catch {
    return false;
  }
}

/**
 * Del JSON que Claude Code le pasa al hook `Notification` por stdin, el
 * texto del aviso si es un pedido de permiso; null si es otra notificación
 * (p. ej. "está esperando tu input" tras un rato quieto) o si no se entiende.
 * ponytail: se reconoce por el texto ("permission"); si Claude Code cambia
 * el formato, el hook queda mudo — no rompe nada — y se ajusta acá.
 */
export function permissionFromHook(raw) {
  let data;
  try { data = JSON.parse(String(raw || '')); } catch { return null; }
  const type = String(data?.notification_type || '');
  const message = String(data?.message || '').trim();
  if (type && !/permission/i.test(type)) return null;
  if (!message || (!type && !/permission|permiso/i.test(message))) return null;
  return message;
}

/* ---------- Entrega ---------- */

/**
 * Texto que Bento pega en la terminal destino.
 *
 * Lleva la ruta al skill (y no el protocolo entero) para no inundar el
 * contexto del agente en cada mensaje: la primera vez lo lee, después ya lo
 * tiene.
 *
 * **Sale siempre en UNA sola línea**, y no es cosmético. Del otro lado hay
 * un TUI (Claude Code, opencode) leyendo el pty: un `\n` en el medio no es
 * un separador visual, es un Enter dentro de su caja de texto. Con dos
 * líneas, el agente recibe el mensaje partido y el Enter final ya no envía
 * nada — que fue exactamente el bug de la primera prueba de campo.
 *
 * **No lleva el cuerpo del mensaje, sólo dónde leerlo** (`ybento leer 42`).
 * Pegar el texto completo hacía del pty el transporte *y* el registro, y de
 * ahí salieron los peores bugs: el Enter tragado en mensajes largos (025),
 * el truncamiento (027) y un reporte de 30 líneas llegando aplanado en un
 * párrafo. Con el aviso, lo que viaja por el pty es siempre corto y lo
 * genera Bento; el texto completo, con sus saltos, vive en messages.jsonl
 * y se lee con el CLI. Es el mismo criterio que las Tareas.
 *
 * Los metadatos (número, `--re`, sello, cruces, desfase) sí van en el
 * aviso: son cortos y le dicen al agente qué va a leer antes de abrirlo.
 *
 * **Y sale entre comillas simples**, que es lo que lo vuelve seguro.
 * No siempre hay un TUI escuchando: si el proceso del agente terminó, la
 * terminal volvió al prompt y lo que pegamos lo interpreta el shell. Sin
 * comillas eso tiene tres finales, los tres vistos en campo:
 *
 *   - `(` `)` -> error de parseo (molesto, recuperable);
 *   - una comilla sin cerrar -> zsh queda en continuación y **se traga todo
 *     lo que llegue después**, incluido el Enter — el loop se cuelga hasta
 *     que un humano lo destrabe;
 *   - un backtick o `$(...)` -> **el shell ejecuta ese contenido**. Un
 *     mensaje escrito por un agente (o copiado de un archivo del repo)
 *     terminaría corriendo comandos en la máquina del usuario.
 *
 * Entre comillas simples nada de eso pasa: no hay expansión, no hay
 * sustitución, el token siempre cierra, y en el peor caso el shell dice
 * "command not found" y devuelve el prompt limpio. El costo es que el
 * agente ve el mensaje entrecomillado, que es un precio ridículo al lado
 * de ejecución arbitraria de comandos.
 */
export function formatForTerminal(message, {
  skillPath = SKILL_FILE, crossed = [], head = null,
} = {}) {
  const origin = message.from === 'usuario' ? 'del usuario' : `de @${message.from}`;
  const num = message.seq ? `#${message.seq} ` : '';
  // Por `seq` (el mismo número que usa `--re`); el id sólo si no hay seq.
  const ref = message.seq || message.id;

  // A qué contesta. Va adelante, pegado al número, porque es lo primero
  // que hay que saber para leer el resto: sin esto, dos agentes discuten
  // sin darse cuenta de que hablan de mensajes distintos.
  const re = message.replyTo ? `(responde a tu #${message.replyTo}) ` : '';

  // Sello de entrega: sobre qué árbol se escribió esto. Se muestra SIEMPRE,
  // no sólo cuando hay desfase — es el límite exacto sobre el que arranca
  // un QA, en vez de "el árbol en este momento". El `+sin commitear` es lo
  // que evita revisar código a medio escribir.
  const stamp = message.commit
    ? ` [sobre ${message.commit}${message.dirty ? ' +cambios sin commitear' : ''}]`
    : '';

  const notes = [];

  // Si se cruzaron, decirlo acá es lo único que lo hace evidente a tiempo:
  // el que recibe puede reconciliar antes de contestar, en vez de descubrir
  // el desencuentro tres mensajes después.
  if (crossed.length) {
    notes.push(`lo escribió sin haber visto ${crossed.length === 1
      ? `tu mensaje #${crossed[0].seq}`
      : `tus mensajes ${crossed.map((m) => `#${m.seq}`).join(', ')}`}`);
  }

  // Desfase de código: el mensaje describe el árbol como estaba en ese
  // commit, y el árbol ya avanzó. Sin esto, un reporte de bug ya corregido
  // se lee como si fuera actual.
  if (head && message.commit && message.commit !== head) {
    notes.push(`el árbol ya está en ${head} — puede que ya esté resuelto`);
  }

  const warning = notes.length ? ` [ojo: ${notes.join('; ')}]` : '';

  const body = `[loop] Mensaje ${num}${re}${origin} para @${message.to}`
    + `${stamp}${warning} — leelo con: ybento leer ${ref} `
    + `(sos @${message.to} en este loop; el protocolo está en ${skillPath})`;

  // Comillas simples reales -> tipográfica, para poder envolver todo entre
  // comillas simples sin un solo escape.
  return `'${body.replace(/'/g, '’')}'`;
}

/**
 * Qué hay para entregar ahora mismo, por agente.
 *
 * Sólo devuelve destinatarios en `waiting`: los que están `working` quedan
 * con su bandeja intacta hasta que se liberen. Ese es justamente el motivo
 * de existir de status.json — sin este filtro, el texto se entrelaza con lo
 * que el agente esté corriendo.
 */
export async function pendingDeliveries(cwd) {
  const agents = await listAgents(cwd);
  const out = [];
  for (const agent of agents) {
    if (agent.state !== 'waiting') continue;
    const pending = await inbox(cwd, agent.name);
    if (pending.length) out.push({ agent, messages: pending });
  }
  return out;
}

/* ---------- Vigilancia ---------- */

/**
 * Avisa cuando cambia algo en `.ybento/loop/`.
 *
 * Bento necesita esto para ser el repartidor: los mensajes los postean
 * procesos ajenos (el CLI que corre cada agente), así que sin vigilar el
 * directorio nadie se entera de que hay algo para pegar.
 *
 * Devuelve una función para cortar, o `null` si la carpeta no existe —
 * mismo criterio que watchTasks: no la creamos sólo por querer mirarla.
 */
export function watchLoop(cwd, onChange) {
  const dir = resolveSafe(cwd, LOOP_DIR);

  let watcher;
  try {
    watcher = watch(dir, { persistent: false }, () => onChange());
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  watcher.on('error', () => watcher.close());

  return () => watcher.close();
}
