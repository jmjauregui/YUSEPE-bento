/**
 * src/renderer/core/loopUnread.js
 * --------------------------------------------------------------
 * Qué mensajes del loop no vio el usuario todavía (spec 034).
 *
 * Un cursor por workspace —el último mensaje marcado como leído— igual en
 * espíritu al `cursor` de cada agente en status.json. Vive en localStorage
 * y no en `.ybento/loop/`: es estado de la UI de quien mira (como el tema o
 * el sonido), los agentes no lo leen, y status.json ya tiene lock y N
 * escritores concurrentes como para sumarle esto sin necesidad.
 *
 * Cuenta como no leído todo lo que no escribió el usuario, incluidos los
 * mensajes entre agentes: el valor del loop es seguir la cadena completa.
 * Sólo se marca leído a pedido ("Marcar todo como leído"), nunca solo.
 * --------------------------------------------------------------
 */

const KEY_PREFIX = 'yusepe:loop-read:';

/**
 * Mensajes posteriores al cursor que no escribió el usuario.
 *
 * El cursor es `{ id, seq }`. Se busca por id; si no aparece (el panel pide
 * sólo los últimos 200, o el archivo se truncó) se compara por `seq`, que
 * sale de la posición en un archivo append-only.
 */
export function unreadMessages(messages, cursor) {
  if (!cursor) return [];
  const at = cursor.id ? messages.findIndex((m) => m.id === cursor.id) : -1;
  const after = at !== -1
    ? messages.slice(at + 1)
    : messages.filter((m) => (m.seq || 0) > (cursor.seq || 0));
  return after.filter((m) => m.from !== 'usuario');
}

/** `{ count, forUser, ids }` — `forUser`: alguno va dirigido a @usuario. */
export function unreadSummary(messages, cursor) {
  const unread = unreadMessages(messages, cursor);
  return {
    count: unread.length,
    forUser: unread.some((m) => m.to === 'usuario'),
    ids: new Set(unread.map((m) => m.id)),
  };
}

/** Texto del contador: '' sin no leídos, '99+' arriba de 99. */
export function badgeLabel(count) {
  if (!count) return '';
  return count > 99 ? '99+' : String(count);
}

/**
 * Texto accesible del contador de no leídos (aria-label).
 * Usa el número real, nunca '99+': el recorte visual no sirve a quien no ve la pantalla.
 */
export function unreadTitle(count) {
  if (!count) return '';
  return count === 1 ? '1 mensaje sin leer' : `${count} mensajes sin leer`;
}

/** Cursor que deja todo lo de `messages` como leído. */
export function cursorAtEnd(messages) {
  const last = messages[messages.length - 1];
  // Sin mensajes: seq 0, así el primero que llegue cuenta como no leído.
  return last ? { id: last.id, seq: last.seq || 0 } : { id: null, seq: 0 };
}

/* ---------- Persistencia ---------- */

// try/catch: localStorage puede tirar (almacenamiento bloqueado o lleno), y
// el contador de no leídos no vale romper el panel del loop.
export function loadCursor(cwd, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY_PREFIX + cwd);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCursor(cwd, cursor, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY_PREFIX + cwd, JSON.stringify(cursor));
  } catch { /* ver loadCursor */ }
}

/**
 * Cursor del workspace; si nunca se guardó uno, arranca con todo leído —
 * si no, la primera vez aparece un contador con el historial entero.
 */
export function ensureCursor(cwd, messages, storage = globalThis.localStorage) {
  const saved = loadCursor(cwd, storage);
  if (saved) return saved;
  const fresh = cursorAtEnd(messages);
  saveCursor(cwd, fresh, storage);
  return fresh;
}
