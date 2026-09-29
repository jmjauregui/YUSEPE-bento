/**
 * src/renderer/components/webviewTile.js
 * --------------------------------------------------------------
 * Tile webview. El <webview> llena el tile; si el tile tiene `nav: true`
 * lleva encima una barra de navegación (‹ › ↻ dirección ⌄, ver
 * webviewNavBar.js) que se monta/desmonta en caliente al cambiar `nav`
 * en el perfil, sin tocar el <webview>. Overlay de error si la carga falla.
 * --------------------------------------------------------------
 */
import { h, debounce } from '../utils/dom.js';
import { bus } from '../core/eventBus.js';
import * as liveTiles from '../core/liveTiles.js';
import { ProfileManager } from '../core/profileManager.js';
import { normalizeUrl, navEnabled } from '../core/browserNav.js';
import { createWebviewNavBar } from './webviewNavBar.js';

export { normalizeUrl };

export function createWebviewTile(tile, profileId) {
  // Si esta webview ya está viva (el usuario volvió a este workspace),
  // reutilizamos el mismo <webview>/guest: sesión, scroll y JS en memoria
  // siguen exactamente donde quedaron.
  const cached = liveTiles.get(tile.id);
  if (cached) {
    return { root: cached.node, webview: cached.meta.webview };
  }

  const url = tile.url;
  const partition = `persist:yusepe-${tile.id}`;

  const errorOverlay = h('div', {
    class: 'absolute inset-0 hidden grid place-items-center bg-bg-soft/95 text-center p-4 z-10',
  });

  const webview = h('webview', {
    src: url,
    partition,
    allowpopups: 'false',
    webpreferences: 'contextIsolation=true, nodeIntegration=false',
  });

  // Los permisos (micrófono, portapapeles, DRM…) los decide el main para
  // todas las sesiones, incluida la partición de este webview: ver
  // configureSession() en main/index.js.
  webview.addEventListener('did-attach', () => {
    // Zoom por-tile persistido (ver components/workspaceManager.js). Se
    // fuerza a nivel Chromium (setZoomFactor), así que funciona incluso en
    // sitios que bloquean el zoom del navegador con CSS/meta viewport.
    try { webview.setZoomFactor(tile.zoom || 1); } catch { /* noop */ }
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;
    errorOverlay.innerHTML = `<div>
      <div class="text-sm text-fg-soft mb-1">⚠ No se pudo cargar</div>
      <div class="text-[10px] text-fg-subtle">${e.errorCode} · ${e.errorDescription || ''}</div>
      <div class="text-[10px] text-fg-subtle mt-1 break-all">${e.validatedURL}</div>
    </div>`;
    errorOverlay.classList.remove('hidden');
  });

  webview.addEventListener('did-finish-load', () => {
    errorOverlay.classList.add('hidden');
  });

  // El <webview> es una superficie de compositor aparte: un click dentro
  // no burbujea 'mousedown' al contenedor del tile, así que el foco del
  // grid (usado por Cmd+W) no se actualizaba. El evento nativo 'focus'
  // sí se dispara sobre el propio elemento <webview> al recibir el click.
  webview.addEventListener('focus', () => {
    bus.emit('tile:focus', { id: tile.id });
  });

  const root = h('div', {
    class: 'tile tile-webview',
    dataset: { tileId: tile.id, kind: tile.kind },
  }, [webview, errorOverlay]);

  // ---- Barra de navegación (tile.nav === true) ----
  let navBar = null;
  let navOn = navEnabled(tile);
  // Con la barra encendida, la última página visitada queda en el perfil
  // para que el tile reabra ahí tras un reinicio. Con la barra apagada el
  // tile se comporta como siempre (url fija del perfil).
  const persistUrl = debounce(() => {
    if (!navOn) return;
    let url = null;
    try { url = webview.getURL(); } catch { /* noop */ }
    if (url && /^https?:/i.test(url) && url !== tile.url) {
      tile.url = url;
      ProfileManager.updateTile(tile.id, { url }).catch(() => {});
    }
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
    if (id !== tile.id || !patch || !('nav' in patch)) return;
    navOn = patch.nav === true;
    if (navOn) mountNav(); else unmountNav();
  });

  // El kill real destruye el <webview> de verdad (saca el guest del DOM
  // para siempre). Desmontar por cambio de workspace NO pasa por acá —
  // ver liveTiles.js y bentoGrid.js (se mueve a una zona oculta en vez
  // de removerse, así el guest sigue vivo).
  function killReal() {
    try { webview.remove(); } catch { /* noop */ }
  }
  liveTiles.register(tile.id, {
    profileId, kind: 'webview', node: root, kill: killReal,
    meta: { webview, focusAddress: () => navBar?.focusAddress() },
  });

  return { root, webview };
}
