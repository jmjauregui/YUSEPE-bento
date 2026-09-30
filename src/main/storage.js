/**
 * src/main/storage.js
 * --------------------------------------------------------------
 * Capa de persistencia de perfiles.
 * - Cada perfil es un JSON en: <userData>/profiles/<id>.json
 * - Índice ligero en: <userData>/profiles/_index.json
 * - Escrituras atómicas (.tmp + rename).
 * - Nombres únicos validados en create y rename.
 * - Deduplicación automática del índice al leer (fix bug anterior).
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Historial de resoluciones del grid (ver core/layout.js y bentoGrid.js):
//   v1: 6 columnas / filas de 140px (perfiles sin `gridVersion`)
//   v2: 12 columnas / filas de 70px
//   v3: 24 columnas / filas de 35px
//   v4: 48 columnas / filas de 35px (solo columnas: filas más finas que
//       35px ya no aportan y hacen saltar el arrastre vertical)
// Cada salto multiplica los segmentos con la misma resolución física, así
// que un perfil migrado se ve idéntico. La migración corre una sola vez al
// cargar, encadenando las versiones que falten, y se persiste.
const GRID_VERSION = 4;
/** Factores de escala (columnas, filas) para pasar de la versión N a la N+1. */
const GRID_SCALE_FROM = {
  1: { cols: 2, rows: 2 },
  2: { cols: 2, rows: 2 },
  3: { cols: 2, rows: 1 },
};

function isCurrentOrNewer(profile) {
  return Number.isInteger(profile.gridVersion) && profile.gridVersion >= GRID_VERSION;
}

function scaleTiles(tiles, { cols, rows }) {
  for (const tile of tiles || []) {
    if (tile.col != null) tile.col = (tile.col - 1) * cols + 1;
    if (tile.row != null) tile.row = (tile.row - 1) * rows + 1;
    if (tile.colSpan != null) tile.colSpan = tile.colSpan * cols;
    if (tile.rowSpan != null) tile.rowSpan = tile.rowSpan * rows;
  }
}

function migrateGrid(profile) {
  // Un perfil de una app más nueva no se toca: no sabemos cómo leerlo.
  if (isCurrentOrNewer(profile)) return profile;
  let version = Number.isInteger(profile.gridVersion) && profile.gridVersion >= 1
    ? profile.gridVersion
    : 1;
  while (version < GRID_VERSION) {
    scaleTiles(profile.tiles, GRID_SCALE_FROM[version]);
    version += 1;
  }
  profile.gridVersion = GRID_VERSION;
  return profile;
}

