import { describe, it, expect } from 'vitest';
import {
  findEmptySpot,
  compactTiles,
  resolveColGrowth,
  resolveColShrink,
  resolveRowGrowth,
  resolveRowShrink,
  moveTileTo,
  findNeighbor,
  pointToCell,
  rowDelta,
  autoScrollStep,
  resolveColGrowthLeft,
  resolveRowGrowthUp,
} from './layout.js';

describe('findEmptySpot', () => {
  it('devuelve la esquina superior izquierda en un grid vacío', () => {
    expect(findEmptySpot(2, 2, new Set())).toEqual({ col: 1, row: 1 });
  });

  it('salta las celdas ocupadas', () => {
    const occupied = new Set(['1,1', '2,1']);
    expect(findEmptySpot(1, 1, occupied)).toEqual({ col: 3, row: 1 });
  });

  it('respeta el límite de columnas del grid', () => {
    const occupied = new Set(['1,1', '2,1', '3,1', '4,1', '5,1']);
    // Ancho 2 no cabe en la última columna libre (col 6) de una fila de 6.
    expect(findEmptySpot(2, 1, occupied, 6)).toEqual({ col: 1, row: 2 });
  });

  it('con startRow, prioriza filas desde ahí y solo cae a filas previas si no hay hueco después', () => {
    const occupied = new Set(); // grid completamente vacío
    expect(findEmptySpot(1, 1, occupied, 6, 3)).toEqual({ col: 1, row: 3 });
  });

  it('con startRow, cae a filas anteriores si no hay hueco desde startRow en adelante', () => {
    // Ocupamos todas las filas 3..60 en la única columna posible para un
    // tile de colSpan=6 (grid de 6 cols), dejando libre solo la fila 1.
    const occupied = new Set();
    for (let r = 3; r <= 60; r++) occupied.add(`1,${r}`);
    expect(findEmptySpot(6, 1, occupied, 6, 3)).toEqual({ col: 1, row: 1 });
  });
});

describe('compactTiles', () => {
  it('elimina huecos reordenando en orden de lectura', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 2 },
      // Hueco en col 3-4, fila 1-2 (tile eliminado)
      { id: 'B', col: 5, row: 1, colSpan: 2, rowSpan: 2 },
    ];
    compactTiles(tiles);
    expect(tiles.find((t) => t.id === 'A')).toMatchObject({ col: 1, row: 1 });
    expect(tiles.find((t) => t.id === 'B')).toMatchObject({ col: 3, row: 1 });
  });

  it('mantiene colSpan/rowSpan intactos', () => {
    const tiles = [{ id: 'A', col: 4, row: 4, colSpan: 3, rowSpan: 2 }];
    compactTiles(tiles);
    expect(tiles[0]).toMatchObject({ col: 1, row: 1, colSpan: 3, rowSpan: 2 });
  });

  it('no genera solapes entre tiles de distintos tamaños', () => {
    const tiles = [
      { id: 'A', col: 5, row: 1, colSpan: 1, rowSpan: 1 },
      { id: 'B', col: 1, row: 1, colSpan: 4, rowSpan: 1 },
    ];
    compactTiles(tiles);
    const [a, b] = [tiles.find((t) => t.id === 'A'), tiles.find((t) => t.id === 'B')];
    const overlap =
      a.col < b.col + b.colSpan && a.col + a.colSpan > b.col &&
      a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
    expect(overlap).toBe(false);
  });
});

