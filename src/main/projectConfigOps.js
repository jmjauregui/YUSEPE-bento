/**
 * src/main/projectConfigOps.js
 * --------------------------------------------------------------
 * Lee y escribe .ybento/config/loop.json: orden de pills y agente designado.
 *
 * Escritura con patrón leer-mezclar-escribir, en fila por ruta (fileChains):
 * dos escrituras simultáneas de campos distintos no se pisan.
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_FILE = path.join('.ybento', 'config', 'loop.json');
const MAX_NAMES = 200;

// Misma expresión que normalizeName en loopOps.js:65 — se replica aquí para
// descartar en silencio, no lanzar. Si el patrón cambia, actualizar también acá.
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

let _writeCounter = 0;

// Cadena de promesas por ruta absoluta: serializa escrituras al mismo archivo.
const fileChains = new Map();

function chainFor(filePath) {
  return fileChains.get(filePath) ?? Promise.resolve();
}

function setChain(filePath, p) {
  fileChains.set(filePath, p.catch(() => {}));
}

function resolveSafe(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Ruta fuera del workspace');
  }
  return resolved;
}

/**
 * Valida y limpia una lista de nombres de agentes.
 * Nunca lanza: cualquier entrada inválida devuelve [].
 */
export function sanitizeAgentOrder(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.agentOrder)) return [];
  const seen = new Set();
  const result = [];
  for (const item of raw.agentOrder) {
    if (result.length >= MAX_NAMES) break;
    if (typeof item !== 'string') continue;
    const name = item.toLowerCase().replace(/^@/, '');
    if (!NAME_RE.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function sanitizeObserverAgent(value) {
  if (typeof value !== 'string') return null;
  const name = value.toLowerCase().replace(/^@/, '');
  return NAME_RE.test(name) ? name : null;
}

async function readRaw(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeRaw(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${++_writeCounter}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    // H15: si writeFile o rename fallan, borrar el temporal para no dejar huérfanos.
    try { await fs.unlink(tmp); } catch { /* ya borrado o inaccesible */ }
    throw err;
  }
}

/**
 * Lee, mezcla el parche y escribe, en fila por ruta.
 * `patch` puede tener { agentOrder?, observerAgent? }.
 * Las dos escrituras simultáneas de campos distintos no se pisan.
 */
function mergeWrite(cwd, patch) {
  const filePath = resolveSafe(cwd, CONFIG_FILE);
  const next = chainFor(filePath).then(async () => {
    const existing = await readRaw(filePath);
    const agentOrder = sanitizeAgentOrder(
      patch.agentOrder !== undefined
        ? { agentOrder: patch.agentOrder }
        : existing,
    );
    const observerAgent = patch.observerAgent !== undefined
      ? sanitizeObserverAgent(patch.observerAgent)
      : sanitizeObserverAgent(existing.observerAgent);
    await writeRaw(filePath, { version: 1, agentOrder, observerAgent });
  });
  setChain(filePath, next);
  return next;
}

/**
 * Lee el orden guardado. Ausente, roto o inválido → [].
 * Leer nunca crea la carpeta.
 */
export async function readAgentOrder(cwd) {
  const filePath = resolveSafe(cwd, CONFIG_FILE);
  try {
    return sanitizeAgentOrder(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return [];
  }
}

/**
 * Guarda el orden con escritura atómica, sin pisar observerAgent.
 * Sanitiza antes de escribir: el archivo es del proyecto y lo lee un humano.
 */
export async function writeAgentOrder(cwd, names) {
  const sanitized = sanitizeAgentOrder({ agentOrder: Array.isArray(names) ? names : [] });
  return mergeWrite(cwd, { agentOrder: sanitized });
}

/**
 * Lee el agente designado para recibir avisos del observador.
 * Ausente, roto o inválido → null.
 */
export async function readObserverAgent(cwd) {
  const filePath = resolveSafe(cwd, CONFIG_FILE);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return sanitizeObserverAgent(raw.observerAgent);
  } catch {
    return null;
  }
}

/**
 * Guarda el agente designado sin pisar agentOrder.
 * name = null borra la designación.
 */
export async function writeObserverAgent(cwd, name) {
  return mergeWrite(cwd, { observerAgent: name });
}
