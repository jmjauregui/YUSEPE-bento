# Barra de navegación en tiles webview · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un tile webview pueda mostrar una barra (atrás, adelante, recargar, dirección, ocultar) encendible por tile y persistida en el perfil, con Cmd+L como en un navegador.

**Architecture:** lógica pura en `src/renderer/core/browserNav.js` (testeable en node); barra como componente `src/renderer/components/webviewNavBar.js` montado/desmontado por `webviewTile.js` según `tile.nav`; toggle vía botón, menú `Tile › Barra de dirección` (Cmd+L → `menu:tile-action {type:'address-bar'}`) y columna en el administrador del workspace.

**Tech Stack:** Electron 44 (castLabs), JS ESM sin framework, `h()` de `utils/dom.js`, vitest (node), Playwright `_electron` para E2E.

Spec: `docs/superpowers/specs/2026-09-29-barra-navegacion-webview-design.md`.

---

### Task 1: módulo puro `browserNav.js` (TDD)

**Files:**
- Create: `src/renderer/core/browserNav.js`
- Test: `src/renderer/core/browserNav.test.js`

- [ ] **Step 1: test que falla**

```js
// src/renderer/core/browserNav.test.js
import { describe, it, expect } from 'vitest';
import { resolveAddress, navDefaultFor, navEnabled, historyState } from './browserNav.js';

describe('resolveAddress', () => {
  it('acepta URL completa', () => {
    expect(resolveAddress('https://netflix.com/browse')).toBe('https://netflix.com/browse');
  });
  it('agrega https a un dominio pelado', () => {
    expect(resolveAddress('discord.com/app')).toBe('https://discord.com/app');
  });
  it('texto con espacios busca en Google', () => {
    expect(resolveAddress('jurisprudencia corte suprema')).toBe(
      'https://www.google.com/search?q=jurisprudencia%20corte%20suprema');
  });
  it('una palabra sin punto busca en Google', () => {
    expect(resolveAddress('netflix')).toBe('https://www.google.com/search?q=netflix');
  });
  it('vacío devuelve null', () => {
    expect(resolveAddress('   ')).toBeNull();
    expect(resolveAddress('')).toBeNull();
  });
});

describe('navDefaultFor', () => {
  it('manual enciende, app apaga', () => {
    expect(navDefaultFor('manual')).toBe(true);
    expect(navDefaultFor('app')).toBe(false);
  });
});

describe('navEnabled', () => {
  it('solo true explícito enciende', () => {
    expect(navEnabled({ nav: true })).toBe(true);
    expect(navEnabled({ nav: false })).toBe(false);
    expect(navEnabled({})).toBe(false);
  });
});

describe('historyState', () => {
  it('deshabilita atrás/adelante y pinta detener mientras carga', () => {
    expect(historyState({ canGoBack: false, canGoForward: true, isLoading: true })).toEqual({
      backDisabled: true, forwardDisabled: false, reloadLabel: '✕', reloadTitle: 'Detener',
    });
    expect(historyState({ canGoBack: true, canGoForward: false, isLoading: false })).toEqual({
      backDisabled: false, forwardDisabled: true, reloadLabel: '↻', reloadTitle: 'Recargar',
    });
  });
});
```

- [ ] **Step 2: correr y ver fallar** — `npx vitest run src/renderer/core/browserNav.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: implementación mínima**

```js
// src/renderer/core/browserNav.js
/**
 * Lógica pura de la barra de navegación de los tiles webview (sin DOM):
 * resolver lo que escribe el usuario, valor por defecto de `nav` y el
 * estado que pinta la barra. La UI está en components/webviewNavBar.js.
 */
import { normalizeUrl } from '../components/webviewTile.js';

const SEARCH = 'https://www.google.com/search?q=';

/** Texto del campo de dirección → URL a cargar, o null si está vacío. */
export function resolveAddress(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (!/\s/.test(t)) {
    const url = normalizeUrl(t);
    if (url) return url;
  }
  return SEARCH + encodeURIComponent(t);
}

/** `manual` (URL manual) nace con barra; `app` (catálogo) sin barra. */
export function navDefaultFor(origin) {
  return origin === 'manual';
}

/** Solo `nav: true` explícito enciende; tiles viejos sin el campo quedan sin barra. */
export function navEnabled(tile) {
  return tile?.nav === true;
}

