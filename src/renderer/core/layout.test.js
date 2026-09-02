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
