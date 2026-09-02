/**
 * src/renderer/core/layout.js
 * --------------------------------------------------------------
 * Utilidades puras de posicionamiento para el Bento Grid manual
 * (12 columnas, filas auto). Compartidas entre bentoGrid.js
 * (render/posicionamiento en vivo) y profileManager.js (reacomodo
 * al eliminar un tile).
 * --------------------------------------------------------------
 */

export const GRID_COLS = 12;

/**
 * Busca el primer hueco libre (orden de lectura: fila, luego columna).
 * `startRow` permite sesgar la búsqueda para empezar cerca de una fila
 * preferida (p.ej. la posición previa de un tile desplazado) en vez de
 * saltar siempre a la esquina superior izquierda.
 */
export function findEmptySpot(colSpan, rowSpan, occupied, gridCols = GRID_COLS, startRow = 1) {
  for (let r = startRow; r <= 60; r++) {
    const spot = scanRow(r, colSpan, rowSpan, occupied, gridCols);
    if (spot) return spot;
  }
  for (let r = 1; r < startRow; r++) {
    const spot = scanRow(r, colSpan, rowSpan, occupied, gridCols);
    if (spot) return spot;
  }
  return { col: 1, row: 1 };
}

function scanRow(r, colSpan, rowSpan, occupied, gridCols) {
  for (let c = 1; c <= gridCols - colSpan + 1; c++) {
    let free = true;
    for (let dr = 0; dr < rowSpan && free; dr++) {
      for (let dc = 0; dc < colSpan && free; dc++) {
        if (occupied.has(`${c + dc},${r + dr}`)) free = false;
      }
    }
    if (free) return { col: c, row: r };
  }
  return null;
}

/**
 * Reempaqueta TODOS los tiles desde la esquina superior izquierda,
 * en orden de lectura (fila, columna) según su posición actual,
 * eliminando huecos dejados por tiles eliminados. Muta y devuelve
 * los mismos objetos tile (col/row actualizados).
 */
export function compactTiles(tiles, gridCols = GRID_COLS) {
  const ordered = [...tiles].sort((a, b) => {
    const ra = a.row || 1;
    const rb = b.row || 1;
    if (ra !== rb) return ra - rb;
    return (a.col || 1) - (b.col || 1);
  });

  const occupied = new Set();
  for (const tile of ordered) {
    const cs = tile.colSpan || 1;
    const rs = tile.rowSpan || 1;
    const pos = findEmptySpot(cs, rs, occupied, gridCols);
    tile.col = pos.col;
    tile.row = pos.row;
    for (let r = pos.row; r < pos.row + rs; r++)
      for (let c = pos.col; c < pos.col + cs; c++)
        occupied.add(`${c},${r}`);
  }
  return ordered;
}

/* ===================== Push resize ===================== */
// Al crecer un tile hacia un vecino, el vecino se encoge (en vez de
// bloquear el resize) hasta un mínimo de 1 columna/fila. Si ni con eso
// cabe, se prueba con un tamaño de crecimiento menor.

function rectOf(tile, overrides) {
  return {
    id: tile.id,
    col: overrides?.col ?? (tile.col || 1),
    row: overrides?.row ?? (tile.row || 1),
    colSpan: overrides?.colSpan ?? (tile.colSpan || 1),
    rowSpan: overrides?.rowSpan ?? (tile.rowSpan || 1),
  };
}

function rectsOverlap(a, b) {
  return (
    a.col < b.col + b.colSpan && a.col + a.colSpan > b.col &&
    a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row
  );
}

/** Verifica que, aplicando `overrides` (tileId -> rect parcial), ningún tile se solape. */
function noOverlapsWith(tiles, overrides) {
  const finals = tiles.map((t) => rectOf(t, overrides.get(t.id)));
  for (let i = 0; i < finals.length; i++) {
    for (let j = i + 1; j < finals.length; j++) {
      if (rectsOverlap(finals[i], finals[j])) return false;
    }
  }
  return true;
}

