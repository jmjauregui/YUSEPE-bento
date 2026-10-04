/**
 * src/renderer/core/dictation.js
 * --------------------------------------------------------------
 * Dictado por voz del loop (spec 040): grabar el micrófono y transcribir
 * localmente con Whisper (ver dictation.worker.js).
 *
 * Grabar → al soltar, el audio se decodifica a 16 kHz mono (lo que espera
 * Whisper) con un AudioContext a esa frecuencia, que hace el remuestreo por
 * nosotros, y va al worker. Nada de esto envía mensajes: devuelve texto.
 * --------------------------------------------------------------
 */
import { DICTATION_LANGUAGES, DICTATION_MODELS, mixToMono } from './dictationText.js';

const LANG_KEY = 'yusepe:dictation-lang';
const QUALITY_KEY = 'yusepe:dictation-quality';
const READY_KEY = (model) => `yusepe:dictation-ready:${model}`;

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

export const getDictationLanguage = () => {
  const v = read(LANG_KEY, 'es');
  return DICTATION_LANGUAGES[v] ? v : 'es';
};
export const setDictationLanguage = (v) => write(LANG_KEY, DICTATION_LANGUAGES[v] ? v : 'es');
export const getDictationQuality = () => (read(QUALITY_KEY, 'fast') === 'precise' ? 'precise' : 'fast');
export const setDictationQuality = (v) => write(QUALITY_KEY, v === 'precise' ? 'precise' : 'fast');

/** El modelo elegido, y si ya se descargó alguna vez en esta máquina. */
export function currentModel() {
  const q = DICTATION_MODELS[getDictationQuality()];
  return { ...q, downloaded: read(READY_KEY(q.id), '') === '1' };
}

/* ---------- Worker ---------- */

let worker = null;
let nextId = 1;
const pending = new Map();
let onProgress = () => {};

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./dictation.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress(data); return; }
      const job = pending.get(data.id);
      if (!job) return;
      if (data.type === 'ready') { write(READY_KEY(job.model), '1'); return; }
      pending.delete(data.id);
      if (data.type === 'result') job.resolve(data.text);
      else job.reject(new Error(friendlyModelError(data.message, job.model)));
    };
  }
  return worker;
}

function friendlyModelError(message, model) {
  const offline = /fetch|network|Failed to load|404|ENOTFOUND/i.test(message || '');
  if (offline && read(READY_KEY(model), '') !== '1') {
    const m = Object.values(DICTATION_MODELS).find((x) => x.id === model);
    return `Para dictar la primera vez hace falta internet: se descarga el modelo de voz (~${m?.sizeMb || 80} MB), una sola vez.`;
  }
  return `El reconocimiento de voz falló: ${message}`;
}

/* ---------- Micrófono ---------- */

let recorder = null;
let stream = null;
let chunks = [];
// Medidor de nivel del micrófono, para la onda en vivo de la UI. Es el
// mismo stream que se graba: lo que se ve es tu voz, no una animación.
let meterCtx = null;
let analyser = null;
let meterBuf = null;

/** Nivel actual del micrófono, 0–1 (RMS con algo de ganancia). 0 si no graba. */
export function currentLevel() {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(meterBuf);
  let sum = 0;
  for (const v of meterBuf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / meterBuf.length) * 4);
}

function stopMeter() {
  analyser = null;
  meterBuf = null;
  meterCtx?.close().catch(() => {});
  meterCtx = null;
}

function micErrorMessage(err) {
  const name = err?.name || '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No encontré un micrófono. Conectá uno (o revisá que el sistema lo vea) y probá de nuevo.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) return 'Bento no tiene permiso de micrófono. Habilitalo en Ajustes del Sistema → Privacidad y seguridad → Micrófono → YUSEPE Bento, y reabrí la app.';
    if (/Windows/i.test(ua)) return 'Bento no tiene permiso de micrófono. Habilitalo en Configuración → Privacidad y seguridad → Micrófono (permitir a las apps de escritorio).';
    return 'Bento no tiene acceso al micrófono. Revisá que PipeWire/PulseAudio lo vea (pavucontrol) y que no esté silenciado.';
  }
  return `No pude usar el micrófono: ${err?.message || err}`;
}

export const isRecording = () => !!recorder;

/** Empieza a grabar. Tira con un mensaje accionable si no hay micrófono o permiso. */
export async function startRecording() {
  if (recorder) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    throw new Error(micErrorMessage(err));
  }
  chunks = [];
  try {
    meterCtx = new AudioContext();
    analyser = meterCtx.createAnalyser();
    analyser.fftSize = 1024;
    meterBuf = new Float32Array(analyser.fftSize);
    meterCtx.createMediaStreamSource(stream).connect(analyser);
  } catch { stopMeter(); /* sin onda, pero se graba igual */ }
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
}

/** Corta la grabación sin transcribir (p. ej. al cerrar el panel). */
export function cancelRecording() {
  if (!recorder) return;
  try { recorder.stop(); } catch { /* noop */ }
  stopMeter();
  stream?.getTracks().forEach((t) => t.stop());
  recorder = null;
  stream = null;
  chunks = [];
}

/**
 * Corta la grabación y devuelve el texto transcripto.
 * @param {{ onProgress?: (p: {file: string, loaded: number, total: number}) => void }} [opts]
 */
export async function stopAndTranscribe({ onProgress: progress = () => {} } = {}) {
  if (!recorder) return '';
  const rec = recorder;
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });
  rec.stop();
  await stopped;
  stopMeter();
  stream?.getTracks().forEach((t) => t.stop());
  recorder = null;
  stream = null;

  const blob = new Blob(chunks, { type: rec.mimeType });
  chunks = [];
  if (!blob.size) return '';

  // Un AudioContext a 16 kHz remuestrea al decodificar: es lo que pide Whisper.
  const ctx = new AudioContext({ sampleRate: 16000 });
  let audio;
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    audio = mixToMono(Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)));
  } finally {
    ctx.close().catch(() => {});
  }
  if (audio.length < 1600) return ''; // menos de 0,1 s: nada que transcribir

  const { id: model } = currentModel();
  const language = DICTATION_LANGUAGES[getDictationLanguage()].whisper;
  onProgress = progress;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, model });
    // Copia propia: transferir el buffer de un canal del AudioBuffer lo dejaría inválido.
    const send = new Float32Array(audio);
    getWorker().postMessage({ id, audio: send, model, language }, [send.buffer]);
  });
}
