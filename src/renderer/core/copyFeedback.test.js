/**
 * src/renderer/core/copyFeedback.test.js
 * ----------------------------------------------------------
 * Sin DOM. Timers falsos de vitest. Una fila de la tabla del plan por test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCopyFeedback } from './copyFeedback.js';

describe('createCopyFeedback', () => {
  let states;
  let feedback;

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
    feedback = createCopyFeedback({
      durationMs: 1500,
      onState: (s) => states.push(s),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writeFn resuelve → done; a los 1 499 ms sigue done; a los 1 500 ms → idle', async () => {
    await feedback.run(() => Promise.resolve());
    expect(states).toEqual(['done']);
    vi.advanceTimersByTime(1499);
    expect(states).toEqual(['done']);
    vi.advanceTimersByTime(1);
    expect(states).toEqual(['done', 'idle']);
  });

  it('writeFn rechaza → failed, nunca done', async () => {
    await feedback.run(() => Promise.reject(new Error('fallo')));
    expect(states).toEqual(['failed']);
    expect(states).not.toContain('done');
    vi.advanceTimersByTime(1500);
    expect(states).toEqual(['failed', 'idle']);
  });

  it('dos run que resuelven, el segundo a los 1 000 ms → a los 1 600 sigue done; a los 2 500 → idle', async () => {
    await feedback.run(() => Promise.resolve());
    vi.advanceTimersByTime(1000);
    await feedback.run(() => Promise.resolve());
    // A los 1 600 ms desde el inicio (600 ms después del segundo run): sigue done
    vi.advanceTimersByTime(600);
    expect(states.at(-1)).toBe('done');
    // A los 2 500 ms desde el inicio (1 500 ms después del segundo run): idle
    vi.advanceTimersByTime(900);
    expect(states.at(-1)).toBe('idle');
  });

  it('falla en t=0, éxito en t=1000 → a los 1600 sigue done; a los 2500 → idle', async () => {
    await feedback.run(() => Promise.reject(new Error('x')));  // falla en t = 0
    vi.advanceTimersByTime(1000);
    await feedback.run(() => Promise.resolve());               // éxito en t = 1000
    vi.advanceTimersByTime(600);
    expect(states.at(-1)).toBe('done');                        // t = 1600
    vi.advanceTimersByTime(900);
    expect(states.at(-1)).toBe('idle');                        // t = 2500
  });
});
