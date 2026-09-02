/**
 * src/main/loopDispatcher.test.js
 * --------------------------------------------------------------
 * El repartidor sobre disco real, con un pty falso.
 *
 * Lo que se cubre acá es justamente lo que no se puede ver en un test de
 * loopOps: que un mensaje llegue *una sola vez*, a la terminal correcta,
 * y nunca a un agente ocupado. Un fallo en cualquiera de esas tres cosas
 * rompe el loop de una forma difícil de diagnosticar a mano (texto
 * entrelazado en un TUI, o un agente repitiendo la misma tarea).
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createDispatcher } from './loopDispatcher.js';
import { getAgent, inbox, listMessages, markDelivered, postMessage, registerAgent, setAgentState } from './loopOps.js';
import { createWriteQueue } from './ptyWriteQueue.js';

let cwd;
let writes;
let dispatcher;

/**
 * Pty falso. `log` guarda todas las escrituras; `pastes` filtra el Enter,
 * que va en una escritura aparte a propósito (ver SUBMIT_DELAY_MS).
 */
function makeWriter() {
  const log = [];
  return {
    log,
    write: (ptyId, data) => log.push({ ptyId, data }),
    get pastes() { return log.filter((w) => w.data !== '\r'); },
  };
}

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-dispatch-test-'));
  writes = makeWriter();
  // submitDelayMs: 0 para no pagar la pausa real en cada test; que el
  // Enter viaje aparte se verifica en su propio bloque.
  // pollMs alto: salvo el test de la vigilancia, todos piden las vueltas a
  // mano, y un poll de fondo repartiendo por su cuenta los vuelve
  // dependientes del reloj (y flaky al correr la suite completa).
  dispatcher = createDispatcher({
    writeToPty: writes.write, submitDelayMs: 0, pollMs: 60_000, watchFs: false,
  });

  await registerAgent(cwd, { name: 'claudio', role: 'codifica' });
  await registerAgent(cwd, { name: 'opencito', role: 'valida' });
});

afterEach(async () => {
  // `dispose()` espera la vuelta en curso: si no, el reparto sigue
  // escribiendo mientras borramos la carpeta y el rm falla con ENOTEMPTY.
  await dispatcher.dispose();
  await fs.rm(cwd, { recursive: true, force: true });
});

/**
 * Apunta el repartidor al workspace del test.
 *
 * Con `watchFs: false` y el poll largo (ver beforeEach), las únicas vueltas
 * que corren son las que el test pide con `tick()`. Si no, las escrituras
 * del propio test disparan la vigilancia y una vuelta de fondo entrega un
 * mensaje en medio de las aserciones.
 */
function start() {
  dispatcher.start(cwd);
}

describe('binding de agentes a terminales', () => {
  it('sin binding el mensaje no se entrega y queda en la bandeja', async () => {
    start();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });

    expect(await dispatcher.tick()).toEqual([]);
    expect(writes.log).toEqual([]);
    expect(await inbox(cwd, 'claudio')).toHaveLength(1);
  });

  it('normaliza el nombre al asociar', async () => {
    dispatcher.bind('@Claudio', 'pty_1', cwd);
    expect(dispatcher.boundAgents(cwd)).toEqual(['claudio']);
  });

  it('unbind corta la entrega', async () => {
    start();
    dispatcher.bind('claudio', 'pty_1', cwd);
    dispatcher.unbind('claudio', cwd);
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });

    expect(await dispatcher.tick()).toEqual([]);
  });
});