export function historyState({ canGoBack, canGoForward, isLoading }) {
  return {
    backDisabled: !canGoBack,
    forwardDisabled: !canGoForward,
    reloadLabel: isLoading ? '✕' : '↻',
    reloadTitle: isLoading ? 'Detener' : 'Recargar',
  };
}
```

Nota: `normalizeUrl` vive en `webviewTile.js`, que importa `eventBus` y `liveTiles` (puros, sin DOM en import) — vitest en node lo carga bien.

- [ ] **Step 4: correr y ver pasar** — `npx vitest run src/renderer/core/browserNav.test.js` → 8 tests PASS.
- [ ] **Step 5: commit** — `git add src/renderer/core/browserNav.js src/renderer/core/browserNav.test.js && git commit -m "feat(navbar): lógica pura de la barra de navegación (resolver dirección, default, estado)"`

### Task 2: componente `webviewNavBar.js` + montaje en `webviewTile.js`

**Files:**
- Create: `src/renderer/components/webviewNavBar.js`
- Modify: `src/renderer/components/webviewTile.js`
- Modify: `src/renderer/style.css` (bloque `.webview-navbar`)

- [ ] **Step 1: componente**

```js
// src/renderer/components/webviewNavBar.js
/**
 * Barra de navegación de un tile webview: ‹ › ↻ [dirección] ⌄.
 * Se monta encima del <webview> cuando el tile tiene `nav: true`
 * (ver webviewTile.js). El <webview> nunca se mueve del DOM.
 */
import { h } from '../utils/dom.js';
import { resolveAddress, historyState } from '../core/browserNav.js';

export function createWebviewNavBar(webview, { onHide }) {
  let loading = false;
  const back = btn('‹', 'Atrás', () => { try { webview.goBack(); } catch { /* noop */ } });
  const fwd = btn('›', 'Adelante', () => { try { webview.goForward(); } catch { /* noop */ } });
  const reload = btn('↻', 'Recargar', () => {
    try { loading ? webview.stop() : webview.reload(); } catch { /* noop */ }
  });
  const address = h('input', {
    class: 'webview-navbar-address',
    type: 'text', spellcheck: 'false', autocomplete: 'off',
    placeholder: 'Escribe una dirección o busca en Google',
  });
  const hide = btn('⌄', 'Ocultar barra (Cmd+L la vuelve a mostrar)', onHide);
  hide.classList.add('webview-navbar-hide');

  const root = h('div', { class: 'webview-navbar' }, [
    h('div', { class: 'webview-navbar-grip' }), back, fwd, reload, address, hide,
  ]);

  function currentUrl() { try { return webview.getURL() || ''; } catch { return ''; } }
  function paint() {
    let canGoBack = false, canGoForward = false;
    try { canGoBack = webview.canGoBack(); canGoForward = webview.canGoForward(); } catch { /* noop */ }
    const s = historyState({ canGoBack, canGoForward, isLoading: loading });
    back.disabled = s.backDisabled;
    fwd.disabled = s.forwardDisabled;
    reload.textContent = s.reloadLabel;
    reload.title = s.reloadTitle;
  }
  function syncAddress() {
    if (document.activeElement !== address) address.value = currentUrl();
    paint();
  }

  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = resolveAddress(address.value);
      if (url) { try { webview.loadURL(url); } catch { /* noop */ } webview.focus(); }
    } else if (e.key === 'Escape') {
      address.value = currentUrl();
      webview.focus();
    }
  });
  address.addEventListener('focus', () => address.select());

  const onStart = () => { loading = true; paint(); };
  const onStop = () => { loading = false; syncAddress(); };
  webview.addEventListener('did-start-loading', onStart);
  webview.addEventListener('did-stop-loading', onStop);
  webview.addEventListener('did-navigate', syncAddress);
  webview.addEventListener('did-navigate-in-page', syncAddress);
  syncAddress();

  function dispose() {
    webview.removeEventListener('did-start-loading', onStart);
    webview.removeEventListener('did-stop-loading', onStop);
    webview.removeEventListener('did-navigate', syncAddress);
    webview.removeEventListener('did-navigate-in-page', syncAddress);
    root.remove();
  }
  function focusAddress() { address.focus(); address.select(); }

  return { root, dispose, focusAddress };
}

