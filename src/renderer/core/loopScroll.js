/**
 * Relleno del hilo para que el compositor flotante no tape el último mensaje,
 * y predicado de "al fondo" con su umbral de 40 px como único dueño (045).
 */

/**
 * Alto de padding que el hilo necesita al pie para que el compositor
 * flotante no tape el último mensaje.
 *   - Nunca NaN ni negativo (getBoundingClientRect sobre un nodo oculto da 0).
 *   - Siempre entero (un padding con subpíxeles provoca re-layout en cada
 *     observación del ResizeObserver).
 *   - Topado a streamH * maxRatio cuando se conoce el alto del hilo, para
 *     que el relleno no se coma toda la vista.
 */
export function composerPad(composerH, { gap = 8, streamH = null, maxRatio = 0.6 } = {}) {
  const h = Number.isFinite(composerH) && composerH > 0 ? composerH : 0;
  const raw = h + gap;
  if (streamH != null && Number.isFinite(streamH) && streamH > 0) {
    return Math.round(Math.min(raw, streamH * maxRatio));
  }
  return Math.round(raw);
}

/**
 * ¿El hilo está "al fondo"? Única definición del umbral de 40 px;
 * hoy vive inline en renderStream — extraerla le da test y un solo lugar
 * donde cambiarlo.
 */
export function isAtBottom({ scrollHeight, scrollTop, clientHeight }, threshold = 40) {
  return scrollHeight - scrollTop - clientHeight < threshold;
}
