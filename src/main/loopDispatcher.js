/**
 * src/main/loopDispatcher.js
 * --------------------------------------------------------------
 * El repartidor del loop: vigila `.ybento/loop/` y pega los mensajes
 * pendientes en la terminal de su destinatario.
 *
 * Es la pieza que hace que el loop no se corte. Los agentes postean con
 * el CLI (`ybento enviar`), que corre en *otro proceso*; si nadie mirara
 * el directorio, un agente que ya terminó su turno y volvió al prompt se
 * quedaría dormido para siempre esperando un mensaje que nunca va a ir a
 * buscar. Acá Bento lo despierta escribiéndole en el pty.
 *
 * Dos decisiones que sostienen todo lo demás:
 *
 *   1. **Un mensaje por vuelta y por agente.** Pegarle tres mensajes de
 *      corrido a un agente le inunda el prompt y los procesa mezclados.
 *      Como al recibir se marca `working`, el resto de su bandeja espera
 *      sola hasta que vuelva a `waiting`: la serialización sale gratis
 *      del gate de estado, sin cola aparte.
 *
 *   2. **El vínculo nombre -> ptyId vive en memoria, no en el disco.**
 *      El ptyId muere con la terminal; la identidad (`@claudio`) no. Si
 *      se persistiera, al reiniciar Bento el repartidor le escribiría a
 *      un pty que ya no existe. `status.json` guarda el `tileId` (que
 *      sirve para la UI) y acá se guarda el ptyId del momento.
 * --------------------------------------------------------------
 */
import {
  crossedMessages, formatForTerminal, listMessages, markDelivered,
  normalizeName, pendingDeliveries, readHead, watchLoop,
} from './loopOps.js';
import * as diag from './loopDiag.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cada cuánto se revisa igual, por si `fs.watch` se pierde un evento.
 * Configurable por dispatcher: los tests lo suben para que sólo corran las
 * vueltas que piden a mano y no dependan del reloj.
 */
const POLL_MS = 1500;

/** Espera tras un cambio antes de repartir, para no repartir a medias. */
const DEBOUNCE_MS = 120;

/**
 * Pausa entre pegar el texto y mandar el Enter.
 *
 * No es una precaución: sin esto el loop no es autónomo. Los agentes corren
 * en TUIs (Claude Code, opencode) que detectan ráfagas de input como
 * *pegado* — si el `\r` llega en la misma escritura que el texto, lo
 * absorben como parte del contenido pegado en vez de leerlo como un Enter,
 * y el mensaje queda escrito en el prompt esperando que un humano lo
 * envíe a mano. Mandarlo aparte, con la ventana de pegado ya cerrada, lo
 * convierte en una pulsación de tecla de verdad.
 *
 * 250ms es holgado a propósito: las ventanas de detección de pegado andan
 * en decenas de milisegundos, y acá pasarse no cuesta nada (una ronda del
 * loop tarda minutos) mientras que quedarse corto rompe la autonomía.
 */
const SUBMIT_DELAY_MS = 250;

/**
 * Tope máximo para esperar el drenaje de la cola antes de continuar.
 *
 * El mensaje más largo observado en campo tiene 13 384 chars:
 *   (ceil(13 384 / 50) − 1) × 5 ms ≈ 1 335 ms de drenaje.
 * 5 000 ms triplica ese máximo; si se supera en un loop real, algo en el
 * pty está mal (proceso muerto sin cerrar la cola, por ejemplo) y esperar
 * más sólo bloquearía el reparto entero del workspace para siempre.
 */
const IDLE_TIMEOUT_MS = 5_000;

/** Shells que, si están en primer plano, significan "acá no hay agente". */
const SHELL_NAMES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh',
  'powershell.exe', 'pwsh.exe', 'cmd.exe',
]);

/** Saca `-zsh` -> `zsh`, `/bin/bash` -> `bash`. */
function shellName(raw) {
  return String(raw || '').split(/[\\/]/).pop().replace(/^-/, '').toLowerCase();
}

/**
 * ¿Esa terminal está en el prompt del shell (y no dentro de un TUI)?
 *
 * Se exporta porque hace falta fuera del reparto: antes de tipearle un
 * `export` a una terminal hay que saber si lo va a leer un shell o si va a
 * terminar escrito adentro del prompt del agente como si fuera un mensaje.
 */