function btn(label, title, onClick) {
  return h('button', { class: 'webview-navbar-btn', title, type: 'button', onClick }, label);
}
```

- [ ] **Step 2: montaje en `webviewTile.js`**

Cambios (mantener todo lo existente):

```js
import { debounce } from '../utils/dom.js';
import { navEnabled } from '../core/browserNav.js';
import { createWebviewNavBar } from './webviewNavBar.js';
import { ProfileManager } from '../core/profileManager.js';
```

Dentro de `createWebviewTile`, después de crear `root` (que ahora lleva la clase extra `tile-webview`):

```js
  const root = h('div', {
    class: 'tile tile-webview',
    dataset: { tileId: tile.id, kind: tile.kind },
  }, [webview, errorOverlay]);

  // ---- Barra de navegación (nav: true) ----
  let navBar = null;
  let navOn = navEnabled(tile);
  const persistUrl = debounce(() => {
    if (!navOn) return;
    const url = (() => { try { return webview.getURL(); } catch { return null; } })();
    if (url && /^https?:/i.test(url)) ProfileManager.updateTile(tile.id, { url }).catch(() => {});
  }, 500);
  function mountNav() {
    if (navBar) return;
    navBar = createWebviewNavBar(webview, {
      onHide: () => ProfileManager.updateTile(tile.id, { nav: false }),
    });
    root.prepend(navBar.root);
    root.classList.add('has-navbar');
  }
  function unmountNav() {
    if (!navBar) return;
    navBar.dispose();
    navBar = null;
    root.classList.remove('has-navbar');
  }
  if (navOn) mountNav();
  webview.addEventListener('did-navigate', persistUrl);
  bus.on('tile:updated', ({ id, patch }) => {
    if (id !== tile.id || !('nav' in patch)) return;
    navOn = patch.nav === true;
    navOn ? mountNav() : unmountNav();
  });
```

Y en `liveTiles.register(...)` agregar a `meta`: `focusAddress: () => navBar?.focusAddress()`. El `return` final queda `{ root, webview }` igual. En el `cached` del inicio no hay cambio (el nodo ya lleva la barra).

- [ ] **Step 3: CSS** — al final de `src/renderer/style.css`, dentro del `@layer components` si existe (si no, al final):

```css
  /* ---- Barra de navegación de webviews ---- */
  .tile-webview { display: flex; flex-direction: column; }
  .tile-webview > webview { flex: 1 1 auto; min-height: 0; }
  .webview-navbar {
    flex: 0 0 32px;
    display: flex; align-items: center; gap: 4px;
    padding: 0 6px 0 0;
    background: var(--color-bg-soft);
    border-bottom: 1px solid var(--color-tile-border);
    z-index: 15;
  }
  .webview-navbar-grip { flex: 0 0 28px; height: 100%; }
  .webview-navbar-btn {
    flex: 0 0 24px; height: 24px; border-radius: 6px;
    font-size: 15px; line-height: 1; color: var(--color-fg-soft);
  }
  .webview-navbar-btn:hover:not(:disabled) { background: var(--color-bg-elev); }
  .webview-navbar-btn:disabled { opacity: 0.35; cursor: default; }
  .webview-navbar-address {
    flex: 1 1 auto; min-width: 0; height: 24px;
    padding: 0 8px; border-radius: 6px; font-size: 12px;
    background: var(--color-bg-elev); color: var(--color-fg);
    border: 1px solid transparent; outline: none;
  }
  .webview-navbar-address:focus { border-color: rgb(var(--color-accent-rgb) / 0.6); }
```

Verificar los nombres de variables contra `style.css` (`--color-bg-soft`, `--color-bg-elev`, `--color-fg-soft`, `--color-fg`, `--color-tile-border`, `--color-accent-rgb`) y ajustar a los que existan.

- [ ] **Step 4: `npm run build` sin errores; `npx vitest run` sin regresiones.**
- [ ] **Step 5: commit** — `git commit -m "feat(navbar): barra de navegación montable en tiles webview (nav: true)"`

### Task 3: encendido — defaults, menú Cmd+L, administrador, cheatsheet

**Files:**
- Modify: `src/renderer/components/tile.js` (`fromUrl` → `nav: true`; `fromApp` → `nav: false`)
- Modify: `src/main/index.js` (menú Tile: `{ label: 'Barra de dirección', accelerator: 'CmdOrCtrl+L', click: sendTile('address-bar') }`)
- Modify: `src/renderer/main.js` (`onTileAction`: `else if (type === 'address-bar') toggleAddressBar();`)
- Modify: `src/renderer/components/bentoGrid.js` (exportar `toggleAddressBar`)
- Modify: `src/renderer/components/workspaceManager.js` (columna «Barra»)
- Modify: `src/renderer/components/shortcutsCheatsheet.js` (`[[MOD, 'L'], 'Barra de dirección del webview enfocado']`)

- [ ] **Step 1: defaults en `tile.js`** — usar `navDefaultFor('manual')` / `navDefaultFor('app')` importando de `../core/browserNav.js`.

- [ ] **Step 2: `toggleAddressBar` en `bentoGrid.js`**

```js
import * as liveTiles from '../core/liveTiles.js';
import { navEnabled } from '../core/browserNav.js';

