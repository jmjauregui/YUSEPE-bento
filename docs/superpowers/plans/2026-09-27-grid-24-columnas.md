# Grid de 24 columnas · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duplicar la resolución del Bento Grid (12→24 columnas, filas 70→35 px) con migración automática de perfiles a `gridVersion: 3`, sin que ningún workspace existente cambie de aspecto.

**Architecture:** Las funciones de layout ya reciben `gridCols` como parámetro y el renderer lee `GRID_COLS`/`MIN_ROW_PX` de constantes, así que el cambio es: dos constantes, una migración encadenada por versión en `storage.js`, y los tamaños por defecto de tiles nuevos ×2. Spec: `docs/superpowers/specs/2026-09-27-grid-24-columnas-design.md`.

**Tech Stack:** Electron 33, JS ESM sin framework, vitest.

---

### Task 1: Migración encadenada a gridVersion 3 (storage.js)

**Files:**
- Modify: `src/main/storage.js:16-34`
- Test: `src/main/storage.test.js:207-250`

- [ ] **Step 1: Cambiar las expectativas existentes a v3 y agregar los casos nuevos**

Reemplazar el bloque `describe('ProfileStorage.load — migración de grid (6→12 columnas)'` por:

```js
describe('ProfileStorage.load — migración de grid (v1 6 col → v2 12 col → v3 24 col)', () => {
  async function writeRawProfile(id, overrides = {}) {
    const profile = {
      id, name: 'Legacy', cwd: null, createdAt: 1, updatedAt: 1, tiles: [],
      ...overrides,
    };
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  it('v1 (sin gridVersion) escala x4 en total: pasa por v2 y v3', async () => {
    await writeRawProfile('legacy-1', {
      tiles: [{ id: 't1', col: 3, row: 2, colSpan: 2, rowSpan: 1 }],
    });
    const loaded = await storage.load('legacy-1');
    expect(loaded.gridVersion).toBe(3);
    // (3-1)*4+1 = 9 · (2-1)*4+1 = 5 · 2*4 = 8 · 1*4 = 4
    expect(loaded.tiles[0]).toMatchObject({ col: 9, row: 5, colSpan: 8, rowSpan: 4 });
  });

  it('v2 escala x2 y queda en v3', async () => {
    await writeRawProfile('v2-1', {
      gridVersion: 2,
      tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }],
    });
    const loaded = await storage.load('v2-1');
    expect(loaded.gridVersion).toBe(3);
    expect(loaded.tiles[0]).toMatchObject({ col: 9, row: 5, colSpan: 8, rowSpan: 4 });
  });

  it('persiste la migración: cargar de nuevo no vuelve a escalar', async () => {
    await writeRawProfile('legacy-2', {
      gridVersion: 2,
      tiles: [{ id: 't1', col: 1, row: 1, colSpan: 6, rowSpan: 2 }],
    });
    await storage.load('legacy-2');
    const loadedAgain = await storage.load('legacy-2');
    expect(loadedAgain.tiles[0]).toMatchObject({ col: 1, row: 1, colSpan: 12, rowSpan: 4 });
  });

  it('perfiles ya en gridVersion 3 no se tocan', async () => {
    await writeRawProfile('current-1', {
      gridVersion: 3,
      tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }],
    });
    const loaded = await storage.load('current-1');
    expect(loaded.tiles[0]).toMatchObject({ col: 5, row: 3, colSpan: 4, rowSpan: 2 });
  });

  it('perfiles de una app más nueva (gridVersion > 3) no se tocan ni se reescriben', async () => {
    await writeRawProfile('future-1', {
      gridVersion: 4,
      tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }],
    });
    const loaded = await storage.load('future-1');
    expect(loaded.gridVersion).toBe(4);
    expect(loaded.tiles[0]).toMatchObject({ col: 5, row: 3, colSpan: 4, rowSpan: 2 });
  });

  it('un gridVersion inválido se trata como v1', async () => {
    await writeRawProfile('bad-1', {
      gridVersion: 'x',
      tiles: [{ id: 't1', col: 1, row: 1, colSpan: 1, rowSpan: 1 }],
    });
    const loaded = await storage.load('bad-1');
    expect(loaded.gridVersion).toBe(3);
    expect(loaded.tiles[0]).toMatchObject({ col: 1, row: 1, colSpan: 4, rowSpan: 4 });
  });

  it('tiles sin posición solo escalan los campos presentes', async () => {
    await writeRawProfile('partial-1', {
      gridVersion: 2,
      tiles: [{ id: 't1', colSpan: 3, rowSpan: 5 }],
    });
    const loaded = await storage.load('partial-1');
    expect(loaded.tiles[0]).toEqual({ id: 't1', colSpan: 6, rowSpan: 10 });
  });
});
```