export function looksLikeShell({ process: foreground, shell } = {}) {
  const name = shellName(foreground);
  if (!name) return false;
  return SHELL_NAMES.has(name) || name === shellName(shell);
}

/**
 * @param {object} opts
 * @param {(ptyId: string, data: string) => void} opts.writeToPty
 * @param {(ptyId: string) => ({ process: string, shell: string }|null)} [opts.probePty]
 *   sonda de presencia: qué proceso está en primer plano de ese pty
 * @param {(info: object) => void} [opts.onDelivered] aviso para la UI
 * @param {() => void} [opts.onChange] algo cambió en el disco (lo dispara
 *   la vigilancia, para que el panel de mensajes se refresque solo)
 * @param {(info: object) => void} [opts.onPresence] un agente apareció o se fue
 */
export function createDispatcher({
  writeToPty,
  whenIdleForPty = () => Promise.resolve(),
  probePty = null,
  onDelivered = () => {},
  onChange = () => {},
  onPresence = () => {},
  submitDelayMs = SUBMIT_DELAY_MS,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  pollMs = POLL_MS,
  // Los tests que cuentan entregas la apagan: si no, sus propias escrituras
  // disparan vueltas de fondo y el conteo depende del reloj.
  watchFs = true,
} = {}) {
  /**
   * Bindings y presencia indexados por workspace (cwd → Map).
   *
   * Antes eran mapas globales compartidos: en modo "loops simultáneos",
   * si dos workspaces tenían un agente con el mismo nombre, el segundo
   * `bind` sobreescribía el primero y los mensajes llegaban a la terminal
   * equivocada. Al indexarlos por cwd cada workspace tiene su propio
   * espacio de nombres.
   *
   * bindingsFor / presenceFor auto-inicializan la entrada: `bind` puede
   * llamarse antes de `start` (liveTiles monta terminales en el mismo
   * tick que el IPC de start) sin perder nada.
   */
  const allBindings = new Map(); // cwd -> Map<normalizedName, ptyId>
  const allPresence = new Map(); // cwd -> Map<normalizedName, {present,foreground,checkedAt}>

  function bindingsFor(targetCwd) {
    if (!allBindings.has(targetCwd)) allBindings.set(targetCwd, new Map());
    return allBindings.get(targetCwd);
  }

  function presenceFor(targetCwd) {
    if (!allPresence.has(targetCwd)) allPresence.set(targetCwd, new Map());
    return allPresence.get(targetCwd);
  }

  /**
   * Estado por workspace vigilado: { poll, unwatch, debounce, chain }.
   *
   * En modo "un loop a la vez" sólo hay una entrada; en modo "loops
   * simultáneos" puede haber N (una por workspace visitado). Usar un Map
   * en vez de variables sueltas permite añadir/quitar workspaces sin
   * tocar los demás ni reinventar la cadena de vueltas de reparto.
   */
  const cwds = new Map();

  /**
   * Asocia un agente con la terminal donde está corriendo.
   * Sin binding no se le entrega nada: el mensaje queda en su bandeja.
   *
   * @param {string} name
   * @param {string} ptyId
   * @param {string} cwd  workspace al que pertenece el agente
   */
  function bind(name, ptyId, cwd) {
    bindingsFor(cwd).set(normalizeName(name), ptyId);
  }

  /**
   * @param {string} name
   * @param {string} [cwd]  si se omite, quita el agente de todos los workspaces
   */
  function unbind(name, cwd) {
    const id = normalizeName(name);
    if (cwd) {
      bindingsFor(cwd).delete(id);
      presenceFor(cwd).delete(id);
    } else {
      for (const b of allBindings.values()) b.delete(id);
      for (const p of allPresence.values()) p.delete(id);
    }
  }

  /**
   * ¿Sigue habiendo un agente escuchando en esa terminal?
   *
   * Recibe el Map de presencia del workspace concreto para no mezclar
   * estado de presencia entre workspaces distintos.
   */
  function checkPresence(name, ptyId, pMap) {
    if (!probePty) return true;

    let info = null;
    try {
      info = probePty(ptyId);
    } catch {
      return true;
    }
    if (!info || !info.process) return true;

    const foreground = shellName(info.process);
    const present = !looksLikeShell(info);

    const previous = pMap.get(name);
    pMap.set(name, { present, foreground, checkedAt: new Date().toISOString() });
    if (!previous || previous.present !== present) {
      onPresence({ agent: name, present, foreground });
    }
    return present;
  }

  /**
   * Estado de presencia conocido, para pintarlo en el panel.
   *
   * @param {string} [targetCwd]  si se omite, fusiona todos los workspaces
   */
  function presenceSnapshot(targetCwd) {
    if (targetCwd) return Object.fromEntries(presenceFor(targetCwd));
    const merged = {};
    for (const p of allPresence.values()) {
      for (const [k, v] of p) merged[k] = v;
    }
    return merged;
  }

  /** @param {string} [targetCwd]  si se omite, devuelve todos los workspaces */
  function boundAgents(targetCwd) {
    if (targetCwd) return [...bindingsFor(targetCwd).keys()];
    const all = new Set();
    for (const b of allBindings.values()) for (const k of b.keys()) all.add(k);
    return [...all];
  }

  /**
   * Una vuelta de reparto para un workspace concreto.
   * Devuelve lo que entregó — los tests miran esto,
   * y la UI lo usa para pintar el mensaje como enviado.
   */
  async function runTickFor(targetCwd) {
    if (!targetCwd) return [];

    const cwdBindings = bindingsFor(targetCwd);
    const cwdPresence = presenceFor(targetCwd);

    const ready = await pendingDeliveries(targetCwd);
    const delivered = [];
    // Se lee una vez por vuelta y sólo si hay algo que entregar: hace
    // falta el hilo completo para detectar cruces.
    const all = ready.length ? await listMessages(targetCwd) : [];
    // Una lectura de HEAD por vuelta, no por mensaje: sirve para avisar
    // que un reporte describe un árbol que ya avanzó.
    const head = ready.length ? await readHead(targetCwd) : null;

    for (const { agent, messages } of ready) {
      const ptyId = cwdBindings.get(agent.name);
      if (!ptyId) continue; // sin terminal asociada: se queda en la bandeja

      // Si el agente ya no está corriendo en esa terminal, NO se entrega
      // y el cursor no avanza: el mensaje sigue pendiente y aparece como
      // tal en el panel. Un mensaje sin leer es recuperable; uno marcado
      // como entregado que nadie leyó, no.
      if (!checkPresence(agent.name, ptyId, cwdPresence)) continue;

      // Sólo el más viejo: el resto espera a que vuelva a `waiting`.
      const message = messages[0];
      const payload = formatForTerminal(message, {
        crossed: crossedMessages(all, message),
        head,
      });

      // Abre la ventana de captura de diagnóstico: guarda B1 y permite
      // que la envoltura de ipc.js acumule B2 en los chunks de proc.write.
      // La ventana se cierra en el finally para garantizarlo aunque algo
      // tire: sin esto la sesión quedaría armada y el tipeo posterior del
      // usuario se acumularía hasta la próxima entrega (fuga de privacidad).
      diag.arm(ptyId, { agent: agent.name, cwd: targetCwd, messageId: message.id, payload });
      let drenajeVencido = false;
      try {
        // Dos escrituras separadas, no una: ver SUBMIT_DELAY_MS. El texto
        // primero, y el Enter después de que el TUI del agente haya cerrado
        // su ventana de detección de pegado.
        writeToPty(ptyId, payload);
        // Espera el drenaje real, con tope de tiempo: si la cola nunca
        // resuelve (pty muerto sin cerrar la cola), el reparto no se cuelga.
        drenajeVencido = await Promise.race([
          whenIdleForPty(ptyId).then(() => false),
          sleep(idleTimeoutMs).then(() => true),
        ]);
        if (submitDelayMs > 0) await sleep(submitDelayMs);
        writeToPty(ptyId, '\r');
      } finally {
        diag.disarm(ptyId);
      }

      // El cursor avanza *después* de escribir: si Bento se cae en el
      // medio, el mensaje se reintenta en vez de perderse.
      await markDelivered(targetCwd, agent.name, message.id);
      // Vuelca el registro a disco, fire-and-forget: ningún fallo del
      // diagnóstico se propaga al camino de entrega.
      diag.flush(ptyId, { drenajeVencido }).catch(() => {});

      delivered.push({ agent: agent.name, message });
      onDelivered({ agent: agent.name, message });
    }

    return delivered;
  }

  /** Encola una vuelta para un workspace concreto. */
  function tickFor(targetCwd) {
    const state = cwds.get(targetCwd);
    if (!state) return Promise.resolve([]);
    state.chain = state.chain.then(
      () => runTickFor(targetCwd),
      () => runTickFor(targetCwd),
    );
    return state.chain;
  }

  /**
   * Encola una vuelta para TODOS los workspaces vigilados y devuelve
   * el array combinado. Firma idéntica a la versión anterior: los tests
   * y la UI siguen usando `dispatcher.tick()` sin cambios.
   */
  function tick() {
    const promises = [...cwds.keys()].map(tickFor);
    return Promise.all(promises).then((arrays) => arrays.flat());
  }

  /** Reparte enseguida para un workspace, agrupando ráfagas de cambios. */
  function scheduleFor(targetCwd) {
    const state = cwds.get(targetCwd);
    if (!state) return;
    if (state.debounce) clearTimeout(state.debounce);
    state.debounce = setTimeout(() => {
      state.debounce = null;
      onChange();
      tickFor(targetCwd);
    }, DEBOUNCE_MS);
  }

  /**
   * Arranca a vigilar un workspace. Idempotente: si ya se está vigilando
   * ese cwd, no hace nada. No detiene otros workspaces activos: en modo
   * "loops simultáneos" pueden coexistir varios.
   *
   * En modo "un loop a la vez", el llamador es responsable de llamar a
   * `stop(cwdAnterior)` antes de llamar a `start(cwdNuevo)`.
   */
  function start(nextCwd) {
    if (!nextCwd || cwds.has(nextCwd)) return; // idempotente

    const state = { poll: null, unwatch: null, debounce: null, chain: Promise.resolve([]) };
    cwds.set(nextCwd, state);

    // `fs.watch` es el camino rápido, pero se pierde eventos según el SO y
    // no existe hasta que exista la carpeta. El intervalo es la red: hace
    // que el loop ande igual, sólo que con hasta POLL_MS de demora.
    if (watchFs) {
      try {
        state.unwatch = watchLoop(nextCwd, () => scheduleFor(nextCwd));
      } catch {
        state.unwatch = null;
      }
    }
    state.poll = setInterval(() => {
      // Si la carpeta apareció después de arrancar, enganchamos el watch.
      if (watchFs && !state.unwatch) {
        try { state.unwatch = watchLoop(nextCwd, () => scheduleFor(nextCwd)); } catch { /* sigue el poll */ }
      }
      // `fs.watch` puede perder eventos en Windows (Explorer, Search Indexer,
      // antivirus). `onChange` acá garantiza que la sidebar se refresca aunque
      // watchLoop no haya avisado — mismo intervalo que el tick, sin coste extra.
      onChange();
      tickFor(nextCwd);
    }, pollMs);

    if (watchFs) scheduleFor(nextCwd);
  }

  /**
   * Detiene la vigilancia de un workspace concreto, o de todos si no se
   * especifica ninguno.
   *
   * @param {string} [targetCwd] — si se omite, detiene todos los workspaces.
   */
  function stop(targetCwd) {
    const toStop = targetCwd ? [targetCwd] : [...cwds.keys()];
    for (const c of toStop) {
      const state = cwds.get(c);
      if (!state) continue;
      if (state.debounce) { clearTimeout(state.debounce); state.debounce = null; }
      if (state.poll) { clearInterval(state.poll); state.poll = null; }
      if (state.unwatch) { try { state.unwatch(); } catch { /* noop */ } state.unwatch = null; }
      cwds.delete(c);
    }
  }

  /**
   * Corta todo, incluidas las asociaciones (al cerrar la app).
   *
   * Espera las vueltas en curso: `stop()` sólo cancela los timers,
   * pero un reparto ya arrancado sigue escribiendo en `.ybento/loop/`
   * después. Sin esperarlo, quien limpie detrás (un test que borra su
   * carpeta temporal, o la app cerrando el workspace) corre contra una
   * escritura a medio hacer.
   */
  async function dispose() {
    // Recolectar chains ANTES de stop(): stop() vacía el Map.
    const chains = [...cwds.values()].map((s) => s.chain);
    stop();
    await Promise.all(chains.map((c) => c.catch(() => {})));
    allBindings.clear();
    allPresence.clear();
  }

  return {
    bind, unbind, boundAgents, tick, start, stop, dispose,
    presence: presenceSnapshot,
  };
}
