/**
 * src/renderer/core/copyFeedback.js
 * ----------------------------------------------------------
 * Estado del ícono de copiar: idle → done/failed → idle.
 * Sin DOM. Timers inyectables para tests.
 * ----------------------------------------------------------
 */

/**
 * @param {object} opts
 * @param {number}   [opts.durationMs=1500]
 * @param {(state:'idle'|'done'|'failed')=>void} opts.onState
 * @param {typeof setTimeout}  [opts.setTimeout]
 * @param {typeof clearTimeout} [opts.clearTimeout]
 * @returns {{ run(writeFn: ()=>Promise<void>): Promise<void> }}
 */
export function createCopyFeedback({
  durationMs = 1500,
  onState,
  setTimeout: _setTimeout = globalThis.setTimeout,
  clearTimeout: _clearTimeout = globalThis.clearTimeout,
}) {
  let timer = null;

  function armReset() {
    if (timer !== null) _clearTimeout(timer);
    timer = _setTimeout(() => {
      timer = null;
      onState('idle');
    }, durationMs);
  }

  async function run(writeFn) {
    try {
      await writeFn();
      onState('done');
    } catch {
      onState('failed');
    }
    armReset();
  }

  return { run };
}