describe('entrega', () => {
  beforeEach(() => {
    start();
    dispatcher.bind('claudio', 'pty_claudio', cwd);
    dispatcher.bind('opencito', 'pty_opencito', cwd);
  });

  it('pega el mensaje en la terminal correcta', async () => {
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'crea una landing' });
    await dispatcher.tick();

    expect(writes.pastes).toHaveLength(1);
    expect(writes.pastes[0].ptyId).toBe('pty_claudio');
    expect(writes.pastes[0].data).toContain('crea una landing');
  });

  // Del otro lado hay un TUI que detecta ráfagas como pegado: si el Enter
  // viaja pegado al texto se lo traga como contenido y el mensaje queda
  // escrito sin enviarse — el loop deja de ser autónomo.
  it('manda el Enter en una escritura separada, después del texto', async () => {
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });
    await dispatcher.tick();

    expect(writes.log).toHaveLength(2);
    expect(writes.log[0].data).not.toContain('\r');
    expect(writes.log[1]).toEqual({ ptyId: 'pty_claudio', data: '\r' });
  });

  // Un `\n` en el medio es un Enter dentro de la caja de texto del agente:
  // parte el mensaje y rompe el envío.
  it('colapsa el mensaje a una sola línea', async () => {
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'linea 1\nlinea 2\n\nlinea 3' });
    await dispatcher.tick();

    const { data } = writes.pastes[0];
    expect(data).not.toContain('\n');
    expect(data).toContain('linea 1 linea 2 linea 3');
  });

  it('el texto pegado le dice quién es y dónde está el protocolo', async () => {
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'el botón no anda' });
    await dispatcher.tick();

    const { data } = writes.pastes[0];
    expect(data).toContain('@opencito');
    expect(data).toContain('@claudio');
    // path.join: en Windows la ruta viaja con `\`, en Unix con `/`.
    expect(data).toContain(path.join('.ybento', 'loop', 'skill.md'));
  });

  it('cada agente recibe lo suyo', async () => {
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'para claudio' });
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'para opencito' });
    await dispatcher.tick();

    const byPty = Object.fromEntries(writes.pastes.map((w) => [w.ptyId, w.data]));
    expect(byPty.pty_claudio).toContain('para claudio');
    expect(byPty.pty_opencito).toContain('para opencito');
  });

  // Si esto falla, el agente repite la misma tarea una y otra vez.
  it('no repite un mensaje ya entregado', async () => {
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'una sola vez' });

    await dispatcher.tick();
    await dispatcher.tick();
    await dispatcher.tick();

    expect(writes.pastes).toHaveLength(1);
  });

  it('avanza el cursor al entregar', async () => {
    const msg = await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });
    await dispatcher.tick();

    expect((await getAgent(cwd, 'claudio')).cursor).toBe(msg.id);
    expect(await inbox(cwd, 'claudio')).toEqual([]);
  });

  // Inundar el prompt con tres mensajes de corrido los hace procesar
  // mezclados; el resto espera a que el agente vuelva a `waiting`.
  it('entrega de a un mensaje por vuelta', async () => {
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'dos' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'tres' });

    await dispatcher.tick();
    expect(writes.pastes).toHaveLength(1);
    expect(writes.pastes[0].data).toContain('uno');

    await dispatcher.tick();
    expect(writes.pastes).toHaveLength(2);
    expect(writes.pastes[1].data).toContain('dos');
  });

  it('reporta lo entregado', async () => {
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });
    const delivered = await dispatcher.tick();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].agent).toBe('claudio');
    expect(delivered[0].message.text).toBe('hola');
  });
});

describe('el gate de estado', () => {
  beforeEach(() => {
    start();
    dispatcher.bind('claudio', 'pty_claudio', cwd);
  });

  // La razón de ser de status.json: escribir en el pty de un agente que
  // está corriendo su tarea entrelaza el texto con su TUI.
  it('no le escribe a un agente en working', async () => {
    await setAgentState(cwd, 'claudio', 'working');
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'no me pegues ahora' });

    await dispatcher.tick();
    expect(writes.log).toEqual([]);
  });

  it('entrega en cuanto vuelve a waiting, sin haber perdido nada', async () => {
    await setAgentState(cwd, 'claudio', 'working');
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'hay un bug' });
    await dispatcher.tick();
    expect(writes.log).toEqual([]);

    await setAgentState(cwd, 'claudio', 'waiting');
    await dispatcher.tick();

    expect(writes.pastes).toHaveLength(1);
    expect(writes.pastes[0].data).toContain('hay un bug');
  });
});