describe('resolveColGrowth (push)', () => {
  it('crece libremente cuando no hay vecino en el camino', () => {
    const tiles = [{ id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 1 }];
    const result = resolveColGrowth(tiles, 'A', 4);
    expect(result).toEqual({ colSpan: 4, pushed: [] });
  });

  it('empuja (encoge) al vecino de la derecha que estorba', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 3, rowSpan: 2 },
      { id: 'B', col: 4, row: 1, colSpan: 3, rowSpan: 2 },
    ];
    const result = resolveColGrowth(tiles, 'A', 5);
    expect(result.colSpan).toBe(5);
    expect(result.pushed).toEqual([
      { tile: tiles[1], col: 6, colSpan: 1 },
    ]);
  });

  it('retrocede al máximo alcanzable si el tamaño pedido dejaría al vecino en 0', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 3, rowSpan: 2 },
      { id: 'B', col: 4, row: 1, colSpan: 3, rowSpan: 2 },
    ];
    const result = resolveColGrowth(tiles, 'A', 6);
    expect(result.colSpan).toBe(5); // el máximo que deja a B con colSpan >= 1
    expect(result.pushed[0]).toMatchObject({ col: 6, colSpan: 1 });
  });

  it('no empuja tiles en otras filas', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 3, rowSpan: 1 },
      { id: 'B', col: 4, row: 2, colSpan: 3, rowSpan: 1 }, // fila distinta
    ];
    const result = resolveColGrowth(tiles, 'A', 6);
    expect(result).toEqual({ colSpan: 6, pushed: [] });
  });

  it('respeta el límite del grid (no crece más allá de gridCols)', () => {
    const tiles = [{ id: 'A', col: 5, row: 1, colSpan: 1, rowSpan: 1 }];
    const result = resolveColGrowth(tiles, 'A', 10, 6);
    expect(result.colSpan).toBe(2); // col 5 + colSpan 2 - 1 = 6 (borde del grid)
  });

  it('tileId inexistente devuelve null', () => {
    expect(resolveColGrowth([], 'nope', 3)).toBeNull();
  });
});

describe('resolveColShrink (expand del vecino)', () => {
  it('el vecino pegado al borde liberado se expande para llenar el hueco', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 5, rowSpan: 2 },
      { id: 'B', col: 6, row: 1, colSpan: 1, rowSpan: 2 },
    ];
    const result = resolveColShrink(tiles, 'A', 3);
    expect(result.colSpan).toBe(3);
    expect(result.pushed).toEqual([
      { tile: tiles[1], col: 4, colSpan: 3 },
    ]);
  });

  it('sin vecino pegado al borde, solo encoge sin efectos secundarios', () => {
    const tiles = [{ id: 'A', col: 1, row: 1, colSpan: 4, rowSpan: 1 }];
    const result = resolveColShrink(tiles, 'A', 2);
    expect(result).toEqual({ colSpan: 2, pushed: [] });
  });

  it('no expande vecinos que no estén exactamente pegados al borde', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 3, rowSpan: 1 },
      { id: 'B', col: 5, row: 1, colSpan: 2, rowSpan: 1 }, // deja hueco en col 4
    ];
    const result = resolveColShrink(tiles, 'A', 2);
    expect(result).toEqual({ colSpan: 2, pushed: [] });
  });
});

describe('resolveRowGrowth / resolveRowShrink (simétrico en filas)', () => {
  it('empuja hacia abajo al vecino que estorba', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 2 },
      // rowSpan 3 le da margen para encogerse a 1 y permitir el crecimiento completo de A.
      { id: 'B', col: 1, row: 3, colSpan: 2, rowSpan: 3 },
    ];
    const result = resolveRowGrowth(tiles, 'A', 4);
    expect(result.rowSpan).toBe(4);
    expect(result.pushed).toEqual([
      { tile: tiles[1], row: 5, rowSpan: 1 },
    ]);
  });

  it('retrocede al máximo alcanzable si el vecino no tiene margen suficiente', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 2 },
      { id: 'B', col: 1, row: 3, colSpan: 2, rowSpan: 2 },
    ];
    const result = resolveRowGrowth(tiles, 'A', 4);
    expect(result.rowSpan).toBe(3); // no llega a 4: dejaría a B en rowSpan 0
    expect(result.pushed).toEqual([
      { tile: tiles[1], row: 4, rowSpan: 1 },
    ]);
  });

  it('el vecino de abajo se expande hacia arriba al encoger', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 4 },
      { id: 'B', col: 1, row: 5, colSpan: 2, rowSpan: 1 },
    ];
    const result = resolveRowShrink(tiles, 'A', 2);
    expect(result.rowSpan).toBe(2);
    expect(result.pushed).toEqual([
      { tile: tiles[1], row: 3, rowSpan: 3 },
    ]);
  });

  it('rowSpan no tiene límite superior fijo (filas auto)', () => {
    const tiles = [{ id: 'A', col: 1, row: 1, colSpan: 1, rowSpan: 1 }];
    const result = resolveRowGrowth(tiles, 'A', 20);
    expect(result).toEqual({ rowSpan: 20, pushed: [] });
  });
});

