import { describe, it, expect } from 'vitest';
import { sizeFromDelta } from './resizableSidebar.js';

describe('sizeFromDelta', () => {
  it('edge right: crece cuando pointer > pointerStart (arrastrar hacia la derecha agranda el panel izquierdo)', () => {
    expect(sizeFromDelta({ edge: 'right', start: 400, pointerStart: 500, pointer: 550, min: 100, max: 1000 })).toBe(450);
  });

  it('edge left: crece cuando pointer < pointerStart (arrastrar hacia la izquierda agranda el panel derecho)', () => {
    expect(sizeFromDelta({ edge: 'left', start: 400, pointerStart: 500, pointer: 450, min: 100, max: 1000 })).toBe(450);
  });

  it('edge bottom: crece cuando pointer > pointerStart (arrastrar hacia abajo agranda el panel superior)', () => {
    expect(sizeFromDelta({ edge: 'bottom', start: 300, pointerStart: 400, pointer: 440, min: 100, max: 1000 })).toBe(340);
  });

  it('edge top: crece cuando pointer < pointerStart (arrastrar hacia arriba agranda el panel inferior)', () => {
    expect(sizeFromDelta({ edge: 'top', start: 300, pointerStart: 400, pointer: 360, min: 100, max: 1000 })).toBe(340);
  });

  it('clampea a max y a min', () => {
    // Supera el máximo
    expect(sizeFromDelta({ edge: 'right', start: 400, pointerStart: 500, pointer: 900, min: 100, max: 600 })).toBe(600);
    // Cae por debajo del mínimo
    expect(sizeFromDelta({ edge: 'right', start: 150, pointerStart: 500, pointer: 450, min: 200, max: 900 })).toBe(200);
  });
});
