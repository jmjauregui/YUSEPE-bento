/**
 * src/renderer/core/agentOrder.js
 * --------------------------------------------------------------
 * Lógica pura del reordenamiento de pills — sin DOM, con tests.
 * Mismo criterio que core/layout.js: lo que se puede razonar sin DOM,
 * se razona sin DOM.
 * --------------------------------------------------------------
 */

export const HOLD_MS = 1000;
export const SLOP_PX = 5;

/**
 * Aplica un orden guardado a una lista de agentes.
 *
 * - Los agentes cuyo nombre aparece en `order` van primero, en el orden de
 *   `order`.
 * - El resto va al final, en el orden en que llegaron (alfabético, porque
 *   así los entrega listAgents).
 * - Nombres de `order` que no están en `agents`: se ignoran.
 * - Duplicados en `order`: cuentan una vez (primera aparición).
 * - No muta la entrada.
 */
export function applyAgentOrder(agents, order) {
  if (!order?.length) return [...agents];
  const orderMap = new Map();
  for (const name of order) {
    if (!orderMap.has(name)) orderMap.set(name, orderMap.size);
  }
  const inOrder = [];
  const rest = [];
  for (const agent of agents) {
    if (orderMap.has(agent.name)) inOrder.push(agent);
    else rest.push(agent);
  }
  inOrder.sort((a, b) => orderMap.get(a.name) - orderMap.get(b.name));
  return [...inOrder, ...rest];
}

/**
 * Mueve el elemento en la posición `from` a la posición `to` en una copia
 * del array. No muta la entrada.
 */
export function moveName(names, from, to) {
  const arr = [...names];
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return arr;
}

/**
 * Clasifica el resultado de un gesto de puntero sobre una pill.
 *
 * - `'tap'`    → gesto corto sin levantar (click normal)
 * - `'cancel'` → movió más de SLOP_PX antes del segundo (ni click ni drag)
 * - `'lift'`   → la pill se levantó (drag completado o no)
 */
/**
 * Acumula la distancia máxima alcanzada durante un gesto.
 * Usar Math.max garantiza que volver al origen no convierte un 'cancel' en 'tap'.
 */
export function trackPress(maxSoFar, dx, dy) {
  return Math.max(maxSoFar, Math.hypot(dx, dy));
}

export function pressOutcome({ lifted, movedPx }) {
  if (lifted) return 'lift';
  if (movedPx > SLOP_PX) return 'cancel';
  return 'tap';
}

/**
 * Qué pills de `otherPills` cruzan a la arrastrada y en qué dirección.
 *
 * `viejo` = índice actual de la pill arrastrada en el array de TODAS las pills
 *           (= número de pills en otherPills que están antes de ella).
 * `nuevo` = posición de inserción devuelta por `insertionIndex` (0..otherPills.length).
 *
 * - Hacia adelante (nuevo > viejo): las de [viejo, nuevo) en otherPills van
 *   ANTES de la pill arrastrada — cada una con insertBefore(otra, pill).
 * - Hacia atrás  (nuevo < viejo): las de [nuevo, viejo) en otherPills van
 *   DESPUÉS — cada una con insertBefore(otra, pill.nextSibling_capturado).
 * - Sin cambio: null.
 */
export function crossingPlan(viejo, nuevo) {
  if (nuevo === viejo) return null;
  const indices = [];
  if (nuevo > viejo) {
    for (let i = viejo; i < nuevo; i++) indices.push(i);
    return { direction: 'forward', indices };
  }
  for (let i = nuevo; i < viejo; i++) indices.push(i);
  return { direction: 'backward', indices };
}

/**
 * Lista de movimientos DOM que implementan un `crossingPlan`.
 *
 * Cada elemento del resultado es `{ node, before }` listo para
 * `container.insertBefore(node, before)`. `before === null` significa
 * insertar al final.
 *
 * INVARIANTE: ningún movimiento tiene `node === dragged`. Si `dragged`
 * no está en `children`, devuelve [].
 */
export function crossingMoves(children, dragged, nuevo) {
  const viejo = children.indexOf(dragged);
  if (viejo === -1) return [];
  const others = children.filter((c) => c !== dragged);
  const plan = crossingPlan(viejo, nuevo);
  if (!plan) return [];
  const nextSib = children[viejo + 1] ?? null;
  const before = plan.direction === 'forward' ? dragged : nextSib;
  return plan.indices.map((i) => ({ node: others[i], before }));
}

/**
 * Histéresis entre reordenamientos: sólo reordenar si el puntero se alejó
 * al menos SLOP_PX del punto del último reordenamiento.
 * Evita oscilaciones en el salto de fila (el layout solo, sin mover el puntero,
 * no puede desencadenar un nuevo reordenamiento).
 *
 * `lastReorderPt` = null en el primer reordenamiento del gesto.
 */
export function shouldReorder(current, lastReorderPt) {
  if (!lastReorderPt) return true;
  return Math.hypot(current.x - lastReorderPt.x, current.y - lastReorderPt.y) >= SLOP_PX;
}

/**
 * Calcula en qué posición de lectura insertar la pill arrastrada.
 *
 * `rects` son los rectángulos de las OTRAS pills (planos, sin nodos DOM),
 * en el orden DOM (= orden de lectura para flex-wrap).
 * `point` es la posición actual del puntero.
 *
 * Devuelve el índice de inserción (0 = antes de la primera, N = al final).
 *
 * Para un contenedor flex-wrap, "antes" de una pill significa:
 * - El puntero está por encima del borde superior de esa fila, O
 * - El puntero está en la misma fila y a la izquierda del centro horizontal.
 */
export function insertionIndex(rects, point) {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (point.y < r.top) return i;
    if (point.y <= r.bottom && point.x < r.left + r.width / 2) return i;
  }
  return rects.length;
}