describe('moveTileTo', () => {
  it('mover a espacio vacío no afecta a otros tiles', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 1 },
      { id: 'B', col: 3, row: 1, colSpan: 2, rowSpan: 1 },
    ];
    moveTileTo(tiles, 'A', 1, 5);
    expect(tiles.find((t) => t.id === 'A')).toMatchObject({ col: 1, row: 5 });
    expect(tiles.find((t) => t.id === 'B')).toMatchObject({ col: 3, row: 1 });
  });

  it('mover sobre un único tile de igual tamaño produce un swap', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 1 },
      { id: 'B', col: 3, row: 1, colSpan: 2, rowSpan: 1 },
    ];
    moveTileTo(tiles, 'A', 3, 1);
    expect(tiles.find((t) => t.id === 'A')).toMatchObject({ col: 3, row: 1 });
    expect(tiles.find((t) => t.id === 'B')).toMatchObject({ col: 1, row: 1 });
  });

  it('el tile desplazado busca hueco libre cerca de su propia fila, no arriba-izquierda por defecto', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: 'B', col: 3, row: 3, colSpan: 1, rowSpan: 1 },
    ];
    // Muevo A justo encima de B; B debería reubicarse cerca de la fila 3,
    // no saltar a la fila 1 (que además ya la dejó libre A).
    moveTileTo(tiles, 'A', 3, 3);
    const b = tiles.find((t) => t.id === 'B');
    expect(b.row).toBe(3);
    expect(b.col).not.toBe(3); // no puede quedar en la misma celda que A
  });

  it('nunca deja tiles solapados tras el movimiento', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 2, rowSpan: 2 },
      { id: 'B', col: 3, row: 1, colSpan: 2, rowSpan: 2 },
      { id: 'C', col: 5, row: 1, colSpan: 2, rowSpan: 2 },
    ];
    moveTileTo(tiles, 'C', 1, 1);
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i], b = tiles[j];
        const overlap =
          a.col < b.col + b.colSpan && a.col + a.colSpan > b.col &&
          a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
        expect(overlap).toBe(false);
      }
    }
  });

  it('tileId inexistente no lanza ni muta nada', () => {
    const tiles = [{ id: 'A', col: 1, row: 1, colSpan: 1, rowSpan: 1 }];
    expect(() => moveTileTo(tiles, 'nope', 5, 5)).not.toThrow();
    expect(tiles[0]).toMatchObject({ col: 1, row: 1 });
  });

  // La regresión del salto: en un grid denso, el único hueco de verdad
  // libre para el desplazado quedaba varias filas más abajo del contenido
  // y el tile "desaparecía" de lo visible. El origen que dejó vacío el
  // tile movido es un destino mejor cuando el hueco cercano no existe.
  it('en un grid denso el desplazado hace swap con el origen en vez de irse muy abajo', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 6, rowSpan: 2 },
      { id: 'D', col: 1, row: 3, colSpan: 6, rowSpan: 2 },
      { id: 'B', col: 7, row: 3, colSpan: 6, rowSpan: 2 },
      { id: 'G1', col: 1, row: 5, colSpan: 12, rowSpan: 2 },
      { id: 'G2', col: 1, row: 7, colSpan: 12, rowSpan: 2 },
      { id: 'G3', col: 1, row: 9, colSpan: 12, rowSpan: 2 },
    ];
    // A (fila 1) cae sobre B (fila 3). Para B no hay hueco en su fila
    // (D ocupa la izquierda) ni abajo (G1-G3 llenan hasta la fila 10):
    // sin swap terminaría en la fila 11, fuera de lo visible.
    moveTileTo(tiles, 'A', 7, 3);
    expect(tiles.find((t) => t.id === 'A')).toMatchObject({ col: 7, row: 3 });
    expect(tiles.find((t) => t.id === 'B')).toMatchObject({ col: 1, row: 1 });
    // El resto no se movió.
    expect(tiles.find((t) => t.id === 'D')).toMatchObject({ col: 1, row: 3 });
    expect(tiles.find((t) => t.id === 'G1')).toMatchObject({ col: 1, row: 5 });
  });

  it('con hueco cercano en su fila, el desplazado lo sigue prefiriendo al origen', () => {
    const tiles = [
      { id: 'A', col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: 'B', col: 3, row: 3, colSpan: 1, rowSpan: 1 },
    ];
    moveTileTo(tiles, 'A', 3, 3);
    const b = tiles.find((t) => t.id === 'B');
    expect(b.row).toBe(3); // no saltó a la fila 1 aunque A la dejó libre
  });
});

