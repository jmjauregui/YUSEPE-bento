/**
 * src/renderer/core/loopNotify.js
 * --------------------------------------------------------------
 * Notificaciones sonoras del loop: suena cuando un agente escribe
 * al usuario. Todos los sonidos son sintéticos (Web Audio API),
 * sin archivos externos ni problemas de CSP.
 *
 * Exports públicos:
 *   SOUNDS          — lista para mostrar en el selector de settings
 *   getSound()      — id guardado en localStorage (default 'chord')
 *   setSound(id)    — persiste la preferencia
 *   playSound(id?)  — toca un sonido; sin id usa el guardado
 *   notifyUserMessage(fromAgent?) — sonido + notificación de OS si la
 *                                   ventana no tiene foco
 * --------------------------------------------------------------
 */

const STORAGE_KEY = 'yusepe:loop-notify-sound';

export const SOUNDS = [
  { id: 'chord',   label: 'Acorde ascendente' },
  { id: 'ping',    label: 'Ping limpio' },
  { id: 'twobeep', label: 'Dos notas' },
  { id: 'pop',     label: 'Pop suave' },
  { id: 'tick',    label: 'Triple clic' },
  { id: 'none',    label: 'Sin sonido' },
];

export function getSound() {
  const v = localStorage.getItem(STORAGE_KEY);
  return SOUNDS.some((s) => s.id === v) ? v : 'chord';
}

export function setSound(id) {
  localStorage.setItem(STORAGE_KEY, id);
}

/* ---------- Primitiva de síntesis ---------- */

function tone(ac, type, freq, startAt, duration, volume = 0.3) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t = ac.currentTime + startAt;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t);
  osc.stop(t + duration);
}

/* ---------- Sonidos ---------- */

function chord(ac) {
  // Acorde mayor: A5 (880 Hz), C#6 (1109 Hz), E6 (1319 Hz)
  [[880, 0], [1109, 0.07], [1319, 0.14]].forEach(([freq, delay]) => {
    tone(ac, 'sine', freq, delay, 0.45);
  });
}

function ping(ac) {
  tone(ac, 'sine', 1046, 0, 0.55, 0.4);
}

function twobeep(ac) {
  // Dos notas descendentes al estilo macOS
  [[1046, 0], [880, 0.15]].forEach(([freq, delay]) => {
    tone(ac, 'sine', freq, delay, 0.28);
  });
}

function pop(ac) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(900, ac.currentTime + 0.08);
  gain.gain.setValueAtTime(0.5, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
  osc.start();
  osc.stop(ac.currentTime + 0.22);
}

function tick(ac) {
  [0, 0.09, 0.18].forEach((delay) => {
    tone(ac, 'square', 1200, delay, 0.06, 0.12);
  });
}

const PLAYERS = { chord, ping, twobeep, pop, tick };

/* ---------- API pública ---------- */

export function playSound(id = getSound()) {
  if (!id || id === 'none') return;
  const fn = PLAYERS[id];
  if (!fn) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    fn(ac);
    // Cierra el contexto después de que todos los osciladores hayan parado
    setTimeout(() => ac.close().catch(() => {}), 1200);
  } catch {
    // Falla silenciosa: sin gesto del usuario el navegador puede bloquear
    // la creación del AudioContext — no es un error fatal.
  }
}

let permissionRequested = false;

/**
 * Toca el sonido seleccionado y, si la ventana no tiene foco, muestra
 * una notificación de sistema.
 *
 * @param {string} [fromAgent] nombre del emisor (sin @), para el cuerpo
 */
export async function notifyUserMessage(fromAgent) {
  playSound();

  // La notificación de OS sólo tiene sentido cuando la ventana está en background.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;

  if (!permissionRequested) {
    permissionRequested = true;
    try { await Notification.requestPermission(); } catch { /* ignorar */ }
  }

  if (Notification.permission === 'granted') {
    new Notification('Mensaje en el loop', {
      body: fromAgent ? `@${fromAgent} te escribió` : 'Nuevo mensaje para vos en el loop',
      // El sonido del sistema se omite: ya pusimos el nuestro.
      silent: true,
    });
  }
}
