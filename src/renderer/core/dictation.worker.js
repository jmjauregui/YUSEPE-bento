/**
 * src/renderer/core/dictation.worker.js
 * --------------------------------------------------------------
 * Reconocimiento de voz local (spec 040): Whisper corriendo con
 * transformers.js en un Web Worker, para no congelar la UI mientras
 * transcribe. El audio no sale de la máquina; lo único que se baja de
 * internet es el modelo, una vez (queda en la caché del navegador, dentro
 * de <userData>).
 *
 * El motor (onnxruntime-web) se sirve desde el bundle y no del CDN que la
 * librería usa por defecto: la CSP de Bento no carga scripts de afuera, y
 * así el dictado anda sin conexión después de la primera descarga.
 *
 * ponytail: backend WASM y modelos q8 (los más livianos). WebGPU sería más
 * rápido pero cambia los tipos de modelo (y la descarga); se suma si la
 * latencia molesta en uso real.
 * --------------------------------------------------------------
 */
import { env, pipeline } from '@huggingface/transformers';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL(ortWasmUrl, self.location.href).href,
  mjs: new URL(ortMjsUrl, self.location.href).href,
};

/** Un pipeline por modelo, cargado a pedido y reusado. */
const pipelines = new Map();

function getPipeline(model) {
  if (!pipelines.has(model)) {
    pipelines.set(model, pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress') {
          self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        }
      },
    }).catch((err) => {
      // Que un fallo (sin red, por ejemplo) no quede cacheado para siempre.
      pipelines.delete(model);
      throw err;
    }));
  }
  return pipelines.get(model);
}

self.onmessage = async ({ data }) => {
  const { id, audio, model, language } = data;
  // `load`: sólo descargar/cargar el modelo (la UI muestra el progreso antes
  // de grabar, en vez de mezclar la descarga con la primera transcripción).
  if (data.type === 'load') {
    try {
      await getPipeline(model);
      self.postMessage({ type: 'ready', id });
      self.postMessage({ type: 'result', id, text: '' });
    } catch (err) {
      self.postMessage({ type: 'error', id, message: String(err?.message || err) });
    }
    return;
  }
  try {
    const asr = await getPipeline(model);
    self.postMessage({ type: 'ready', id });
    const out = await asr(audio, {
      task: 'transcribe',
      ...(language ? { language } : {}),
      // Prompts largos: Whisper procesa de a 30 s.
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ type: 'result', id, text: String(out?.text || '').trim() });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