describe('findNeighbor', () => {
  // Layout 2x2:  A B
  //              C D
  const grid = [
    { id: 'A', col: 1, row: 1, colSpan: 6, rowSpan: 3 },
    { id: 'B', col: 7, row: 1, colSpan: 6, rowSpan: 3 },
    { id: 'C', col: 1, row: 4, colSpan: 6, rowSpan: 3 },
    { id: 'D', col: 7, row: 4, colSpan: 6, rowSpan: 3 },
  ];

  it('encuentra el vecino a la derecha, izquierda, arriba y abajo', () => {
    expect(findNeighbor(grid, 'A', 'right')).toBe('B');
    expect(findNeighbor(grid, 'B', 'left')).toBe('A');
    expect(findNeighbor(grid, 'A', 'down')).toBe('C');
    expect(findNeighbor(grid, 'C', 'up')).toBe('A');
  });

  it('devuelve null cuando no hay tile en esa dirección', () => {
    expect(findNeighbor(grid, 'A', 'left')).toBeNull();
    expect(findNeighbor(grid, 'A', 'up')).toBeNull();
    expect(findNeighbor(grid, 'D', 'right')).toBeNull();
    expect(findNeighbor(grid, 'D', 'down')).toBeNull();
  });

  it('prefiere el vecino más alineado, no solo el más cercano en línea recta', () => {
    // A grande a la izquierda; B arriba-derecha, C abajo-derecha bien
    // alineado con A. Desde A hacia la derecha debe elegir el más alineado.
    const tiles = [
      { id: 'A', col: 1, row: 3, colSpan: 6, rowSpan: 2 },
      { id: 'B', col: 7, row: 1, colSpan: 6, rowSpan: 1 },
      { id: 'C', col: 7, row: 3, colSpan: 6, rowSpan: 2 },
    ];
    expect(findNeighbor(tiles, 'A', 'right')).toBe('C');
  });

  it('tileId inexistente devuelve null', () => {
    expect(findNeighbor(grid, 'nope', 'right')).toBeNull();
  });
});

describe('pointToCell (034)', () => {
  it('scrollTop = 0 da la misma celda que el cálculo sin scroll', () => {
    // x=0 → col 1; y=0 → row 1
    expect(pointToCell({ x: 0, y: 0, scrollTop: 0, colStep: 100, rowStep: 80 }))
      .toEqual({ col: 1, row: 1 });
  });

  it('scrollTop = 312 con rowStep = 78 e y = 10 → fila 5', () => {
    // floor((10 + 312) / 78) + 1 = floor(4.128) + 1 = 5
    expect(pointToCell({ x: 0, y: 10, scrollTop: 312, colStep: 100, rowStep: 78 }))
      .toEqual({ col: 1, row: 5 });
  });

  it('nunca devuelve fila o columna < 1', () => {
    expect(pointToCell({ x: -200, y: -200, scrollTop: 0, colStep: 100, rowStep: 80 }))
      .toEqual({ col: 1, row: 1 });
  });

  it('en el límite exacto de columna cae en la siguiente (floor+1, no ceil)', () => {
    // x=100 con colStep=100: floor(100/100)+1 = 2; ceil(100/100) = 1 → distingue formulas
    expect(pointToCell({ x: 100, y: 0, scrollTop: 0, colStep: 100, rowStep: 80 }))
      .toEqual({ col: 2, row: 1 });
  });

  it('fila en el límite exacto de fila cae en la siguiente (floor+1, no ceil)', () => {
    // scrollTop=78 con rowStep=78: floor((0+78)/78)+1 = 1+1 = 2; ceil(78/78) = 1
    expect(pointToCell({ x: 0, y: 0, scrollTop: 78, colStep: 100, rowStep: 78 }))
      .toEqual({ col: 1, row: 2 });
  });
});

