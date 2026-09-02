/**
 * src/main/ptyWriteQueue.test.js
 * --------------------------------------------------------------
 * La cola de escritura al pty. La regresión que importa: un pegado
 * grande debe llegar COMPLETO y EN ORDEN al proceso — el bug de
 * campo era que ConPTY descartaba todo menos la cola del pegado.
 * --------------------------------------------------------------
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteQueue } from './ptyWriteQueue.js';

describe('ptyWriteQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('una escritura corta (tipeo) sale inmediata, sin esperar el intervalo', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d));

    q.write('a');

    expect(written).toEqual(['a']);
  });

  it('un pegado grande llega completo, en orden, troceado en chunks', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d), { chunkSize: 10, intervalMs: 5 });
    const paste = 'x'.repeat(95) + 'FINAL';

    q.write(paste);
    vi.runAllTimers();

    expect(written.join('')).toBe(paste);
    expect(written.length).toBe(10);
    expect(Math.max(...written.map((c) => c.length))).toBeLessThanOrEqual(10);
  });

  it('el primer chunk sale sin esperar; el resto se espacia con el intervalo', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d), { chunkSize: 5, intervalMs: 5 });

    q.write('123456789');
    expect(written).toEqual(['12345']);

    vi.advanceTimersByTime(5);
    expect(written).toEqual(['12345', '6789']);
  });

  it('escrituras durante un drenaje se encolan detrás: el \\r del dispatcher sale último', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d), { chunkSize: 5, intervalMs: 5 });

    q.write('mensaje largo del loop');
    q.write('\r'); // corto, pero NO debe colarse adelante de la cola activa
    vi.runAllTimers();

    expect(written.join('')).toBe('mensaje largo del loop\r');
    expect(written[written.length - 1]).toBe('\r');
  });

  it('dispose() frena el drenaje y descarta lo pendiente', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d), { chunkSize: 5, intervalMs: 5 });

    q.write('123456789');
    q.dispose();
    vi.runAllTimers();

    expect(written).toEqual(['12345']);
    q.write('mas'); // tras dispose no se escribe nada
    expect(written).toEqual(['12345']);
  });

  it('si la escritura lanza (proceso muerto), descarta la cola sin explotar', () => {
    const write = vi.fn(() => { throw new Error('EPIPE'); });
    const q = createWriteQueue(write, { chunkSize: 5, intervalMs: 5 });

    expect(() => {
      q.write('123456789');
      vi.runAllTimers();
    }).not.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
  });

  // La regresión de campo: el corte a los 50 chars cayó justo dentro del
  // `\x1b[201~` que cierra un bracketed paste, y el TUI del otro lado
  // puede leer ese ESC suelto como tecla Escape y partir el pegado.
  it('no corta un chunk en medio de una secuencia de escape', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d), { chunkSize: 10, intervalMs: 5 });
    // El borde del chunk (10) cae dentro del `\x1b[201~` (empieza en 7).
    const paste = '\x1b[200~abc\x1b[201~xyz';

    q.write(paste);
    vi.runAllTimers();

    expect(written.join('')).toBe(paste);
    for (const chunk of written) {
      const esc = chunk.lastIndexOf('\x1b');
      if (esc === -1) continue;
      // Toda secuencia que arranca en el chunk debe terminar en el chunk.
      // eslint-disable-next-line no-control-regex -- el ESC es el objeto del test
      expect(chunk.slice(esc)).toMatch(/^\x1b\[[0-9;?]*[\x40-\x7e]/);
    }
  });

  it('una secuencia patológica más larga que el chunk igual sale completa', () => {
    const written = [];
    const q = createWriteQueue((d) => written.push(d), { chunkSize: 5, intervalMs: 5 });
    const paste = '\x1b[200~hola';

    q.write(paste);
    vi.runAllTimers();

    expect(written.join('')).toBe(paste);
  });

  it('ignora datos vacíos o no-string sin tocar el pty', () => {
    const write = vi.fn();
    const q = createWriteQueue(write);

    q.write('');
    q.write(null);
    q.write(undefined);
    q.write(42);

    expect(write).not.toHaveBeenCalled();
  });

  // Regresión H7: dispose() descartaba la cola sin despertar los whenIdle()
  // pendientes → el dispatcher quedaba colgado en `await whenIdleForPty` para
  // siempre, bloqueando el reparto entero del workspace.
  it('dispose() resuelve las promesas de whenIdle() pendientes', async () => {
    const q = createWriteQueue(() => {}, { chunkSize: 5, intervalMs: 5 });
    q.write('123456789'); // 2 chunks: 1o drena síncrono, 2o espera timer
    const resolved = [];
    q.whenIdle().then(() => resolved.push('ok'));
    // en este punto: 1 chunk en cola, timer activo → whenIdle() pendiente
    q.dispose();
    // clear() debe llamar notifyIdle() → el callback se encola como microtarea
    await Promise.resolve();
    expect(resolved).toEqual(['ok']);
  });
});
