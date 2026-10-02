/**
 * src/renderer/core/liveTiles.js
 * --------------------------------------------------------------
 * Registro genérico de tiles que se mantienen VIVOS cuando el usuario
 * cambia de espacio de trabajo, en vez de destruirse (terminales y
 * webviews). Al volver a ese perfil, se reutiliza el mismo nodo DOM
 * (mismo proceso pty o mismo <webview>/guest de Electron) — scrollback,
 * sesión de la página, todo intacto.
 *
 * Solo se mata de verdad un tile cuando:
 *  - el usuario lo borra puntualmente (ProfileManager.removeTile), o
 *  - se mata el workspace completo (killWorkspace) o se borra el perfil.
 * --------------------------------------------------------------
 */
import { bus } from './eventBus.js';

/** tileId -> { profileId, kind, node, kill, meta } */
const live = new Map();

/**
 * @param {string} tileId
 * @param {{ profileId: string, kind: string, node: Node, kill: () => void, meta?: object }} entry
 */
export function register(tileId, entry) {
  live.set(tileId, { meta: {}, ...entry });
  bus.emit('live-tiles:changed');
}

export function get(tileId) {
  return live.get(tileId);
}

/** Mata de verdad un tile puntual (borrado real, no cambio de workspace). */
export function kill(tileId) {
  const entry = live.get(tileId);
  if (!entry) return;
  try { entry.kill(); } catch { /* noop */ }
  live.delete(tileId);
  bus.emit('live-tiles:changed');
}

/**
 * Suelta un tile SIN matar su proceso: dispone la vista (xterm, DOM,
 * listeners) y lo saca del registro. Es el paso previo a traspasar el
 * workspace a otra ventana, que se volverá dueña del pty (ver
 * main.js detachWorkspace y terminal.js `detach`). Si el tile no sabe
 * soltarse (webview, calculadora), se mata como siempre.
 */
export function release(tileId) {
  const entry = live.get(tileId);
  if (!entry) return;
  if (typeof entry.detach === 'function') {
    try { entry.detach(); } catch { /* noop */ }
  } else {
    try { entry.kill(); } catch { /* noop */ }
  }
  live.delete(tileId);
  bus.emit('live-tiles:changed');
}

/** [tileId, entry] de todos los tiles vivos de un workspace. */
export function entriesForProfile(profileId) {
  return [...live].filter(([, e]) => e.profileId === profileId);
}

/** Mata TODOS los tiles vivos (terminales + webviews) de un workspace. */
export function killWorkspace(profileId) {
  let killed = 0;
  for (const [tileId, entry] of [...live]) {
    if (entry.profileId !== profileId) continue;
    try { entry.kill(); } catch { /* noop */ }
    live.delete(tileId);
    killed++;
  }
  if (killed) bus.emit('live-tiles:changed');
  return killed;
}

/** IDs de perfiles con al menos un tile vivo (activo o en background). */
export function runningProfileIds() {
  return new Set([...live.values()].map((e) => e.profileId));
}

/** Cuántos tiles vivos tiene un perfil. */
export function countForProfile(profileId) {
  return [...live.values()].filter((e) => e.profileId === profileId).length;
}
