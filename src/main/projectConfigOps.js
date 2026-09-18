/**
 * src/main/projectConfigOps.js
 * --------------------------------------------------------------
 * Lee y escribe .ybento/config/loop.json: el orden de las pills de agentes.
 *
 * El renderer pide por IPC; nunca toca disco.
 * Escritura atómica con sufijo único por escritura (pid + contador) para que
 * dos escrituras seguidas en el mismo proceso no compartan archivo temporal.
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

/**
 * Lee el orden guardado. Ausente, roto o inválido → [].
 * Leer nunca crea la carpeta.
 */
export async function readAgentOrder(cwd) {
  const file = resolveSafe(cwd, CONFIG_FILE);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return sanitizeAgentOrder(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Guarda el orden con escritura atómica.
 * Sanitiza antes de escribir: el archivo es del proyecto y lo lee un humano.
 */
export async function writeAgentOrder(cwd, names) {
  const sanitized = sanitizeAgentOrder({ agentOrder: Array.isArray(names) ? names : [] });
  const file = resolveSafe(cwd, CONFIG_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${++_writeCounter}`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ version: 1, agentOrder: sanitized }, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    // H15: si writeFile o rename fallan, borrar el temporal para no dejar huérfanos.
    try { await fs.unlink(tmp); } catch { /* ya borrado o inaccesible */ }
    throw err;
  }
}
