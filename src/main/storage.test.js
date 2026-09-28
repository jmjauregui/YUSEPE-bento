import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ProfileStorage } from './storage.js';

let dir;
let storage;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-storage-test-'));
  storage = new ProfileStorage(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ProfileStorage.create', () => {
  it('crea un perfil con id único, tiles vacíos y cwd', async () => {
    const profile = await storage.create({ name: 'Trabajo', cwd: '/tmp/proyecto' });

    expect(profile.id).toBeTruthy();
    expect(profile.name).toBe('Trabajo');
    expect(profile.cwd).toBe('/tmp/proyecto');
    expect(profile.tiles).toEqual([]);
  });

  it('cwd es null si no se especifica', async () => {
    const profile = await storage.create({ name: 'Sin carpeta' });
    expect(profile.cwd).toBeNull();
  });

  it('rechaza nombres duplicados (case-insensitive)', async () => {
    await storage.create({ name: 'Trabajo' });
    await expect(storage.create({ name: 'trabajo' })).rejects.toThrow(/ya existe/i);
  });

  it('persiste el perfil en disco y en el índice', async () => {
    const profile = await storage.create({ name: 'Trabajo' });

    const loaded = await storage.load(profile.id);
    expect(loaded).toMatchObject({ id: profile.id, name: 'Trabajo' });

    const list = await storage.list();
    expect(list).toEqual([
      expect.objectContaining({ id: profile.id, name: 'Trabajo' }),
    ]);
  });
});

describe('ProfileStorage.save / load', () => {
  it('save persiste cambios (p.ej. tiles) y actualiza updatedAt', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    const firstUpdatedAt = profile.updatedAt;

    profile.tiles = [{ id: 't1', kind: 'terminal' }];
    await new Promise((r) => setTimeout(r, 5)); // asegura un updatedAt distinto
    const saved = await storage.save(profile);

    expect(saved.tiles).toHaveLength(1);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(firstUpdatedAt);

    const reloaded = await storage.load(profile.id);
    expect(reloaded.tiles).toHaveLength(1);
  });

  it('save sin id lanza', async () => {
    await expect(storage.save({ name: 'sin id' })).rejects.toThrow(/id/i);
  });

  it('load de un id inexistente lanza', async () => {
    await expect(storage.load('no-existe')).rejects.toThrow();
  });
});

describe('ProfileStorage.rename', () => {
  it('renombra y valida unicidad', async () => {
    const a = await storage.create({ name: 'A' });
    await storage.create({ name: 'B' });

    await expect(storage.rename(a.id, 'B')).rejects.toThrow(/ya existe/i);

    const renamed = await storage.rename(a.id, 'C');
    expect(renamed.name).toBe('C');

    const list = await storage.list();
    expect(list.find((p) => p.id === a.id).name).toBe('C');
  });

  it('permite renombrar a su propio nombre actual (no colisiona consigo mismo)', async () => {
    const a = await storage.create({ name: 'A' });
    await expect(storage.rename(a.id, 'A')).resolves.toMatchObject({ name: 'A' });
  });
});

describe('ProfileStorage.setCwd', () => {
  it('actualiza el cwd en el archivo y en el índice', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    await storage.setCwd(profile.id, '/nueva/carpeta');

    const loaded = await storage.load(profile.id);
    expect(loaded.cwd).toBe('/nueva/carpeta');

    const list = await storage.list();
    expect(list.find((p) => p.id === profile.id).cwd).toBe('/nueva/carpeta');
  });
});

describe('ProfileStorage.setWallpaper', () => {
  it('guarda el wallpaper en el archivo del perfil', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    const wallpaper = {
      url: 'https://images.pexels.com/photos/1/photo-1.jpeg',
      photographerName: 'Alguien',
      photographerUrl: 'https://www.pexels.com/@alguien',
      opacity: 0.6,
    };

    await storage.setWallpaper(profile.id, wallpaper);

    const loaded = await storage.load(profile.id);
    expect(loaded.wallpaper).toEqual(wallpaper);
  });

  it('null quita el wallpaper', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    await storage.setWallpaper(profile.id, { url: 'x', photographerName: 'y', photographerUrl: 'z', opacity: 1 });
    await storage.setWallpaper(profile.id, null);

    const loaded = await storage.load(profile.id);
    expect(loaded.wallpaper).toBeNull();
  });

  it('no aparece en el índice liviano (solo en el archivo del perfil)', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    await storage.setWallpaper(profile.id, { url: 'x', photographerName: 'y', photographerUrl: 'z', opacity: 1 });

    const list = await storage.list();
    expect(list.find((p) => p.id === profile.id).wallpaper).toBeUndefined();
  });
});