describe('rowDelta (034)', () => {
  it('puntero quieto y scroll avanzando 156 px (rowHeight 78) → +2', () => {
    expect(rowDelta({ startY: 100, startScroll: 0, y: 100, scroll: 156, rowHeight: 78 }))
      .toBe(2);
  });

  it('dy = +120 con rowHeight 78 → +2 (round, no floor ni trunc)', () => {
    // round(120/78) = round(1.538) = 2; floor y trunc dan 1
    expect(rowDelta({ startY: 0, startScroll: 0, y: 120, scroll: 0, rowHeight: 78 }))
      .toBe(2);
  });

  it('dy = -100 con rowHeight 78 → -1 (round, no floor)', () => {
    // round(-100/78) = round(-1.282) = -1; floor da -2
    expect(rowDelta({ startY: 100, startScroll: 0, y: 0, scroll: 0, rowHeight: 78 }))
      .toBe(-1);
  });

  it('sin scroll es igual que Math.round(dy / rowHeight)', () => {
    expect(rowDelta({ startY: 100, startScroll: 0, y: 200, scroll: 0, rowHeight: 78 }))
      .toBe(Math.round((200 - 100) / 78));
  });
});

describe('autoScrollStep (034)', () => {
  it('en el medio → 0', () => {
    expect(autoScrollStep(500, 0, 1000)).toBe(0);
  });

  it('pegado al borde de abajo → positivo; pegado al borde de arriba → negativo', () => {
    expect(autoScrollStep(1000, 0, 1000)).toBeGreaterThan(0);
    expect(autoScrollStep(0, 0, 1000)).toBeLessThan(0);
  });

  it('más cerca del borde → paso mayor, nunca más que maxStep', () => {
    const s1 = autoScrollStep(970, 0, 1000);  // depth = 10
    const s2 = autoScrollStep(1000, 0, 1000); // depth = 40 → maxStep
    expect(s2).toBeGreaterThan(s1);
    expect(s1).toBeLessThanOrEqual(20);
    expect(s2).toBeLessThanOrEqual(20);
  });

  it('tope abajo: muy fuera del área no supera maxStep', () => {
    // sin Math.min: depth=1200-960=240, round(240/40*20)=120 > 20
    expect(autoScrollStep(1200, 0, 1000)).toBeLessThanOrEqual(20);
  });

  it('tope arriba: muy fuera del área no supera -maxStep', () => {
    // sin Math.min: depth=40-(-200)=240, round(240/40*20)=120 → -120 < -20
    expect(autoScrollStep(-200, 0, 1000)).toBeGreaterThanOrEqual(-20);
  });
});

// ---------- helpers para 035 ----------
function t035(id, col, row, colSpan, rowSpan) {
  return { id, col, row, colSpan, rowSpan };
}
function rightOf(tile) { return (tile.col || 1) + (tile.colSpan || 1) - 1; }
function bottomOf(tile) { return (tile.row || 1) + (tile.rowSpan || 1) - 1; }

