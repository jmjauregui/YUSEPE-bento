/**
 * src/renderer/core/rosterAccordion.js
 * ----------------------------------------------------------
 * Lógica pura sin DOM para el acordeón del roster de agentes.
 *
 * - `STUCK_WORKING_MS`, `isAbsent`, `isStuck`, `agentProblem`,
 *   `rosterAlert` → color del punto del botón y subtítulo de fila.
 * - `createRosterAccordion` → controlador de la cuenta regresiva.
 *
 * El estado vive en el controlador, nunca en nodos que se repinten.
 * Los timers se inyectan para que los tests puedan usar fakes.
 * ----------------------------------------------------------
 */

/**
 * A partir de acá, un agente en `working` probablemente se colgó o murió a
 * mitad de la tarea. No se toca solo — se avisa y se ofrece liberarlo,
 * porque un agente que de verdad está trabajando duro no debería perder su
 * turno por un umbral arbitrario.
 */
export const STUCK_WORKING_MS = 15 * 60 * 1000;

/** Presencia explícitamente falsa → ausente. Indefinida no lo es. */
export function isAbsent(presence) {
  return presence?.present === false;
}

/** Umbral estricto (>): exactamente 15 min no cuenta. */
export function isStuck(agent, now) {
  return agent.state === 'working'
    && now - new Date(agent.updatedAt).getTime() > STUCK_WORKING_MS;
}

/**
 * Devuelve el primer problema del agente, con la misma precedencia
 * que usa `agentRow`: ausente antes que trabado.
 */
export function agentProblem(agent, presence, now) {
  if (isAbsent(presence)) return 'absent';
  if (isStuck(agent, now)) return 'stuck';
  return null;
}

/**
 * Flags para pintar una fila del roster: separados para que un agente
 * ausente Y trabado muestre tanto el subtítulo de ausente como el botón
 * "liberar". Si deriváramos `showRelease` de `subtitle`, un agente ausente+
 * trabado perdería el botón (porque `subtitle` da 'absent').
 */
export function rowFlags(agent, presence, now) {
  return {
    subtitle: agentProblem(agent, presence, now),
    showRelease: isStuck(agent, now),
  };
}

/**
 * `'red'` si algún agente está ausente; si no, `'amber'` si alguno está
 * trabado; si no, `null`. Rojo le gana al ámbar.
 */
export function rosterAlert(agents, presenceByName, now) {
  let amber = false;
  for (const agent of agents) {
    const p = presenceByName?.[agent.name];
    if (isAbsent(p)) return 'red';
    if (isStuck(agent, now)) amber = true;
  }
  return amber ? 'amber' : null;
}

/**
 * Firma de las opciones del selector de designado.
 * Incluye los nombres en orden y el designado: cualquier cambio real produce
 * una firma distinta, y la misma lista con la misma selección produce la misma.
 * @param {{ name: string }[]} agents
 * @param {string|null} observerAgent
 */
export function observerOptionsSignature(agents, observerAgent) {
  return agents.map((a) => a.name).join(',') + '|' + (observerAgent ?? '');
}

/**
 * Controlador de la cuenta regresiva del acordeón.
 *
 * @param {object} opts
 * @param {number}   [opts.durationMs=5000]
 * @param {()=>boolean} opts.isHeld   - ¿mouse o foco adentro ahora?
 * @param {(open:boolean)=>void} opts.onChange - refleja el estado en el DOM
 * @param {typeof setTimeout}  [opts.setTimeout]
 * @param {typeof clearTimeout} [opts.clearTimeout]
 */
export function createRosterAccordion({
  durationMs = 5000,
  isHeld,
  onChange,
  setTimeout: _setTimeout = globalThis.setTimeout,
  clearTimeout: _clearTimeout = globalThis.clearTimeout,
}) {
  let open = false;
  let timer = null;

  function arm() {
    if (timer !== null) _clearTimeout(timer);
    timer = _setTimeout(() => {
      timer = null;
      if (isHeld()) {
        arm();
      } else {
        _close();
      }
    }, durationMs);
  }

  function _open() {
    open = true;
    onChange(true);
    arm();
  }

  function _close() {
    if (timer !== null) { _clearTimeout(timer); timer = null; }
    open = false;
    onChange(false);
  }

  function toggle() {
    if (open) _close();
    else _open();
  }

  function release() {
    if (!open) return;
    arm();
  }

  return {
    open: _open,
    close: _close,
    toggle,
    release,
    get isOpen() { return open; },
  };
}
