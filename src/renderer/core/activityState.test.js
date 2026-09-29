import { describe, it, expect, vi } from 'vitest';
import { createActivity } from './activityState.js';

function harness({ focused = false, now0 = 10_000 } = {}) {
  let now = now0;
  const timers = new Map(); let seq = 0;
  const setT = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  const clearT = (id) => timers.delete(id);
  const tick = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  const changes = [];
  const a = createActivity({
    now: () => now, isFocused: () => focused, onChange: (s) => changes.push(s),
    setTimeout: setT, clearTimeout: clearT,
  });
  return { a, tick, changes, setFocused: (v) => { focused = v; } };
}

describe('activityState', () => {
  it('arranca idle y no cuenta salida en el arranque (3 s)', () => {
    const { a, tick, changes } = harness();
    expect(a.state()).toBe('idle');
    a.data(500);
    expect(a.state()).toBe('idle');
    tick(3001); a.data(500);
    expect(a.state()).toBe('working');
    expect(changes).toEqual(['working']);
  });

  it('un fragmento chico no cuenta; tres chicos en 1 s sí', () => {
    const { a, tick } = harness(); tick(3001);
    a.data(5); expect(a.state()).toBe('idle');
    a.data(5); tick(100); a.data(5);
    expect(a.state()).toBe('working');
  });

  it('working → done tras 1,5 s sin salida si NO tiene el foco', () => {
    const { a, tick, changes } = harness({ focused: false }); tick(3001);
    a.data(100); tick(1499); expect(a.state()).toBe('working');
    tick(2); expect(a.state()).toBe('done');
    expect(changes).toEqual(['working', 'done']);
  });

  it('working → idle tras 1,5 s si tiene el foco', () => {
    const { a, tick } = harness({ focused: true }); tick(3001);
    a.data(100); tick(1501);
    expect(a.state()).toBe('idle');
  });

  it('la salida continua mantiene working (el temporizador se reinicia)', () => {
    const { a, tick } = harness(); tick(3001);
    a.data(100); tick(1000); a.data(100); tick(1000); a.data(100); tick(1000);
    expect(a.state()).toBe('working');
    tick(1501); expect(a.state()).toBe('done');
  });

  it('done se limpia al enfocar; salida nueva vuelve a working', () => {
    const { a, tick, changes } = harness(); tick(3001);
    a.data(100); tick(1501); expect(a.state()).toBe('done');
    a.focus(); expect(a.state()).toBe('idle');
    a.data(100); expect(a.state()).toBe('working');
    expect(changes).toEqual(['working', 'done', 'idle', 'working']);
  });

  it('focus en idle o working no cambia nada', () => {
    const { a, tick, changes } = harness(); tick(3001);
    a.focus(); expect(changes).toEqual([]);
    a.data(100); a.focus(); expect(a.state()).toBe('working');
  });

  it('dispose cancela el temporizador pendiente', () => {
    const { a, tick, changes } = harness(); tick(3001);
    a.data(100); a.dispose(); tick(5000);
    expect(changes).toEqual(['working']);
  });

  it('usa los timers globales por defecto', () => {
    vi.useFakeTimers();
    const changes = [];
    const a = createActivity({ isFocused: () => false, onChange: (s) => changes.push(s), warmupMs: 0 });
    a.data(100); vi.advanceTimersByTime(1600);
    expect(changes).toEqual(['working', 'done']);
    vi.useRealTimers();
  });
});