Además, en los tests anteriores del archivo que dicen `gridVersion: 2` como "versión actual" (líneas ~146, ~162, ~171) cambiar `2` por `3`, y donde se compruebe `expect(imported.gridVersion).toBe(2)` poner `3`.

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/main/storage.test.js`
Expected: FAIL en los casos v3 (hoy devuelve gridVersion 2).

- [ ] **Step 3: Implementar la migración encadenada**

Reemplazar las líneas 16-34 de `src/main/storage.js` por:

```js
// Historial de resoluciones del grid (ver core/layout.js y bentoGrid.js):
//   v1: 6 columnas / filas de 140px (perfiles sin `gridVersion`)
//   v2: 12 columnas / filas de 70px
//   v3: 24 columnas / filas de 35px
// Cada salto duplica los segmentos en ambos ejes con la misma resolución
// física, así que un perfil migrado se ve idéntico. La migración corre una
// sola vez al cargar, encadenando las versiones que falten, y se persiste.
const GRID_VERSION = 3;
/** Factor de escala para pasar de la versión N a la N+1. */
const GRID_SCALE_FROM = { 1: 2, 2: 2 };

function scaleTiles(tiles, factor) {
  for (const tile of tiles || []) {
    if (tile.col != null) tile.col = (tile.col - 1) * factor + 1;
    if (tile.row != null) tile.row = (tile.row - 1) * factor + 1;
    if (tile.colSpan != null) tile.colSpan = tile.colSpan * factor;
    if (tile.rowSpan != null) tile.rowSpan = tile.rowSpan * factor;
  }
}

function migrateGrid(profile) {
  let version = Number.isInteger(profile.gridVersion) && profile.gridVersion >= 1
    ? profile.gridVersion
    : 1;
  // Un perfil de una app más nueva no se toca: no sabemos cómo leerlo.
  if (version >= GRID_VERSION) return profile;
  while (version < GRID_VERSION) {
    scaleTiles(profile.tiles, GRID_SCALE_FROM[version]);
    version += 1;
  }
  profile.gridVersion = GRID_VERSION;
  return profile;
}
```

Y en `load()` (línea ~134) cambiar la condición para no reescribir perfiles de versión mayor:

```js
    if (!(Number.isInteger(profile.gridVersion) && profile.gridVersion >= GRID_VERSION)) {
      migrateGrid(profile);
      await this._writeProfile(profile); // persistir la migración una sola vez
    }
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/main/storage.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage.js src/main/storage.test.js
git commit -m "feat(grid): migración encadenada de perfiles a gridVersion 3"
```

### Task 2: GRID_COLS = 24 en layout.js

**Files:**
- Modify: `src/renderer/core/layout.js:1-11`
- Test: `src/renderer/core/layout.test.js`

- [ ] **Step 1: Test de la constante y del límite por defecto**

Agregar al inicio de `layout.test.js` (tras los imports, importando también `GRID_COLS`):

```js
import { GRID_COLS } from './layout.js';

describe('GRID_COLS', () => {
  it('el grid tiene 24 columnas', () => {
    expect(GRID_COLS).toBe(24);
  });

  it('findEmptySpot usa 24 como ancho por defecto', () => {
    // Fila 1 ocupada en las 23 primeras columnas: un tile de ancho 2 no cabe
    // en la columna 24 y baja a la fila 2.
    const occupied = new Set(Array.from({ length: 23 }, (_, i) => `${i + 1},1`));
    expect(findEmptySpot(2, 1, occupied)).toEqual({ col: 1, row: 2 });
    expect(findEmptySpot(1, 1, occupied)).toEqual({ col: 24, row: 1 });
  });
});
```

- [ ] **Step 2: Fijar el test "grid denso" al ancho 12 que describe**

En el test `'en un grid denso el desplazado hace swap con el origen en vez de irse muy abajo'` cambiar la llamada a:

```js
    moveTileTo(tiles, 'A', 7, 3, 12);
```

y agregar un comentario encima: `// El escenario está armado sobre 12 columnas: se pasa explícito.`

