/**
 * src/renderer/core/loopSearch.js
 * LÃ³gica pura del buscador en el hilo del loop.
 * Sin I/O, sin DOM â€” sÃ³lo matcheo y resaltado.
 */

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Devuelve los mensajes cuyo campo `text` coincide con la consulta
 * (case-insensitive, literal). Consulta vacÃ­a o sÃ³lo espacios â†’ lista completa.
 * Mensajes sin `text` no causan excepciÃ³n.
 */
export function matchMessages(messages, query) {
  if (!query || !query.trim()) return messages;
  const q = query.trim().toLowerCase();
  return messages.filter((m) => (m?.text ?? '').toLowerCase().includes(q));
}

/**
 * Devuelve todos los tramos del texto, en orden. Concatenarlos reconstruye
 * el texto original. Los tramos con `match: true` son las coincidencias.
 * Consulta vacÃ­a â†’ un solo tramo con match: false.
 */
export function highlightSegments(text, query) {
  if (!query || !query.trim()) return [{ text, match: false }];
  const escaped = escapeRegExp(query.trim());
  const re = new RegExp(escaped, 'gi');
  const segments = [];
  let lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push({ text: text.slice(lastIndex, m.index), match: false });
    segments.push({ text: m[0], match: true });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), match: false });
  return segments.length ? segments : [{ text, match: false }];
}

/**
 * Índice inicial de navegación: el último resultado (el más reciente, abajo).
 * -1 si no hay resultados.
 */
export function initialNavIndex(results) {
  return results.length === 0 ? -1 : results.length - 1;
}

/**
 * Mueve el índice una posición en la dirección indicada, sin dar la vuelta.
 * 'next' sube hacia los mensajes más viejos (índice menor).
 * 'prev' baja hacia los más nuevos (índice mayor).
 */
export function moveNavIndex(index, len, dir) {
  if (len === 0) return -1;
  if (dir === 'next') return Math.max(0, index - 1);
  return Math.min(len - 1, index + 1);
}

/**
 * Contador de posición en el orden de navegación.
 * "1 de N" cuando se está en el más reciente; "N de N" en el más viejo.
 * "" si no hay resultados.
 */
export function navLabel(index, len) {
  if (len === 0 || index < 0) return '';
  return `${len - index} de ${len}`;
}
