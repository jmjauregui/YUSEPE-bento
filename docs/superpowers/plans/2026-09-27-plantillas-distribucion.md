# Plantillas de distribución · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al crear un workspace, elegir una plantilla de distribución (incorporada o guardada por el usuario) que deje los tiles ya ubicados en la grilla de 24 columnas.

**Architecture:** Un módulo puro en el renderer define y valida plantillas e instancia tiles; un almacén JSON en main guarda las del usuario (patrón de `SnippetsStore`); `storage.create` acepta tiles iniciales; un selector modal con miniaturas se inserta como tercer paso de "Nuevo workspace". Spec: `docs/superpowers/specs/2026-09-27-plantillas-distribucion-design.md`.

**Tech Stack:** Electron 33, JS ESM, vitest, `h()` de `utils/dom.js` para UI.

---

### Task 1: Módulo puro `layoutTemplates.js`

**Files:**
- Create: `src/renderer/core/layoutTemplates.js`
- Test: `src/renderer/core/layoutTemplates.test.js`

- [ ] **Step 1: Tests**

```js
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES, validateTemplate, instantiateTemplate, templateFromProfile,
} from './layoutTemplates.js';

describe('BUILTIN_TEMPLATES', () => {
  it('todas son válidas y la primera es "vacio"', () => {
    expect(BUILTIN_TEMPLATES[0].id).toBe('vacio');
    for (const t of BUILTIN_TEMPLATES) expect(validateTemplate(t)).toEqual({ ok: true });
  });
  it('tienen ids únicos', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validateTemplate', () => {
  const base = { name: 'x', tiles: [] };
  it('rechaza kinds desconocidos', () => {
    const r = validateTemplate({ ...base, tiles: [{ kind: 'nope', col: 1, row: 1, colSpan: 2, rowSpan: 2 }] });
    expect(r.ok).toBe(false);
  });
  it('rechaza tiles fuera de las 24 columnas', () => {
    const r = validateTemplate({ ...base, tiles: [{ kind: 'terminal', col: 20, row: 1, colSpan: 6, rowSpan: 2 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/24/);
  });
  it('rechaza solapes', () => {
    const r = validateTemplate({ ...base, tiles: [
      { kind: 'terminal', col: 1, row: 1, colSpan: 4, rowSpan: 4 },
      { kind: 'terminal', col: 3, row: 3, colSpan: 4, rowSpan: 4 },
    ] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/solap/i);
  });
  it('rechaza nombre vacío y tiles que no son array', () => {
    expect(validateTemplate({ name: '', tiles: [] }).ok).toBe(false);
    expect(validateTemplate({ name: 'x', tiles: null }).ok).toBe(false);
  });
});

describe('instantiateTemplate', () => {
  it('da ids nuevos y únicos y conserva geometría, comando y url', () => {
    let n = 0;
    const tpl = { id: 't', name: 't', tiles: [
      { kind: 'terminal', title: 'A', col: 1, row: 1, colSpan: 12, rowSpan: 20, command: 'htop' },
      { kind: 'webview', title: 'W', col: 13, row: 1, colSpan: 12, rowSpan: 20, url: 'https://example.com' },
    ] };
    const tiles = instantiateTemplate(tpl, { newId: () => `id-${++n}` });
    expect(tiles.map((t) => t.id)).toEqual(['id-1', 'id-2']);
    expect(tiles[0]).toMatchObject({ kind: 'terminal', title: 'A', col: 1, row: 1, colSpan: 12, rowSpan: 20, command: 'htop' });
    expect(tiles[1]).toMatchObject({ kind: 'webview', url: 'https://example.com' });
    expect(typeof tiles[0].createdAt).toBe('number');
    // No muta la plantilla
    expect(tpl.tiles[0].id).toBeUndefined();
  });
  it('lanza si la plantilla es inválida', () => {
    expect(() => instantiateTemplate({ name: 'x', tiles: [{ kind: 'nope', col: 1, row: 1, colSpan: 1, rowSpan: 1 }] }))
      .toThrow();
  });
});

describe('templateFromProfile', () => {
  it('conserva la distribución y descarta lo que es del workspace', () => {
    const profile = { id: 'p', name: 'Motor', cwd: '/x', tiles: [
      { id: 'a', kind: 'terminal', title: 'MAC', col: 1, row: 1, colSpan: 6, rowSpan: 20, command: 'claude', cwd: '/x', createdAt: 1, loopAgent: 'mac' },
      { id: 'b', kind: 'webview', title: 'D', col: 7, row: 1, colSpan: 6, rowSpan: 20, url: 'https://d', zoom: 0.8 },
    ] };
    const tpl = templateFromProfile(profile, { name: 'Mía', description: 'desc' });
    expect(tpl).toEqual({ name: 'Mía', description: 'desc', tiles: [
      { kind: 'terminal', title: 'MAC', col: 1, row: 1, colSpan: 6, rowSpan: 20, command: 'claude' },
      { kind: 'webview', title: 'D', col: 7, row: 1, colSpan: 6, rowSpan: 20, url: 'https://d', zoom: 0.8 },
    ] });
    expect(validateTemplate(tpl)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Correr → FAIL (módulo no existe).** `npx vitest run src/renderer/core/layoutTemplates.test.js`

- [ ] **Step 3: Implementar** (`src/renderer/core/layoutTemplates.js`): constantes `KINDS = ['terminal','webview','tasks','calculator','file']`, `GRID_COLS` importado de `./layout.js`, `BUILTIN_TEMPLATES` según el spec, `validateTemplate` (nombre, array, kind, límites, solapes por rectángulos), `instantiateTemplate(t, { newId = () => crypto.randomUUID(), now = Date.now } = {})`, `templateFromProfile` con lista blanca de campos (`kind,title,col,row,colSpan,rowSpan,command,url,zoom`, solo si no son `null/undefined`).

- [ ] **Step 4: Correr → PASS.** Commit: `feat(plantillas): módulo puro de plantillas de distribución`.

### Task 2: `TemplatesStore` en main + IPC + preload

**Files:**
- Create: `src/main/templatesOps.js`, `src/main/templatesOps.test.js`
- Modify: `src/main/ipc.js` (junto a snippets), `src/preload/index.js` (junto a snippets)

- [ ] **Step 1: Tests** (`templatesOps.test.js`, mismo esqueleto que `snippetsOps.test.js`: tmpdir + `new TemplatesStore(path)`):
  - `list()` vacío sin archivo.
  - `create({ name: 'Mía', tiles: [...] })` devuelve `{ id, name, description: '', tiles, createdAt }` y `list()` lo incluye ordenado por nombre.
  - `create` con nombre vacío → throw `/nombre/`; con `tiles` no array → throw `/tiles/`.
  - `remove(id)` lo saca; remove de id inexistente no falla.
- [ ] **Step 2: FAIL → implementar → PASS.** Commit: `feat(plantillas): almacén de plantillas del usuario`.
- [ ] **Step 3: IPC + preload**: en `ipc.js` `const templates = new TemplatesStore(join(app.getPath('userData'), 'layout-templates.json'))` y handlers `templates:list|create|delete` (+ `removeHandler` en el cleanup); en preload `templates: { list, create(payload), delete(id) }`. Commit: `feat(plantillas): IPC y preload`.

### Task 3: `storage.create` con tiles iniciales

**Files:**
- Modify: `src/main/storage.js` (`create`), `src/main/storage.test.js`

- [ ] **Step 1: Tests**: `create({ name, tiles: [{ kind:'terminal', col:1,row:1,colSpan:12,rowSpan:20 }, { id:'fijo', kind:'tasks', ... }] })` → `load(id).tiles` tiene 2, el primero con `id` string no vacío y el segundo con `id: 'fijo'`; `create({ name, tiles: 'x' })` → tiles `[]`.
- [ ] **Step 2: FAIL → implementar** (`tiles: Array.isArray(tiles) ? tiles.map((t) => ({ ...t, id: t.id || randomUUID() })) : []`) **→ PASS.** Commit: `feat(plantillas): storage.create acepta tiles iniciales`.
- [ ] **Step 3: `ProfileManager.create(name, cwd = null, tiles = [])`** pasa `tiles` al preload. Commit junto al anterior o aparte.

### Task 4: `openModal({ onClose })`

**Files:**
- Modify: `src/renderer/components/modal.js`

- [ ] **Step 1: Implementar**: variable `onCloseCb`; `openModal` la setea (`onClose || null`); `closeModal` la invoca una vez (guardar en local, poner `null`, llamar). `promptModal`/`confirmModal` no cambian. Sin test unitario (DOM); se cubre en la verificación manual. Commit: `feat(modal): callback onClose`.

### Task 5: Selector de plantillas

**Files:**
- Create: `src/renderer/components/templatePicker.js`

- [ ] **Step 1: Implementar `pickTemplate()`**: carga `window.yusepe.templates.list()` (si falla, solo incorporadas + toast), arma tarjetas: miniatura = `div` con `display:grid; grid-template-columns: repeat(24, 1fr); grid-auto-rows: 4px; gap: 1px` y un `div` por tile con `gridColumn/gridRow` y color por kind (terminal: `bg-accent/70`, webview: `bg-sky-400/60`, tasks: `bg-amber-400/60`, otros `bg-fg-subtle/40`); debajo nombre y descripción; las del usuario llevan papelera (confirm + `templates.delete` + re-render). Click en tarjeta → `closeModal()` + `resolve(t)`. `onClose` → `resolve(null)` si aún no resolvió. Commit: `feat(plantillas): selector con miniaturas`.

### Task 6: Integración en "Nuevo workspace" y en el administrador

**Files:**
- Modify: `src/renderer/main.js` (`createNewProfile`), `src/renderer/components/workspaceManager.js`

- [ ] **Step 1: `createNewProfile`**: tras elegir carpeta: `const tpl = await pickTemplate(); if (!tpl) return; const tiles = instantiateTemplate(tpl); const p = await ProfileManager.create(name, cwd, tiles);`
- [ ] **Step 2: Administrador**: debajo de la tabla, botón "Guardar distribución como plantilla" → `promptModal({ title: 'Nombre de la plantilla' })` → `templateFromProfile(state.profile, { name })` → `validateTemplate` (toast si falla) → `window.yusepe.templates.create(tpl)` → toast "Plantilla guardada".
- [ ] **Step 3: Commit**: `feat(plantillas): selector al crear workspace y guardar distribución actual (P5)`.

### Task 7: Verificación

- [ ] `npm test` (mismos 2 fallos preexistentes), `npm run build`, y en la app compilada: crear workspace con "Cuatro columnas"; guardar "Motor + Jurimetría" como plantilla; crear otro con ella; borrar la plantilla desde el selector. Actualizar roadmap (029) y commit `docs`.