describe('resolveColGrowthLeft (035)', () => {
  it('espacio libre: col baja, colSpan sube, borde derecho igual', () => {
    const tiles = [t035('A', 5, 1, 3, 2)];
    const r = resolveColGrowthLeft(tiles, 'A', 4);
    expect(r).not.toBeNull();
    expect(r.colSpan).toBe(4);
    expect(r.col).toBe(4);
    expect(rightOf(r)).toBe(rightOf(tiles[0])); // borde derecho fijo
    expect(r.pushed).toHaveLength(0);
  });

  it('vecino a la izquierda: mantiene su col y achica su colSpan', () => {
    // A: cols 5-7 (right=7). B: cols 2-4 (adjacent). A crece a colSpan=4 → col=4.
    const tiles = [t035('A', 5, 1, 3, 2), t035('B', 2, 1, 3, 2)];
    const r = resolveColGrowthLeft(tiles, 'A', 4);
    expect(r).not.toBeNull();
    expect(r.col).toBe(4);
    expect(r.pushed).toHaveLength(1);
    const pb = r.pushed[0];
    expect(pb.col).toBe(tiles[1].col); // left border de B se preserva
    expect(pb.colSpan).toBeLessThan(tiles[1].colSpan);
  });

  it('pide de más: queda en col=1, colSpan=bordeDerecho', () => {
    const tiles = [t035('A', 5, 1, 3, 2)];
    const r = resolveColGrowthLeft(tiles, 'A', 20);
    expect(r).not.toBeNull();
    expect(r.col).toBe(1);
    expect(r.colSpan).toBe(rightOf(tiles[0])); // bordeDerecho = 7
  });

  it('vecino sin margen: retrocede al máximo posible', () => {
    // B ocupa la totalidad de su colSpan=2 pegado a A; A no puede desplazarlo más de 1
    const tiles = [t035('A', 5, 1, 3, 2), t035('B', 3, 1, 2, 2)];
    const r = resolveColGrowthLeft(tiles, 'A', 5);
    expect(r).not.toBeNull();
    expect(r.col).toBeGreaterThan(1); // no llega a 1 porque B no cabe
    expect(r.col + r.colSpan - 1).toBe(rightOf(tiles[0])); // borde derecho fijo
  });

  it('tiles en otras filas no se tocan', () => {
    // C está en fila distinta, mismas cols → no debe aparecer en pushed
    const tiles = [t035('A', 5, 1, 3, 2), t035('C', 2, 4, 3, 1)];
    const r = resolveColGrowthLeft(tiles, 'A', 4);
    expect(r).not.toBeNull();
    expect(r.pushed).toHaveLength(0);
  });

  it('achicar desde la izquierda: vecino pegado se estira hasta el nuevo borde', () => {
    // A: cols 5-7. B: cols 3-4 (right=4, right+1=5=A.col). A achica a colSpan=2 (col=6).
    // B debe expandirse para cubrir el col liberado (5).
    const tiles = [t035('A', 5, 1, 3, 2), t035('B', 3, 1, 2, 2)];
    const r = resolveColGrowthLeft(tiles, 'A', 2);
    expect(r).not.toBeNull();
    expect(r.col).toBe(6);
    expect(r.colSpan).toBe(2);
    expect(r.pushed).toHaveLength(1);
    const pb = r.pushed[0];
    expect(pb.tile.id).toBe('B');
    expect(pb.col).toBe(tiles[1].col); // B no se mueve a la izquierda
    expect(pb.colSpan).toBeGreaterThan(tiles[1].colSpan); // B se estira
  });
});

