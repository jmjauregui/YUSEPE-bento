/**
 * src/renderer/theme-vars.test.js
 * --------------------------------------------------------------
 * Regresión de las variables de canales `--*-rgb`.
 *
 * Estuvieron definidas con comas (`10, 132, 255`) mientras Tailwind las
 * consumía como `rgb(var(--x) / <alpha>)`. `rgb()` no deja mezclar comas
 * con la barra, así que el color era inválido y el navegador descartaba la
 * declaración: `bg-accent` no pintaba **nada**. En tema oscuro no se veía
 * (texto blanco sobre un fondo sin pintar igual se lee) y en claro dejaba
 * los botones primarios blancos sobre blanco.
 *
 * Se testea leyendo el archivo y no el DOM porque es una invariante de
 * sintaxis, no de render: vitest corre con `environment: 'node'` y esto no
 * necesita jsdom para atrapar el error.
 * --------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath y no `.pathname`: en Windows el pathname de un file-URL es
// `/C:/...`, y unido con path.join da la ruta inválida `C:\C:\...`.
const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, 'style.css'), 'utf8');

describe('variables de canales --*-rgb', () => {
  it('se definen separadas por espacio, nunca por coma', () => {
    const defs = [...css.matchAll(/(--[a-z-]+-rgb):\s*([^;]+);/g)];
    expect(defs.length).toBeGreaterThan(0); // si se renombran, que no pase en silencio

    for (const [, name, value] of defs) {
      expect(`${name} = ${value}`).toBe(`${name} = ${value.replace(/,/g, '')}`);
      expect(value.trim().split(/\s+/)).toHaveLength(3);
    }
  });

  it('no se consumen con la forma heredada rgba(var(--x), a)', () => {
    // Con canales separados por espacio, `rgba(10 132 255, 0.5)` también es
    // inválido: la otra mitad del mismo error.
    expect(css).not.toMatch(/rgba\(\s*var\(--[a-z-]+-rgb\)/);
  });
});

describe('tailwind consume esas variables con la forma moderna', () => {
  it('accent usa rgb(var(--x) / <alpha-value>)', () => {
    const config = readFileSync(path.join(here, '../../tailwind.config.js'), 'utf8');
    expect(config).toMatch(/rgb\(var\(--color-accent-rgb\)\s*\/\s*<alpha-value>\)/);
  });
});
