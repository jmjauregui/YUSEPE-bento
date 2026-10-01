/**
 * src/main/explorerFs.js
 * --------------------------------------------------------------
 * Lectura de sistema de archivos para el tile "Explorador".
 * Todo acceso se resuelve relativo a un `root` (el cwd del workspace)
 * y se valida que no escape de ahí (protección básica contra path
 * traversal vía `..`) — la lectura queda acotada al árbol del workspace.
 * --------------------------------------------------------------
 */
import { promises as fs, watch } from 'fs';
import path from 'path';

const MAX_PREVIEW_BYTES = 1_000_000;

const MEDIA_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

function resolveSafe(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath || '.');
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Ruta fuera del workspace');
  }
  return resolved;
}

/** Ruta absoluta validada dentro del workspace (para abrir con la app del sistema). */
export function resolvePath(root, relPath) {
  return resolveSafe(root, relPath);
}

/**
 * Como resolvePath, pero además exige que apunte a algo *adentro* del root
 * y no al root mismo. Lo usan las operaciones destructivas (borrar, renombrar):
 * sin esto, un relPath vacío o "." resolvería al workspace entero.
 */
export function resolveEntryPath(root, relPath) {
  const resolved = resolveSafe(root, relPath);
  if (resolved === path.resolve(root)) {
    throw new Error('No se puede operar sobre la raíz del workspace');
  }
  return resolved;
}

/** Lista el contenido de una carpeta (carpetas primero, luego alfabético). */
export async function listDir(root, relPath = '.') {
  const dir = resolveSafe(root, relPath);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      relPath: relPath === '.' ? e.name : path.join(relPath, e.name),
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

const SEARCH_IGNORE = new Set(['node_modules', '.git', 'out', 'release', 'dist', '.vite', 'build']);
const SEARCH_RESULT_LIMIT = 200;
const SEARCH_SCAN_LIMIT = 20_000; // tope de entradas visitadas, por si algún ignore no aplica

/**
 * Búsqueda recursiva de archivos por nombre (substring, case-insensitive).
 * Salta carpetas ruidosas típicas (node_modules, .git, etc.) y corta en
 * `SEARCH_RESULT_LIMIT` resultados / `SEARCH_SCAN_LIMIT` entradas visitadas
 * para no colgarse en árboles enormes.
 *
 * Los dotfiles y dotfolders SÍ se buscan (`.gitignore`, `.claude/…`): el
 * árbol los muestra, así que esconderlos del buscador era incoherente — el
 * usuario ve todos los archivos de su proyecto y debe poder saltar a
 * cualquiera. Lo único que no se recorre es `SEARCH_IGNORE`, que filtra por
 * carpeta concreta (incluida `.git`) y no por "empieza con punto".
 */
export async function searchFiles(root, query) {
  const resolvedRoot = path.resolve(root);
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results = [];
  let scanned = 0;
  const queue = ['.'];

  while (queue.length && results.length < SEARCH_RESULT_LIMIT && scanned < SEARCH_SCAN_LIMIT) {
    const relDir = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(resolveSafe(resolvedRoot, relDir), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (results.length >= SEARCH_RESULT_LIMIT || scanned >= SEARCH_SCAN_LIMIT) break;
      scanned++;

      const relPath = relDir === '.' ? e.name : path.join(relDir, e.name);
      if (e.isDirectory()) {
        if (!SEARCH_IGNORE.has(e.name)) queue.push(relPath);
      } else if (e.name.toLowerCase().includes(q)) {
        results.push({ name: e.name, relPath });
      }
    }
  }

  return results;
}

/** Lee un archivo para preview. Detecta binarios y corta archivos grandes. */
export async function readFilePreview(root, relPath) {
  const file = resolveSafe(root, relPath);
  const stat = await fs.stat(file);
  if (stat.isDirectory()) throw new Error('Es una carpeta, no un archivo');

  if (stat.size > MAX_PREVIEW_BYTES) {
    return { truncated: true, binary: false, content: '', size: stat.size };
  }

  const buf = await fs.readFile(file);
  const sample = buf.subarray(0, 8000);
  const isBinary = sample.includes(0);
  if (isBinary) {
    return { truncated: false, binary: true, content: '', size: stat.size };
  }

  return { truncated: false, binary: false, content: buf.toString('utf8'), size: stat.size };
}

const MAX_MEDIA_BYTES = 50_000_000;

/**
 * Lee los bytes crudos de una imagen o PDF para previsualizar (no pasa por
 * el chequeo de "binario" de readFilePreview, que está pensado para texto).
 * Devuelve el Buffer directo — vía IPC llega al renderer como Uint8Array, y
 * de ahí va a pdf.js (`data`) o a un Blob para <img>. Se leen los bytes acá
 * a propósito, para no depender de que el renderer pueda descargar el
 * archivo por sí mismo (protocolos custom / fetch dan problemas).
 */
export async function readMediaBytes(root, relPath) {
  const mime = MEDIA_MIME_TYPES[path.extname(relPath).toLowerCase()];
  if (!mime) throw new Error('Tipo de archivo no soportado para previsualizar como medio');

  const file = resolveSafe(root, relPath);
  const stat = await fs.stat(file);
  if (stat.isDirectory()) throw new Error('Es una carpeta, no un archivo');
  if (stat.size > MAX_MEDIA_BYTES) {
    throw new Error(`El archivo pesa ${(stat.size / 1_000_000).toFixed(1)} MB — el máximo para previsualizar es 50 MB.`);
  }

  const buf = await fs.readFile(file);
  return { mime, bytes: buf };
}

/**
 * Crea un archivo vacío o una carpeta dentro del workspace.
 *
 * `relPath` puede venir anidado ("src/utils/foo.js"): las carpetas
 * intermedias se crean solas, igual que en VSCode. `resolveSafe` corre
 * primero, así que el destino ya está garantizado dentro del root y el
 * mkdir recursivo de los padres no puede escaparse.
 *
 * La creación es exclusiva a propósito (`mkdir` sin `recursive`, `open`
 * con flag 'wx'): si ya existe, falla en vez de pisar el archivo del
 * usuario. Chequear con stat antes sería una race — dejamos que el propio
 * syscall resuelva y traducimos EEXIST a un mensaje legible.
 */
export async function createEntry(root, relPath, isDir = false) {
  const target = resolveSafe(root, relPath);
  if (target === path.resolve(root)) throw new Error('El nombre no puede estar vacío');

  const name = path.basename(target);
  await fs.mkdir(path.dirname(target), { recursive: true });

  try {
    if (isDir) {
      await fs.mkdir(target);
    } else {
      const handle = await fs.open(target, 'wx');
      await handle.close();
    }
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`Ya existe "${name}" en esa carpeta`);
    }
    throw err;
  }

  // Se devuelve la relPath normalizada por `path` (y no la del renderer)
  // para que la UI seleccione la entrada nueva con la misma forma de ruta
  // que produce listDir.
  return { name, isDir, relPath: path.relative(path.resolve(root), target) };
}

