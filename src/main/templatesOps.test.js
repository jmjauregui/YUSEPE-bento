import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { TemplatesStore } from './templatesOps.js';

let dir;
let store;

const TILES = [
  { kind: 'terminal', title: 'T1', col: 1, row: 1, colSpan: 12, rowSpan: 20 },
  { kind: 'terminal', title: 'T2', col: 13, row: 1, colSpan: 12, rowSpan: 20 },
];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-templates-test-'));
  store = new TemplatesStore(path.join(dir, 'layout-templates.json'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('TemplatesStore.list', () => {
  it('devuelve [] si el archivo todavía no existe', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('devuelve las plantillas ordenadas por nombre', async () => {
    await store.create({ name: 'Zeta', tiles: TILES });
    await store.create({ name: 'Alfa', tiles: TILES });
    const list = await store.list();
    expect(list.map((t) => t.name)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('TemplatesStore.create', () => {
  it('guarda id, nombre, descripción, tiles y fecha', async () => {
    const t = await store.create({ name: '  Mía  ', description: 'd', tiles: TILES });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe('Mía');
    expect(t.description).toBe('d');
    expect(t.tiles).toEqual(TILES);
    expect(typeof t.createdAt).toBe('number');
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'layout-templates.json'), 'utf8'));
    expect(raw.templates).toHaveLength(1);
  });

  it('la descripción es opcional', async () => {
    const t = await store.create({ name: 'Sin desc', tiles: [] });
    expect(t.description).toBe('');
  });

  it('rechaza nombre vacío', async () => {
    await expect(store.create({ name: '   ', tiles: TILES })).rejects.toThrow(/nombre/);
  });

  it('rechaza tiles que no son un array', async () => {
    await expect(store.create({ name: 'x', tiles: 'no' })).rejects.toThrow(/tiles/);
  });
});

describe('TemplatesStore.remove', () => {
  it('elimina por id', async () => {
    const a = await store.create({ name: 'A', tiles: TILES });
    await store.create({ name: 'B', tiles: TILES });
    await store.remove(a.id);
    expect((await store.list()).map((t) => t.name)).toEqual(['B']);
  });

  it('un id inexistente no falla', async () => {
    await store.create({ name: 'A', tiles: TILES });
    await expect(store.remove('nope')).resolves.toBeUndefined();
    expect(await store.list()).toHaveLength(1);
  });
});