describe('ProfileStorage.create — tiles iniciales (plantillas)', () => {
  it('persiste los tiles recibidos y completa los ids que falten', async () => {
    const created = await storage.create({
      name: 'Con plantilla',
      tiles: [
        { kind: 'terminal', col: 1, row: 1, colSpan: 12, rowSpan: 20 },
        { id: 'fijo', kind: 'tasks', col: 13, row: 1, colSpan: 12, rowSpan: 20 },
      ],
    });
    const loaded = await storage.load(created.id);
    expect(loaded.tiles).toHaveLength(2);
    expect(typeof loaded.tiles[0].id).toBe('string');
    expect(loaded.tiles[0].id.length).toBeGreaterThan(0);
    expect(loaded.tiles[1].id).toBe('fijo');
    expect(loaded.gridVersion).toBe(3);
  });

  it('tiles que no son array se ignoran', async () => {
    const created = await storage.create({ name: 'Raro', tiles: 'x' });
    expect(created.tiles).toEqual([]);
  });
});

describe('ProfileStorage.importProfile', () => {
  it('crea un perfil nuevo con id propio (nunca reutiliza el del archivo)', async () => {
    const raw = { id: 'id-original', name: 'Deploy', cwd: '/tmp', tiles: [], gridVersion: 3 };
    const imported = await storage.importProfile(raw);

    expect(imported.id).toBeTruthy();
    expect(imported.id).not.toBe('id-original');
    expect(imported.name).toBe('Deploy');
  });

  it('resuelve colisión de nombre agregando un sufijo', async () => {
    await storage.create({ name: 'Deploy' });
    const imported = await storage.importProfile({ name: 'Deploy', tiles: [] });
    expect(imported.name).toBe('Deploy (2)');
  });

  it('preserva gridVersion del archivo — no fuerza re-migración si ya es la actual', async () => {
    const raw = {
      name: 'Ya migrado', tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }], gridVersion: 3,
    };
    const imported = await storage.importProfile(raw);
    expect(imported.tiles[0]).toMatchObject({ col: 5, row: 3, colSpan: 4, rowSpan: 2 });
  });

  it('migra la grilla si el archivo importado no tiene gridVersion (export viejo)', async () => {
    const raw = { name: 'Viejo', tiles: [{ id: 't1', col: 1, row: 1, colSpan: 3, rowSpan: 2 }] };
    const imported = await storage.importProfile(raw);
    expect(imported.gridVersion).toBe(3);
    expect(imported.tiles[0]).toMatchObject({ col: 1, row: 1, colSpan: 12, rowSpan: 8 });
  });

  it('tiles ausente o inválido se normaliza a array vacío', async () => {
    const imported = await storage.importProfile({ name: 'Sin tiles' });
    expect(imported.tiles).toEqual([]);
  });

  it('el perfil importado queda persistido en disco (list lo incluye)', async () => {
    await storage.importProfile({ name: 'Persistido', tiles: [] });
    const list = await storage.list();
    expect(list.some((p) => p.name === 'Persistido')).toBe(true);
  });
});

describe('ProfileStorage.remove', () => {
  it('elimina el archivo del perfil y su entrada del índice', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    await storage.remove(profile.id);

    await expect(storage.load(profile.id)).rejects.toThrow();
    expect(await storage.list()).toEqual([]);
  });

  it('eliminar un id inexistente no lanza', async () => {
    await expect(storage.remove('no-existe')).resolves.toBeUndefined();
  });

  it('tras eliminar, el nombre queda libre para reutilizarse', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    await storage.remove(profile.id);
    await expect(storage.create({ name: 'Trabajo' })).resolves.toMatchObject({ name: 'Trabajo' });
  });
});