/**
 * Intenta crecer el colSpan de `tileId` hasta `desiredCS`, encogiendo
 * los tiles a la derecha que estorben (push). Si el tamaño deseado no
 * cabe, prueba tamaños menores hasta encontrar uno válido.
 * Devuelve `{ colSpan, pushed: [{ tile, col, colSpan }] }`.
 */
export function resolveColGrowth(tiles, tileId, desiredCS, gridCols = GRID_COLS) {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return null;
  const col = tile.col || 1;
  const row = tile.row || 1;
  const rowSpan = tile.rowSpan || 1;
  const current = tile.colSpan || 1;
  const maxCS = Math.min(desiredCS, gridCols - col + 1);

  if (maxCS < current) return resolveColShrink(tiles, tileId, maxCS);
  if (maxCS === current) return { colSpan: current, pushed: [] };

  for (let cs = maxCS; cs > current; cs--) {
    const pushed = tryColSize(tiles, tile, col, row, rowSpan, cs);
    if (pushed) return { colSpan: cs, pushed };
  }
  return null;
}

/**
 * Al encoger `tileId`, el/los vecino(s) que estaban pegados al borde
 * que se libera se expanden para ocupar el espacio (en vez de dejarlo
 * vacío). Devuelve `{ colSpan, pushed: [{ tile, col, colSpan }] }`.
 */
export function resolveColShrink(tiles, tileId, desiredCS) {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return null;
  const col = tile.col || 1;
  const row = tile.row || 1;
  const rowSpan = tile.rowSpan || 1;
  const current = tile.colSpan || 1;
  const newCS = Math.max(1, Math.min(desiredCS, current));
  if (newCS >= current) return { colSpan: current, pushed: [] };

  const oldRight = col + current - 1;
  const freedLeft = col + newCS;
  const pushed = [];
  for (const other of tiles) {
    if (other.id === tile.id) continue;
    const oC = other.col || 1;
    const oR = other.row || 1;
    const oCS = other.colSpan || 1;
    const oRS = other.rowSpan || 1;
    const rowsOverlap = row < oR + oRS && row + rowSpan > oR;
    if (!rowsOverlap || oC !== oldRight + 1) continue;
    pushed.push({ tile: other, col: freedLeft, colSpan: oCS + (oldRight - freedLeft + 1) });
  }
  return { colSpan: newCS, pushed };
}

function tryColSize(tiles, tile, col, row, rowSpan, cs) {
  const newRight = col + cs - 1;
  const pushes = [];
  for (const other of tiles) {
    if (other.id === tile.id) continue;
    const oC = other.col || 1;
    const oR = other.row || 1;
    const oCS = other.colSpan || 1;
    const oRS = other.rowSpan || 1;
    const rowsOverlap = row < oR + oRS && row + rowSpan > oR;
    if (!rowsOverlap || oC <= col || oC > newRight) continue;
    const pushedCol = newRight + 1;
    const pushedSpan = oC + oCS - pushedCol;
    if (pushedSpan < 1) return null;
    pushes.push({ tile: other, col: pushedCol, colSpan: pushedSpan });
  }

  const overrides = new Map([[tile.id, { colSpan: cs }]]);
  for (const p of pushes) overrides.set(p.tile.id, { col: p.col, colSpan: p.colSpan });
  return noOverlapsWith(tiles, overrides) ? pushes : null;
}

/**
 * Igual que `resolveColGrowth` pero para rowSpan, empujando hacia abajo.
 * Devuelve `{ rowSpan, pushed: [{ tile, row, rowSpan }] }`.
 */
export function resolveRowGrowth(tiles, tileId, desiredRS) {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return null;
  const col = tile.col || 1;
  const row = tile.row || 1;
  const colSpan = tile.colSpan || 1;
  const current = tile.rowSpan || 1;
  const maxRS = Math.max(1, desiredRS);

  if (maxRS < current) return resolveRowShrink(tiles, tileId, maxRS);
  if (maxRS === current) return { rowSpan: current, pushed: [] };

  for (let rs = maxRS; rs > current; rs--) {
    const pushed = tryRowSize(tiles, tile, col, row, colSpan, rs);
    if (pushed) return { rowSpan: rs, pushed };
  }
  return null;
}

