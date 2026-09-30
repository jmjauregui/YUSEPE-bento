/**
 * src/main/templatesOps.js
 * --------------------------------------------------------------
 * Plantillas de distribución guardadas por el usuario (ver
 * renderer/core/layoutTemplates.js para las incorporadas y el formato de
 * los tiles). Globales a la app, un solo JSON en
 * <userData>/layout-templates.json, mismo patrón de escritura atómica
 * que snippetsOps.js.
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export class TemplatesStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.templates) ? data.templates : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async _write(templates) {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ templates }, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async list() {
    const templates = await this._read();
    return [...templates].sort((a, b) => a.name.localeCompare(b.name));
  }

  async create({ name, description, tiles } = {}) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('La plantilla necesita un nombre.');
    if (!Array.isArray(tiles)) throw new Error('La plantilla necesita una lista de tiles.');
    const templates = await this._read();
    const template = {
      id: randomUUID(),
      name: trimmed,
      description: (description || '').trim(),
      tiles,
      createdAt: Date.now(),
    };
    templates.push(template);
    await this._write(templates);
    return template;
  }

  async remove(id) {
    const templates = await this._read();
    await this._write(templates.filter((t) => t.id !== id));
  }
}
