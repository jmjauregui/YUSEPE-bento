/**
 * src/renderer/core/loopActivity.js
 * Lógica pura del indicador de actividad del loop.
 * Sin I/O: todo por parámetro para testear con reloj inyectado.
 */

/** Ventana "alguien está imprimiendo ahora" (ms). */
export const FRESH_MS = 5_000;
/** A partir de acá la racha queda fija sin parpadear (ms). */
export const STEADY_MS = 120_000;

/**
 * Decide el estado de la lucecita de actividad.
 *
 * La racha no tiene estado propio: el llamador la pasa de vuelta en cada
 * ciclo, igual que `alerted` en el observador.
 *
 * @param {{
 *   now: number,
 *   lastDataAtByAgent: Record<string,number>,
 *   streakStartedAt: number|null,
 * }} opts
 * @returns {{ state: 'idle'|'blink'|'steady', streakStartedAt: number|null, sinceMs: number }}
 */
export function activityState({ now, lastDataAtByAgent, streakStartedAt }) {
  let freshest = 0;
  for (const ts of Object.values(lastDataAtByAgent ?? {})) {
    if (typeof ts === 'number' && ts > freshest) freshest = ts;
  }

  // Borde estricto: exactamente FRESH_MS → idle
  const hasFresh = freshest > 0 && (now - freshest) < FRESH_MS;

  if (!hasFresh) {
    return { state: 'idle', streakStartedAt: null, sinceMs: 0 };
  }

  const streak = streakStartedAt ?? now;
  const sinceMs = now - streak;

  if (sinceMs >= STEADY_MS) {
    return { state: 'steady', streakStartedAt: streak, sinceMs };
  }
  return { state: 'blink', streakStartedAt: streak, sinceMs };
}
