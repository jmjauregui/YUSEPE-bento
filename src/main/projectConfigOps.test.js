/**
 * src/main/projectConfigOps.test.js
 * Disco real, directorio temporal — cubre criterios C1 y C3 de la spec 028.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsp } from 'fs';
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  sanitizeAgentOrder,
  readAgentOrder,
  writeAgentOrder,
  readObserverAgent,
  writeObserverAgent,
} from './projectConfigOps.js';

const CONFIG_REL = path.join('.ybento', 'config', 'loop.json');

let tmpDir;
beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'bento-projcfg-'));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/* ---------- sanitizeAgentOrder ---------- */

describe('sanitizeAgentOrder', () => {
  it('null → []', () => expect(sanitizeAgentOrder(null)).toEqual([]));
  it('undefined → []', () => expect(sanitizeAgentOrder(undefined)).toEqual([]));
  it('cadena → []', () => expect(sanitizeAgentOrder('hola')).toEqual([]));
  it('objeto sin agentOrder → []', () => expect(sanitizeAgentOrder({ version: 1 })).toEqual([]));
  it('agentOrder no-array → []', () => expect(sanitizeAgentOrder({ agentOrder: 'claudio' })).toEqual([]));
  it('agentOrder = null → []', () => expect(sanitizeAgentOrder({ agentOrder: null })).toEqual([]));

  it('filtra nombres inválidos', () => {
    const raw = { agentOrder: ['claudio', '', 123, null, 'UPPER', 'ok-agent', '@loop-lead'] };
    // '' falla el regex; 123 no es string; null no es string; 'UPPER' → 'upper' OK;
    // 'ok-agent' OK; '@loop-lead' → 'loop-lead' OK
    expect(sanitizeAgentOrder(raw)).toEqual(['claudio', 'upper', 'ok-agent', 'loop-lead']);
  });

  it('nombres con @ se limpian', () => {
    expect(sanitizeAgentOrder({ agentOrder: ['@claudio', '@verifier'] })).toEqual(['claudio', 'verifier']);
  });

  it('duplicados: primera aparición gana', () => {
    expect(sanitizeAgentOrder({ agentOrder: ['claudio', 'verifier', 'claudio'] })).toEqual(['claudio', 'verifier']);
  });

  it('array enorme: tope de 200', () => {
    const big = Array.from({ length: 300 }, (_, i) => `ag${String(i).padStart(3, '0')}`);
    const result = sanitizeAgentOrder({ agentOrder: big });
    expect(result).toHaveLength(200);
    expect(result[0]).toBe('ag000');
    expect(result[199]).toBe('ag199');
  });

  it('nombre demasiado largo (> 32 chars) se descarta', () => {
    const long = 'a'.repeat(33);
    expect(sanitizeAgentOrder({ agentOrder: [long, 'ok'] })).toEqual(['ok']);
  });

  it('nombre que empieza con guión se descarta', () => {
    expect(sanitizeAgentOrder({ agentOrder: ['-bad', 'good'] })).toEqual(['good']);
  });
});

/* ---------- readAgentOrder ---------- */

describe('readAgentOrder', () => {
  it('archivo ausente → [] sin lanzar', async () => {
    expect(await readAgentOrder(tmpDir)).toEqual([]);
  });

  it('leer no crea la carpeta', async () => {
    await readAgentOrder(tmpDir);
    const configDir = path.join(tmpDir, '.ybento', 'config');
    await expect(readFile(path.join(configDir, 'loop.json'))).rejects.toThrow();
  });

  it('JSON inválido → []', async () => {
    const dir = path.join(tmpDir, '.ybento', 'config');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'loop.json'), 'no es json', 'utf8');
    expect(await readAgentOrder(tmpDir)).toEqual([]);
  });

  it('agentOrder no-array → []', async () => {
    const dir = path.join(tmpDir, '.ybento', 'config');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'loop.json'), JSON.stringify({ version: 1, agentOrder: 'malo' }), 'utf8');
    expect(await readAgentOrder(tmpDir)).toEqual([]);
  });

  it('nombres inválidos se descartan', async () => {
    const dir = path.join(tmpDir, '.ybento', 'config');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'loop.json'), JSON.stringify({ version: 1, agentOrder: ['ok', 'BAD_UPPER', '', 'good'] }), 'utf8');
    // 'BAD_UPPER' → 'bad_upper' OK por lowercasing; '' falla el regex
    expect(await readAgentOrder(tmpDir)).toEqual(['ok', 'bad_upper', 'good']);
  });
});

