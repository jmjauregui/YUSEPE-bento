/**
 * src/main/ptyWriteQueue.js
 * --------------------------------------------------------------
 * Cola de escritura por pty: trocea todo lo que se escribe al
 * proceso en chunks chicos con una pausa entre cada uno.
 *
 * Por qué existe: en Windows, ConPTY pierde input si se le escribe
 * un bloque grande de una sola vez — el buffer de entrada de la
 * consola se desborda y descarta lo que no entró, así que de un
 * pegado largo sobrevive sólo la cola (~200-400 caracteres). Es el
 * mismo bug que obligó a VS Code a trocear sus escrituras al pty
 * (50 chars / 5 ms). Se aplica en todas las plataformas: en Unix el
 * kernel ya hace backpressure y el troceo es inofensivo.
 *
 * Va en main y no en el renderer a propósito: por acá pasan TODOS
 * los escritores (tipeo/pegado del usuario, `tile.command`
 * precargado, snippets y el loopDispatcher), y la cola FIFO por pty
 * preserva el orden entre ellos — p. ej. el `\r` que el dispatcher
 * manda aparte siempre sale después del mensaje que remata.
 *
 * No importa `electron` a propósito: así corre bajo vitest sin mocks.
 * --------------------------------------------------------------
 */

const CHUNK_SIZE = 50;
const DRAIN_INTERVAL_MS = 5;

/**
 * ¿La secuencia de escape que arranca en `esc` termina antes de `end`?
 * Cubre CSI (`\x1b[` params + byte final 0x40-0x7e, p.ej. `\x1b[201~`) y,
 * para cualquier otro escape corto (`\x1bX`), exige al menos un byte más.
 * Sesgo conservador: ante una secuencia rara se corta antes del ESC, que
 * como mucho achica un chunk — partirla sí tiene costo.
 */
function csiCompleteBefore(data, esc, end) {
  if (esc + 1 >= end) return false;
  if (data[esc + 1] !== '[') return true; // `\x1bX`: escape de dos bytes, entra entero
  for (let j = esc + 2; j < end; j++) {
    const c = data.charCodeAt(j);
    if (c >= 0x40 && c <= 0x7e) return true; // byte final del CSI
  }
  return false;
}

/**
 * @param {(data: string) => void} writeFn escritura real al pty (proc.write)
 * @returns {{ write(data: string): void, dispose(): void }}
 */
export function createWriteQueue(writeFn, { chunkSize = CHUNK_SIZE, intervalMs = DRAIN_INTERVAL_MS } = {}) {
  const queue = [];
  let timer = null;
  let disposed = false;
  const idleCallbacks = [];

  function notifyIdle() {
    const cbs = idleCallbacks.splice(0);
    for (const cb of cbs) cb();
  }

  const clear = () => {
    queue.length = 0;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Despierta cualquier whenIdle() pendiente: la cola se descartó,
    // así que no va a haber más drenaje. Cubre dispose() y el catch de
    // writeFn (proceso muerto). notifyIdle() hace splice(0), por lo que
    // una segunda llamada en el mismo tick es inofensiva.
    notifyIdle();
  };

  const drain = () => {
    timer = null;
    const chunk = queue.shift();
    if (chunk === undefined) { notifyIdle(); return; }
    try {
      writeFn(chunk);
    } catch {
      // El proceso ya murió: lo que quedaba en cola no tiene destino.
      // clear() llama notifyIdle() internamente.
      clear();
      return;
    }
    if (queue.length) {
      timer = setTimeout(drain, intervalMs);
    } else {
      notifyIdle();
    }
  };

  return {
    write(data) {
      if (disposed || typeof data !== 'string' || !data) return;

      // Camino rápido para el tipeo interactivo: una tecla no espera
      // el intervalo. Sólo si no hay un drenaje en curso — colarse
      // adelante de una cola activa rompería el orden.
      if (!queue.length && timer === null && data.length <= chunkSize) {
        try { writeFn(data); } catch { /* proceso muerto */ }
        return;
      }

      // El corte nunca parte una secuencia de escape: un `\x1b` que queda
      // al final de un chunk y su `[201~` en el siguiente pueden hacer que
      // el TUI del otro lado interprete el ESC suelto como tecla Escape y
      // pierda el cierre del bracketed paste (verificado con sonda: el
      // corte a los 50 chars cayó justo dentro del marcador). Si el borde
      // cae dentro de una secuencia incompleta, se corta antes del ESC.
      let i = 0;
      while (i < data.length) {
        let end = Math.min(i + chunkSize, data.length);
        if (end < data.length) {
          const esc = data.lastIndexOf('\x1b', end - 1);
          if (esc > i && !csiCompleteBefore(data, esc, end)) end = esc;
        }
        queue.push(data.slice(i, end));
        i = end;
      }
      if (timer === null) drain();
    },

    whenIdle() {
      if (!queue.length && timer === null) return Promise.resolve();
      return new Promise((resolve) => idleCallbacks.push(resolve));
    },

    dispose() {
      disposed = true;
      clear();
    },
  };
}
