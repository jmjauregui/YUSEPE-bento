/**
 * src/main/loopDiag.js
 * --------------------------------------------------------------
 * Instrumentación pasiva para atrapar el truncamiento de mensajes.
 *
 * Registra dos puntos de observación por entrega:
 *   B1 — el payload exacto que recibió writeToPty (en loopDispatcher)
 *   B2 — los chunks que createWriteQueue le pasó realmente a proc.write
 *        (observados en la envoltura de writeFn en ipc.js)
 *
 * La ventana de captura está ACOTADA a la duración de una entrega:
 * arm() la abre, disarm() la cierra. Fuera de esa ventana, chunk()
 * retorna en la primera línea sin acumular nada — esto es lo que impide
 * registrar el tipeo del usuario (contraseñas, comandos, etc.).
 *
 * El volcado a disco ocurre DESPUÉS de markDelivered, fire-and-forget.
 * Ningún fallo del diagnóstico se propaga al camino de entrega.
 *
 * No importa `electron` a propósito: así corre bajo vitest sin mocks.
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';

/** Directorio relativo al workspace donde viven los registros. */
const DIAG_SUBDIR = path.join('.ybento', 'loop', 'diag');

/**
 * Tope duro de acumulación de B2 por entrega (64 KB).
 * Si se supera, se marca truncadoPorTope y se deja de acumular.
 * El fallo queda visible en el registro en vez de comerse la memoria.
 */
const MAX_B2_BYTES = 64 * 1024;

/**
 * Estado por pty activo en una ventana de captura.
 * armed: true  → chunk() acumula
 * armed: false → chunk() ignora (ventana cerrada, esperando flush)
 */
const sessions = new Map();

/**
 * Abre la ventana de captura para `ptyId`.
 * Guarda B1 (el payload tal como llegó a writeToPty, sin reformatear)
 * y deja la sesión lista para acumular B2.
 *
 * @param {string} ptyId
 * @param {{ agent: string, cwd: string, messageId: string, payload: string }} opts
 */
export function arm(ptyId, { agent, cwd, messageId, payload }) {
  sessions.set(ptyId, {
    agent,
    cwd,
    messageId,
    b1: payload,
    b2Parts: [],
    b2Len: 0,
    truncadoPorTope: false,
    armed: true,
  });
}

/**
 * Acumula un chunk de B2 (lo que writeFn le entregó realmente a proc.write).
 * Retorna inmediatamente si el pty no está en una ventana activa:
 * fuera de una entrega no se acumula nada — esto protege el tipeo del usuario.
 *
 * @param {string} ptyId
 * @param {string} data
 */
export function chunk(ptyId, data) {
  const s = sessions.get(ptyId);
  if (!s || !s.armed) return;
  if (s.truncadoPorTope) return;
  const available = MAX_B2_BYTES - s.b2Len;
  if (data.length > available) {
    if (available > 0) {
      s.b2Parts.push(data.slice(0, available));
      s.b2Len = MAX_B2_BYTES;
    }
    s.truncadoPorTope = true;
    return;
  }
  s.b2Parts.push(data);
  s.b2Len += data.length;
}

/**
 * Cierra la ventana: a partir de acá, chunk() no acumula para este pty.
 * La sesión queda en memoria hasta que flush() la consuma.
 *
 * @param {string} ptyId
 */
export function disarm(ptyId) {
  const s = sessions.get(ptyId);
  if (s) s.armed = false;
}

/**
 * Vuelca el registro a `.ybento/loop/diag/<agente>.json`.
 * Un archivo por agente, sobrescrito: no crece entre entregas.
 *
 * @param {string} ptyId
 * @param {{ colaVaciadaPorError?: boolean, drenajeVencido?: boolean }} flags
 */
export async function flush(ptyId, { colaVaciadaPorError = false, drenajeVencido = false } = {}) {
  const s = sessions.get(ptyId);
  sessions.delete(ptyId); // liberar memoria pase lo que pase con el volcado
  if (!s) return;

  const b2 = s.b2Parts.join('');
  const record = {
    timestamp: new Date().toISOString(),
    agent: s.agent,
    messageId: s.messageId,
    b1: s.b1,
    b1Len: s.b1.length,
    b2,
    b2Len: b2.length,
    b2Chunks: s.b2Parts.length,
    truncadoPorTope: s.truncadoPorTope,
    colaVaciadaPorError,
    drenajeVencido,
  };

  const diagDir = path.join(s.cwd, DIAG_SUBDIR);
  const file = path.join(diagDir, `${s.agent}.json`);
  await fs.mkdir(diagDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(record, null, 2), 'utf8');
}
