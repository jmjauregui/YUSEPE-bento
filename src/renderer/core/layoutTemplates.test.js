import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES, validateTemplate, instantiateTemplate, templateFromProfile,
} from './layoutTemplates.js';

describe('BUILTIN_TEMPLATES', () => {
  it('todas son válidas y la primera es "vacio"', () => {
    expect(BUILTIN_TEMPLATES[0].id).toBe('vacio');
    for (const t of BUILTIN_TEMPLATES) expect(validateTemplate(t), t.id).toEqual({ ok: true });
  });

  it('tienen ids únicos y están marcadas como incorporadas', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BUILTIN_TEMPLATES) expect(t.builtin).toBe(true);
  });
});

describe('validateTemplate', () => {
  const base = { name: 'x', tiles: [] };

  it('rechaza kinds desconocidos', () => {
    const r = validateTemplate({ ...base, tiles: [{ kind: 'nope', col: 1, row: 1, colSpan: 2, rowSpan: 2 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nope/);
  });

  it('rechaza tiles fuera de las 24 columnas', () => {
    const r = validateTemplate({ ...base, tiles: [{ kind: 'terminal', col: 20, row: 1, colSpan: 6, rowSpan: 2 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/24/);
  });

  it('rechaza solapes', () => {
    const r = validateTemplate({ ...base, tiles: [
      { kind: 'terminal', col: 1, row: 1, colSpan: 4, rowSpan: 4 },
      { kind: 'terminal', col: 3, row: 3, colSpan: 4, rowSpan: 4 },
    ] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/solap/i);
  });

  it('rechaza nombre vacío y tiles que no son array', () => {
    expect(validateTemplate({ name: '', tiles: [] }).ok).toBe(false);
    expect(validateTemplate({ name: 'x', tiles: null }).ok).toBe(false);
  });

  it('rechaza posiciones o tamaños que no son enteros positivos', () => {
    expect(validateTemplate({ ...base, tiles: [{ kind: 'terminal', col: 0, row: 1, colSpan: 2, rowSpan: 2 }] }).ok).toBe(false);
    expect(validateTemplate({ ...base, tiles: [{ kind: 'terminal', col: 1, row: 1, colSpan: 0, rowSpan: 2 }] }).ok).toBe(false);
    expect(validateTemplate({ ...base, tiles: [{ kind: 'terminal', col: 1.5, row: 1, colSpan: 2, rowSpan: 2 }] }).ok).toBe(false);
  });
});

describe('instantiateTemplate', () => {
  it('da ids nuevos y únicos y conserva geometría, comando y url', () => {
    let n = 0;
    const tpl = { id: 't', name: 't', tiles: [
      { kind: 'terminal', title: 'A', col: 1, row: 1, colSpan: 12, rowSpan: 20, command: 'htop' },
      { kind: 'webview', title: 'W', col: 13, row: 1, colSpan: 12, rowSpan: 20, url: 'https://example.com' },
    ] };
    const tiles = instantiateTemplate(tpl, { newId: () => `id-${++n}`, now: () => 123 });
    expect(tiles.map((t) => t.id)).toEqual(['id-1', 'id-2']);
    expect(tiles[0]).toEqual({ id: 'id-1', createdAt: 123, kind: 'terminal', title: 'A', col: 1, row: 1, colSpan: 12, rowSpan: 20, command: 'htop' });
    expect(tiles[1]).toMatchObject({ kind: 'webview', url: 'https://example.com' });
    // No muta la plantilla
    expect(tpl.tiles[0].id).toBeUndefined();
  });

  it('lanza si la plantilla es inválida', () => {
    expect(() => instantiateTemplate({ name: 'x', tiles: [{ kind: 'nope', col: 1, row: 1, colSpan: 1, rowSpan: 1 }] }))
      .toThrow();
  });

  it('la plantilla vacía instancia cero tiles', () => {
    expect(instantiateTemplate(BUILTIN_TEMPLATES[0])).toEqual([]);
  });
});

describe('templateFromProfile', () => {
  it('conserva la distribución y descarta lo que es del workspace', () => {
    const profile = { id: 'p', name: 'Motor', cwd: '/x', tiles: [
      { id: 'a', kind: 'terminal', title: 'MAC', col: 1, row: 1, colSpan: 6, rowSpan: 20, command: 'claude', cwd: '/x', createdAt: 1, loopAgent: 'mac' },
      { id: 'b', kind: 'webview', title: 'D', col: 7, row: 1, colSpan: 6, rowSpan: 20, url: 'https://d', zoom: 0.8 },
    ] };
    const tpl = templateFromProfile(profile, { name: 'Mía', description: 'desc' });
    expect(tpl).toEqual({ name: 'Mía', description: 'desc', tiles: [
      { kind: 'terminal', title: 'MAC', col: 1, row: 1, colSpan: 6, rowSpan: 20, command: 'claude' },
      { kind: 'webview', title: 'D', col: 7, row: 1, colSpan: 6, rowSpan: 20, url: 'https://d', zoom: 0.8 },
    ] });
    expect(validateTemplate(tpl)).toEqual({ ok: true });
  });

  it('un perfil sin tiles da una plantilla vacía con descripción por defecto', () => {
    expect(templateFromProfile({ tiles: [] }, { name: 'Nada' })).toEqual({ name: 'Nada', description: '', tiles: [] });
  });
});