describe('resolveRowGrowthUp (035)', () => {
  it('espacio libre: row baja, rowSpan sube, borde de abajo igual', () => {
    const tiles = [t035('A', 1, 3, 3, 3)]; // A: rows 3-5
    const r = resolveRowGrowthUp(tiles, 'A', 5);
    expect(r).not.toBeNull();
    expect(r.rowSpan).toBe(5);
    expect(r.row).toBe(1);
    expect(bottomOf(r)).toBe(bottomOf(tiles[0]));
  });

  it('pide de más: queda en row=1, rowSpan=bordeDeBajo', () => {
    const tiles = [t035('A', 1, 3, 3, 3)];
    const r = resolveRowGrowthUp(tiles, 'A', 99);
    expect(r).not.toBeNull();
    expect(r.row).toBe(1);
    expect(r.rowSpan).toBe(bottomOf(tiles[0]));
  });

  it('vecino arriba: mantiene su row y achica su rowSpan', () => {
    // A: rows 3-5. B: rows 1-2. A crece hacia arriba; B.row no cambia.
    const tiles = [t035('A', 1, 3, 3, 3), t035('B', 1, 1, 3, 2)];
    const r = resolveRowGrowthUp(tiles, 'A', 5);
    expect(r).not.toBeNull();
    expect(r.pushed).toHaveLength(1);
    const pb = r.pushed[0];
    expect(pb.row).toBe(tiles[1].row); // top border de B se preserva
    expect(pb.rowSpan).toBeLessThan(tiles[1].rowSpan);
  });

  it('achicar desde arriba: vecino de arriba se estira hacia abajo', () => {
    // A: rows 3-5. B: rows 1-2 (bottom+1=3=A.row). A achica a rowSpan=2 (row=4).
    const tiles = [t035('A', 1, 3, 3, 3), t035('B', 1, 1, 3, 2)];
    const r = resolveRowGrowthUp(tiles, 'A', 2);
    expect(r).not.toBeNull();
    expect(r.row).toBe(4);
    expect(r.pushed).toHaveLength(1);
    const pb = r.pushed[0];
    expect(pb.tile.id).toBe('B');
    expect(pb.row).toBe(tiles[1].row); // B no sube
    expect(pb.rowSpan).toBeGreaterThan(tiles[1].rowSpan); // B se estira
  });
});

describe('resolveColGrowthLeft / resolveRowGrowthUp (035) — invariantes', () => {
  it('pushed apunta a === tiles reales, no a copias del espejo', () => {
    const tiles = [t035('A', 5, 1, 3, 2), t035('B', 2, 1, 3, 2)];
    const r = resolveColGrowthLeft(tiles, 'A', 4);
    expect(r.pushed[0].tile).toBe(tiles[1]); // referencia exacta
  });

  it('resolveRowGrowthUp: pushed apunta a === tile real, no a copia del espejo', () => {
    // A: rows 3-5. B: rows 1-2 (vecino de arriba). A crece hacia arriba.
    const tiles = [t035('A', 1, 3, 3, 3), t035('B', 1, 1, 3, 2)];
    const r = resolveRowGrowthUp(tiles, 'A', 5);
    expect(r).not.toBeNull();
    expect(r.pushed).toHaveLength(1);
    expect(r.pushed[0].tile).toBe(tiles[1]); // referencia exacta al tile real
  });

  it('ninguna operación deja superposiciones en un layout de 5 tiles', () => {
    const tiles = [
      t035('A', 5, 1, 3, 2), t035('B', 2, 1, 3, 2),
      t035('C', 9, 1, 4, 2), t035('D', 1, 3, 6, 2), t035('E', 7, 3, 6, 2),
    ];
    const r = resolveColGrowthLeft(tiles, 'A', 5);
    if (!r) return; // si no cabe, no hay superposición
    // Aplicar result a un clon y verificar
    const applied = tiles.map((t) => {
      if (t.id === 'A') return { ...t, col: r.col, colSpan: r.colSpan };
      const p = r.pushed.find((x) => x.tile.id === t.id);
      return p ? { ...t, col: p.col, colSpan: p.colSpan } : t;
    });
    for (let i = 0; i < applied.length; i++) {
      for (let j = i + 1; j < applied.length; j++) {
        const a = applied[i], b = applied[j];
        const colOvlp = a.col < b.col + b.colSpan && a.col + a.colSpan > b.col;
        const rowOvlp = a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
        expect(colOvlp && rowOvlp).toBe(false);
      }
    }
  });

  it('la entrada no se muta', () => {
    const tiles = [t035('A', 5, 1, 3, 2), t035('B', 2, 1, 3, 2)];
    const snap = tiles.map((t) => ({ ...t }));
    resolveColGrowthLeft(tiles, 'A', 4);
    resolveRowGrowthUp(tiles, 'A', 5);
    tiles.forEach((t, i) => expect(t).toEqual(snap[i]));
  });
});
