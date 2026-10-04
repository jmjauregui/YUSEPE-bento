/**
 * src/remote/app.js
 * --------------------------------------------------------------
 * Chat del loop en el teléfono (spec 041). La sirve Bento desde la compu,
 * sólo en la red local, detrás de una llave en la URL y de tu aprobación.
 *
 * Reglas de esta página:
 *   - Todo texto va con textContent. La única excepción es el cuerpo de los
 *     mensajes (`msg.html`), que el servidor ya sanitizó (core/markdown.js).
 *   - Nada de estilos inline (la CSP no los permite): los colores de cada
 *     agente van como variables CSS vía el CSSOM.
 *   - Sin estado propio que importe: el hilo vive en la compu.
 * --------------------------------------------------------------
 */

const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);

let view = 'list';
let currentId = params.get('ws');
let thread = null;
let target = null;
let tick = 0;
let thinkingTimer = null;

/* ---------- Utilidades ---------- */

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'vars') for (const [name, val] of Object.entries(v)) n.style.setProperty(name, val);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

const PALETTE = ['#4aa3f0', '#b483f5', '#2dd4bf', '#f472b6', '#f59e0b', '#60a5fa', '#c084fc', '#22d3ee'];
function colorOf(agent) {
  if (agent?.color && /^#[0-9a-f]{6}$/i.test(agent.color)) return agent.color;
  let n = 0;
  for (const ch of String(agent?.name || '')) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

const time = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const cursorOf = (key) => Number(localStorage.getItem(`cursor:${key}`) || 0);
const setCursor = (key, seq) => localStorage.setItem(`cursor:${key}`, String(seq));

async function api(p, opts = {}) {
  const r = await fetch(p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) throw Object.assign(new Error('sin-sesion'), { code: 401 });
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`), { code: r.status });
  return r.json();
}

function screen(...children) {
  $app.replaceChildren(...children);
}

/* ---------- Emparejar ---------- */

async function pair() {
  screen(el('div', { class: 'center' }, [
    el('div', { class: 'logo' }, '🍱'),
    el('h1', {}, 'Esperando tu aprobación'),
    el('p', { class: 'muted' }, 'Aprobá este dispositivo en la compu, en el aviso de Bento.'),
    el('div', { class: 'spinner' }),
  ]));
  const r = await fetch('api/pair', { method: 'POST' });
  if (r.ok) return true;
  screen(el('div', { class: 'center' }, [
    el('div', { class: 'logo' }, '🔒'),
    el('h1', {}, r.status === 429 ? 'Hay otra aprobación pendiente' : 'No se aprobó la conexión'),
    el('p', { class: 'muted' }, r.status === 429
      ? 'Esperá un momento y volvé a cargar la página.'
      : 'Si fue un error, apagá y volvé a prender "Abrir en el teléfono" en Bento y escaneá el QR nuevo.'),
  ]));
  return false;
}

/* ---------- Lista de loops ---------- */

async function showList() {
  view = 'list';
  thread = null;
  stopThinking();
  const { workspaces } = await api('api/workspaces');
  const items = workspaces.map((w) => {
    const unread = w.toUserSeqs.filter((s) => s > cursorOf(w.cursorKey)).length;
    const badges = [];
    if (w.waitingOn === 'question') badges.push(el('span', { class: 'badge q' }, '❓ decisión'));
    if (w.waitingOn === 'permission') badges.push(el('span', { class: 'badge p' }, '🔐 permiso'));
    if (unread) badges.push(el('span', { class: 'badge n' }, `${unread} nuevo${unread === 1 ? '' : 's'}`));
    return el('button', { class: 'ws', onclick: () => openThread(w.id) }, [
      el('div', { class: 'ws-top' }, [
        el('span', { class: `dot ${w.working.length ? 'on' : ''}` }),
        el('span', { class: 'ws-name' }, w.name),
        el('span', { class: 'ws-badges' }, badges.length ? badges : el('span', { class: 'muted small' }, 'al día')),
      ]),
      w.working.length
        ? el('div', { class: 'ws-sub working' }, `${w.working.map((n) => `@${n}`).join(', ')} trabajando…`)
        : (w.preview ? el('div', { class: 'ws-sub' }, `${w.preview.from === 'usuario' ? 'vos' : `@${w.preview.from}`}: ${w.preview.text}`) : null),
    ]);
  });
  screen(
    el('header', { class: 'bar' }, [el('span', { class: 'title' }, 'Tus loops')]),
    el('div', { class: 'list' }, items.length ? items : [el('p', { class: 'center muted' }, 'No hay loops corriendo en Bento ahora.')]),
  );
}

/* ---------- Hilo ---------- */

async function openThread(id) {
  currentId = id;
  view = 'thread';
  target = null;
  await renderThread(true);
}

async function renderThread(scrollToEnd = false) {
  let data;
  try {
    data = await api(`api/ws/${currentId}/thread`);
  } catch (err) {
    if (err.code === 404) { currentId = null; await showList(); return; }
    throw err;
  }
  const isNew = thread && data.messages.length > thread.messages.length;
  const newestToMe = isNew && data.messages[data.messages.length - 1]?.to === 'usuario';
  thread = data;
  const agentBy = Object.fromEntries(data.agents.map((a) => [a.name, a]));
  if (!data.agents.some((a) => a.name === target)) target = data.agents[0]?.name || null;

  const cursor = cursorOf(data.cursorKey);
  let markedNew = false;
  const rows = data.messages.map((m) => {
    const mine = m.from === 'usuario';
    const agent = agentBy[m.from];
    const fresh = !mine && m.seq > cursor && !markedNew;
    if (fresh) markedNew = true;
    const body = el('div', { class: 'body' });
    body.innerHTML = m.html; // sanitizado en el servidor (core/markdown.js)
    const bubble = el('div', { class: `msg ${mine ? 'mine' : ''} ${m.kind || ''}`, vars: mine ? {} : { '--tint': colorOf(agent || { name: m.from }) } }, [
      el('div', { class: 'meta' }, [
        el('b', {}, mine ? 'vos' : `${agent?.emoji ? `${agent.emoji} ` : ''}@${m.from}`),
        ` → ${m.to === 'usuario' ? 'vos' : `@${m.to}`} · ${time(m.createdAt)}`,
      ]),
      body,
      m.kind === 'question' ? questionCard(m) : null,
      m.kind === 'permission' ? el('div', { class: 'perm' }, m.attended ? '✓ atendido' : '🔐 Contestalo en su terminal, en la compu.') : null,
    ]);
    return el('div', { class: `row ${mine ? 'right' : ''}` }, [fresh ? el('div', { class: 'new' }, 'Nuevos') : null, bubble]);
  });

  const stream = el('div', { class: 'stream' }, rows);
  const thinking = el('div', { class: 'thinking' });
  const input = el('textarea', { rows: '2', placeholder: target ? `Mensaje para @${target}…` : 'No hay agentes en este loop', enterkeyhint: 'send' });
  const sendBtn = el('button', { class: 'send', 'aria-label': 'Enviar' }, '↑');
  const send = async () => {
    const text = input.value.trim();
    if (!text || !target) return;
    sendBtn.disabled = true;
    try {
      await api(`api/ws/${currentId}/message`, {
        method: 'POST',
        body: JSON.stringify({ to: target, text, seenUpTo: thread.messages[thread.messages.length - 1]?.id || null }),
      });
      input.value = '';
      await renderThread(true);
    } catch (err) {
      alert(err.message);
    } finally {
      sendBtn.disabled = false;
    }
  };
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  const pills = el('div', { class: 'pills' }, data.agents.map((a) => el('button', {
    class: `pill ${a.name === target ? 'on' : ''}`,
    vars: { '--tint': colorOf(a) },
    onclick: () => { target = a.name; renderThread(); },
  }, `${a.emoji ? `${a.emoji} ` : ''}@${a.name}`)));

  // Guardar lo que estaba escribiendo si se repinta por un cambio en vivo.
  const prev = $app.querySelector('textarea');
  if (prev) input.value = prev.value;
  const prevStream = $app.querySelector('.stream');
  const nearEnd = prevStream ? prevStream.scrollHeight - prevStream.scrollTop - prevStream.clientHeight < 80 : true;

  screen(
    el('header', { class: 'bar' }, [
      el('button', { class: 'back', onclick: () => showList(), 'aria-label': 'Volver' }, '‹'),
      el('span', { class: 'title' }, data.name),
    ]),
    stream,
    el('footer', { class: 'composer' }, [thinking, pills, el('div', { class: 'box' }, [input, sendBtn])]),
  );
  if (scrollToEnd || nearEnd) stream.scrollTop = stream.scrollHeight;
  setCursor(data.cursorKey, data.messages[data.messages.length - 1]?.seq || 0);
  if (newestToMe && document.visibilityState === 'visible') navigator.vibrate?.(60);

  paintThinking(thinking, data, agentBy);
}

function questionCard(m) {
  if (m.answer) {
    return el('div', { class: 'opts' }, (m.options || []).map((o, i) =>
      el('div', { class: `opt ${i === m.answer.choice ? 'chosen' : 'dim'}` }, `${i === m.answer.choice ? '✓ ' : ''}${o}`))
      .concat(m.answer.choice == null ? [el('div', { class: 'opt chosen' }, `✓ ${m.answer.text}`)] : []));
  }
  const answer = async (choice, text) => {
    await api(`api/ws/${currentId}/message`, {
      method: 'POST', body: JSON.stringify({ to: m.from, text, replyTo: m.seq, choice }),
    });
    await renderThread();
  };
  return el('div', { class: 'opts' }, [
    ...(m.options || []).map((o, i) => el('button', { class: 'opt', onclick: () => answer(i, o) }, o)),
    el('button', {
      class: 'opt other',
      onclick: () => {
        const t = prompt('Tu respuesta:');
        if (t && t.trim()) answer(null, t.trim());
      },
    }, 'Otra respuesta…'),
  ]);
}

/* ---------- "Está pensando…" ---------- */

function paintThinking(box, data, agentBy) {
  stopThinking();
  const working = data.agents.filter((a) => a.state === 'working' && data.presence?.[a.name]?.present !== false);
  if (!working.length) return;
  const paint = () => {
    box.replaceChildren(...working.map((a) => {
      let seed = 0;
      for (const ch of a.name) seed = (seed * 31 + ch.codePointAt(0)) >>> 0;
      const phrase = data.phrases[(seed + tick) % data.phrases.length];
      return el('div', { class: 'think', vars: { '--tint': colorOf(agentBy[a.name]) } }, [
        el('b', {}, `${a.emoji || '●'} @${a.name}`), ` está ${phrase}`, el('span', { class: 'dots' }, [el('i'), el('i'), el('i')]),
      ]);
    }));
  };
  paint();
  thinkingTimer = setInterval(() => { tick += 1; paint(); }, 2800);
}

function stopThinking() {
  clearInterval(thinkingTimer);
  thinkingTimer = null;
}

/* ---------- En vivo ---------- */

function listen() {
  const es = new EventSource('api/events');
  es.addEventListener('workspaces', () => { if (view === 'list') showList().catch(fail); });
  es.addEventListener('thread', (e) => {
    const { id } = JSON.parse(e.data);
    if (view === 'thread' && id === currentId) renderThread().catch(fail);
    else if (view === 'list') showList().catch(fail);
  });
  es.onerror = () => {
    // Bento se apagó o se perdió la red: EventSource reintenta solo.
  };
}

function fail(err) {
  if (err?.code === 401) { start(); return; }
  screen(el('div', { class: 'center' }, [
    el('div', { class: 'logo' }, '📡'),
    el('h1', {}, 'Se perdió la conexión con Bento'),
    el('p', { class: 'muted' }, 'Revisá que la compu siga prendida, en la misma WiFi, y con "Abrir en el teléfono" activo.'),
    el('button', { class: 'retry', onclick: () => start() }, 'Reintentar'),
  ]));
}

async function start() {
  try {
    try {
      await api('api/workspaces');
    } catch (err) {
      if (err.code !== 401) throw err;
      if (!(await pair())) return;
    }
    listen();
    if (currentId) await openThread(currentId);
    else await showList();
  } catch (err) {
    fail(err);
  }
}

start();