/**
 * ¿`target` ya está ocupado por otra entrada distinta de `source`?
 *
 * No alcanza con `stat(target)`: en macOS/Windows el FS es case-insensitive,
 * así que renombrar "Foo.md" -> "foo.md" encuentra el propio archivo origen
 * y parecería un choque. Se comparan los inodes para distinguir "ya existe
 * otra cosa ahí" de "es el mismo archivo con otra grafía".
 */
async function isOccupiedByOther(target, source) {
  const targetStat = await fs.stat(target).catch(() => null);
  if (!targetStat) return false;
  const sourceStat = await fs.stat(source).catch(() => null);
  if (!sourceStat) return true;
  return !(targetStat.ino === sourceStat.ino && targetStat.dev === sourceStat.dev);
}

/**
 * Renombra (o mueve, si `newName` trae subcarpetas) una entrada dentro del
 * workspace. Origen y destino se validan por separado contra el root.
 *
 * `fs.rename` pisa el destino en silencio en POSIX, así que el chequeo de
 * ocupado es lo único que evita que renombrar sobre un archivo existente lo
 * destruya. Queda una race chica entre el chequeo y el rename; se asume, la
 * alternativa portable no existe.
 */
export async function renameEntry(root, relPath, newName) {
  const source = resolveEntryPath(root, relPath);
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('El nombre no puede estar vacío');

  const target = resolveEntryPath(root, path.join(path.dirname(relPath), trimmed));
  if (target === source) return { name: path.basename(source), relPath, unchanged: true };

  if (await isOccupiedByOther(target, source)) {
    throw new Error(`Ya existe "${path.basename(target)}" en esa carpeta`);
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);

  const stat = await fs.stat(target);
  return {
    name: path.basename(target),
    isDir: stat.isDirectory(),
    relPath: path.relative(path.resolve(root), target),
  };
}

/**
 * Copia una entrada al lado de sí misma con sufijo " copia" (", copia 2", …
 * si ya estuviera tomado). Las carpetas se copian recursivamente.
 */
export async function duplicateEntry(root, relPath) {
  const source = resolveEntryPath(root, relPath);
  const stat = await fs.stat(source);

  const dir = path.dirname(source);
  const ext = stat.isDirectory() ? '' : path.extname(source);
  const base = path.basename(source, ext);

  let target = path.join(dir, `${base} copia${ext}`);
  for (let n = 2; await fs.stat(target).then(() => true, () => false); n++) {
    target = path.join(dir, `${base} copia ${n}${ext}`);
  }

  await fs.cp(source, target, { recursive: stat.isDirectory(), errorOnExist: true, force: false });

  return {
    name: path.basename(target),
    isDir: stat.isDirectory(),
    relPath: path.relative(path.resolve(root), target),
  };
}

/** Escribe un archivo (escritura atómica: .tmp + rename). */
export async function writeFile(root, relPath, content) {
  const file = resolveSafe(root, relPath);
  const stat = await fs.stat(file).catch(() => null);
  if (stat && stat.isDirectory()) throw new Error('Es una carpeta, no un archivo');

  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
  return { size: Buffer.byteLength(content, 'utf8') };
}

/**
 * Vigila un archivo puntual (tile fijado): un agente/editor externo lo
 * puede tocar en cualquier momento y el tile queda mostrando algo viejo
 * hasta que alguien lo recarga a mano.
 *
 * Se vigila la carpeta contenedora, no el archivo — mismo motivo que
 * `tasksOps.watchTasks`: un guardado atómico (tmp + rename, lo que hace
 * `writeFile` de acá arriba) cambia de inode, y `fs.watch` sobre el
 * archivo mismo pierde la referencia después del primer guardado externo.
 *
 * Devuelve una función para cortar la vigilancia, o `null` si la carpeta
 * todavía no existe.
 */
export function watchFile(root, relPath, onChange) {
  const file = resolveSafe(root, relPath);
  const dir = path.dirname(file);
  const base = path.basename(file);

  let watcher;
  try {
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (filename && filename !== base) return;
      onChange();
    });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  watcher.on('error', () => watcher.close());

  return () => watcher.close();
}
