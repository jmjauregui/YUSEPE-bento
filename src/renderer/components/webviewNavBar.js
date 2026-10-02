/**
 * src/renderer/components/webviewNavBar.js
 * --------------------------------------------------------------
 * Barra de navegación de un tile webview: ‹ › ↻ [dirección] ⌄.
 * Se monta encima del <webview> cuando el tile tiene `nav: true`
 * (ver webviewTile.js). El <webview> nunca se mueve del DOM: moverlo
 * recrea el guest (recarga la página).
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { resolveAddress, historyState } from '../core/browserNav.js';

export function createWebviewNavBar(webview, { onHide }) {
  let loading = false;
  const back = btn('‹', 'Atrás', () => { try { webview.goBack(); } catch { /* noop */ } });
  const fwd = btn('›', 'Adelante', () => { try { webview.goForward(); } catch { /* noop */ } });
  const reload = btn('↻', 'Recargar', () => {
    try { if (loading) webview.stop(); else webview.reload(); } catch { /* noop */ }
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

  // Antes de que el guest se adjunte (o mientras no navegó) getURL() está
  // vacío o tira: en ese caso mostramos el src con que nació el tile.
  function currentUrl() {
    let url = '';
    try { url = webview.getURL() || ''; } catch { /* noop */ }
    return url || webview.getAttribute('src') || '';
  }
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
      if (url) {
        try { webview.loadURL(url); } catch { /* noop */ }
        webview.focus();
      }
    } else if (e.key === 'Escape') {
      address.value = currentUrl();
      webview.focus();
    }
    e.stopPropagation();
  });
  address.addEventListener('focus', () => address.select());

  const onStart = () => { loading = true; paint(); };
  const onStop = () => { loading = false; syncAddress(); };
  webview.addEventListener('did-start-loading', onStart);
  webview.addEventListener('did-stop-loading', onStop);
  webview.addEventListener('did-navigate', syncAddress);
  webview.addEventListener('did-navigate-in-page', syncAddress);
  syncAddress();
  webview.addEventListener('did-attach', syncAddress, { once: true });

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
