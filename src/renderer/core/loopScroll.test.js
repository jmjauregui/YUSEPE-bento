import { describe, it, expect } from 'vitest';
import { composerPad, isAtBottom } from './loopScroll.js';

describe('composerPad', () => {
  it('alto + gap: composerPad(90) → 98', () => {
    expect(composerPad(90)).toBe(98);
  });

  it('compositor oculto (composerH=0) → sólo el gap, nunca 0 ni negativo', () => {
    expect(composerPad(0)).toBe(8);
  });

  it('medición fallida (NaN / undefined) → sólo el gap, no NaN en la variable CSS', () => {
    expect(composerPad(NaN)).toBe(8);
    expect(composerPad(undefined)).toBe(8);
  });

  it('composerH no entero → resultado siempre entero (evita re-layout en cada observación)', () => {
    expect(Number.isInteger(composerPad(90.4))).toBe(true);
    expect(composerPad(90.4)).toBe(98);
  });

  it('relleno topado a streamH × maxRatio para no comerse la vista', () => {
    expect(composerPad(300, { streamH: 400 })).toBe(240);
  });
});

describe('isAtBottom', () => {
  it('distancia 0 → true (exactamente al fondo)', () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 960, clientHeight: 40 })).toBe(true);
  });

  it('distancia 39 → true; distancia 41 → false (borde del umbral de 40 px)', () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 921, clientHeight: 40 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 919, clientHeight: 40 })).toBe(false);
  });

  it('threshold explícito reemplaza al predeterminado de 40', () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 951, clientHeight: 40 }, 10)).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 950, clientHeight: 40 }, 10)).toBe(false);
  });
});
