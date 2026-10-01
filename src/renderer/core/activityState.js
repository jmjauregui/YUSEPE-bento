/**
 * src/renderer/core/activityState.js
 * --------------------------------------------------------------
 * Estado de actividad de una terminal a partir de su salida (sin DOM):
 *
 *   idle ──salida SOSTENIDA──▶ working ──1,5 s sin salida──▶ done (si el
 *   tile NO tiene el foco y trabajó ≥ 3 s) o idle. done ──foco──▶ idle.
 *
 * Reglas, todas medidas (2026-09-29, node-pty, 40-60 s por corrida):
 *  - Gracia de 10 s desde el PRIMER byte (no desde crear el pty): una
 *    sesión retomada (`claude --resume`) pinta 4 KB en el segundo 1 y
 *    sigue pintando hasta el segundo 4; por ssh al mini todo llega más
 *    tarde. Contar desde el pty daba «listo» al arrancar.
 *  - «Sostenida»: salida en ≥ 3 segundos distintos dentro de una ventana
 *    de 5 s y ≥ 300 bytes en esa ventana. Claude Code ocioso emite un
 *    repintado aislado de ~44 bytes cerca del segundo 11 (medido dos
 *    veces); un fragmento suelto nunca es trabajo.
 *  - «Listo» solo si la fase working duró ≥ 3 s entre el primer y el último
 *    byte (el silencio de 1,5 s no cuenta); si no, vuelve a idle en
 *    silencio (un parpadeo no merece etiqueta).
 * Los timers se inyectan para testear sin esperar.
 * --------------------------------------------------------------
 */
export function createActivity({
  now = () => Date.now(),
  isFocused = () => false,
  onChange = () => {},
  quietMs = 1500,
  warmupMs = 10000,
  windowMs = 5000,
  minSeconds = 3,
  minBytes = 300,
  minWorkingMs = 3000,
  setTimeout: setT = globalThis.setTimeout.bind(globalThis),
  clearTimeout: clearT = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  let state = 'idle';
  let timer = null;
  let firstByteAt = null;
  let workingSince = null;
  let lastDataAt = null;
  let recent = []; // [{ t, bytes }] dentro de la ventana

  function set(next) {
    if (next === state) return;
    state = next;
    onChange(state);
  }

  function armQuiet() {
    if (timer) clearT(timer);
    timer = setT(() => {
      timer = null;
      if (state !== 'working') return;
      const worked = lastDataAt - workingSince; // trabajo real, sin contar el silencio
      const eligible = worked >= minWorkingMs && !isFocused();
      workingSince = null;
      recent = [];
      set(eligible ? 'done' : 'idle');
    }, quietMs);
  }

  function sustained(t) {
    recent = recent.filter((r) => t - r.t <= windowMs);
    const bytes = recent.reduce((a, r) => a + r.bytes, 0);
    const seconds = new Set(recent.map((r) => Math.floor(r.t / 1000))).size;
    return seconds >= minSeconds && bytes >= minBytes;
  }

  function data(bytes) {
    const t = now();
    if (firstByteAt === null) firstByteAt = t;
    if (t - firstByteAt < warmupMs) return;
    recent.push({ t, bytes });
    lastDataAt = t;
    if (state === 'working') { armQuiet(); return; }
    if (!sustained(t)) return;
    workingSince = recent[0].t;
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
