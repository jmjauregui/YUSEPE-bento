/**
 * src/main/remoteServer.js
 * --------------------------------------------------------------
 * Loop remoto en la red local (spec 041): sirve el chat del loop a un
 * teléfono en la misma WiFi, a partir de un QR.
 *
 * El teléfono es otro cliente del mismo disco: lee el hilo y escribe
 * mensajes del USUARIO con las mismas funciones de loopOps que el panel.
 * El repartidor se los entrega a los agentes como siempre.
 *
 * SEGURIDAD — un mensaje al loop termina ejecutando comandos en la máquina
 * (los agentes corren código), así que esto se diseñó al revés: todo
 * cerrado salvo lo imprescindible.
 *   - Apagado por defecto; se apaga solo a los 30 min sin teléfonos.
 *   - Llave aleatoria de 256 bits en el path, nueva en cada encendido;
 *     sin ella, 404 vacío (ni siquiera confirma que hay un Bento acá).
 *   - Cada dispositivo se aprueba en la compu; recién ahí recibe su sesión
 *     (cookie HttpOnly, SameSite=Strict, acotada al path de la llave).
 *   - Sólo IPs de red privada.
 *   - El teléfono pide workspaces por id opaco (HMAC del cwd con la llave):
 *     nunca manda ni ve rutas del disco.
 *   - Escribe sólo como `usuario`; no crea preguntas/permisos, no toca
 *     archivos ni terminales.
 * Sin HTTPS (en la red local exigiría instalar una CA en el teléfono): el
 * tráfico viaja sin cifrar por la WiFi, y la UI lo dice.
 * --------------------------------------------------------------
 */
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { listAgents, listMessages, postMessage, MESSAGES_FILE, STATUS_FILE } from './loopOps.js';
import { renderMarkdown } from '../renderer/core/markdown.js';
import { THINKING_PHRASES } from '../renderer/core/loopThinking.js';

export const IDLE_SHUTDOWN_MS = 30 * 60 * 1000;
const PAIR_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_BODY = 32 * 1024;
const MAX_TEXT = 20_000;
const STATIC_FILES = { '': 'index.html', 'app.js': 'app.js', 'app.css': 'app.css' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** ¿Es una IP de red privada (o este mismo equipo)? */
export function isPrivateIp(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '').toLowerCase();
  if (a === '::1' || a.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(a)) return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
}

/** IPv4 privadas de las interfaces de red (la primera es la que se usa). */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && isPrivateIp(i.address)) out.push(i.address);
    }
  }
  return out;
}

const b64url = (buf) => buf.toString('base64url');

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Qué se le muestra al teléfono de un mensaje: nada de rutas ni campos internos. */
function projectMessage(m) {
  return {
    id: m.id,
    seq: m.seq,
    from: m.from,
    to: m.to,
    // Markdown ya sanitizado (core/markdown.js, spec 033): el teléfono lo
    // inserta tal cual, sin librería propia.
    html: renderMarkdown(m.text, { breaks: true, images: false }),
    createdAt: m.createdAt,
    replyTo: m.replyTo ?? null,
    kind: m.kind || null,
    options: m.kind === 'question' ? m.options : undefined,
    answer: m.kind === 'question' ? (m.answer ? { choice: m.answer.choice, text: m.answer.text } : null) : undefined,
    attended: m.kind === 'permission' ? !!m.attended : undefined,
  };
}

/**
 * @param {object} deps
 * @param {() => Promise<{cwd: string, name: string}[]>|{cwd: string, name: string}[]} deps.activeWorkspaces loops corriendo en Bento
 * @param {(cwd: string) => object} [deps.presence] presencia de los agentes de un workspace
 * @param {(device: {ua: string, ip: string}) => Promise<boolean>} deps.onPairRequest aprobación en la compu
 * @param {(status: object) => void} [deps.onStatus] cambió el estado (para la UI de Bento)
 * @param {string} deps.staticDir carpeta con la página del teléfono (src/remote)
 * @param {(addr: string) => boolean} [deps.isAllowedIp]
 * @param {() => number} [deps.now]
 */
