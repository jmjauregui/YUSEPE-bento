/**
 * src/renderer/core/orderLoader.js
 * --------------------------------------------------------------
 * Fábrica de la función loadOrder con dependencias inyectadas.
 *
 * Permite testear la carrera H14 sin DOM ni IPC:
 * si la promesa de un workspace viejo resuelve DESPUÉS de que el cwd
 * cambió, el resultado se descarta y nunca sobreescribe el orden actual.
 * --------------------------------------------------------------
 */

/**
 * @param {{ getCwd: () => string|null, fetchOrder: (cwd: string) => Promise<string[]>, onLoaded: (state: {cwd: string, names: string[]}) => void }} opts
 * @returns {() => Promise<void>}
 */
export function createOrderLoader({ getCwd, fetchOrder, onLoaded }) {
  return async function loadOrder() {
    const c = getCwd();
    if (!c) return;
    try {
      const names = await fetchOrder(c);
      // H14: no asignar si el workspace cambió mientras resolvía la promesa.
      if (c === getCwd()) onLoaded({ cwd: c, names });
    } catch {
      if (c === getCwd()) onLoaded({ cwd: c, names: [] });
    }
  };
}