/** Cmd+L: muestra la barra del webview enfocado (y enfoca la dirección). */
export async function toggleAddressBar() {
  const tile = state.profile?.tiles.find((t) => t.id === focusedTileId);
  if (!tile || tile.kind !== 'webview') return;
  if (!navEnabled(tile)) await ProfileManager.updateTile(tile.id, { nav: true });
  liveTiles.get(tile.id)?.meta?.focusAddress?.();
}
```

- [ ] **Step 3: menú, main.js, cheatsheet** como en Files.

- [ ] **Step 4: administrador** — header: `h('th', { class: 'py-1.5 pr-2 font-medium w-14' }, 'Barra')` antes de Zoom; `row()` agrega `navCell(tile)` antes de `zoomCell`; colspan del vacío pasa a 6.

```js
  function navCell(tile) {
    const td = h('td', { class: 'py-2 pr-2 whitespace-nowrap' });
    if (tile.kind !== 'webview') { td.append(h('span', { class: 'text-fg-subtle' }, '—')); return td; }
    const on = tile.nav === true;
    td.append(h('button', {
      class: `text-[10px] px-1.5 py-1 rounded border transition ${on ? 'border-accent text-accent' : 'border-line text-fg-subtle hover:bg-bg-elev'}`,
      title: on ? 'Ocultar la barra de navegación' : 'Mostrar la barra de navegación',
      onClick: () => ProfileManager.updateTile(tile.id, { nav: !on }),
    }, on ? 'Sí' : 'No'));
    return td;
  }
```

(comprobar que el administrador se re-pinta con `tile:updated`; si no, llamar a su `render()` tras el update.)

- [ ] **Step 5: build + vitest + commit** — `git commit -m "feat(navbar): Cmd+L, defaults por origen, interruptor en el administrador"`

### Task 4: E2E `e2e/navbar.mjs`

**Files:**
- Create: `e2e/navbar.mjs`
- Modify: `package.json` (`"e2e": "... && node e2e/navbar.mjs"`)

- [ ] **Step 1: escribir la prueba** (mismo esqueleto que `smoke.mjs`; siembra gridVersion 4):

```js
const seeded = {
  id: 'nav', name: 'Nav', cwd: null, createdAt: 1, updatedAt: 1, gridVersion: 4,
  tiles: [
    { id: 'w-on',  kind: 'webview', title: 'Con barra', url: 'about:blank', nav: true,  col: 1,  row: 1, colSpan: 24, rowSpan: 8 },
    { id: 'w-off', kind: 'webview', title: 'Sin barra', url: 'about:blank',             col: 25, row: 1, colSpan: 24, rowSpan: 8 },
  ],
};
```
Checks, en orden:
1. `#bento .tile[data-tile-id="w-on"] .webview-navbar` visible; `w-off` sin `.webview-navbar`.
2. Campo de dirección de `w-on` tiene valor `about:blank`.
3. Click en `w-off` (mousedown sobre el tile) → `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:tile-action', { type: 'address-bar' }))` → aparece `.webview-navbar` en `w-off` y el perfil en disco tiene `nav: true` en `w-off` (`waitForFunction` + leer JSON).
4. Click en `.webview-navbar-hide` de `w-off` → desaparece y el disco queda `nav: false`.
5. Escribir `example.com` en la dirección de `w-on` + Enter → `page.waitForFunction` de que el atributo/URL del webview empieza con `https://example.com` (si no hay red, aceptar `did-fail-load` y solo verificar que el input intentó: comprobar `webview.getAttribute('src')`? No: `loadURL` no cambia `src`. Verificar en su lugar que el perfil guardó `url` con `https://example.com/` tras `did-navigate` — requiere red. Marcar el check como «omitido sin red» si `did-fail-load`.)

- [ ] **Step 2: `npm run e2e` en verde; commit** — `git commit -m "test(e2e): barra de navegación (visibilidad por nav, Cmd+L, ocultar, persistencia)"`

### Task 5: roadmap + empaquetado

- [ ] Anotar en `spec/constitution/roadmap.md` (sección Propuestas de Abel): **P6 · Barra de navegación en webviews — HECHO 2026-09-29** + siguientes pasos fuera de alcance (pestañas, historial, `target=_blank` a otro tile, favoritos).
- [ ] `npm run package:mac && npm run vmp-sign && npm run release:mac`; instalar con el script de reinicio (Bento cerrado) y probar Cmd+L sobre el tile de Netflix.
