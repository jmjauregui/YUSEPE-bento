/**
 * src/renderer/core/agentDot.js
 * Lógica pura: actividad + presencia + etiqueta → estado del punto del agente.
 *
 * El color y las palabras salen de la misma función para que no puedan
 * contradecirse. Orden de precedencia estricto:
 *   1. ausente → gris    (lo más grave: no corre nadie)
 *   2. actividad fresca → rojo   (titila en blink, fijo en steady)
 *   3. working + trabado → ámbar
 *   4. resto → verde
 */
import { STUCK_WORKING_MS } from './rosterAccordion.js';

/**
 * @param {object} opts
 * @param {{ state: 'idle'|'blink'|'steady' }} opts.activity  resultado de activityState
 * @param {boolean} opts.absent      presencia === false
 * @param {boolean} opts.working     agent.state === 'working'
 * @param {number}  [opts.stuckMs]   ms desde el último cambio de estado del agente
 * @returns {{ color: 'green'|'red'|'amber'|'gray', blink: boolean, label: string }}
 */
export function agentDotState({ activity, absent, working, stuckMs = 0 }) {
  if (absent) {
    return { color: 'gray', blink: false, label: 'Caído: su terminal volvió al prompt' };
  }

  const isActive = activity?.state === 'blink' || activity?.state === 'steady';
  if (isActive) {
    return {
      color: 'red',
      blink: activity.state === 'blink',
      label: 'Ocupado: está trabajando ahora',
    };
  }

  if (working && stuckMs > STUCK_WORKING_MS) {
    const min = Math.floor(stuckMs / 60_000);
    const since = min >= 60
      ? `hace ${Math.floor(min / 60)} h`
      : `hace ${min} min`;
    return {
      color: 'amber',
      blink: false,
      label: `Trabado: figura ocupado y no imprime ${since} — su bandeja está frenada`,
    };
  }

  return { color: 'green', blink: false, label: 'Disponible: recibe mensajes' };
}
