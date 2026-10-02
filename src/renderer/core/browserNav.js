/**
 * src/renderer/core/browserNav.js
 * --------------------------------------------------------------
 * Lógica pura de la barra de navegación de los tiles webview (sin
 * DOM): normalizar/resolver lo que escribe el usuario, el valor por
 * defecto de `nav` según cómo nació el tile y el estado que pinta la
 * barra. La UI está en components/webviewNavBar.js.
 * --------------------------------------------------------------
 */
const SAFE_PROTOCOLS = /^https?:\/\//i;
const SEARCH = 'https://www.google.com/search?q=';

/** URL http(s) válida (agrega https:// a un dominio pelado) o null. */
export function normalizeUrl(input) {
  if (!input) return null;
  let url = input.trim();
  if (!SAFE_PROTOCOLS.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
    else return null;
  }
  try { return new URL(url).toString(); }
  catch { return null; }
}

/** Texto del campo de dirección → URL a cargar (o búsqueda en Google), null si está vacío. */
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

/** Solo `nav: true` explícito enciende: los tiles viejos sin el campo quedan como estaban. */
export function navEnabled(tile) {
  return tile?.nav === true;
}

/** Estado de los botones según el historial del webview y si está cargando. */
export function historyState({ canGoBack, canGoForward, isLoading }) {
  return {
    backDisabled: !canGoBack,
    forwardDisabled: !canGoForward,
    reloadLabel: isLoading ? '✕' : '↻',
    reloadTitle: isLoading ? 'Detener' : 'Recargar',
  };
}