/* ---------- writeAgentOrder + ida y vuelta ---------- */

describe('writeAgentOrder', () => {
  it('crea la carpeta y escribe el archivo', async () => {
    await writeAgentOrder(tmpDir, ['claudio', 'verifier']);
    const raw = await readFile(path.join(tmpDir, CONFIG_REL), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.agentOrder).toEqual(['claudio', 'verifier']);
  });

  it('ida y vuelta: write → read devuelve el mismo array', async () => {
    const names = ['verifier', 'claudio', 'opencito'];
    await writeAgentOrder(tmpDir, names);
    expect(await readAgentOrder(tmpDir)).toEqual(names);
  });

  it('sanitiza antes de escribir', async () => {
    await writeAgentOrder(tmpDir, ['@claudio', 'UPPER', 'claudio', '']);
    expect(await readAgentOrder(tmpDir)).toEqual(['claudio', 'upper']);
  });

  it('sobreescribe el archivo previo', async () => {
    await writeAgentOrder(tmpDir, ['claudio', 'verifier']);
    await writeAgentOrder(tmpDir, ['verifier']);
    expect(await readAgentOrder(tmpDir)).toEqual(['verifier']);
  });

  it('dos escrituras seguidas no se interfieren (sufijo único)', async () => {
    const p1 = writeAgentOrder(tmpDir, ['claudio']);
    const p2 = writeAgentOrder(tmpDir, ['verifier']);
    await Promise.all([p1, p2]);
    // Una de las dos ganó (rename atómico); el archivo es válido
    const result = await readAgentOrder(tmpDir);
    expect(result.length).toBeGreaterThan(0);
  });

  it('array vacío escribe un archivo válido', async () => {
    await writeAgentOrder(tmpDir, []);
    expect(await readAgentOrder(tmpDir)).toEqual([]);
  });

  it('escribe dentro del workspace sin lanzar', async () => {
    await expect(writeAgentOrder(tmpDir, ['ok'])).resolves.toBeUndefined();
  });

  it('rename falla (EPERM): re-lanza el error y no deja .tmp-* en disco (H15)', async () => {
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EPERM simulado'), { code: 'EPERM' }),
    );
    await expect(writeAgentOrder(tmpDir, ['ok'])).rejects.toThrow('EPERM simulado');
    // No debe quedar ningún .tmp-* en .ybento/config.
    const cfgDir = path.join(tmpDir, '.ybento', 'config');
    const files = await readdir(cfgDir).catch(() => []);
    expect(files.filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });
});

/* ---------- 036: observerAgent + escrituras sin pisarse ---------- */

describe('observerAgent', () => {
  it('guardar el orden conserva observerAgent', async () => {
    await writeObserverAgent(tmpDir, 'coord');
    await writeAgentOrder(tmpDir, ['claudio', 'verifier']);
    expect(await readObserverAgent(tmpDir)).toBe('coord');
  });

  it('guardar observerAgent conserva el orden', async () => {
    await writeAgentOrder(tmpDir, ['claudio', 'verifier']);
    await writeObserverAgent(tmpDir, 'coord');
    expect(await readAgentOrder(tmpDir)).toEqual(['claudio', 'verifier']);
  });

  it('dos escrituras seguidas de campos distintos → quedan las dos', async () => {
    const p1 = writeAgentOrder(tmpDir, ['claudio']);
    const p2 = writeObserverAgent(tmpDir, 'coord');
    await Promise.all([p1, p2]);
    expect(await readAgentOrder(tmpDir)).toEqual(['claudio']);
    expect(await readObserverAgent(tmpDir)).toBe('coord');
  });

  it('observerAgent inválido en el archivo → null, sin romper el orden', async () => {
    const dir = path.join(tmpDir, '.ybento', 'config');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'loop.json'),
      JSON.stringify({ version: 1, agentOrder: ['claudio'], observerAgent: '!!invalido' }),
      'utf8',
    );
    expect(await readObserverAgent(tmpDir)).toBeNull();
    expect(await readAgentOrder(tmpDir)).toEqual(['claudio']);
  });
});
