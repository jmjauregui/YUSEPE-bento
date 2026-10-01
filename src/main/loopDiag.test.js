/**
 * src/main/loopDiag.test.js
 * --------------------------------------------------------------
 * Criterios de aceptación de la spec 027.
 *
 * Todos usan disco real sobre un directorio temporal: el mismo patrón
 * que loopDispatcher.test.js y loopOps.test.js.
 *
 * Criterios cubiertos:
 *   C1 — B1 registrado es idéntico carácter a carácter al payload original
 *   C2 — B2 es la concatenación en orden de los chunks; B2 === B1 si no hay pérdida
 *   C3 — escribir al pty fuera de la ventana NO queda registrado (privacidad)
 *   C5 — N entregas dejan como mucho 1 archivo por agente
 *   C7 — un payload de 13 500 chars queda completo en el registro
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { arm, chunk, disarm, flush } from './loopDiag.js';

let cwd;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-diag-test-'));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

async function readRecord(agentName) {
  return JSON.parse(
    await fs.readFile(path.join(cwd, '.ybento', 'loop', 'diag', `${agentName}.json`), 'utf8'),
  );
}

describe('C1 — B1 es el payload exacto recibido', () => {
  it('lo registrado como b1 es idéntico carácter a carácter al payload', async () => {
    const payload = 'hola mundo con acentos: España, niño, ñoño';
    arm('pty_1', { agent: 'claudio', cwd, messageId: 'msg-c1', payload });
    chunk('pty_1', payload.slice(0, 10));
    chunk('pty_1', payload.slice(10));
    disarm('pty_1');
    await flush('pty_1');

    const rec = await readRecord('claudio');
    expect(rec.b1).toBe(payload);
    expect(rec.b1Len).toBe(payload.length);
    expect(rec.messageId).toBe('msg-c1');
    expect(rec.agent).toBe('claudio');
  });
});

describe('C2 — B2 es la concatenación en orden de los chunks', () => {
  it('los chunks llegan en orden y B2 === B1 si no hay pérdida', async () => {
    const payload = 'abcdefghijklmnopqrstuvwxyz';
    arm('pty_1', { agent: 'claudio', cwd, messageId: 'msg-c2', payload });
    // Simula 4 chunks como si la cola los troceara
    chunk('pty_1', 'abcdefg');
    chunk('pty_1', 'hijklmn');
    chunk('pty_1', 'opqrstu');
    chunk('pty_1', 'vwxyz\r'); // incluye el \r como lo haría el dispatcher
    disarm('pty_1');
    await flush('pty_1');

    const rec = await readRecord('claudio');
    expect(rec.b2).toBe(payload + '\r');
    expect(rec.b2Len).toBe(payload.length + 1);
    expect(rec.b2Chunks).toBe(4);
    // La parte de texto (sin \r) coincide con B1
    expect(rec.b2.slice(0, rec.b1Len)).toBe(rec.b1);
  });
});

describe('C3 — escribir fuera de la ventana NO queda registrado (privacidad)', () => {
  it('chunk antes de arm no se acumula', async () => {
    // Simula tipeo del usuario ANTES de que Bento abra la ventana
    chunk('pty_c3', 'contraseña_secreta_123');
    chunk('pty_c3', 'mi_clave_ssh');

    arm('pty_c3', { agent: 'opencito', cwd, messageId: 'msg-c3a', payload: 'hola' });
    chunk('pty_c3', 'hola'); // dentro de la ventana
    disarm('pty_c3');
    await flush('pty_c3');

    const rec = await readRecord('opencito');
    expect(rec.b2).toBe('hola');
    expect(rec.b2).not.toContain('contraseña_secreta_123');
    expect(rec.b2).not.toContain('mi_clave_ssh');
  });

  it('chunk después de disarm no se acumula', async () => {
    arm('pty_c3b', { agent: 'opencito', cwd, messageId: 'msg-c3b', payload: 'msg' });
    chunk('pty_c3b', 'msg');
    disarm('pty_c3b'); // ventana cerrada

    // Tipeo del usuario DESPUÉS del cierre de la ventana
    chunk('pty_c3b', 'ls -la');
    chunk('pty_c3b', 'git status');

    await flush('pty_c3b');

    const rec = await readRecord('opencito');
    expect(rec.b2).toBe('msg');
    expect(rec.b2).not.toContain('ls -la');
    expect(rec.b2).not.toContain('git status');
  });

  it('pty sin arm activo ignora todos los chunks', async () => {
    chunk('pty_sin_arm', 'esto nunca se guarda');
    chunk('pty_sin_arm', 'ni esto tampoco');
    // No hay arm ni flush: el directorio de diag no se crea
    await expect(
      fs.access(path.join(cwd, '.ybento', 'loop', 'diag')),
    ).rejects.toThrow();
  });
});

describe('C5 — N entregas dejan como mucho 1 archivo por agente', () => {
  it('5 entregas al mismo agente dejan un solo archivo con la última', async () => {
    for (let i = 0; i < 5; i++) {
      arm('pty_1', { agent: 'claudio', cwd, messageId: `msg-${i}`, payload: `payload-${i}` });
      chunk('pty_1', `payload-${i}`);
      disarm('pty_1');
      await flush('pty_1');
    }

    const diagDir = path.join(cwd, '.ybento', 'loop', 'diag');
    const files = await fs.readdir(diagDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('claudio.json');

    const rec = await readRecord('claudio');
    expect(rec.messageId).toBe('msg-4');
  });

  it('entregas a agentes distintos dejan un archivo por agente', async () => {
    for (const [ptyId, agentName] of [['pty_a', 'claudio'], ['pty_b', 'opencito']]) {
      arm(ptyId, { agent: agentName, cwd, messageId: `msg-${agentName}`, payload: 'x' });
      chunk(ptyId, 'x');
      disarm(ptyId);
      await flush(ptyId);
    }

    const diagDir = path.join(cwd, '.ybento', 'loop', 'diag');
    const files = (await fs.readdir(diagDir)).sort();
    expect(files).toEqual(['claudio.json', 'opencito.json']);
  });
});

describe('C7 — payload de 13 500 chars queda completo (caso real de campo)', () => {
  it('registro sin truncadoPorTope y b2 === b1', async () => {
    const payload = 'x'.repeat(13_500);
    arm('pty_1', { agent: 'claudio', cwd, messageId: 'msg-c7', payload });
    // Simula la cola troceo en chunks de 50 chars (= CHUNK_SIZE)
    for (let i = 0; i < payload.length; i += 50) {
      chunk('pty_1', payload.slice(i, i + 50));
    }
    chunk('pty_1', '\r'); // el Enter final
    disarm('pty_1');
    await flush('pty_1');

    const rec = await readRecord('claudio');
    expect(rec.b1Len).toBe(13_500);
    expect(rec.b2Len).toBe(13_501); // 13 500 + '\r'
    expect(rec.b2.slice(0, 13_500)).toBe(payload);
    expect(rec.b2.slice(13_500)).toBe('\r');
    expect(rec.truncadoPorTope).toBe(false);
  });
});

describe('tope de 64 KB — marca truncadoPorTope sin comerse la memoria', () => {
  it('payload > 64 KB queda marcado como truncado', async () => {
    const BIG = 'y'.repeat(65_536 + 500);
    arm('pty_big', { agent: 'claudio', cwd, messageId: 'msg-big', payload: BIG });
    for (let i = 0; i < BIG.length; i += 50) {
      chunk('pty_big', BIG.slice(i, i + 50));
    }
    disarm('pty_big');
    await flush('pty_big');

    const rec = await readRecord('claudio');
    expect(rec.truncadoPorTope).toBe(true);
    expect(rec.b2Len).toBeLessThanOrEqual(65_536);
  });
});

describe('flags de drenaje', () => {
  it('drenajeVencido se persiste en el registro', async () => {
    arm('pty_1', { agent: 'claudio', cwd, messageId: 'msg-dv', payload: 'test' });
    chunk('pty_1', 'test');
    disarm('pty_1');
    await flush('pty_1', { drenajeVencido: true });

    const rec = await readRecord('claudio');
    expect(rec.drenajeVencido).toBe(true);
    expect(rec.colaVaciadaPorError).toBe(false);
  });

  it('colaVaciadaPorError se persiste en el registro', async () => {
    arm('pty_1', { agent: 'claudio', cwd, messageId: 'msg-cve', payload: 'test' });
    chunk('pty_1', 'test');
    disarm('pty_1');
    await flush('pty_1', { colaVaciadaPorError: true });

    const rec = await readRecord('claudio');
    expect(rec.colaVaciadaPorError).toBe(true);
  });
});

describe('flush sin sesión previa no falla', () => {
  it('flush de un ptyId sin arm es un no-op silencioso', async () => {
    await expect(flush('pty_inexistente')).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(cwd, '.ybento', 'loop', 'diag')),
    ).rejects.toThrow();
  });
});
