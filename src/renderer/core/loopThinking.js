/**
 * src/renderer/core/loopThinking.js
 * --------------------------------------------------------------
 * "@claudio está contando cabellos…" — la señal de que un agente del loop
 * está trabajando (estado `working`). Sin esto, después de mandar un
 * mensaje el hilo queda quieto y no se sabe si alguien lo está atendiendo.
 *
 * Las frases rotan para que se note que está vivo, como el indicador de
 * Claude Code. Cada agente arranca en una frase distinta (semilla por
 * nombre) así dos agentes trabajando a la vez no dicen lo mismo.
 * Lógica pura, sin DOM.
 * --------------------------------------------------------------
 */

export const THINKING_PHRASES = [
  'dilucidando', 'contando cabellos', 'apretando una tuerca', 'desenredando cables',
  'consultando al oráculo', 'afinando el violín', 'peinando el código',
  'ordenando el cajón de las medias', 'calentando motores', 'destapando la cañería',
  'haciendo malabares', 'alineando los astros', 'cebando el mate', 'persiguiendo un bug',
  'leyendo la letra chica', 'contando ovejas eléctricas', 'puliendo los bordes',
  'desarmando el reloj', 'armando el rompecabezas', 'buscando la media perdida',
  'sacudiendo la alfombra', 'regando las plantas del repo', 'hablando con el pato de goma',
  'doblando la ropa', 'lustrando los zapatos', 'inflando globos', 'sintonizando la radio',
  'ajustando el tornillo flojo', 'rebobinando el casete', 'hirviendo el agua',
  'revolviendo la olla', 'barajando las cartas', 'midiendo dos veces', 'atando cabos',
  'uniendo los puntos', 'cazando mariposas', 'domando el compilador', 'negociando con el linter',
  'descifrando jeroglíficos', 'encendiendo la chispa', 'tejiendo el algoritmo',
  'masticando el problema', 'rascándose la cabeza', 'tomando un café',
  'mirando por la ventana con intensidad', 'esquivando un merge conflict',
];

/** Semilla estable por nombre: el mismo agente arranca siempre en la misma frase. */
function seedOf(name) {
  let n = 0;
  for (const ch of String(name)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return n;
}

/** Frase del agente en el "tick" `tick` (sube cada pocos segundos). */
export function thinkingPhrase(name, tick) {
  const i = (seedOf(name) + tick) % THINKING_PHRASES.length;
  return THINKING_PHRASES[i];
}

/** "hace 3 min" desde que pasó a working; vacío el primer minuto. */
export function workingFor(sinceIso, now = Date.now()) {
  const ms = now - new Date(sinceIso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return '';
  const min = Math.floor(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Línea a mostrar en el panel de "pensando" para un agente.
 * - rojo (titilando o no) → kind 'phrase': la frase rotatoria del agente
 * - ámbar → kind 'problem': el diagnóstico del dot, sin frase (decisión 044-B)
 * - verde / gris → null (el agente no aparece en el panel)
 *
 * @param {{ dot: {color: string, blink: boolean, label: string}, phrase: string, elapsed: string }} opts
 * @returns {{ kind: 'phrase'|'problem', color: string, text: string } | null}
 */
export function thinkingLine({ dot, phrase }) {
  if (dot.color === 'red') return { kind: 'phrase', color: 'red', text: phrase };
  if (dot.color === 'amber') return { kind: 'problem', color: 'amber', text: dot.label };
  return null;
}
