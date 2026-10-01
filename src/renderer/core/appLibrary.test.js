import { describe, it, expect } from 'vitest';
import { LIBRARY_APPS, CATEGORIES } from './appLibrary.js';

describe('appLibrary', () => {
  it('toda app del catálogo pertenece a una categoría declarada', () => {
    for (const app of LIBRARY_APPS) {
      expect(CATEGORIES, `${app.name}: categoría "${app.category}"`).toContain(app.category);
    }
  });

  it('incluye Discord en la categoría Comunicación', () => {
    const discord = LIBRARY_APPS.find((a) => a.name === 'Discord');
    expect(discord).toBeDefined();
    expect(discord.url).toBe('https://discord.com/app');
    expect(discord.category).toBe('Comunicación');
    expect(discord.id).toBe('discord.com');
  });

  it('no repite ids (hostnames) en el catálogo', () => {
    const ids = LIBRARY_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
