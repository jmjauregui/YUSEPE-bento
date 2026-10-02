/**
 * src/main/loopObserver.js
 * Lógica pura del observador de inactividad del loop.
 * Sin I/O: todo por parámetro para testear con reloj inyectado.
 */

/** Umbral por defecto si main nunca recibió el ajuste del renderer. */
export const OBSERVER_THRESHOLD_MS = 10 * 60_000;

/**
 * Texto del aviso que se postea en el hilo.
 * @param {{ case: string, about: string[], minutesAgo: number, seq?: number|null }} opts
 */
export function observerText({ case: c, about, minutesAgo, seq = null }) {
  const min = Math.round(minutesAgo);
  const footer = ' (Aviso automático de Bento: no respondas a @bento.)';
  if (c === 'working') {
    const who = about.map((n) => `@${n}`).join(', ');
    return `No veo actividad: ${who} no imprime nada en su terminal hace ${min} min. Puede haber terminado sin avisar o estar esperando un permiso.${footer}`;
  }
  if (c === 'dropped') {
    const seqPart = seq != null ? ` #${seq}` : '';
    return `No veo actividad: @${about[0]} recibió${seqPart} hace ${min} min y no respondió.${footer}`;
  }
  if (c === 'undeliverable') {
    return `El último mensaje para @${about[0]} lleva ${min} min sin entregarse: su terminal ya no está en el workspace.${footer}`;
  }
  return `Inactividad detectada.${footer}`;
}

/**
 * Decide si hay que avisar sobre inactividad del loop.
 *
 * Orden de decisión (del plan.md):
 *   1. Umbral null → nada
 *   2. Menos de dos agentes → nada
 *   3. Sin último mensaje o anterior a watchStartedAt → nada
 *   4. Último mensaje para @usuario → nada (regla del usuario)
 *   5. Ocupado y callado (con memoria de episodios por marca de actividad)
 *   6. Pelota caída (solo si nadie en working; from !== bento)
 *      – entregado: destinatario en waiting, silencioso → avisar al designado
 *      – no entregado: sin terminal → avisar solo al usuario
 *
 * @param {{
 *   now: number,
 *   thresholdMs: number|null,
 *   watchStartedAt: number,
 *   agents: {name:string,state:string,cursor:string|null,updatedAt:string}[],
 *   lastMessage: {id:string,from:string,to:string,createdAt:string}|null,
 *   bound: Set<string>,
 *   lastDataAtByAgent: Record<string,number>,
 *   designated: string|null,
 *   alerted: Map<string,number>,
 * }} opts
 * @returns {{ notices: {to:string,case:string,about:string[]}[], alerted: Map<string,number> }}
 */
export function decideObserver({
  now,
  thresholdMs,
  watchStartedAt,
  agents,
  lastMessage,
  bound,
  lastDataAtByAgent,
  designated,
  alerted,
}) {
  const out = { notices: [], alerted: new Map(alerted) };

  // 1. Desactivado
  if (thresholdMs == null) return out;

  // 2. Menos de dos agentes
  if (!agents || agents.length < 2) return out;

  // 3. Sin último mensaje o anterior a watchStartedAt
  if (!lastMessage) return out;
  if (new Date(lastMessage.createdAt).getTime() < watchStartedAt) return out;

  // 4. Último mensaje para @usuario → el loop espera al usuario, no está trabado
  if (lastMessage.to === 'usuario') return out;

  // El designado sólo vale si sigue registrado en el loop.
  // Si el agente dejó el loop, cae en "sin designado" y el aviso va al usuario.
  const designatedOk = (designated && agents.some((a) => a.name === designated))
    ? designated
    : null;

  function activityMark(name) {
    const a = agents.find((ag) => ag.name === name);
    const updatedAt = a ? new Date(a.updatedAt).getTime() : 0;
    const lastData = lastDataAtByAgent[name] ?? 0;
    return Math.max(updatedAt, lastData);
  }

  // Tiene señal sólo si tiene terminal registrada (bound), no por lastDataAt
  function hasSignal(name) { return bound.has(name); }

  // Silencio estricto: > (no >=)
  function isSilent(name) {
    return hasSignal(name) && (now - activityMark(name)) > thresholdMs;
  }

  // 5. Ocupado y callado
  const silentWorking = agents
    .filter((a) => a.state === 'working' && isSilent(a.name));

  const newSilent = silentWorking.filter(
    (a) => out.alerted.get(a.name) !== activityMark(a.name),
  );

  if (newSilent.length > 0) {
    const names = newSilent.map((a) => a.name);
    // Al designado primero (si no está entre los callados)
    const target = (designatedOk && !names.includes(designatedOk)) ? designatedOk : null;
    if (target) out.notices.push({ to: target, case: 'working', about: names });
    out.notices.push({ to: 'usuario', case: 'working', about: names });
    for (const a of newSilent) out.alerted.set(a.name, activityMark(a.name));
    return out;
  }

  // 6. Pelota caída (sólo si nadie está en working)
  if (agents.some((a) => a.state === 'working')) return out;

  // El último mensaje no debe ser de @bento (evita bucle de avisos)
  if (lastMessage.from === 'bento') return out;

  const dest = lastMessage.to;
  const destAgent = agents.find((a) => a.name === dest);
  if (!destAgent) return out;

  const delivered = destAgent.cursor === lastMessage.id;

  if (delivered) {
    // El destinatario recibió pero no respondió
    if (destAgent.state !== 'waiting') return out;
    if (!isSilent(dest)) return out;

    const target = (designatedOk && designatedOk !== dest) ? designatedOk : null;
    if (target) {
      out.notices.push({ to: target, case: 'dropped', about: [dest] });
    } else {
      out.notices.push({ to: 'usuario', case: 'dropped', about: [dest] });
    }
  } else {
    // No entregado: si tiene terminal, el repartidor lo dará; no avisar
    if (bound.has(dest)) return out;
    // Sin terminal: el mensaje nunca llega → avisar sólo al usuario
    const elapsed = now - new Date(lastMessage.createdAt).getTime();
    if (elapsed <= thresholdMs) return out;
    out.notices.push({ to: 'usuario', case: 'undeliverable', about: [dest] });
  }

  return out;
}
