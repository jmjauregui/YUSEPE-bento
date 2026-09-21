/**
 * src/renderer/core/rosterAccordion.test.js
 * ----------------------------------------------------------
 * Sin DOM. Timers falsos de vitest + isHeld controlado.
 * Cubre los 16 tests de la tabla de plan.md (C1-C5).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STUCK_WORKING_MS,
  agentProblem,
  rowFlags,
  rosterAlert,
  createRosterAccordion,
  observerOptionsSignature,
} from './rosterAccordion.js';

/* ============================================================
   Acordeón — cuenta regresiva (C1-C3)
   ============================================================ */

describe('createRosterAccordion', () => {
  let held;
  let changes;
  let acc;

  beforeEach(() => {
    vi.useFakeTimers();
    held = false;
    changes = [];
    acc = createRosterAccordion({
      durationMs: 5000,
      isHeld: () => held,
      onChange: (v) => changes.push(v),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('abrir → 4 999 ms sigue abierto; al llegar a 5 000 ms se cierra', () => {
    acc.open();
    expect(acc.isOpen).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(acc.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(acc.isOpen).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('abrir con isHeld=true → 60 s → sigue abierto (consulta isHeld en cada vencimiento)', () => {
    held = true;
    acc.open();
    vi.advanceTimersByTime(60_000);
    expect(acc.isOpen).toBe(true);
  });

  it('isHeld true, release() (leave falso), 5 s → sigue abierto — no se cierra por evento', () => {
    held = true;
    acc.open();
    vi.advanceTimersByTime(3000);
    acc.release(); // simula un mouseleave falso con isHeld=true
    vi.advanceTimersByTime(5000);
    expect(acc.isOpen).toBe(true);
  });

  it('isHeld pasa a false sin release() → cierra al vencer — no depende del evento', () => {
    held = true;
    acc.open();
    vi.advanceTimersByTime(4000);
    held = false; // el mouse salió pero el evento no llegó
    vi.advanceTimersByTime(1001);
    expect(acc.isOpen).toBe(false);
  });

  it('release() con 1 s restante → reinicia a 5 s, no reanuda lo que faltaba', () => {
    acc.open();
    vi.advanceTimersByTime(4000); // quedan 1 s
    acc.release();                 // rearma a 5 s
    vi.advanceTimersByTime(4999);
    expect(acc.isOpen).toBe(true); // todavía no
    vi.advanceTimersByTime(1);
    expect(acc.isOpen).toBe(false);
  });

  it('close() cancela el timer: sin nueva apertura no dispara onChange extra', () => {
    acc.open();
    vi.advanceTimersByTime(3000); // quedan 2 s del timer
    acc.close();
    const len = changes.length; // [true, false]
    vi.advanceTimersByTime(2001); // el timer viejo vencería aquí si no fue cancelado
    expect(changes).toHaveLength(len); // sin onChange espurio
  });

  it('abierto, open() a los 4 s → cierra a los 9 s desde el inicio', () => {
    acc.open();
    vi.advanceTimersByTime(4000);
    acc.open(); // rearma: 5 s más desde ahora
    vi.advanceTimersByTime(4999);
    expect(acc.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(acc.isOpen).toBe(false);
  });

  it('toggle(): abierto → cerrado; cerrado → abierto', () => {
    acc.open();
    expect(acc.isOpen).toBe(true);
    acc.toggle();
    expect(acc.isOpen).toBe(false);
    acc.toggle();
    expect(acc.isOpen).toBe(true);
  });

  it('release() con el roster cerrado → sigue cerrado, sin timers', () => {
    expect(acc.isOpen).toBe(false);
    acc.release();
    vi.advanceTimersByTime(10_000);
    expect(acc.isOpen).toBe(false);
    expect(changes).toHaveLength(0);
  });
});

/* ============================================================
   agentProblem / isStuck / rosterAlert (C4-C5)
   ============================================================ */

const NOW = 1_000_000_000;
const mkAgent = (state, updatedAt) => ({ state, updatedAt: new Date(updatedAt).toISOString() });

describe('agentProblem', () => {
  it('presence.present false → absent', () => {
    const a = mkAgent('waiting', NOW);
    expect(agentProblem(a, { present: false }, NOW)).toBe('absent');
  });

  it('working hace exactamente 15 min → null; hace 15 min + 1 ms → stuck', () => {
    const exact = mkAgent('working', NOW - STUCK_WORKING_MS);
    expect(agentProblem(exact, {}, NOW)).toBe(null);

    const over = mkAgent('working', NOW - STUCK_WORKING_MS - 1);
    expect(agentProblem(over, {}, NOW)).toBe('stuck');
  });

  it('waiting viejo → null; working reciente → null', () => {
    const oldWaiting = mkAgent('waiting', NOW - STUCK_WORKING_MS - 9999);
    expect(agentProblem(oldWaiting, {}, NOW)).toBe(null);

    const recentWorking = mkAgent('working', NOW - 1000);
    expect(agentProblem(recentWorking, {}, NOW)).toBe(null);
  });

  it('ausente Y trabado → absent (ausente tiene precedencia)', () => {
    const a = mkAgent('working', NOW - STUCK_WORKING_MS - 1);
    expect(agentProblem(a, { present: false }, NOW)).toBe('absent');
  });

  it('presence undefined → no es absent', () => {
    const a = mkAgent('waiting', NOW);
    expect(agentProblem(a, undefined, NOW)).toBe(null);
  });
});

describe('rowFlags', () => {
  it('ausente Y trabado → subtitle absent, showRelease true', () => {
    const a = mkAgent('working', NOW - STUCK_WORKING_MS - 1);
    const flags = rowFlags(a, { present: false }, NOW);
    expect(flags.subtitle).toBe('absent');
    expect(flags.showRelease).toBe(true);
  });

  it('sólo trabado → subtitle stuck, showRelease true', () => {
    const a = mkAgent('working', NOW - STUCK_WORKING_MS - 1);
    const flags = rowFlags(a, { present: true }, NOW);
    expect(flags.subtitle).toBe('stuck');
    expect(flags.showRelease).toBe(true);
  });

  it('sólo ausente (no trabado) → subtitle absent, showRelease false', () => {
    const a = mkAgent('waiting', NOW);
    const flags = rowFlags(a, { present: false }, NOW);
    expect(flags.subtitle).toBe('absent');
    expect(flags.showRelease).toBe(false);
  });

  it('sin problemas → subtitle null, showRelease false', () => {
    const a = mkAgent('waiting', NOW);
    const flags = rowFlags(a, { present: true }, NOW);
    expect(flags.subtitle).toBe(null);
    expect(flags.showRelease).toBe(false);
  });
});

describe('rosterAlert', () => {
  it('uno ausente y otro trabado → red (rojo le gana al ámbar)', () => {
    const a1 = { ...mkAgent('waiting', NOW), name: 'alpha' };
    const a2 = { ...mkAgent('working', NOW - STUCK_WORKING_MS - 1), name: 'beta' };
    const pb = { alpha: { present: false }, beta: { present: true } };
    expect(rosterAlert([a1, a2], pb, NOW)).toBe('red');
  });

  it('[trabado, ausente] → red — el orden de la lista no importa', () => {
    const a1 = { ...mkAgent('working', NOW - STUCK_WORKING_MS - 1), name: 'alpha' };
    const a2 = { ...mkAgent('waiting', NOW), name: 'beta' };
    const pb = { alpha: { present: true }, beta: { present: false } };
    expect(rosterAlert([a1, a2], pb, NOW)).toBe('red');
  });

  it('sólo trabado → amber', () => {
    const a = { ...mkAgent('working', NOW - STUCK_WORKING_MS - 1), name: 'alpha' };
    expect(rosterAlert([a], { alpha: { present: true } }, NOW)).toBe('amber');
  });

  it('ningún problema → null', () => {
    const a = { ...mkAgent('waiting', NOW), name: 'alpha' };
    expect(rosterAlert([a], { alpha: { present: true } }, NOW)).toBe(null);
  });

  it('lista vacía → null', () => {
    expect(rosterAlert([], {}, NOW)).toBe(null);
  });
});

/* ============================================================
   observerOptionsSignature — firma del selector de designado
   ============================================================ */

describe('observerOptionsSignature', () => {
  const ags = (names) => names.map((n) => ({ name: n }));

  it('misma lista y mismo designado → misma firma (opciones no se rehacen)', () => {
    const a = ags(['claudio', 'coord']);
    expect(observerOptionsSignature(a, 'coord')).toBe(observerOptionsSignature(a, 'coord'));
  });

  it('designado cambia → firma distinta', () => {
    const a = ags(['claudio', 'coord']);
    expect(observerOptionsSignature(a, 'coord')).not.toBe(observerOptionsSignature(a, 'claudio'));
  });

  it('misma cantidad pero un nombre distinto → firma distinta', () => {
    const a1 = ags(['claudio', 'coord']);
    const a2 = ags(['claudio', 'impl']);
    expect(observerOptionsSignature(a1, null)).not.toBe(observerOptionsSignature(a2, null));
  });

  it('mismo conjunto en orden distinto → firma distinta', () => {
    const a1 = ags(['claudio', 'coord']);
    const a2 = ags(['coord', 'claudio']);
    expect(observerOptionsSignature(a1, null)).not.toBe(observerOptionsSignature(a2, null));
  });

  it("sin separador entre nombres colisionan: ['ab','c'] vs ['a','bc'] → firmas distintas", () => {
    // Con join('') ambas listas producirían 'abc|' — el separador ',' lo evita.
    const a1 = ags(['ab', 'c']);
    const a2 = ags(['a', 'bc']);
    expect(observerOptionsSignature(a1, null)).not.toBe(observerOptionsSignature(a2, null));
  });
});
