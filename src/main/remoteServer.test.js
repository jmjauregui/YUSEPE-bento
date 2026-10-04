/**
 * src/main/remoteServer.test.js
 * --------------------------------------------------------------
 * El servidor del loop remoto (spec 041) sobre un puerto real en
 * localhost. Lo que se prueba es, sobre todo, lo que NO tiene que pasar:
 * un mensaje al loop termina ejecutando comandos en la máquina.
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createRemoteServer, isPrivateIp, IDLE_SHUTDOWN_MS } from './remoteServer.js';
import { listMessages, postMessage, registerAgent } from './loopOps.js';

const STATIC = path.join(process.cwd(), 'src', 'remote');

let cwdA;
let cwdB;
let active;
let approve;
let clock;
let remote;
let base;

async function mkWorkspace(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `yusepe-remote-${name}-`));
  await registerAgent(dir, { name: 'claudio', role: 'codifica' });
  return dir;
}

beforeEach(async () => {
  cwdA = await mkWorkspace('a');
  cwdB = await mkWorkspace('b');
  active = [{ cwd: cwdA, name: 'TOROLORO' }, { cwd: cwdB, name: 'CORPUSIA' }];
  approve = true;
  clock = 1_000_000;
  remote = createRemoteServer({
    activeWorkspaces: () => active,
    onPairRequest: async () => approve,
    staticDir: STATIC,
    now: () => clock,
  });
  const st = await remote.start({ host: '127.0.0.1', initialCwd: cwdA });
  base = st.url.replace(/\?.*$/, '');
});

afterEach(async () => {
  remote.stop();
  await fs.rm(cwdA, { recursive: true, force: true });
  await fs.rm(cwdB, { recursive: true, force: true });
});

/** Empareja y devuelve un fetch que manda la cookie de sesión. */
async function paired() {
  const r = await fetch(`${base}api/pair`, { method: 'POST' });
  expect(r.status).toBe(200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return (p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { ...(opts.headers || {}), cookie } });
}