/**
 * Igual que `resolveColShrink` pero para rowSpan: expande al vecino
 * pegado al borde inferior que se libera al encoger `tileId`.
 * Devuelve `{ rowSpan, pushed: [{ tile, row, rowSpan }] }`.
 */
export function resolveRowShrink(tiles, tileId, desiredRS) {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return null;
  const col = tile.col || 1;
  const row = tile.row || 1;
  const colSpan = tile.colSpan || 1;
  const current = tile.rowSpan || 1;
  const newRS = Math.max(1, Math.min(desiredRS, current));
  if (newRS >= current) return { rowSpan: current, pushed: [] };

  const oldBottom = row + current - 1;
  const freedTop = row + newRS;
  const pushed = [];
  for (const other of tiles) {
    if (other.id === tile.id) continue;
    const oC = other.col || 1;
    const oR = other.row || 1;
    const oCS = other.colSpan || 1;
    const oRS = other.rowSpan || 1;
    const colsOverlap = col < oC + oCS && col + colSpan > oC;
    if (!colsOverlap || oR !== oldBottom + 1) continue;
    pushed.push({ tile: other, row: freedTop, rowSpan: oRS + (oldBottom - freedTop + 1) });
  }
  return { rowSpan: newRS, pushed };
}

function tryRowSize(tiles, tile, col, row, colSpan, rs) {
  const newBottom = row + rs - 1;
  const pushes = [];
  for (const other of tiles) {
    if (other.id === tile.id) continue;
    const oC = other.col || 1;
    const oR = other.row || 1;
    const oCS = other.colSpan || 1;
    const oRS = other.rowSpan || 1;
    const colsOverlap = col < oC + oCS && col + colSpan > oC;
    if (!colsOverlap || oR <= row || oR > newBottom) continue;
    const pushedRow = newBottom + 1;
    const pushedSpan = oR + oRS - pushedRow;
    if (pushedSpan < 1) return null;
    pushes.push({ tile: other, row: pushedRow, rowSpan: pushedSpan });
  }

  const overrides = new Map([[tile.id, { rowSpan: rs }]]);
  for (const p of pushes) overrides.set(p.tile.id, { row: p.row, rowSpan: p.rowSpan });
  return noOverlapsWith(tiles, overrides) ? pushes : null;
}

/* ===================== Navegación espacial (teclado) ===================== */

function centerOf(t) {
  return {
    x: (t.col || 1) + (t.colSpan || 1) / 2,
    y: (t.row || 1) + (t.rowSpan || 1) / 2,
  };
}

/**
 * Devuelve el id del tile vecino más cercano en la dirección dada
 * ('left' | 'right' | 'up' | 'down'), o null si no hay ninguno.
 *
 * Heurística tipo tiling WM: entre los tiles que están del lado correcto
 * (según el centro), elige el de menor "costo" = distancia en el eje
 * primario + 2× el desalineamiento en el eje perpendicular. Así prioriza
 * el que está más alineado con el actual, no solo el más cercano en línea
 * recta. Puro: no toca el DOM (testeable en layout.test.js).
 */
export function findNeighbor(tiles, tileId, dir) {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return null;
  const c = centerOf(tile);

  let bestId = null;
  let bestScore = Infinity;
  for (const other of tiles) {
    if (other.id === tileId) continue;
    const o = centerOf(other);
    const dx = o.x - c.x;
    const dy = o.y - c.y;

    let inDir = false;
    let primary = 0;
    let perp = 0;
    if (dir === 'right') { inDir = dx > 0.01; primary = dx; perp = Math.abs(dy); }
    else if (dir === 'left') { inDir = dx < -0.01; primary = -dx; perp = Math.abs(dy); }
    else if (dir === 'down') { inDir = dy > 0.01; primary = dy; perp = Math.abs(dx); }
    else if (dir === 'up') { inDir = dy < -0.01; primary = -dy; perp = Math.abs(dx); }
    if (!inDir) continue;

    const score = primary + perp * 2;
    if (score < bestScore) { bestScore = score; bestId = other.id; }
  }
  return bestId;
}

