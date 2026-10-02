/**
 * src/main/loopObserver.test.js
 * Tests del observador de inactividad. Reloj inyectado: sin timers ni disco.
 */
import { describe, it, expect } from 'vitest';
import { decideObserver, OBSERVER_THRESHOLD_MS, observerText } from './loopObserver.js';

const T = 10 * 60_000; // 10 min en ms
const START = 1_000_000;
const AFTER_START = START + 1_000; // mensaje creado DESPUÉS del watchStartedAt

function mkAgents(list) {
  return list.map(([name, state, cursor = null, updatedAtMs = 0]) => ({
    name,
    state,
    cursor,
    updatedAt: new Date(updatedAtMs).toISOString(),
  }));
}

function mkMsg(from, to, id = 'msg1', createdAtMs = AFTER_START) {
  return { id, from, to, createdAt: new Date(createdAtMs).toISOString() };
}

const BASE = {
  now: START + T + 1,
  thresholdMs: T,
  watchStartedAt: START,
  agents: mkAgents([['impl', 'working', null, START - T - 10]]),
  lastMessage: mkMsg('usuario', 'impl'),
  bound: new Set(['impl']),
  lastDataAtByAgent: { impl: START - T - 10 },
  designated: null,
  alerted: new Map(),
};

describe('decideObserver', () => {
  it('umbral null → nada (guarda 1, fixture que avisa con umbral real)', () => {
    // Mismo fixture que "umbral + 1ms → aviso" pero con thresholdMs = null.
    // Sin la guarda 1, decideObserver pasaría a evaluar silencios y avisaría.
    const agents = mkAgents([['impl', 'working', null, START - T - 1], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      thresholdMs: null,
      agents,
      lastDataAtByAgent: { impl: START - T - 1 },
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('último mensaje para @usuario → nada, aun con agente callado', () => {
    const agents = mkAgents([['impl', 'working', null, START - T - 10], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      agents,
      bound: new Set(['impl', 'coord']),
      lastMessage: mkMsg('coord', 'usuario'),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('working, silencio = umbral exacto → nada (> estricto)', () => {
    const agents = mkAgents([['impl', 'working', null, START - T], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START, // now - (START - T) = T exacto → no pasa >
      agents,
      lastDataAtByAgent: { impl: START - T },
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('working, silencio = umbral + 1ms → aviso', () => {
    const agents = mkAgents([['impl', 'working', null, START - T - 1], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START, // now - (START - T - 1) = T + 1ms > T
      agents,
      lastDataAtByAgent: { impl: START - T - 1 },
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices.length).toBeGreaterThan(0);
  });

  it('working con updatedAt viejo pero lastDataAt reciente → nada', () => {
    const agents = mkAgents([['impl', 'working', null, START - T * 2], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: START - T + 100 }, // reciente: sólo T-100 ms de silencio
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('agente en working sin terminal (not in bound) → nada', () => {
    const agents = mkAgents([['impl', 'working', null, START - T - 10], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      bound: new Set(['coord']), // impl no tiene terminal
      lastDataAtByAgent: {},
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('callado avisado; otro chequeo, misma marca → nada (memoria)', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const alerted = new Map([['impl', mark]]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      alerted,
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('callado avisado; otros agentes postean → sigue sin avisar', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const alerted = new Map([['impl', mark]]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      alerted,
      lastMessage: mkMsg('coord', 'impl', 'msg2', AFTER_START + 5_000),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('callado avisado; su marca cambia y vuelve a callar → nuevo aviso', () => {
    const oldMark = START - T - 100;
    const newMark = START - T - 10; // distinto de la marca avisada
    const agents = mkAgents([['impl', 'working', null, newMark], ['coord', 'waiting']]);
    const alerted = new Map([['impl', oldMark]]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: newMark },
      alerted,
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices.length).toBeGreaterThan(0);
  });

  it('ocupado y callado → al designado primero, luego al usuario', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      designated: 'coord',
      bound: new Set(['impl', 'coord']),
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices[0]?.to).toBe('coord');
    expect(r.notices[1]?.to).toBe('usuario');
  });

  it('designado = el callado → sólo al usuario', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      designated: 'impl', // el callado ES el designado
      bound: new Set(['impl', 'coord']),
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].to).toBe('usuario');
  });

  it('sin designado → sólo al usuario', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      designated: null,
      bound: new Set(['impl', 'coord']),
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].to).toBe('usuario');
  });

  it('pelota caída: todos waiting, último entregado, destinatario callado → al designado', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'waiting', 'msg1', mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      bound: new Set(['impl', 'coord']),
      designated: 'coord',
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].to).toBe('coord');
    expect(r.notices[0].case).toBe('dropped');
  });

  it('pelota caída: cursor atrás (no entregado) con terminal → no es pelota caída', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'waiting', 'msg0', mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      bound: new Set(['impl', 'coord']), // impl tiene terminal
      designated: 'coord',
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START), // msg1 ≠ cursor msg0
    });
    expect(r.notices).toHaveLength(0);
  });

  it('pelota caída: designado no está en el loop → aviso a @usuario (no al fantasma)', () => {
    // Cubre la rama "pelota caída" (todos waiting, entregado) con designado fuera de agents.
    // Si se usa `designated` crudo en vez de `designatedOk`, el aviso va a 'fantasma'.
    const mark = START - T - 1;
    const agents = mkAgents([['impl', 'waiting', 'msg1', mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      bound: new Set(['impl', 'coord']),
      designated: 'fantasma', // no está en agents
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].to).toBe('usuario');
    expect(r.notices[0].case).toBe('dropped');
  });

  it('pelota caída: último mensaje de @bento → nada', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'waiting', 'msg1', mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      bound: new Set(['impl', 'coord']),
      designated: 'coord',
      lastMessage: mkMsg('bento', 'impl', 'msg1', AFTER_START), // from bento
    });
    expect(r.notices).toHaveLength(0);
  });

  it('pelota caída con un agente en working → no evalúa pelota caída', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'waiting', 'msg1', mark], ['coord', 'working']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark, coord: START }, // coord activo recientemente
      bound: new Set(['impl', 'coord']),
      designated: null,
      lastMessage: mkMsg('usuario', 'impl', 'msg1', AFTER_START),
    });
    // lastMessage.to === 'impl' (no usuario) → pasa regla 1
    // coord en working con lastDataAt reciente → no callado; silentWorking vacío
    // agents.some(working) → corta antes de pelota caída
    expect(r.notices).toHaveLength(0);
  });

  it('un solo agente registrado → nada', () => {
    const agents = mkAgents([['impl', 'working', null, START - T - 10]]);
    const r = decideObserver({
      ...BASE,
      agents,
      bound: new Set(['impl']),
      lastMessage: mkMsg('usuario', 'impl'),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('cero agentes → nada, sin tirar', () => {
    const r = decideObserver({ ...BASE, agents: [], bound: new Set(), lastMessage: null });
    expect(r.notices).toHaveLength(0);
  });

  it('último mensaje anterior a watchStartedAt → nada', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      lastMessage: mkMsg('coord', 'impl', 'msg1', START - 1_000), // antes del watchStartedAt
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('mismo caso pero mensaje nuevo después de watchStartedAt → aviso', () => {
    const mark = START - T - 10;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START), // después del watchStartedAt
      bound: new Set(['impl', 'coord']),
    });
    expect(r.notices.length).toBeGreaterThan(0);
  });

  it('no entregado, sin terminal, > umbral → aviso sólo al usuario (undeliverable)', () => {
    // now = START + 2T (bien al futuro); mensaje creado en AFTER_START (> watchStartedAt)
    // elapsed = now - AFTER_START = 2T - 1000 > T ✓
    const now2 = START + T + T;
    const agents = mkAgents([['impl', 'waiting', 'msg0', AFTER_START], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: now2,
      agents,
      lastDataAtByAgent: {},
      bound: new Set(['coord']), // impl NO tiene terminal
      designated: 'coord',
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START), // creado en AFTER_START
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].to).toBe('usuario');
    expect(r.notices[0].case).toBe('undeliverable');
  });

  it('no entregado, con terminal (in bound) → no es undeliverable', () => {
    const now2 = START + T + T;
    const agents = mkAgents([['impl', 'waiting', 'msg0', AFTER_START], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: now2,
      agents,
      lastDataAtByAgent: {},
      bound: new Set(['coord', 'impl']), // impl TIENE terminal
      designated: 'coord',
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('designado no está en el loop → aviso a @usuario (no al designado fantasma)', () => {
    // El agente 'fantasma' no aparece en agents; designatedOk debe quedar null.
    const mark = START - T - 1;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      bound: new Set(['impl', 'coord']),
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      designated: 'fantasma', // no está en agents
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].to).toBe('usuario');
  });

  it('la memoria ESCRIBE la marca: segunda llamada con result.alerted mismo reloj → nada', () => {
    // Verifica que decideObserver escriba realmente alerted (no solo lo lea).
    // Primera llamada: agente callado, alerted vacío → avisa y guarda la marca.
    // Segunda llamada: mismo reloj y el result.alerted de la primera → 0 avisos.
    const mark = START - T - 1;
    const agents = mkAgents([['impl', 'working', null, mark], ['coord', 'waiting']]);
    const opts = {
      ...BASE,
      now: START,
      agents,
      lastDataAtByAgent: { impl: mark },
      bound: new Set(['impl', 'coord']),
      lastMessage: mkMsg('coord', 'impl', 'msg1', AFTER_START),
      alerted: new Map(),
    };
    const r1 = decideObserver(opts);
    expect(r1.notices.length).toBeGreaterThan(0); // primera: avisa
    expect(r1.alerted.get('impl')).toBe(mark);    // y guarda la marca
    const r2 = decideObserver({ ...opts, alerted: r1.alerted });
    expect(r2.notices).toHaveLength(0);            // segunda: callada
  });

  it('undeliverable con elapsed = umbral - 1 → nada (borde inferior)', () => {
    // elapsed justo por debajo del umbral → no debe avisar
    const createdAt = START + T + T - (T - 1); // now - createdAt = T - 1
    const now2 = START + T + T;
    const agents = mkAgents([['impl', 'waiting', 'msg0', AFTER_START], ['coord', 'waiting']]);
    const r = decideObserver({
      ...BASE,
      now: now2,
      agents,
      lastDataAtByAgent: {},
      bound: new Set(['coord']),   // impl sin terminal
      designated: 'coord',
      lastMessage: mkMsg('coord', 'impl', 'msg1', createdAt),
    });
    expect(r.notices).toHaveLength(0);
  });

  it('OBSERVER_THRESHOLD_MS es 10 minutos (600 000 ms)', () => {
    expect(OBSERVER_THRESHOLD_MS).toBe(10 * 60_000);
  });
});

describe('observerText', () => {
  it('caso working incluye footer y minutos', () => {
    const t = observerText({ case: 'working', about: ['impl'], minutesAgo: 12 });
    expect(t).toContain('@impl');
    expect(t).toContain('12 min');
    expect(t).toContain('no respondas a @bento');
  });

  it('caso dropped incluye número de seq si hay', () => {
    const t = observerText({ case: 'dropped', about: ['impl'], minutesAgo: 5, seq: 42 });
    expect(t).toContain('#42');
  });

  it('caso dropped sin seq no incluye #', () => {
    const t = observerText({ case: 'dropped', about: ['impl'], minutesAgo: 5 });
    expect(t).not.toContain('#');
  });

  it('caso undeliverable menciona el agente', () => {
    const t = observerText({ case: 'undeliverable', about: ['impl'], minutesAgo: 7 });
    expect(t).toContain('@impl');
  });
});
