import { describe, it, expect, vi } from 'vitest';
import { createActivity } from './activityState.js';

function harness({ focused = false } = {}) {
  let now = 100_000;
  const timers = new Map(); let seq = 0;
  const setT = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  const clearT = (id) => timers.delete(id);
  const tick = (ms) => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } };
  const changes = [];
  const a = createActivity({ now: () => now, isFocused: () => focused, onChange: (s) => changes.push(s), setTimeout: setT, clearTimeout: clearT });
  // salida sostenida: `secs` segundos seguidos con un fragmento de `bytes` cada uno
  const burst = (secs, bytes = 200) => { for (let i = 0; i < secs; i++) { a.data(bytes); tick(1000); } };
  return { a, tick, changes, burst, setFocused: (v) => { focused = v; } };
}

describe('activityState', () => {
  it('la gracia de 10 s se cuenta desde el primer byte, no desde crear el pty', () => {
    const { a, tick, burst } = harness();
    tick(30_000);            // el pty existe hace 30 s pero no escribió nada (ssh lento)
    burst(5, 2000);          // arranque de una sesión retomada: 5 s de pintura
    expect(a.state()).toBe('idle');
    tick(6000);              // ya pasaron los 10 s desde el primer byte
    burst(4);
    expect(a.state()).toBe('working');
  });

  it('un repintado aislado en reposo (44 bytes) no marca nada', () => {
    const { a, tick, changes } = harness();
    a.data(400); tick(11_000);
    a.data(44); tick(5000);
    expect(changes).toEqual([]);
  });

  it('salida en 3 segundos distintos con ≥ 300 bytes marca working', () => {
    const { a, tick, changes } = harness();
    a.data(400); tick(11_000);
    a.data(100); tick(1000); a.data(100); tick(1000);
    expect(changes).toEqual([]);           // 2 segundos, 200 bytes: todavía no
    a.data(100);
    expect(changes).toEqual(['working']);  // 3 segundos, 300 bytes
  });

  it('working corto (< 3 s) vuelve a idle sin «listo»', () => {
    const { a, tick, changes } = harness();
    a.data(400); tick(11_000);
    a.data(200); tick(1000); a.data(200); tick(1000); a.data(200); // working desde t0
    expect(a.state()).toBe('working');
    tick(1600);                            // trabajó ~2 s + 1,5 s de silencio
    expect(changes).toEqual(['working', 'idle']);
  });

  it('working largo sin foco → done; con foco → idle', () => {
    const noFocus = harness();
    noFocus.a.data(400); noFocus.tick(11_000); noFocus.burst(6); noFocus.tick(1600);
    expect(noFocus.changes).toEqual(['working', 'done']);
    const focus = harness({ focused: true });
    focus.a.data(400); focus.tick(11_000); focus.burst(6); focus.tick(1600);
    expect(focus.changes).toEqual(['working', 'idle']);
  });

  it('la salida continua mantiene working y done se limpia al enfocar', () => {
    const { a, tick, changes, burst } = harness();
    a.data(400); tick(11_000); burst(10);
    expect(a.state()).toBe('working');
    tick(1600); expect(a.state()).toBe('done');
    a.focus(); expect(a.state()).toBe('idle');
    burst(4); expect(a.state()).toBe('working');
    expect(changes).toEqual(['working', 'done', 'idle', 'working']);
  });

  it('focus en idle o working no cambia nada; dispose cancela el temporizador', () => {
    const { a, tick, changes, burst } = harness();
    a.focus(); expect(changes).toEqual([]);
    a.data(400); tick(11_000); burst(5); a.focus(); expect(a.state()).toBe('working');
    a.dispose(); tick(10_000);
    expect(changes).toEqual(['working']);
  });

  it('usa los timers globales por defecto', () => {
    vi.useFakeTimers();
    const changes = [];
    const a = createActivity({ isFocused: () => false, onChange: (s) => changes.push(s), warmupMs: 0 });
    for (let i = 0; i < 5; i++) { a.data(200); vi.advanceTimersByTime(1000); }
    vi.advanceTimersByTime(1600);
    expect(changes).toEqual(['working', 'done']);
    vi.useRealTimers();
  });
});
