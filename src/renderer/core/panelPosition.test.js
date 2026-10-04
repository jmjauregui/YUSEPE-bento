import { describe, it, expect } from 'vitest';
import { panelLayout, POSITIONS, DEFAULT_POSITION, expandClip } from './panelPosition.js';

describe('panelLayout', () => {
  it('right → handleEdge left, axis x, storageKey loop-width, min 300, max 900 (estático)', () => {
    const l = panelLayout('right', 800);
    expect(l.handleEdge).toBe('left');
    expect(l.axis).toBe('x');
    expect(l.storageKey).toBe('yusepe:loop-width');
    expect(l.min).toBe(300);
    expect(l.max).toBe(900);
  });

  it('left → handleEdge right (invertido respecto a right)', () => {
    const l = panelLayout('left', 800);
    expect(l.handleEdge).toBe('right');
    expect(l.axis).toBe('x');
  });

  it('top con 1000px → max 700 (70%), axis y, storageKey loop-height, handleEdge bottom', () => {
    const l = panelLayout('top', 1000);
    expect(l.max).toBe(700);
    expect(l.axis).toBe('y');
    expect(l.storageKey).toBe('yusepe:loop-height');
    expect(l.handleEdge).toBe('bottom');
  });

  it('bottom con 500px → max 350, handleEdge top', () => {
    const l = panelLayout('bottom', 500);
    expect(l.max).toBe(350);
    expect(l.handleEdge).toBe('top');
  });

  it('posición desconocida → mismo layout que DEFAULT_POSITION (right)', () => {
    const unknown = panelLayout('center', 800);
    const def = panelLayout(DEFAULT_POSITION, 800);
    expect(unknown.handleEdge).toBe(def.handleEdge);
    expect(unknown.axis).toBe(def.axis);
    expect(unknown.storageKey).toBe(def.storageKey);
    expect(unknown.max).toBe(def.max);
  });

  it('POSITIONS tiene los 4 valores; top/bottom usan min 180 y defaultSize 320', () => {
    expect(POSITIONS).toEqual(['left', 'right', 'top', 'bottom']);
    expect(panelLayout('top', 800).min).toBe(180);
    expect(panelLayout('bottom', 800).defaultSize).toBe(320);
    // right/left usan min 300 y defaultSize 384
    expect(panelLayout('right', 800).min).toBe(300);
    expect(panelLayout('left', 800).defaultSize).toBe(384);
  });
});

describe('expandClip', () => {
  it('right → offset en el inset IZQUIERDO; to siempre inset(0 0 0 0)', () => {
    const { from, to } = expandClip('right', { available: 1440, size: 384 });
    expect(from).toBe('inset(0 0 0 1056px)');
    expect(to).toBe('inset(0 0 0 0)');
  });

  it('left → offset en el inset DERECHO', () => {
    const { from, to } = expandClip('left', { available: 1440, size: 384 });
    expect(from).toBe('inset(0 1056px 0 0)');
    expect(to).toBe('inset(0 0 0 0)');
  });

  it('top → offset en el inset INFERIOR', () => {
    const { from, to } = expandClip('top', { available: 800, size: 320 });
    expect(from).toBe('inset(0 0 480px 0)');
    expect(to).toBe('inset(0 0 0 0)');
  });

  it('bottom → offset en el inset SUPERIOR', () => {
    const { from, to } = expandClip('bottom', { available: 800, size: 320 });
    expect(from).toBe('inset(480px 0 0 0)');
    expect(to).toBe('inset(0 0 0 0)');
  });

  it('size >= available → offset 0 (nunca negativo)', () => {
    const { from } = expandClip('right', { available: 300, size: 1200 });
    expect(from).toBe('inset(0 0 0 0px)');
  });

  it('posición desconocida → default right (offset en inset izquierdo)', () => {
    const { from } = expandClip('center', { available: 1000, size: 400 });
    expect(from).toBe('inset(0 0 0 600px)');
  });
});
