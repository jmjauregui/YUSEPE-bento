# P2 · Grid de 24 columnas (resolución fina para redimensionar)

Fecha: 2026-09-27 · Rama: `feature/grid-24-columnas` · Propuesta P2 del roadmap.

## Problema

El grid manual tiene 12 columnas y filas de 70 px mínimo. En un monitor ultrawide con 5 o 6 tiles no hay reparto parejo (4 terminales + un panel no caben en partes iguales) y cada paso de resize es 1/12 del ancho: demasiado grueso para ajustar terminales.

## Decisión

Duplicar la resolución del grid en ambos ejes, igual que se hizo de v1 (6 columnas / 140 px) a v2 (12 / 70 px):

- `GRID_COLS`: 12 → **24**.
- `MIN_ROW_PX`: 70 → **35**.
- `gridVersion`: 2 → **3**, con migración automática ×2 de `col`, `row`, `colSpan`, `rowSpan` al cargar cada perfil (una sola vez, persistida), encadenada desde v1 (sin `gridVersion`) → v2 → v3.
- Tamaños por defecto de tiles nuevos ×2 para que se vean igual que hoy (terminal 12×8, webview 8×8, calculadora 8×8, tareas 6×10, archivo 8×10; auto-posicionamiento 8×8).

La resolución física no cambia: un perfil migrado se ve idéntico; solo los pasos de resize y de movimiento por teclado son la mitad de grandes.

## Alternativas descartadas

- **Solo columnas (24), filas iguales:** rompe la simetría del patrón de migración existente y deja el eje vertical grueso. Descartada.
- **Columnas configurables por perfil:** más flexible, pero cada perfil necesitaría su propia migración y las plantillas (P5) tendrían que expresarse en fracciones. YAGNI. Descartada.
- **36 columnas:** pasos de 1/36 hacen el resize impreciso al mouse y las celdas de 23 px son ilegibles como unidad. Descartada.

## Componentes que cambian

| Archivo | Cambio |
|---|---|
| `src/renderer/core/layout.js` | `GRID_COLS = 24`; comentario. Ninguna función cambia: todas reciben `gridCols` como parámetro. |
| `src/renderer/components/bentoGrid.js` | `MIN_ROW_PX = 35`; defaults de `ensurePositions` 8×8; comentario. |
| `src/renderer/components/tile.js` | defaults de `TileFactory` ×2. |
| `src/main/storage.js` | `GRID_VERSION = 3`; `migrateGrid` encadenado por versión (`{1:×2, 2:×2}`), aplicado en `load()` e `import()` como hoy. |
| Tests | `storage.test.js`: expectativas a v3, casos v2→v3 y v1→v3 (×4). `layout.test.js`: verificar que nada dependa del default 12. |
| Docs | Comentarios de cabecera y README/tech-stack donde digan "12 columnas". |

## Flujo de datos

1. `storage.load(id)` lee el JSON; si `gridVersion !== 3` aplica las migraciones que falten en orden y reescribe el archivo.
2. El renderer pinta `repeat(24, 1fr)` y filas `minmax(35px, 1fr)`; los tiles ya vienen en coordenadas v3.
3. Perfiles creados por la app nacen con `gridVersion: 3`. Perfiles importados (export viejo) pasan por `load()` y se migran igual.

## Errores y casos borde

- Perfil sin `tiles` o con tiles sin `col/row`: la migración solo toca campos presentes (`!= null`), como hoy; `ensurePositions` ubica el resto.
- Perfil con `gridVersion` mayor a 3 (de una app más nueva): no se toca ni se reescribe.
- Perfil con `gridVersion` desconocido (p.ej. 0 o string): se trata como v1 (sin versión). Se documenta en el test.

## Pruebas

- Unitarias (vitest): migración v2→v3, v1→v3 encadenada, idempotencia (cargar dos veces no re-escala), `gridVersion` > 3 intacto, `create()` nace en v3, `import()` migra.
- Layout: suite existente en verde; un test explícito de que `GRID_COLS` es 24 y de que `findEmptySpot` respeta el nuevo límite con el default.
- Manual en la app compilada: abrir "Motor + Jurimetría" (4 terminales de 3 columnas) y comprobar que se ve igual (ahora 6 columnas cada uno de 24) y que el resize avanza en pasos de 1/24.

## Fuera de alcance

Plantillas (P5), catálogo (P4), ventanas independientes (P1). Cambiar `GAP` o el diseño visual de los handles.