describe('presencia del agente', () => {
  /** Dispatcher con una sonda que dice qué hay en primer plano del pty. */
  function withProbe(foreground, shell = '/bin/zsh') {
    const w = makeWriter();
    const d = createDispatcher({
      writeToPty: w.write,
      probePty: () => ({ process: foreground, shell }),
      submitDelayMs: 0,
      pollMs: 60_000,
      watchFs: false,
    });
    d.start(cwd);
    d.bind('claudio', 'pty_claudio', cwd);
    return { w, d };
  }

  // El caso que rompía en campo: el agente termina, la terminal vuelve al
  // prompt, y el mensaje se daba por entregado sin que nadie lo leyera.
  it('no entrega si la terminal volvió al shell, y NO consume el mensaje', async () => {
    const { w, d } = withProbe('zsh');
    try {
      await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'seguís ahí?' });
      await d.tick();

      expect(w.log).toEqual([]);
      // Lo importante: sigue pendiente, recuperable.
      expect(await inbox(cwd, 'claudio')).toHaveLength(1);
      expect((await getAgent(cwd, 'claudio')).cursor).toBeNull();
    } finally { await d.dispose(); }
  });

  it('reconoce el shell aunque venga como login shell (`-zsh`) o con ruta', async () => {
    for (const foreground of ['-zsh', '/bin/bash', 'fish']) {
      const { w, d } = withProbe(foreground);
      try {
        await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'hola' });
        await d.tick();
        expect(w.log).toEqual([]);
      } finally { await d.dispose(); }
    }
  });

  it('entrega normal si el agente está corriendo', async () => {
    const { w, d } = withProbe('claude');
    try {
      await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'revisá esto' });
      await d.tick();
      expect(w.pastes).toHaveLength(1);
    } finally { await d.dispose(); }
  });

  // Un shell propio que no esté en la lista igual se detecta comparando
  // con el shell que arrancó el pty.
  it('detecta un shell raro comparándolo con el que lanzó la terminal', async () => {
    const { w, d } = withProbe('mishell', '/opt/bin/mishell');
    try {
      await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'hola' });
      await d.tick();
      expect(w.log).toEqual([]);
    } finally { await d.dispose(); }
  });

  // Preferimos entregar de más antes que dejar mudo un loop sano.
  it('ante la duda (sin sonda o sin respuesta) entrega igual', async () => {
    for (const probe of [null, () => null, () => { throw new Error('pty muerto'); }]) {
      const w = makeWriter();
      const d = createDispatcher({
        writeToPty: w.write, probePty: probe, submitDelayMs: 0, pollMs: 60_000, watchFs: false,
      });
      d.start(cwd);
      d.bind('claudio', 'pty_claudio', cwd);
      try {
        await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'hola' });
        await d.tick();
        expect(w.pastes).toHaveLength(1);
      } finally { await d.dispose(); }
      await markDelivered(cwd, 'claudio', (await listMessages(cwd)).at(-1).id);
    }
  });

  it('avisa una sola vez cuando un agente se cae', async () => {
    const avisos = [];
    let foreground = 'claude';
    const w = makeWriter();
    const d = createDispatcher({
      writeToPty: w.write,
      probePty: () => ({ process: foreground, shell: '/bin/zsh' }),
      onPresence: (info) => avisos.push(info),
      submitDelayMs: 0,
      pollMs: 60_000,
      watchFs: false,
    });
    d.start(cwd);
    d.bind('claudio', 'pty_claudio', cwd);

    try {
      await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'uno' });
      await d.tick();
      expect(avisos).toEqual([{ agent: 'claudio', present: true, foreground: 'claude' }]);

      foreground = 'zsh';
      await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'dos' });
      await d.tick();
      await d.tick();
      await d.tick();

      // Un solo aviso de caída, no uno por vuelta del poll.
      expect(avisos.filter((a) => a.present === false)).toHaveLength(1);
      expect(d.presence(cwd).claudio.present).toBe(false);
    } finally { await d.dispose(); }
  });
});

describe('ciclo de vida', () => {
  it('sin start no reparte nada', async () => {
    dispatcher.bind('claudio', 'pty_claudio', cwd);
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });

    expect(await dispatcher.tick()).toEqual([]);
    expect(writes.log).toEqual([]);
  });

  it('stop corta la entrega', async () => {
    start();
    dispatcher.bind('claudio', 'pty_claudio', cwd);
    dispatcher.stop();

    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });
    expect(await dispatcher.tick()).toEqual([]);
  });

  it('start con otro workspace mueve la vigilancia', async () => {
    const otro = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-dispatch-otro-'));
    try {
      await registerAgent(otro, { name: 'claudio' });
      dispatcher.bind('claudio', 'pty_claudio', cwd);

      start();
      dispatcher.start(otro);

      await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'del viejo' });
      expect(await dispatcher.tick()).toEqual([]);

      await postMessage(otro, { from: 'usuario', to: 'claudio', text: 'del nuevo' });
      await dispatcher.tick();
      expect(writes.pastes).toHaveLength(1);
      expect(writes.pastes[0].data).toContain('del nuevo');
    } finally {
      await fs.rm(otro, { recursive: true, force: true });
    }
  });

  it('la vigilancia despierta el reparto sola, sin llamar a tick a mano', async () => {
    // Éste sí necesita el reloj: es lo que está probando. El poll corto es
    // a propósito — `fs.watch` a veces no dispara en macOS (el mismo flake
    // que arrastra watchTasks), y lo que hay que garantizar acá es que la
    // entrega arranque sola, no por cuál de los dos caminos.
    await dispatcher.dispose();
    dispatcher = createDispatcher({
      writeToPty: writes.write, submitDelayMs: 0, pollMs: 150, watchFs: true,
    });
    start();
    dispatcher.bind('claudio', 'pty_claudio', cwd);
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'automático' });

    // Sin tick() explícito: lo tiene que disparar el watch o el poll.
    await new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (writes.pastes.length || Date.now() - started > 4000) return resolve();
        setTimeout(check, 25);
      };
      check();
    });

    // Lo que se prueba acá es que la entrega arranque sola, no cuántas
    // escrituras hubo: afirmar un conteo exacto ata el test al reloj (el
    // watch y el poll pueden coincidir). Que no se repita un mensaje ya
    // entregado tiene su propio test.
    expect(writes.pastes.length).toBeGreaterThanOrEqual(1);
    expect(writes.pastes[0].data).toContain('automático');
  });

  it('dos vueltas simultáneas no entregan el mismo mensaje dos veces', async () => {
    start();
    dispatcher.bind('claudio', 'pty_claudio', cwd);
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'una sola vez' });

    await Promise.all([dispatcher.tick(), dispatcher.tick(), dispatcher.tick()]);
    expect(writes.pastes).toHaveLength(1);
  });
});