export function createRemoteServer({
  activeWorkspaces,
  presence = () => ({}),
  onPairRequest,
  onStatus = () => {},
  staticDir,
  isAllowedIp = isPrivateIp,
  now = () => Date.now(),
}) {
  let server = null;
  let key = null;
  let url = null;
  let startedAt = 0;
  let idleTimer = null;
  const sessions = new Map(); // sid -> { id, ua, ip, lastSeen, streams: Set }
  const pendingPairs = new Set();
  const rejectedIps = new Set();
  const fingerprints = new Map(); // cwd -> string

  const wsId = (cwd) => b64url(createHmac('sha256', key).update(cwd).digest()).slice(0, 22);
  const cursorKey = (cwd) => createHash('sha256').update(cwd).digest('hex').slice(0, 16);

  function status() {
    return {
      running: !!server,
      url,
      devices: [...sessions.values()].map(({ id, ua, ip, streams }) => ({ id, ua, ip, live: streams.size > 0 })),
    };
  }
  const emitStatus = () => onStatus(status());

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const s of sessions.values()) for (const res of s.streams) res.write(frame);
  }

  async function resolveWs(id) {
    return (await activeWorkspaces()).find((w) => sameSecret(wsId(w.cwd), id)) || null;
  }

  /* ---------- Respuestas ---------- */

  const BASE_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // La llave va en la URL: que ningún link la filtre en el Referer.
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  };
  function send(res, code, body = '', headers = {}) {
    res.writeHead(code, { ...BASE_HEADERS, ...headers });
    res.end(body);
  }
  const notFound = (res) => send(res, 404);
  const json = (res, code, data, headers = {}) =>
    send(res, code, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('too-big')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /* ---------- Datos ---------- */

  async function workspaceSummary(w) {
    const messages = await listMessages(w.cwd);
    const agents = await listAgents(w.cwd);
    const last = messages[messages.length - 1];
    let waitingOn = null;
    for (const m of messages) {
      if (m.kind === 'question' && !m.answer) waitingOn = 'question';
      if (m.kind === 'permission' && !m.attended) waitingOn = waitingOn || 'permission';
    }
    return {
      id: wsId(w.cwd),
      cursorKey: cursorKey(w.cwd),
      name: w.name,
      lastSeq: last?.seq || 0,
      lastAt: last?.createdAt || null,
      // Mensajes al usuario: el teléfono cuenta sus no leídos contra su cursor.
      toUserSeqs: messages.filter((m) => m.from !== 'usuario').slice(-200).map((m) => m.seq),
      waitingOn,
      working: agents.filter((a) => a.state === 'working').map((a) => a.name),
      preview: last ? { from: last.from, text: String(last.text).slice(0, 120) } : null,
    };
  }

  async function threadOf(w) {
    const [messages, agents] = await Promise.all([listMessages(w.cwd, { limit: 200 }), listAgents(w.cwd)]);
    return {
      id: wsId(w.cwd),
      cursorKey: cursorKey(w.cwd),
      name: w.name,
      agents: agents.map(({ name, role, color, emoji, state, updatedAt }) => ({ name, role, color, emoji, state, updatedAt })),
      presence: presence(w.cwd) || {},
      messages: messages.map(projectMessage),
      phrases: THINKING_PHRASES,
    };
  }

  /* ---------- Ruteo ---------- */

  async function handle(req, res) {
    if (!isAllowedIp(req.socket.remoteAddress)) return notFound(res);
    const { pathname } = new URL(req.url, 'http://local');
    const parts = pathname.split('/').slice(1); // ['r', key, ...]
    if (parts[0] !== 'r' || !key || !sameSecret(parts[1] || '', key)) return notFound(res);
    const rest = parts.slice(2);
    const route = rest.join('/');

    // Página (sin datos): se puede cargar con la llave, antes de emparejar.
    if (req.method === 'GET' && Object.hasOwn(STATIC_FILES, route)) {
      const file = STATIC_FILES[route];
      try {
        const body = await fs.readFile(path.join(staticDir, file));
        return send(res, 200, body, {
          'Content-Type': MIME[path.extname(file)],
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
      } catch {
        return notFound(res);
      }
    }

    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');

    // Emparejar: queda esperando a que lo apruebes en la compu.
    if (req.method === 'POST' && route === 'api/pair') {
      if (rejectedIps.has(ip)) return json(res, 403, { error: 'rechazado' });
      if (pendingPairs.size >= 2) return json(res, 429, { error: 'ocupado' });
      const ua = String(req.headers['user-agent'] || 'Dispositivo').slice(0, 200);
      pendingPairs.add(res);
      let approved = false;
      let timer = null;
      try {
        approved = await Promise.race([
          Promise.resolve(onPairRequest({ ua, ip })),
          new Promise((resolve) => { timer = setTimeout(() => resolve(false), PAIR_TIMEOUT_MS); }),
        ]);
      } finally {
        clearTimeout(timer);
        pendingPairs.delete(res);
      }
      if (!server) return notFound(res);
      if (!approved) {
        rejectedIps.add(ip);
        return json(res, 403, { error: 'rechazado' });
      }
      const sid = b64url(randomBytes(32));
      sessions.set(sid, { id: b64url(randomBytes(6)), ua, ip, lastSeen: now(), streams: new Set() });
      emitStatus();
      return json(res, 200, { ok: true }, {
        'Set-Cookie': `bento_s=${sid}; HttpOnly; SameSite=Strict; Path=/r/${key}/`,
      });
    }

    // Todo lo demás exige sesión.
    const session = sessions.get(parseCookies(req.headers.cookie).bento_s || '');
    if (!session) return json(res, 401, { error: 'sin-sesion' });
    session.lastSeen = now();

    if (req.method === 'GET' && route === 'api/workspaces') {
      const list = await Promise.all((await activeWorkspaces()).map(workspaceSummary));
      list.sort((a, b) => (!!b.waitingOn - !!a.waitingOn) || String(b.lastAt).localeCompare(String(a.lastAt)));
      return json(res, 200, { workspaces: list });
    }

    if (req.method === 'GET' && route === 'api/events') {
      res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': hola\n\n');
      session.streams.add(res);
      emitStatus();
      const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(beat);
        session.streams.delete(res);
        session.lastSeen = now();
        emitStatus();
      });
      return undefined;
    }

    if (rest[0] === 'api' && rest[1] === 'ws' && rest[2]) {
      const w = await resolveWs(rest[2]);
      if (!w) return notFound(res);

      if (req.method === 'GET' && rest[3] === 'thread' && rest.length === 4) {
        return json(res, 200, await threadOf(w));
      }

      if (req.method === 'POST' && rest[3] === 'message' && rest.length === 4) {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'cuerpo inválido' }); }
        const agents = await listAgents(w.cwd);
        const to = String(body?.to || '');
        const text = String(body?.text || '').trim();
        if (!agents.some((a) => a.name === to)) return json(res, 400, { error: 'agente desconocido' });
        if (!text || text.length > MAX_TEXT) return json(res, 400, { error: 'texto vacío o demasiado largo' });
        // Siempre como usuario, con la misma validación que el panel (loopOps).
        const msg = await postMessage(w.cwd, {
          from: 'usuario',
          to,
          text,
          replyTo: Number.isInteger(body.replyTo) ? body.replyTo : null,
          choice: Number.isInteger(body.choice) ? body.choice : null,
          seenUpTo: typeof body.seenUpTo === 'string' ? body.seenUpTo : null,
        });
        return json(res, 200, { ok: true, id: msg.id });
      }
    }

    return notFound(res);
  }

  /* ---------- Ciclo de vida ---------- */

  function checkIdle() {
    if (!server) return;
    const live = [...sessions.values()].some((s) => s.streams.size > 0);
    if (live) return;
    const last = Math.max(startedAt, ...[...sessions.values()].map((s) => s.lastSeen));
    if (now() - last >= IDLE_SHUTDOWN_MS) stop();
  }

  /**
   * Prende el servidor. Cada encendido: llave nueva, sesiones nuevas.
   * @param {{ host?: string, port?: number, initialCwd?: string }} [opts]
   */
  async function start({ host = lanAddresses()[0], port = 0, initialCwd = null } = {}) {
    if (server) return status();
    if (!host) throw new Error('No encontré una red local (WiFi o cable) en esta máquina.');
    key = b64url(randomBytes(32));
    sessions.clear();
    rejectedIps.clear();
    fingerprints.clear();
    const srv = http.createServer((req, res) => {
      handle(req, res).catch(() => { if (!res.headersSent) notFound(res); else res.end(); });
    });
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, host, resolve);
    });
    server = srv;
    startedAt = now();
    const { port: realPort } = srv.address();
    const ws = initialCwd ? `?ws=${wsId(initialCwd)}` : '';
    url = `http://${host}:${realPort}/r/${key}/${ws}`;
    idleTimer = setInterval(checkIdle, 60_000);
    emitStatus();
    return status();
  }

  function stop() {
    if (!server) return status();
    clearInterval(idleTimer);
    idleTimer = null;
    for (const s of sessions.values()) for (const r of s.streams) r.end();
    sessions.clear();
    server.close();
    server.closeAllConnections?.();
    server = null;
    key = null;
    url = null;
    emitStatus();
    return status();
  }

  /** Echa a un dispositivo: su sesión deja de valer y se le cierra el stream. */
  function kick(deviceId) {
    for (const [sid, s] of sessions) {
      if (s.id !== deviceId) continue;
      for (const r of s.streams) r.end();
      sessions.delete(sid);
      rejectedIps.add(s.ip);
    }
    emitStatus();
    return status();
  }

  /**
   * El repartidor avisa "revisé este workspace" cada pocos segundos aunque
   * no haya pasado nada. Se compara una huella barata (tamaño + fecha de los
   * dos archivos del loop) para avisarle al teléfono sólo si cambió algo.
   */
  async function notifyChange(cwd) {
    if (!server || !sessions.size) return;
    const stamp = async (rel) => {
      try { const st = await fs.stat(path.join(cwd, rel)); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; }
    };
    const fp = `${await stamp(MESSAGES_FILE)}|${await stamp(STATUS_FILE)}`;
    if (fingerprints.get(cwd) === fp) return;
    fingerprints.set(cwd, fp);
    broadcast('thread', { id: wsId(cwd) });
  }

  function notifyLoopsChanged() {
    if (server) broadcast('workspaces', {});
  }

  return { start, stop, status, kick, notifyChange, notifyLoopsChanged, checkIdle };
}
