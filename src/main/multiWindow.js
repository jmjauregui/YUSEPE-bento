/**
 * src/main/multiWindow.js
 * --------------------------------------------------------------
 * Piezas puras (sin Electron) para que un workspace pueda pasar de una
 * ventana a otra sin matar sus terminales:
 *
 *  - OutputRing: últimos N bytes de salida de un pty, para repintar la
 *    terminal en la ventana nueva (el pty no "reimprime" su historia).
 *  - HandoffRegistry: por workspace, el mapa tileId → ptyId que dejó la
 *    ventana que soltó el workspace y que retira la ventana que lo recibe.
 *  - WorkspaceClaims: qué ventana (webContents.id) tiene abierto cada
 *    workspace; un workspace está en una sola ventana a la vez.
 *  - attachPty: cambia el dueño de un pty (a quién se le envía la salida)
 *    y devuelve el buffer acumulado.
 *
 * Ver docs/superpowers/specs/2026-09-27-ventanas-independientes-design.md.
 * --------------------------------------------------------------
 */

export const DEFAULT_RING_BYTES = 256 * 1024;

export class OutputRing {
  constructor(limit = DEFAULT_RING_BYTES) {
    this.limit = limit;
    this.chunks = [];
    this.size = 0;
  }

  push(chunk) {
    const text = String(chunk);
    if (!text) return;
    if (text.length >= this.limit) {
      this.chunks = [text.slice(text.length - this.limit)];
      this.size = this.limit;
      return;
    }
    this.chunks.push(text);
    this.size += text.length;
    while (this.size > this.limit && this.chunks.length) {
      const excess = this.size - this.limit;
      const first = this.chunks[0];
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.slice(excess);
        this.size -= excess;
      }
    }
  }

  snapshot() {
    return this.chunks.join('');
  }
}

export class HandoffRegistry {
  constructor() {
    this.pending = new Map();
  }

  /** Guarda el mapa tileId → ptyId que la ventana nueva debe retirar. */
  set(profileId, tileToPty) {
    if (!profileId || !tileToPty || typeof tileToPty !== 'object') return;
    this.pending.set(profileId, { ...tileToPty });
  }

  has(profileId) {
    return this.pending.has(profileId);
  }

  /** Devuelve y elimina el mapa (una sola ventana puede retirarlo). */
  take(profileId) {
    const map = this.pending.get(profileId) || null;
    this.pending.delete(profileId);
    return map;
  }
}

export class WorkspaceClaims {
  constructor() {
    this.owners = new Map();
  }

  /** @returns {{ ok: true } | { ok: false, ownerId: number }} */
  claim(profileId, ownerId) {
    const current = this.owners.get(profileId);
    if (current == null || current === ownerId) {
      this.owners.set(profileId, ownerId);
      return { ok: true };
    }
    return { ok: false, ownerId: current };
  }

  release(profileId, ownerId) {
    if (this.owners.get(profileId) === ownerId) this.owners.delete(profileId);
  }

  /** Suelta todo lo de una ventana que se cerró. Devuelve los ids liberados. */
  releaseAll(ownerId) {
    const released = [];
    for (const [profileId, owner] of [...this.owners]) {
      if (owner === ownerId) {
        this.owners.delete(profileId);
        released.push(profileId);
      }
    }
    return released;
  }

  ownerOf(profileId) {
    return this.owners.has(profileId) ? this.owners.get(profileId) : null;
  }
}

/**
 * Cambia el dueño de un pty vivo. `entry` es el registro de ipc.js
 * ({ sender, senderId, ring, shell, ... }); `sender` es el webContents que
 * recibirá la salida de ahora en más.
 */
export function attachPty(entry, sender) {
  if (!entry) return { ok: false };
  entry.sender = sender;
  entry.senderId = sender.id;
  return { ok: true, buffer: entry.ring ? entry.ring.snapshot() : '', shell: entry.shell };
}