- [ ] **Step 3: Correr y ver fallar**

Run: `npx vitest run src/renderer/core/layout.test.js`
Expected: FAIL en `GRID_COLS` (recibe 12).

- [ ] **Step 4: Cambiar la constante**

En `src/renderer/core/layout.js`:

```js
 * Utilidades puras de posicionamiento para el Bento Grid manual
 * (24 columnas, filas auto). Compartidas entre bentoGrid.js
```

```js
export const GRID_COLS = 24;
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npx vitest run src/renderer/core/layout.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/core/layout.js src/renderer/core/layout.test.js
git commit -m "feat(grid): 24 columnas"
```

### Task 3: Filas de 35 px y defaults de auto-posicionamiento (bentoGrid.js)

**Files:**
- Modify: `src/renderer/components/bentoGrid.js:5,24,83-84`

No hay test unitario (el módulo toca el DOM al importarse); se verifica en la Task 6.

- [ ] **Step 1: Editar**

```js
 *  - Grid de 24 columnas, filas auto (minmax 35px, 1fr).
```

```js
const MIN_ROW_PX = 35;
```

```js
    const cs = tile.colSpan || 8;
    const rs = tile.rowSpan || 8;
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/bentoGrid.js
git commit -m "feat(grid): filas de 35px y auto-posicionamiento 8x8"
```

### Task 4: Tamaños por defecto de tiles nuevos ×2 (tile.js)

**Files:**
- Modify: `src/renderer/components/tile.js:5,55-116`

- [ ] **Step 1: Editar cada default**

- Cabecera: `* para el grid manual de 24 columnas.`
- `fromUrl`: `colSpan: 8, rowSpan: 8`
- `calculator()`: `colSpan: 8, rowSpan: 8`
- `tasks`: `colSpan: 6, rowSpan: 10`
- `terminal(cwd)`: `colSpan: 12, rowSpan: 8`
- el segundo bloque con `colSpan: 6, rowSpan: 4` (línea ~83): `colSpan: 12, rowSpan: 8`
- `file` (línea ~101): `colSpan: 8, rowSpan: 10`
- `fromApp`: `colSpan: 8, rowSpan: 8`

- [ ] **Step 2: Verificar que no queda ningún default viejo**

Run: `grep -n "colSpan: [0-9]" src/renderer/components/tile.js`
Expected: solo 8, 6, 12, 12, 8, 8 (ningún 3, 4 ni 6 de terminal).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/tile.js
git commit -m "feat(grid): tamaños por defecto de tiles nuevos en la grilla de 24"
```

### Task 5: Documentación

**Files:**
- Modify: `README.md` (línea que describe el grid), `spec/constitution/tech-stack.md`, `spec/constitution/roadmap.md` (entrada 001 y P2)

- [ ] **Step 1: Actualizar menciones**

Run: `grep -rn "12 columnas" README.md spec/`
Reemplazar cada "12 columnas" por "24 columnas (12 hasta v1.5.3)". En el roadmap, marcar P2 como hecha: mover el texto de P2 a la sección "Hecho ✅ (continuación)" como `26. **028 · Grid de 24 columnas** — …` con una línea de resumen y el `gridVersion: 3`.

- [ ] **Step 2: Commit**

```bash
git add README.md spec/
git commit -m "docs: grid de 24 columnas"
```

### Task 6: Verificación completa

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: mismos 2 fallos preexistentes de `loopShim.test.js` (timeouts de entorno) y todo lo demás en verde. Si aparece cualquier otro fallo, es de este cambio: corregir antes de seguir.

- [ ] **Step 2: Build del renderer y main**

Run: `npm run build`
Expected: termina sin errores y deja `out/`.

- [ ] **Step 3: Migración en seco sobre los perfiles reales**

Copiar `~/Library/Application Support/yusepe-bento/profiles/` a un directorio temporal y cargar cada perfil con `ProfileStorage` desde un script Node apuntando a la copia; imprimir por perfil `gridVersion` y, por tile, `col/colSpan` antes y después. Expected: todos en 3, valores ×2, ningún tile fuera de 24 columnas (`col + colSpan - 1 <= 24`).

- [ ] **Step 4: Verificación visual en la app compilada** (se hace en la fase de empaquetado, después de P4 y P5): abrir "Motor + Jurimetría" y comprobar que se ve igual que antes y que el resize avanza en pasos más finos.