describe('ProfileStorage.load — migración de grid (v1 6 col → v2 12 col → v3 24 col)', () => {
  async function writeRawProfile(id, overrides = {}) {
    const profile = {
      id, name: 'Legacy', cwd: null, createdAt: 1, updatedAt: 1, tiles: [],
      ...overrides,
    };
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  it('v1 (sin gridVersion) escala x4 en total: pasa por v2 y v3', async () => {
    await writeRawProfile('legacy-1', {
      tiles: [{ id: 't1', col: 3, row: 2, colSpan: 2, rowSpan: 1 }],
    });
    const loaded = await storage.load('legacy-1');
    expect(loaded.gridVersion).toBe(3);
    // (3-1)*4+1 = 9 · (2-1)*4+1 = 5 · 2*4 = 8 · 1*4 = 4
    expect(loaded.tiles[0]).toMatchObject({ col: 9, row: 5, colSpan: 8, rowSpan: 4 });
  });

  it('v2 escala x2 y queda en v3', async () => {
    await writeRawProfile('v2-1', {
      gridVersion: 2,
      tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }],
    });
    const loaded = await storage.load('v2-1');
    expect(loaded.gridVersion).toBe(3);
    expect(loaded.tiles[0]).toMatchObject({ col: 9, row: 5, colSpan: 8, rowSpan: 4 });
  });

  it('persiste la migración: cargar de nuevo no vuelve a escalar', async () => {
    await writeRawProfile('legacy-2', {
      gridVersion: 2,
      tiles: [{ id: 't1', col: 1, row: 1, colSpan: 6, rowSpan: 2 }],
    });
    await storage.load('legacy-2');
    const loadedAgain = await storage.load('legacy-2');
    expect(loadedAgain.tiles[0]).toMatchObject({ col: 1, row: 1, colSpan: 12, rowSpan: 4 });
  });

  it('perfiles ya en gridVersion 3 no se tocan', async () => {
    await writeRawProfile('current-1', {
      gridVersion: 3,
      tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }],
    });
    const loaded = await storage.load('current-1');
    expect(loaded.tiles[0]).toMatchObject({ col: 5, row: 3, colSpan: 4, rowSpan: 2 });
  });

  it('perfiles de una app más nueva (gridVersion > 3) no se tocan ni se reescriben', async () => {
    await writeRawProfile('future-1', {
      gridVersion: 4,
      tiles: [{ id: 't1', col: 5, row: 3, colSpan: 4, rowSpan: 2 }],
    });
    const loaded = await storage.load('future-1');
    expect(loaded.gridVersion).toBe(4);
    expect(loaded.tiles[0]).toMatchObject({ col: 5, row: 3, colSpan: 4, rowSpan: 2 });
  });

  it('un gridVersion inválido se trata como v1', async () => {
    await writeRawProfile('bad-1', {
      gridVersion: 'x',
      tiles: [{ id: 't1', col: 1, row: 1, colSpan: 1, rowSpan: 1 }],
    });
    const loaded = await storage.load('bad-1');
    expect(loaded.gridVersion).toBe(3);
    expect(loaded.tiles[0]).toMatchObject({ col: 1, row: 1, colSpan: 4, rowSpan: 4 });
  });

  it('tiles sin posición solo escalan los campos presentes', async () => {
    await writeRawProfile('partial-1', {
      gridVersion: 2,
      tiles: [{ id: 't1', colSpan: 3, rowSpan: 5 }],
    });
    const loaded = await storage.load('partial-1');
    expect(loaded.tiles[0]).toEqual({ id: 't1', colSpan: 6, rowSpan: 10 });
  });
});

describe('ProfileStorage — deduplicación del índice', () => {
  it('_readIndex limpia entradas duplicadas y persiste el índice corregido', async () => {
    const profile = await storage.create({ name: 'Trabajo' });

    // Corrompemos el índice a mano simulando el bug histórico (duplicados).
    const idxPath = path.join(dir, '_index.json');
    const idx = JSON.parse(await fs.readFile(idxPath, 'utf8'));
    idx.profiles.push({ ...idx.profiles[0] });
    await fs.writeFile(idxPath, JSON.stringify(idx, null, 2), 'utf8');

    const list = await storage.list();
    expect(list).toHaveLength(1);

    // Y que haya quedado persistido limpio en disco (no solo en memoria).
    const onDisk = JSON.parse(await fs.readFile(idxPath, 'utf8'));
    expect(onDisk.profiles).toHaveLength(1);
    expect(onDisk.profiles[0].id).toBe(profile.id);
  });
});

describe('ProfileStorage.isNameTaken', () => {
  it('excluye el propio id (para permitir rename a sí mismo)', async () => {
    const profile = await storage.create({ name: 'Trabajo' });
    expect(await storage.isNameTaken('Trabajo', profile.id)).toBe(false);
    expect(await storage.isNameTaken('Trabajo')).toBe(true);
  });

  it('devuelve false cuando no hay índice todavía (perfil recién creado el dir)', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-storage-fresh-'));
    const fresh = new ProfileStorage(freshDir);
    expect(await fresh.isNameTaken('lo que sea')).toBe(false);
    await fs.rm(freshDir, { recursive: true, force: true });
  });
});
