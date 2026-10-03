import { describe, it, expect } from 'vitest';
import {
  badgeLabel, cursorAtEnd, ensureCursor, loadCursor, saveCursor, unreadMessages, unreadSummary,
  unreadTitle,
} from './loopUnread.js';

const msg = (seq, from, to) => ({ id: `m${seq}`, seq, from, to, text: '' });
const thread = [
  msg(1, 'usuario', 'claudio'),
  msg(2, 'claudio', 'opencito'),
  msg(3, 'opencito', 'claudio'),
  msg(4, 'claudio', 'usuario'),
  msg(5, 'usuario', 'claudio'),
];

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}

describe('unreadMessages', () => {
  it('lo posterior al cursor, sin lo que escribió el usuario', () => {
    expect(unreadMessages(thread, { id: 'm1', seq: 1 }).map((m) => m.seq)).toEqual([2, 3, 4]);
  });

  it('sin cursor no hay no leídos', () => {
    expect(unreadMessages(thread, null)).toEqual([]);
  });

  // El panel pide sólo los últimos 200: un cursor más viejo no está en la lista.
  it('si el id no está en la lista, compara por seq', () => {
    const window = thread.slice(2);
    expect(unreadMessages(window, { id: 'm0-viejo', seq: 2 }).map((m) => m.seq)).toEqual([3, 4]);
  });

  it('cursor de un workspace vacío: el primer mensaje cuenta', () => {
    expect(unreadMessages([msg(1, 'claudio', 'usuario')], { id: null, seq: 0 })).toHaveLength(1);
  });
});

describe('unreadSummary', () => {
  it('forUser sólo si alguno va a @usuario', () => {
    expect(unreadSummary(thread, { id: 'm1', seq: 1 })).toMatchObject({ count: 3, forUser: true });
    expect(unreadSummary(thread, { id: 'm1', seq: 1 }).ids).toEqual(new Set(['m2', 'm3', 'm4']));
    expect(unreadSummary(thread.slice(0, 3), { id: 'm1', seq: 1 })).toMatchObject({ count: 2, forUser: false });
  });
});

describe('badgeLabel', () => {
  it('vacío, número, 99+', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(99)).toBe('99');
    expect(badgeLabel(100)).toBe('99+');
  });
});

describe('unreadTitle', () => {
  it('singular con 1', () => {
    expect(unreadTitle(1)).toBe('1 mensaje sin leer');
  });
  it('plural con 5', () => {
    expect(unreadTitle(5)).toBe('5 mensajes sin leer');
  });
  it('vacío con 0', () => {
    expect(unreadTitle(0)).toBe('');
  });
  it('número real con 140, nunca 99+ (el recorte es sólo visual)', () => {
    expect(unreadTitle(140)).toBe('140 mensajes sin leer');
  });
});

describe('cursor', () => {
  it('cursorAtEnd deja todo leído', () => {
    expect(unreadMessages(thread, cursorAtEnd(thread))).toEqual([]);
  });

  it('ensureCursor arranca todo leído y después respeta lo guardado', () => {
    const storage = fakeStorage();
    expect(ensureCursor('/p', thread.slice(0, 2), storage)).toEqual({ id: 'm2', seq: 2 });
    // Llegan más mensajes: el cursor guardado no se mueve solo.
    expect(unreadMessages(thread, ensureCursor('/p', thread, storage))).toHaveLength(2);
  });

  it('cada workspace tiene el suyo', () => {
    const storage = fakeStorage();
    saveCursor('/a', { id: 'm1', seq: 1 }, storage);
    expect(loadCursor('/b', storage)).toBeNull();
  });

  it('un storage que tira no rompe nada', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadCursor('/p', broken)).toBeNull();
    expect(() => saveCursor('/p', {}, broken)).not.toThrow();
  });
});
