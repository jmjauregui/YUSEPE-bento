import { describe, it, expect } from 'vitest';
import { OutputRing, HandoffRegistry, WorkspaceClaims, attachPty } from './multiWindow.js';

describe('OutputRing', () => {
  it('acumula y devuelve la salida en orden', () => {
    const ring = new OutputRing(100);
    ring.push('hola ');
    ring.push('mundo');
    expect(ring.snapshot()).toBe('hola mundo');
  });

  it('recorta por el frente cuando supera el límite y conserva el final', () => {
    const ring = new OutputRing(10);
    ring.push('0123456789');
    ring.push('ABCDE');
    expect(ring.snapshot()).toBe('56789ABCDE');
    expect(ring.size).toBe(10);
  });

  it('un chunk mayor que el límite deja solo su cola', () => {
    const ring = new OutputRing(4);
    ring.push('abcdefgh');
    expect(ring.snapshot()).toBe('efgh');
  });
});

describe('HandoffRegistry', () => {
  it('guarda un traspaso y se retira una sola vez', () => {
    const reg = new HandoffRegistry();
    reg.set('p1', { t1: 'pty_1', t2: 'pty_2' });
    expect(reg.has('p1')).toBe(true);
    expect(reg.take('p1')).toEqual({ t1: 'pty_1', t2: 'pty_2' });
    expect(reg.take('p1')).toBeNull();
    expect(reg.has('p1')).toBe(false);
  });

  it('ignora mapas inválidos', () => {
    const reg = new HandoffRegistry();
    reg.set('p1', null);
    reg.set('p2', 'x');
    expect(reg.has('p1')).toBe(false);
    expect(reg.has('p2')).toBe(false);
  });
});

describe('WorkspaceClaims', () => {
  it('el primero que reclama es el dueño; el mismo dueño es idempotente', () => {
    const claims = new WorkspaceClaims();
    expect(claims.claim('p1', 10)).toEqual({ ok: true });
    expect(claims.claim('p1', 10)).toEqual({ ok: true });
    expect(claims.ownerOf('p1')).toBe(10);
  });

  it('otro dueño es rechazado y se informa quién lo tiene', () => {
    const claims = new WorkspaceClaims();
    claims.claim('p1', 10);
    expect(claims.claim('p1', 20)).toEqual({ ok: false, ownerId: 10 });
  });

  it('release solo lo suelta el dueño; releaseAll suelta todo lo de un dueño', () => {
    const claims = new WorkspaceClaims();
    claims.claim('p1', 10);
    claims.claim('p2', 10);
    claims.claim('p3', 20);
    claims.release('p1', 20);
    expect(claims.ownerOf('p1')).toBe(10);
    claims.release('p1', 10);
    expect(claims.ownerOf('p1')).toBeNull();
    expect(claims.releaseAll(10)).toEqual(['p2']);
    expect(claims.ownerOf('p2')).toBeNull();
    expect(claims.ownerOf('p3')).toBe(20);
  });
});

describe('attachPty', () => {
  function fakeSender(id, destroyed = false) {
    return { id, sent: [], isDestroyed: () => destroyed, send(ch, data) { this.sent.push([ch, data]); } };
  }

  it('cambia el dueño y devuelve el buffer acumulado', () => {
    const a = fakeSender(1);
    const b = fakeSender(2);
    const entry = { sender: a, senderId: 1, ring: new OutputRing(100), shell: '/bin/zsh' };
    entry.ring.push('salida previa');
    const res = attachPty(entry, b);
    expect(res).toEqual({ ok: true, buffer: 'salida previa', shell: '/bin/zsh' });
    expect(entry.sender).toBe(b);
    expect(entry.senderId).toBe(2);
  });

  it('un pty inexistente devuelve ok:false', () => {
    expect(attachPty(null, fakeSender(2))).toEqual({ ok: false });
  });
});