describe('sin la llave no hay nada', () => {
  it('sin llave, con otra llave o fuera de /r/: 404 vacío', async () => {
    const origin = new URL(base).origin;
    for (const u of [`${origin}/`, `${origin}/r/`, `${origin}/r/otra-llave/`, `${origin}/r/otra-llave/api/workspaces`]) {
      const r = await fetch(u);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe('');
    }
  });

  it('con la llave, la página carga (sin datos) y con CSP estricta', async () => {
    const r = await fetch(base);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('al reencender, la llave vieja deja de servir', async () => {
    remote.stop();
    const st = await remote.start({ host: '127.0.0.1' });
    const viejo = `${new URL(st.url).origin}${new URL(base).pathname}`;
    expect((await fetch(viejo)).status).toBe(404);
  });

  it('IPs que no son de red privada: 404', async () => {
    remote.stop();
    remote = createRemoteServer({
      activeWorkspaces: () => active, onPairRequest: async () => true, staticDir: STATIC,
      isAllowedIp: () => false,
    });
    const st = await remote.start({ host: '127.0.0.1' });
    expect((await fetch(st.url)).status).toBe(404);
  });

  it('isPrivateIp', () => {
    for (const ip of ['192.168.1.23', '10.0.0.5', '172.20.1.1', '127.0.0.1', '::1', '::ffff:192.168.0.2', 'fe80::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '200.1.2.3', '2001:db8::1', '']) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('emparejamiento', () => {
  it('sin sesión, la API no da datos', async () => {
    const r = await fetch(`${base}api/workspaces`);
    expect(r.status).toBe(401);
  });

  it('aprobado en la compu: recibe una sesión HttpOnly acotada al path de la llave', async () => {
    const r = await fetch(`${base}api/pair`, { method: 'POST' });
    const cookie = r.headers.get('set-cookie');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toContain(`Path=${new URL(base).pathname}`);
    expect(remote.status().devices).toHaveLength(1);
  });

  it('rechazado: 403, y esa IP no puede reintentar en este encendido', async () => {
    approve = false;
    expect((await fetch(`${base}api/pair`, { method: 'POST' })).status).toBe(403);
    approve = true;
    expect((await fetch(`${base}api/pair`, { method: 'POST' })).status).toBe(403);
  });

  it('echar a un dispositivo invalida su sesión', async () => {
    const get = await paired();
    expect((await get('api/workspaces')).status).toBe(200);
    remote.kick(remote.status().devices[0].id);
    expect((await get('api/workspaces')).status).toBe(401);
  });
});

describe('varios workspaces', () => {
  it('lista los loops activos con ids opacos, sin rutas', async () => {
    const get = await paired();
    const { workspaces } = await (await get('api/workspaces')).json();
    expect(workspaces.map((w) => w.name).sort()).toEqual(['CORPUSIA', 'TOROLORO']);
    const raw = JSON.stringify(workspaces);
    expect(raw).not.toContain(cwdA);
    expect(raw).not.toContain(os.tmpdir());
  });

  it('cada mensaje va al workspace correcto, como usuario', async () => {
    const get = await paired();
    const { workspaces } = await (await get('api/workspaces')).json();
    const b = workspaces.find((w) => w.name === 'CORPUSIA');
    const r = await get(`api/ws/${b.id}/message`, {
      method: 'POST',
      body: JSON.stringify({ to: 'claudio', text: 'hola desde el teléfono', kind: 'question', from: 'claudio' }),
    });
    expect(r.status).toBe(200);
    expect(await listMessages(cwdA)).toEqual([]);
    const [msg] = await listMessages(cwdB);
    expect(msg).toMatchObject({ from: 'usuario', to: 'claudio', text: 'hola desde el teléfono' });
    expect(msg.kind).toBeUndefined(); // el teléfono no crea preguntas ni permisos
  });

  it('un loop detenido, o una ruta en lugar de id: 404', async () => {
    const get = await paired();
    const { workspaces } = await (await get('api/workspaces')).json();
    const a = workspaces.find((w) => w.name === 'TOROLORO');
    active = active.filter((w) => w.cwd !== cwdA);
    expect((await get(`api/ws/${a.id}/thread`)).status).toBe(404);
    expect((await get(`api/ws/${encodeURIComponent(cwdB)}/thread`)).status).toBe(404);
  });

  it('el hilo trae Markdown ya sanitizado', async () => {
    await postMessage(cwdA, { from: 'claudio', to: 'usuario', text: 'ok <img src=x onerror=alert(1)>' });
    const get = await paired();
    const { workspaces } = await (await get('api/workspaces')).json();
    const a = workspaces.find((w) => w.name === 'TOROLORO');
    const thread = await (await get(`api/ws/${a.id}/thread`)).json();
    expect(thread.messages[0].html).not.toContain('<img');
    expect(thread.messages[0].html).toContain('&lt;img');
  });

  it('responde preguntas con la opción elegida', async () => {
    await postMessage(cwdA, { from: 'claudio', to: 'usuario', text: '¿A o B?', kind: 'question', options: ['A', 'B'] });
    const get = await paired();
    const a = (await (await get('api/workspaces')).json()).workspaces.find((w) => w.name === 'TOROLORO');
    expect(a.waitingOn).toBe('question');
    await get(`api/ws/${a.id}/message`, { method: 'POST', body: JSON.stringify({ to: 'claudio', text: 'B', replyTo: 1, choice: 1 }) });
    expect((await listMessages(cwdA))[0].answer).toMatchObject({ choice: 1 });
  });

  it('a un agente que no existe, o un cuerpo gigante: rechazado', async () => {
    const get = await paired();
    const a = (await (await get('api/workspaces')).json()).workspaces[0];
    expect((await get(`api/ws/${a.id}/message`, { method: 'POST', body: JSON.stringify({ to: 'nadie', text: 'x' }) })).status).toBe(400);
    const big = JSON.stringify({ to: 'claudio', text: 'x'.repeat(40_000) });
    const r = await get(`api/ws/${a.id}/message`, { method: 'POST', body: big }).catch(() => ({ status: 'cortado' }));
    expect([400, 404, 'cortado']).toContain(r.status);
  });
});

describe('ciclo de vida', () => {
  it('se apaga solo tras 30 min sin teléfonos', async () => {
    clock += IDLE_SHUTDOWN_MS + 1;
    remote.checkIdle();
    expect(remote.status().running).toBe(false);
  });

  it('con actividad reciente, sigue prendido', async () => {
    const get = await paired();
    clock += IDLE_SHUTDOWN_MS - 1000;
    await get('api/workspaces');
    clock += 5000;
    remote.checkIdle();
    expect(remote.status().running).toBe(true);
  });
});
