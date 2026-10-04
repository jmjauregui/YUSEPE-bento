/**
 * src/renderer/core/agentOrder.test.js
 * Lógica pura sin DOM — cubre criterios C2 y C4 de la spec 028.
 */
import { describe, it, expect } from 'vitest';
import { applyAgentOrder, moveName, pressOutcome, insertionIndex, trackPress, crossingPlan, crossingMoves, shouldReorder, HOLD_MS, SLOP_PX } from './agentOrder.js';

const mkAgent = (name) => ({ name, role: '', state: 'waiting' });

/* ---------- applyAgentOrder ---------- */

describe('applyAgentOrder', () => {
  const agents = [mkAgent('alpha'), mkAgent('beta'), mkAgent('gamma')];

  it('sin orden → devuelve la misma lista copiada', () => {
    expect(applyAgentOrder(agents, [])).toEqual(agents);
    expect(applyAgentOrder(agents, null)).toEqual(agents);
  });

  it('orden parcial: los guardados primero, el resto al final en orden original', () => {
    const result = applyAgentOrder(agents, ['gamma', 'alpha']);
    expect(result.map((a) => a.name)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('nombres guardados que ya no están se ignoran', () => {
    const result = applyAgentOrder(agents, ['delta', 'beta', 'alpha']);
    expect(result.map((a) => a.name)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('duplicados en order: cuenta una vez (primera aparición)', () => {
    const result = applyAgentOrder(agents, ['beta', 'beta', 'alpha']);
    expect(result.map((a) => a.name)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('no muta la entrada', () => {
    const copy = [...agents];
    applyAgentOrder(agents, ['gamma']);
    expect(agents).toEqual(copy);
  });

  it('lista de entrada vacía → []', () => {
    expect(applyAgentOrder([], ['alpha'])).toEqual([]);
  });

  it('orden completo: resultado en el orden guardado', () => {
    const result = applyAgentOrder(agents, ['beta', 'gamma', 'alpha']);
    expect(result.map((a) => a.name)).toEqual(['beta', 'gamma', 'alpha']);
  });

  it('el resto mantiene el orden de llegada (alfabético de listAgents)', () => {
    const result = applyAgentOrder(agents, ['gamma']);
    expect(result.map((a) => a.name)).toEqual(['gamma', 'alpha', 'beta']);
  });
});

/* ---------- moveName ---------- */

describe('moveName', () => {
  it('mueve hacia adelante', () => {
    expect(moveName(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('mueve hacia atrás', () => {
    expect(moveName(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('misma posición: sin cambio', () => {
    expect(moveName(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('no muta el array original', () => {
    const orig = ['a', 'b', 'c'];
    moveName(orig, 0, 2);
    expect(orig).toEqual(['a', 'b', 'c']);
  });
});

/* ---------- pressOutcome ---------- */

describe('pressOutcome', () => {
  it('tap: no levantó y no se movió', () => {
    expect(pressOutcome({ lifted: false, movedPx: 0 })).toBe('tap');
    expect(pressOutcome({ lifted: false, movedPx: SLOP_PX })).toBe('tap');
  });

  it('cancel: no levantó pero se movió más de SLOP_PX', () => {
    expect(pressOutcome({ lifted: false, movedPx: SLOP_PX + 1 })).toBe('cancel');
    expect(pressOutcome({ lifted: false, movedPx: 100 })).toBe('cancel');
  });

  it('lift: la pill se levantó (independiente de movedPx)', () => {
    expect(pressOutcome({ lifted: true, movedPx: 0 })).toBe('lift');
    expect(pressOutcome({ lifted: true, movedPx: 200 })).toBe('lift');
  });

  it('HOLD_MS y SLOP_PX son las constantes esperadas', () => {
    expect(HOLD_MS).toBe(1000);
    expect(SLOP_PX).toBe(5);
  });

});

/* ---------- trackPress ---------- */

describe('trackPress', () => {
  it('alejarse y volver: el acumulado sigue siendo cancel (H12)', () => {
    let movedPx = 0;
    movedPx = trackPress(movedPx, 10, 0); // se aleja 10 px
    movedPx = trackPress(movedPx, 0, 0);  // vuelve al origen
    // El máximo fue 10 > SLOP_PX=5 → cancel, no tap.
    expect(pressOutcome({ lifted: false, movedPx })).toBe('cancel');
  });

  it('si nunca superó SLOP_PX, sigue siendo tap aunque vuelva', () => {
    let movedPx = 0;
    movedPx = trackPress(movedPx, SLOP_PX, 0); // exactamente SLOP_PX
    movedPx = trackPress(movedPx, 0, 0);
    expect(pressOutcome({ lifted: false, movedPx })).toBe('tap');
  });

  it('usa distancia euclidiana (Math.hypot)', () => {
    // √(3²+4²) = 5 = SLOP_PX → tap
    expect(trackPress(0, 3, 4)).toBe(5);
    // √(3²+4²) = 5 < SLOP_PX+1=6 → el acumulado es 5
    let movedPx = trackPress(0, 3, 4);
    movedPx = trackPress(movedPx, 0, 0);
    expect(pressOutcome({ lifted: false, movedPx })).toBe('tap');
  });

  it('el acumulado nunca decrece', () => {
    let movedPx = trackPress(0, 20, 0);
    movedPx = trackPress(movedPx, 1, 0);
    expect(movedPx).toBe(20);
  });
});

/* ---------- insertionIndex ---------- */

describe('insertionIndex', () => {
  // Helpers de rectángulo plano
  const rect = (left, top, width = 60, height = 20) => ({
    left, top, right: left + width, bottom: top + height, width, height,
  });

  describe('una sola fila', () => {
    // Tres pills en y=10..30: [0,0..60], [70,0..130], [140,0..200]
    const rects = [rect(0, 10), rect(70, 10), rect(140, 10)];

    it('antes del primero', () => {
      expect(insertionIndex(rects, { x: 10, y: 5 })).toBe(0);
    });

    it('en la mitad izquierda del primero', () => {
      expect(insertionIndex(rects, { x: 20, y: 20 })).toBe(0);
    });

    it('en la mitad derecha del primero → antes del segundo', () => {
      expect(insertionIndex(rects, { x: 50, y: 20 })).toBe(1);
    });

    it('entre el segundo y el tercero', () => {
      expect(insertionIndex(rects, { x: 120, y: 20 })).toBe(2);
    });

    it('después del último', () => {
      expect(insertionIndex(rects, { x: 180, y: 20 })).toBe(3);
    });

    it('muy a la derecha del último → al final', () => {
      expect(insertionIndex(rects, { x: 999, y: 20 })).toBe(3);
    });
  });

  describe('varias filas (flex-wrap)', () => {
    // Primera fila y=0..20: pills en x=0 y x=70
    // Segunda fila y=25..45: pill en x=0
    const rects = [rect(0, 0), rect(70, 0), rect(0, 25)];

    it('antes del primero (fila 1)', () => {
      expect(insertionIndex(rects, { x: 10, y: -5 })).toBe(0);
    });

    it('entre primera y segunda fila', () => {
      // Debería insertar antes del primer elemento de la segunda fila
      expect(insertionIndex(rects, { x: 10, y: 22 })).toBe(2);
    });

    it('en la segunda fila', () => {
      expect(insertionIndex(rects, { x: 10, y: 30 })).toBe(2);
    });

    it('después de todo (debajo de la segunda fila)', () => {
      expect(insertionIndex(rects, { x: 10, y: 50 })).toBe(3);
    });
  });

  it('rects vacíos → 0', () => {
    expect(insertionIndex([], { x: 50, y: 10 })).toBe(0);
  });
});

/* ---------- crossingPlan ---------- */

describe('crossingPlan', () => {
  it('misma posición → null (sin movimiento)', () => {
    expect(crossingPlan(2, 2)).toBeNull();
  });

  it('hacia adelante: [viejo, nuevo) se mueven ANTES de la arrastrada', () => {
    const plan = crossingPlan(1, 3);
    expect(plan.direction).toBe('forward');
    expect(plan.indices).toEqual([1, 2]);
  });

  it('hacia atrás: [nuevo, viejo) se mueven DESPUÉS de la arrastrada', () => {
    const plan = crossingPlan(3, 0);
    expect(plan.direction).toBe('backward');
    expect(plan.indices).toEqual([0, 1, 2]);
  });

  it('avanzar de a uno', () => {
    const plan = crossingPlan(0, 1);
    expect(plan.direction).toBe('forward');
    expect(plan.indices).toEqual([0]);
  });

  it('retroceder de a uno', () => {
    const plan = crossingPlan(2, 1);
    expect(plan.direction).toBe('backward');
    expect(plan.indices).toEqual([1]);
  });

});

/* ---------- crossingMoves ---------- */

describe('crossingMoves', () => {
  // Modelo puro de insertBefore sobre un array.
  function applyMoves(arr, moves) {
    const a = [...arr];
    for (const { node, before } of moves) {
      a.splice(a.indexOf(node), 1);
      a.splice(before === null ? a.length : a.indexOf(before), 0, node);
    }
    return a;
  }

  it('dragged no en children → []', () => {
    expect(crossingMoves(['A', 'B'], 'X', 1)).toEqual([]);
  });

  it('misma posición → [] (sin movimiento)', () => {
    const base = ['A', 'B', 'C', 'D', 'E'];
    expect(crossingMoves(base, 'B', 1)).toEqual([]);
  });

  it('25 combinaciones: ningún movimiento tiene como nodo a la arrastrada, y el orden final es correcto', () => {
    const NAMES = ['A', 'B', 'C', 'D', 'E'];
    for (let v = 0; v < 5; v++) {
      const dragged = NAMES[v];
      const base = [...NAMES];
      const others = NAMES.filter((x) => x !== dragged);
      for (let n = 0; n <= 4; n++) {
        const moves = crossingMoves(base, dragged, n);
        // (1) La pill arrastrada nunca es nodo de un movimiento.
        expect(moves.map((m) => m.node)).not.toContain(dragged);
        // (2) El orden resultante es correcto.
        const expected = [...others.slice(0, n), dragged, ...others.slice(n)];
        expect(applyMoves(base, moves)).toEqual(expected);
      }
    }
  });
});

/* ---------- shouldReorder ---------- */

describe('shouldReorder', () => {
  it('primer reordenamiento (lastReorderPt = null) → true', () => {
    expect(shouldReorder({ x: 50, y: 50 }, null)).toBe(true);
  });

  it('puntero quieto en el mismo punto → false', () => {
    const pt = { x: 50, y: 50 };
    expect(shouldReorder(pt, pt)).toBe(false);
  });

  it('distancia menor que SLOP_PX → false', () => {
    expect(shouldReorder({ x: 50 + SLOP_PX - 1, y: 50 }, { x: 50, y: 50 })).toBe(false);
  });

  it('distancia exactamente SLOP_PX → true', () => {
    expect(shouldReorder({ x: 50 + SLOP_PX, y: 50 }, { x: 50, y: 50 })).toBe(true);
  });

  it('distancia mayor que SLOP_PX → true', () => {
    expect(shouldReorder({ x: 50 + SLOP_PX + 10, y: 50 }, { x: 50, y: 50 })).toBe(true);
  });
});