// Regresión H7: si whenIdleForPty nunca resuelve (pty muerto sin cerrar la
// cola), el cinturón de idleTimeoutMs garantiza que el reparto no se cuelgue.
describe('tolerancia a fallos del drenaje (cinturón)', () => {
  it('tick termina y entrega a los demás agentes aunque whenIdleForPty no resuelva', async () => {
    // whenIdleForPty que NUNCA resuelve para pty_claudio
    const d = createDispatcher({
      writeToPty: writes.write,
      whenIdleForPty: (ptyId) => (ptyId === 'pty_claudio' ? new Promise(() => {}) : Promise.resolve()),
      idleTimeoutMs: 50, // pequeño para que el test no tarde
      submitDelayMs: 0,
      pollMs: 60_000,
      watchFs: false,
    });
    d.start(cwd);
    d.bind('claudio', 'pty_claudio', cwd);
    d.bind('opencito', 'pty_opencito', cwd);

    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'para claudio' });
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'para opencito' });

    try {
      await d.tick(); // debe terminar en ~50 ms, no colgarse
      // opencito debe haber recibido su mensaje aunque claudio bloqueó
      expect(writes.pastes.filter((w) => w.ptyId === 'pty_opencito')).toHaveLength(1);
    } finally {
      await d.dispose();
    }
  }, 5_000);
});

// Usa reloj real: verifica que el \r espere el drenaje completo + submitDelay.
// El doble instantáneo del beforeEach no puede cubrir esto — exactamente el
// bug que se reportó: para mensajes > 2550 chars el sleep empezaba mientras
// la cola aún drenaba, y el \r llegaba sólo 5 ms después del último chunk.
describe('sincronización del Enter con el drenaje de la cola', () => {
  it('el \\r llega después del drenaje completo + submitDelay para mensajes grandes', async () => {
    const submitDelayMs = 30;
    // 500 chars → 10 chunks → 9 intervalos × 5 ms = 45 ms de drenaje > submitDelayMs.
    // Se suma el texto del encabezado de formatForTerminal (~80 chars),
    // así que en la práctica son ~12 chunks y ~55 ms de drenaje.
    const bigText = 'x'.repeat(500);

    // Escrituras reales al "pty" (timestamps del nivel writeFn)
    const physLog = [];
    const writer = createWriteQueue((data) => physLog.push({ data, ts: Date.now() }));

    const testCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-drain-test-'));
    const testDispatcher = createDispatcher({
      writeToPty: (_ptyId, data) => writer.write(data),
      whenIdleForPty: (_ptyId) => writer.whenIdle(),
      submitDelayMs,
      pollMs: 60_000,
      watchFs: false,
    });
    try {
      await registerAgent(testCwd, { name: 'claudio', role: 'codifica' });
      testDispatcher.start(testCwd);
      testDispatcher.bind('claudio', 'pty_1', testCwd);

      await postMessage(testCwd, { from: 'usuario', to: 'claudio', text: bigText });
      await testDispatcher.tick();

      // Debe haber al menos 2 escrituras físicas: algún chunk de texto y el \r.
      expect(physLog.length).toBeGreaterThanOrEqual(2);

      const enterIdx = physLog.findLastIndex((w) => w.data === '\r');
      expect(enterIdx).toBeGreaterThan(0);

      // El \r es el último write
      expect(enterIdx).toBe(physLog.length - 1);

      // Gap entre el último chunk de texto y el \r >= submitDelayMs:
      // el sleep empieza DESPUÉS del drenaje, no mientras drena.
      const lastTextTs = physLog[enterIdx - 1].ts;
      const enterTs = physLog[enterIdx].ts;
      expect(enterTs - lastTextTs).toBeGreaterThanOrEqual(submitDelayMs);
    } finally {
      await testDispatcher.dispose();
      await fs.rm(testCwd, { recursive: true, force: true });
    }
  }, 10_000);
});
