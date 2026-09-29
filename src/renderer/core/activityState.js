/**
 * src/renderer/core/activityState.js
 * --------------------------------------------------------------
 * Estado de actividad de una terminal a partir de su salida (sin DOM):
 *
 *   idle ──salida útil──▶ working ──1,5 s sin salida──▶ done (si el tile
 *   NO tiene el foco) o idle (si lo tiene). done ──foco──▶ idle.
 *
 * «Salida útil»: después del arranque (3 s, la pintura inicial del shell
 * no cuenta) y con al menos 20 bytes, o tres fragmentos chicos en 1 s
 * (un parpadeo de barra de estado no es trabajo).
 *
 * MEDIDO 2026-09-29: Claude Code ocioso en un pty emite 7 fragmentos en
 * el primer segundo y ninguno en los 19 s siguientes; trabajando, varios
 * por segundo. Los timers se inyectan para poder testear sin esperar.
 * --------------------------------------------------------------
 */
export function createActivity({
  now = () => Date.now(),
  isFocused = () => false,
  onChange = () => {},
  quietMs = 1500,
  warmupMs = 3000,
  minBytes = 20,
  setTimeout: setT = globalThis.setTimeout.bind(globalThis),
  clearTimeout: clearT = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  const born = now();
  let state = 'idle';
  let timer = null;
  let small = [];

  function set(next) {
    if (next === state) return;
    state = next;
    onChange(state);
  }

  function armQuiet() {
    if (timer) clearT(timer);
    timer = setT(() => {
      timer = null;
      if (state === 'working') set(isFocused() ? 'idle' : 'done');
    }, quietMs);
  }

  function data(bytes) {
    const t = now();
    if (t - born < warmupMs) return;
    if (bytes < minBytes) {
      small = small.filter((ts) => t - ts <= 1000);
      small.push(t);
      if (small.length < 3) return;
      small = [];
    }
    set('working');
    armQuiet();
  }

  function focus() {
    if (state === 'done') set('idle');
  }

  function dispose() {
    if (timer) clearT(timer);
    timer = null;
  }

  return { data, focus, dispose, state: () => state };
}
