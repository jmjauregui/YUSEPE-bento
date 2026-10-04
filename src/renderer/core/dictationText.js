/**
 * src/renderer/core/dictationText.js
 * --------------------------------------------------------------
 * Lo puro del dictado por voz (spec 040): mezclar el audio a mono e
 * insertar el texto dictado donde estaba el cursor. Sin DOM ni audio real,
 * para poder testearlo.
 * --------------------------------------------------------------
 */

/** Promedia los canales de un audio a uno solo (Whisper espera mono). */
export function mixToMono(channels) {
  if (!channels.length) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  }
  return out;
}

/**
 * Inserta `text` en `value` reemplazando la selección [start, end), con un
 * espacio de separación si hace falta para no pegar palabras. Devuelve el
 * valor nuevo y dónde queda el cursor.
 */
export function insertAtCursor(value, start, end, text) {
  const clean = String(text ?? '').trim();
  if (!clean) return { value, caret: end };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${clean}${trail}`;
  return { value: before + inserted + after, caret: before.length + lead.length + clean.length };
}

/** Modelos por calidad, con su peso aproximado de descarga. */
export const DICTATION_MODELS = {
  fast: { id: 'onnx-community/whisper-base', label: 'Rápido', sizeMb: 80 },
  precise: { id: 'onnx-community/whisper-small', label: 'Preciso', sizeMb: 250 },
};

export const DICTATION_LANGUAGES = {
  es: { label: 'Español', whisper: 'spanish' },
  en: { label: 'English', whisper: 'english' },
  auto: { label: 'Automático', whisper: null },
};
