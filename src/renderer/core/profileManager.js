/**
 * src/renderer/core/profileManager.js
 * --------------------------------------------------------------
 * Encapsula la interacción con la API de perfiles del preload.
 * Mantiene `state` sincronizado y emite eventos de dominio.
 * --------------------------------------------------------------
 */
import { state } from './state.js';
import { bus } from './eventBus.js';
import { compactTiles } from './layout.js';
import * as liveTiles from './liveTiles.js';

const api = () => window.yusepe.profiles;

export const ProfileManager = {
  async refresh() {
    state.profiles = await api().list();
    return state.profiles;
  },

  async create(name, cwd = null, tiles = []) {
    const profile = await api().create({ name: name || 'Nuevo perfil', cwd, tiles });
    await this.refresh();
    return profile;
  },

  async load(id) {
    const previousId = state.activeProfileId;
    if (previousId && previousId !== id) {
      // Desmonta (sin matar) las terminales del workspace anterior antes
      // de reemplazar state.profile.
      bus.emit('workspace:left', { profileId: previousId });
    }
    const profile = await api().load(id);
    state.profile = profile;
    state.activeProfileId = id;
    // Registra la visita (para ordenar la lista y mostrar "última vez").
    // No bloqueamos la carga por esto; el índice se refresca en el próximo
    // render de la lista.
    api().touch(id).then((updated) => {
      if (updated?.lastOpenedAt) profile.lastOpenedAt = updated.lastOpenedAt;
    }).catch(() => { /* noop */ });
    bus.emit('profile:loaded', profile);
    return profile;
  },

  /** Sale del workspace activo sin cargar otro (vuelve a la lista de perfiles). */
  clear() {
    const previousId = state.activeProfileId;
    if (previousId) bus.emit('workspace:left', { profileId: previousId });
    state.profile = null;
    state.activeProfileId = null;
    bus.emit('profile:cleared');
  },

  async saveCurrent() {
    if (!state.profile) return null;
    const saved = await api().save(state.profile);
    state.profile = saved;
    await this.refresh();
    bus.emit('profile:saved', saved);
    return saved;
  },

  async remove(id) {
    await api().delete(id);
    liveTiles.killWorkspace(id);
    if (state.activeProfileId === id) {
      state.profile = null;
      state.activeProfileId = null;
      bus.emit('profile:cleared');
    }
    await this.refresh();
  },

  /** Renombra un perfil. Valida unicidad via storage. */
  async rename(id, newName) {
    const profile = await api().rename(id, newName);
    if (state.activeProfileId === id) {
      state.profile = profile;
    }
    await this.refresh();
    bus.emit('profile:renamed', profile);
    return profile;
  },

  /** Verifica si un nombre ya está en uso. */
  async exists(name) {
    return api().exists(name);
  },

  /** Cambia la carpeta de inicio (cwd) del workspace de un perfil. */
  async setCwd(id, cwd) {
    const profile = await api().setCwd(id, cwd);
    if (state.activeProfileId === id) {
      state.profile = profile;
    }
    await this.refresh();
    bus.emit('profile:cwd-changed', profile);
    return profile;
  },

  /** Cambia el fondo de pantalla del workspace activo. `null` lo quita. */
  async setWallpaper(id, wallpaper) {
    const profile = await api().setWallpaper(id, wallpaper);
    if (state.activeProfileId === id) {
      state.profile = profile;
    }
    bus.emit('profile:wallpaper-changed', profile);
    return profile;
  },

  /** Exporta un perfil a un .json elegido por el usuario (diálogo nativo). */
  async export(id) {
    return api().export(id);
  },

  /** Importa un perfil desde un .json elegido por el usuario. Genera un id nuevo. */
  async import() {
    const result = await api().import();
    if (!result.canceled) await this.refresh();
    return result;
  },

  async addTile(tile) {
    if (!state.profile) return null;
    state.profile.tiles = [...(state.profile.tiles || []), tile];
    bus.emit('tile:added', tile);
    await this.saveCurrent();
    return tile;
  },

  async removeTile(tileId) {
    if (!state.profile) return;

    // Una terminal que pertenece a un loop no se borra por accidente: si
    // desaparece, los otros agentes le siguen escribiendo a un nombre que
    // ya no tiene dónde recibir, y el loop se rompe de una forma que no se
    // ve. Hay que sacarla del loop primero (panel Loop -> ✕ en su fila).
    // El guard va acá y no en cada botón porque éste es el único camino
    // por el que se borra un tile.
    const tile = (state.profile.tiles || []).find((t) => t.id === tileId);
    if (tile?.loopAgent) {
      throw new Error(
        `Esta terminal es @${tile.loopAgent} en el loop. Sacala del loop antes de cerrarla.`,
      );
    }

    // Borrado real de un tile puntual: si era una terminal viva, se mata
    // de verdad (a diferencia de un simple cambio de workspace).
    liveTiles.kill(tileId);
    state.profile.tiles = state.profile.tiles.filter((t) => t.id !== tileId);
    // Reacomoda los tiles restantes desde la esquina superior izquierda
    // para cerrar el hueco que deja el tile eliminado.
    compactTiles(state.profile.tiles);
    bus.emit('tile:removed', { id: tileId });
    await this.saveCurrent();
  },

  async updateTile(tileId, patch) {
    if (!state.profile) return;
    state.profile.tiles = state.profile.tiles.map((t) =>
      t.id === tileId ? { ...t, ...patch } : t
    );
    bus.emit('tile:updated', { id: tileId, patch });
    await this.saveCurrent();
  },

  async reorderTiles(orderedIds) {
    if (!state.profile) return;
    const map = new Map(state.profile.tiles.map((t) => [t.id, t]));
    state.profile.tiles = orderedIds.map((id) => map.get(id)).filter(Boolean);
    bus.emit('tiles:reordered', orderedIds);
    await this.saveCurrent();
  },
};