/* ===================== Mover (drag libre) ===================== */

/**
 * Mueve `tileId` a la celda (`desiredCol`,`desiredRow`) — su tamaño no
 * cambia. Cualquier otro tile que quede tapado intenta primero el lugar
 * de ORIGEN del tile movido (swap, que es lo que uno espera al soltar
 * A sobre B) y recién si no cabe ahí busca el primer hueco libre
 * cercano a su propia fila. Muta los tiles en el lugar; no devuelve nada.
 */
export function moveTileTo(tiles, tileId, desiredCol, desiredRow, gridCols = GRID_COLS) {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return;

  const cs = tile.colSpan || 1;
  const rs = tile.rowSpan || 1;
  const col = Math.max(1, Math.min(desiredCol, gridCols - cs + 1));
  const row = Math.max(1, desiredRow);

  const originCol = tile.col || 1;
  const originRow = tile.row || 1;

  tile.col = col;
  tile.row = row;

  // TODOS los tiles cuentan como ocupados desde el arranque, no solo los
  // ya procesados: si un desplazado pudiera caer sobre uno todavía no
  // visitado, ese saldría despedido en cascada — que era exactamente el
  // tile que "saltaba de lo visible y quedaba muy abajo". Al procesar
  // cada uno se liberan sus propias celdas y se registran las nuevas.
  const cellsOf = (c0, r0, cSpan, rSpan, fn) => {
    for (let r = r0; r < r0 + rSpan; r++)
      for (let c = c0; c < c0 + cSpan; c++)
        fn(`${c},${r}`);
  };

  const occupied = new Set();
  cellsOf(col, row, cs, rs, (k) => occupied.add(k));

  const others = tiles
    .filter((t) => t.id !== tileId)
    .sort((a, b) => {
      const ra = a.row || 1;
      const rb = b.row || 1;
      if (ra !== rb) return ra - rb;
      return (a.col || 1) - (b.col || 1);
    });

  for (const o of others) {
    cellsOf(o.col || 1, o.row || 1, o.colSpan || 1, o.rowSpan || 1, (k) => occupied.add(k));
  }

  const fitsAt = (c0, r0, cSpan, rSpan) => {
    if (c0 < 1 || c0 + cSpan - 1 > gridCols || r0 < 1) return false;
    for (let r = r0; r < r0 + rSpan; r++)
      for (let c = c0; c < c0 + cSpan; c++)
        if (occupied.has(`${c},${r}`)) return false;
    return true;
  };

  for (const other of others) {
    const oCS = other.colSpan || 1;
    const oRS = other.rowSpan || 1;
    const oC = other.col || 1;
    const oR = other.row || 1;

    // Libera sus propias celdas antes de decidir: su lugar actual no
    // puede estorbarse a sí mismo. Ojo: si el tile movido tapa parte de
    // estas celdas, volver a marcarlas lo haría "flotar" — por eso el
    // tile movido re-marca las suyas al final de cada vuelta.
    cellsOf(oC, oR, oCS, oRS, (k) => occupied.delete(k));
    cellsOf(col, row, cs, rs, (k) => occupied.add(k));

    let pos;
    if (fitsAt(oC, oR, oCS, oRS)) {
      pos = { col: oC, row: oR };
    } else {
      // Entre el primer hueco libre y el ORIGEN que dejó vacío el tile
      // movido, gana el más cercano a la fila actual del desplazado. El
      // hueco cercano sigue teniendo prioridad cuando existe (no saltar
      // de fila porque sí), pero si lo único libre queda lejos, el
      // desplazado hace swap con el origen en vez de terminar "muy abajo".
      const near = findEmptySpot(oCS, oRS, occupied, gridCols, oR);
      const originWins = fitsAt(originCol, originRow, oCS, oRS)
        && Math.abs(originRow - oR) < Math.abs(near.row - oR);
      pos = originWins ? { col: originCol, row: originRow } : near;
    }

    other.col = pos.col;
    other.row = pos.row;
    cellsOf(pos.col, pos.row, oCS, oRS, (k) => occupied.add(k));
  }
}
