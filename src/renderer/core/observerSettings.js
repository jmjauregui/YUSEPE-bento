/**
 * src/renderer/core/observerSettings.js
 * Umbral del observador de inactividad del loop: llave de localStorage,
 * default y las tres funciones que lo leen, guardan y empujan a main.
 *
 * Módulo puro (sin DOM ni imports de components/): puede ser importado
 * tanto por settings.js como por loopSidebar.js sin crear un ciclo.
 */

export const OBSERVER_KEY = 'yusepe:loop-observer-threshold';
export const OBSERVER_DEFAULT_MS = 600_000; // 10 minutos

/** Lee el umbral guardado en ms. null = desactivado. */
export function getObserverThreshold() {
  const v = localStorage.getItem(OBSERVER_KEY);
  if (v === 'null') return null;
  const n = parseInt(v, 10);
  return (Number.isFinite(n) && n > 0) ? n * 1000 : OBSERVER_DEFAULT_MS;
}

/** Guarda el umbral (en segundos o null) y lo empuja a main. */
export function setObserverThreshold(seconds) {
  localStorage.setItem(OBSERVER_KEY, seconds == null ? 'null' : String(seconds));
  window.yusepe.loop.setObserver(seconds == null ? null : seconds * 1000);
}

/** Empuja el umbral guardado a main (llamar antes del primer loop.start). */
export function pushObserverThreshold() {
  window.yusepe.loop.setObserver(getObserverThreshold());
}