export class ProfileStorage {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.indexPath = join(baseDir, '_index.json');
  }

  async _ensureDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async _readIndex() {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      const idx = JSON.parse(raw);
      // Deduplicación: fix del bug que creaba entradas duplicadas.
      const seen = new Set();
      const before = idx.profiles.length;
      idx.profiles = idx.profiles.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      // Si removimos duplicados, persistir el índice limpio.
      if (idx.profiles.length < before) {
        await this._writeIndex(idx);
      }
      return idx;
    } catch (err) {
      if (err.code === 'ENOENT') return { profiles: [] };
      throw err;
    }
  }

  async _writeIndex(index) {
    const tmp = `${this.indexPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
    await fs.rename(tmp, this.indexPath);
  }

  async list() {
    const idx = await this._readIndex();
    return idx.profiles;
  }

  /** Verifica si un nombre ya está en uso (case-insensitive). */
  async isNameTaken(name, excludeId = null) {
    const idx = await this._readIndex();
    return idx.profiles.some(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId
    );
  }

  /**
   * Crea un perfil. Valida unicidad de nombre. `cwd` es la carpeta de inicio
   * del workspace. `tiles` (opcional) son los tiles iniciales de una
   * plantilla de distribución, ya en coordenadas de la grilla actual; a los
   * que vengan sin `id` se les asigna uno.
   */
  async create({ name = 'Nuevo perfil', cwd = null, tiles = [] } = {}) {
    if (await this.isNameTaken(name)) {
      throw new Error(`Ya existe un perfil llamado "${name}"`);
    }
    await this._ensureDir();
    const id = randomUUID();
    const now = Date.now();
    const initialTiles = Array.isArray(tiles)
      ? tiles.map((t) => ({ ...t, id: t.id || randomUUID() }))
      : [];
    const profile = { id, name, cwd: cwd || null, createdAt: now, updatedAt: now, tiles: initialTiles, gridVersion: GRID_VERSION };
    // _writeProfile ya actualiza el índice. NO hacer push adicional.
    await this._writeProfile(profile);
    return profile;
  }

  async _writeProfile(profile) {
    await this._ensureDir();
    const path = join(this.baseDir, `${profile.id}.json`);
    const tmp = `${path}.tmp`;
    profile.updatedAt = Date.now();
    await fs.writeFile(tmp, JSON.stringify(profile, null, 2), 'utf8');
    await fs.rename(tmp, path);

    // Actualizar índice (busca si existe, actualiza o crea).
    const idx = await this._readIndex();
    const entry = idx.profiles.find((p) => p.id === profile.id);
    if (entry) {
      entry.name = profile.name;
      entry.cwd = profile.cwd || null;
      entry.updatedAt = profile.updatedAt;
      entry.lastOpenedAt = profile.lastOpenedAt || entry.lastOpenedAt || null;
    } else {
      idx.profiles.push({
        id: profile.id,
        name: profile.name,
        cwd: profile.cwd || null,
        updatedAt: profile.updatedAt,
        lastOpenedAt: profile.lastOpenedAt || null,
      });
    }
    await this._writeIndex(idx);
  }

  async load(id) {
    const path = join(this.baseDir, `${id}.json`);
    const raw = await fs.readFile(path, 'utf8');
    const profile = JSON.parse(raw);
    if (!isCurrentOrNewer(profile)) {
      migrateGrid(profile);
      await this._writeProfile(profile); // persistir la migración una sola vez
    }
    return profile;
  }

  /**
   * Registra que el workspace se acaba de abrir (para ordenarlo y mostrar
   * "última visita"). No pasa por _writeProfile a propósito para no tocar
   * `updatedAt` — abrir no es lo mismo que editar. Escribe el archivo del
   * perfil y el índice directamente.
   */
  async touchLastOpened(id) {
    const now = Date.now();
    let profile = null;
    try {
      profile = await this.load(id);
    } catch (err) {
      if (err.code === 'ENOENT') return null; // perfil borrado; nada que tocar
      throw err;
    }
    profile.lastOpenedAt = now;

    const path = join(this.baseDir, `${id}.json`);
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(profile, null, 2), 'utf8');
    await fs.rename(tmp, path);

    const idx = await this._readIndex();
    const entry = idx.profiles.find((p) => p.id === id);
    if (entry) {
      entry.lastOpenedAt = now;
      await this._writeIndex(idx);
    }
    return profile;
  }

  async save(profile) {
    if (!profile?.id) throw new Error('El perfil necesita un id');
    await this._writeProfile(profile);
    return profile;
  }

  /** Renombra un perfil. Valida unicidad. */
  async rename(id, newName) {
    if (await this.isNameTaken(newName, id)) {
      throw new Error(`Ya existe un perfil llamado "${newName}"`);
    }
    const profile = await this.load(id);
    profile.name = newName;
    await this._writeProfile(profile);
    return profile;
  }

  /** Cambia la carpeta de inicio (cwd) de un perfil. */
  async setCwd(id, cwd) {
    const profile = await this.load(id);
    profile.cwd = cwd || null;
    await this._writeProfile(profile);
    return profile;
  }

  /**
   * Cambia el fondo de pantalla del workspace.
   * `wallpaper`: { url, photographerName, photographerUrl, downloadLocation, opacity } | null
   */
  async setWallpaper(id, wallpaper) {
    const profile = await this.load(id);
    profile.wallpaper = wallpaper || null;
    await this._writeProfile(profile);
    return profile;
  }

  /**
   * Crea un perfil nuevo a partir de un JSON exportado (ver `export` en
   * main/index.js). Siempre genera un id nuevo (nunca reutiliza el del
   * archivo, así nunca choca con un perfil que ya exista en este equipo,
   * ni siquiera si se reimporta el mismo archivo dos veces) y resuelve
   * colisiones de nombre agregando un sufijo " (2)", " (3)"...
   *
   * `gridVersion` del archivo se preserva tal cual (no se fuerza a
   * migrar): si viene de una resolución de grid anterior, `load()` la
   * migra sola la primera vez que se abre, igual que cualquier perfil
   * local viejo.
   */
  async importProfile(rawProfile) {
    await this._ensureDir();
    const id = randomUUID();
    let name = (rawProfile.name || 'Workspace importado').trim() || 'Workspace importado';
    if (await this.isNameTaken(name)) {
      let n = 2;
      while (await this.isNameTaken(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
    }
    const now = Date.now();
    const profile = {
      ...rawProfile,
      id,
      name,
      tiles: Array.isArray(rawProfile.tiles) ? rawProfile.tiles : [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    };
    await this._writeProfile(profile);
    return this.load(id); // dispara migrateGrid si el archivo es de una resolución vieja
  }

  async remove(id) {
    const path = join(this.baseDir, `${id}.json`);
    try {
      await fs.unlink(path);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const idx = await this._readIndex();
    idx.profiles = idx.profiles.filter((p) => p.id !== id);
    await this._writeIndex(idx);
  }
}
