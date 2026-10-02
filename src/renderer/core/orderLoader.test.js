/**
 * src/renderer/core/orderLoader.test.js
 * Lógica pura — cubre la carrera H14: loadOrder tardío de workspace viejo
 * no pisa el workspace actual.
 */
import { describe, it, expect } from 'vitest';
import { createOrderLoader } from './orderLoader.js';

describe('createOrderLoader', () => {
  it('carga tardía del workspace viejo NO pisa el workspace actual (H14)', async () => {
    let currentCwd = 'A';
    const loaded = {};

    // Promesas diferidas para controlar el orden de resolución.
    let resolveA;
    let resolveB;
    const promiseA = new Promise((r) => { resolveA = r; });
    const promiseB = new Promise((r) => { resolveB = r; });

    const loadOrder = createOrderLoader({
      getCwd: () => currentCwd,
      fetchOrder: (c) => (c === 'A' ? promiseA : promiseB),
      onLoaded: ({ cwd: c, names }) => { loaded[c] = names; },
    });

    // Arrancar carga de A, luego cambiar a B y arrancar la de B.
    const pendingA = loadOrder();  // inicia fetch('A')
    currentCwd = 'B';
    const pendingB = loadOrder();  // inicia fetch('B')

    // Resolver B primero, luego A (tardío — el workspace ya es B).
    resolveB(['gamma']);
    await pendingB;

    resolveA(['alpha', 'beta']);
    await pendingA;

    // B se cargó. A llegó tarde: getCwd() era 'B', así que se descartó.
    expect(loaded).toEqual({ B: ['gamma'] });
  });

  it('carga normal (sin cambio de workspace): asigna correctamente', async () => {
    let currentCwd = 'A';
    const loaded = {};

    const loadOrder = createOrderLoader({
      getCwd: () => currentCwd,
      fetchOrder: async () => ['alpha', 'beta'],
      onLoaded: ({ cwd: c, names }) => { loaded[c] = names; },
    });

    await loadOrder();
    expect(loaded).toEqual({ A: ['alpha', 'beta'] });
  });

  it('error en fetchOrder: onLoaded recibe [] si el cwd no cambió', async () => {
    let currentCwd = 'A';
    const loaded = {};

    const loadOrder = createOrderLoader({
      getCwd: () => currentCwd,
      fetchOrder: async () => { throw new Error('fallo'); },
      onLoaded: ({ cwd: c, names }) => { loaded[c] = names; },
    });

    await loadOrder();
    expect(loaded).toEqual({ A: [] });
  });

  it('error tardío de workspace viejo: onLoaded NO se llama', async () => {
    let currentCwd = 'A';
    const loaded = {};

    let rejectA;
    const promiseA = new Promise((_, r) => { rejectA = r; });

    const loadOrder = createOrderLoader({
      getCwd: () => currentCwd,
      fetchOrder: (c) => (c === 'A' ? promiseA : Promise.resolve(['gamma'])),
      onLoaded: ({ cwd: c, names }) => { loaded[c] = names; },
    });

    const pendingA = loadOrder(); // fetch('A') pendiente
    currentCwd = 'B';
    await loadOrder();             // fetch('B') → loaded['B'] = ['gamma']

    rejectA(new Error('fallo tardío'));
    await pendingA;

    // El error de A llegó tarde: no debe llamar onLoaded para A.
    expect(loaded).toEqual({ B: ['gamma'] });
  });
});
