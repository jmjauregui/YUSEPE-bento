/**
 * src/renderer/core/loopActivity.test.js
 * Una fila de la tabla del plan.md por test.
 */
import { describe, it, expect } from 'vitest';
import { activityState, FRESH_MS, STEADY_MS } from './loopActivity.js';

const NOW = 1_000_000_000;

describe('activityState', () => {
  it('sin agentes / sin marcas → idle', () => {
    const r = activityState({ now: NOW, lastDataAtByAgent: {}, streakStartedAt: null });
    expect(r.state).toBe('idle');
    expect(r.streakStartedAt).toBe(null);
  });

  it('una marca de hace 1 s → blink', () => {
    const r = activityState({ now: NOW, lastDataAtByAgent: { a: NOW - 1000 }, streakStartedAt: null });
    expect(r.state).toBe('blink');
    expect(r.streakStartedAt).toBe(NOW);
  });

  it('exactamente FRESH_MS → idle; 1 ms menos → blink (borde estricto)', () => {
    const exact = activityState({ now: NOW, lastDataAtByAgent: { a: NOW - FRESH_MS }, streakStartedAt: null });
    expect(exact.state).toBe('idle');

    const near = activityState({ now: NOW, lastDataAtByAgent: { a: NOW - FRESH_MS + 1 }, streakStartedAt: null });
    expect(near.state).toBe('blink');
  });

  it('dos agentes: uno quieto hace una hora y otro imprimiendo → blink', () => {
    const r = activityState({
      now: NOW,
      lastDataAtByAgent: { quiet: NOW - 3_600_000, active: NOW - 1000 },
      streakStartedAt: null,
    });
    expect(r.state).toBe('blink');
  });

  it('racha de 119 s → blink; de 121 s → steady con sinceMs correcto', () => {
    const streak119 = NOW - (STEADY_MS - 1000);
    const r1 = activityState({ now: NOW, lastDataAtByAgent: { a: NOW - 1000 }, streakStartedAt: streak119 });
    expect(r1.state).toBe('blink');

    const streak121 = NOW - (STEADY_MS + 1000);
    const r2 = activityState({ now: NOW, lastDataAtByAgent: { a: NOW - 1000 }, streakStartedAt: streak121 });
    expect(r2.state).toBe('steady');
    expect(r2.sinceMs).toBe(NOW - streak121);
    expect(r2.streakStartedAt).toBe(streak121);
  });

  it('actividad → hueco de 10 s → actividad: la racha se reinicia', () => {
    const T1 = NOW;

    // Actividad fresca → blink
    const r1 = activityState({ now: T1, lastDataAtByAgent: { a: T1 - 500 }, streakStartedAt: null });
    expect(r1.state).toBe('blink');
    const firstStreak = r1.streakStartedAt;

    // 10 s después, la marca ya tiene elapsed > FRESH_MS → idle, racha cortada
    const r2 = activityState({ now: T1 + 10_000, lastDataAtByAgent: { a: T1 - 500 }, streakStartedAt: firstStreak });
    expect(r2.state).toBe('idle');
    expect(r2.streakStartedAt).toBe(null);

    // Nueva actividad → racha reiniciada (streakStartedAt ≠ firstStreak)
    const r3 = activityState({ now: T1 + 10_000, lastDataAtByAgent: { a: T1 + 9_500 }, streakStartedAt: null });
    expect(r3.state).toBe('blink');
    expect(r3.streakStartedAt).not.toBe(firstStreak);
  });

  it('steady continuo: sigue steady con el mismo streakStartedAt (la racha no se reinicia)', () => {
    const streak = NOW - (STEADY_MS + 5000);

    const r1 = activityState({ now: NOW, lastDataAtByAgent: { a: NOW - 1000 }, streakStartedAt: streak });
    expect(r1.state).toBe('steady');
    expect(r1.streakStartedAt).toBe(streak);

    // Una vuelta más tarde: misma racha, mismo streakStartedAt
    const r2 = activityState({ now: NOW + 1500, lastDataAtByAgent: { a: NOW + 500 }, streakStartedAt: r1.streakStartedAt });
    expect(r2.state).toBe('steady');
    expect(r2.streakStartedAt).toBe(streak);
  });

  it('marca en el futuro (reloj corrido) → no explota, trata como fresca', () => {
    expect(() =>
      activityState({ now: NOW, lastDataAtByAgent: { a: NOW + 9999 }, streakStartedAt: null }),
    ).not.toThrow();

    const r = activityState({ now: NOW, lastDataAtByAgent: { a: NOW + 9999 }, streakStartedAt: null });
    expect(r.state).toBe('blink');
  });
});
