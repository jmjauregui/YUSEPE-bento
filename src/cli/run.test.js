/**
 * src/cli/run.test.js
 * --------------------------------------------------------------
 * CLI `ybento` sobre disco real (dir temporal).
 *
 * Este CLI lo maneja un agente de IA leyendo la salida como texto, así
 * que acá importa tanto el efecto como *lo que imprime*: si el mensaje de
 * error no dice qué hacer, el agente se queda trabado y el loop se corta.
 * Por eso se afirma sobre el contenido de la salida y no sólo sobre el
 * código de retorno.
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { findRoot, parseArgs, run } from './run.js';
import { getAgent, inbox, listMessages, postMessage, registerAgent } from '../main/loopOps.js';

let cwd;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-cli-test-'));
  await fs.mkdir(path.join(cwd, '.ybento'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

/** Corre el CLI capturando salida, como si fuera @claudio. */
async function cli(argv, { as = 'claudio', at = null, env = {} } = {}) {
  let out = '';
  let err = '';
  const code = await run(argv, {
    cwd: at || cwd,
    env: { YBENTO_AGENT: as, ...env },
    out: (t) => { out += t; },
    err: (t) => { err += t; },
  });
  return { code, out, err };
}

async function setupAgents() {
  await registerAgent(cwd, { name: 'claudio', role: 'codifica' });
  await registerAgent(cwd, { name: 'opencito', role: 'valida código fuente' });
}

describe('parseArgs', () => {
  it('separa flags de posicionales', () => {
    const { positional, flags } = parseArgs(['enviar', '@opencito', 'hola', '--json']);
    expect(positional).toEqual(['enviar', '@opencito', 'hola']);
    expect(flags.json).toBe(true);
  });

  it('--as consume su valor', () => {
    const { positional, flags } = parseArgs(['--as', 'claudio', 'estado']);
    expect(flags.as).toBe('claudio');
    expect(positional).toEqual(['estado']);
  });
});

describe('findRoot', () => {
  it('encuentra la raíz desde una subcarpeta', async () => {
    const deep = path.join(cwd, 'src', 'components');
    await fs.mkdir(deep, { recursive: true });
    expect(await findRoot(deep)).toBe(cwd);
  });

  it('YBENTO_ROOT gana sobre la búsqueda', async () => {
    expect(await findRoot(cwd, { YBENTO_ROOT: '/otro/lado' })).toBe('/otro/lado');
  });

  it('devuelve null si no hay workspace', async () => {
    const suelto = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-cli-suelto-'));
    try {
      expect(await findRoot(suelto)).toBeNull();
    } finally {
      await fs.rm(suelto, { recursive: true, force: true });
    }
  });
});

describe('ayuda y errores de uso', () => {
  it('--help sale con 0 y lista los comandos', async () => {
    const { code, out } = await cli(['--help']);
    expect(code).toBe(0);
    for (const cmd of ['estado', 'bandeja', 'enviar']) expect(out).toContain(cmd);
  });

  it('sin comando sale con 1 pero igual muestra la ayuda', async () => {
    const { code, out } = await cli([]);
    expect(code).toBe(1);
    expect(out).toContain('ybento estado');
  });

  it('un comando inventado sugiere --help', async () => {
    const { code, err } = await cli(['volar']);
    expect(code).toBe(1);
    expect(err).toContain('--help');
  });

  it('fuera de un workspace lo dice claro', async () => {
    const suelto = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-cli-suelto-'));
    try {
      const { code, err } = await cli(['estado'], { at: suelto });
      expect(code).toBe(1);
      expect(err).toContain('.ybento');
    } finally {
      await fs.rm(suelto, { recursive: true, force: true });
    }
  });

  it('sin identidad explica cómo darla', async () => {
    let err = '';
    const code = await run(['estado'], {
      cwd, env: {}, out: () => {}, err: (t) => { err += t; },
    });
    expect(code).toBe(1);
    expect(err).toContain('--as');
    expect(err).toContain('YBENTO_AGENT');
  });
});

describe('estado', () => {
  it('sin argumentos muestra mi estado y mi bandeja vacía', async () => {
    await setupAgents();
    const { code, out } = await cli(['estado']);
    expect(code).toBe(0);
    expect(out).toContain('@claudio — waiting');
    expect(out).toContain('sin mensajes');
  });

  // Es el comando que más se repite en el ciclo: no debe volcar la bandeja
  // entera, sólo decir cuántos hay y cómo leerlos.
  it('resume la bandeja sin volcar los mensajes', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'el secreto no debe imprimirse' });

    const { out } = await cli(['estado']);
    expect(out).toContain('1 pendiente');
    expect(out).toContain('ybento bandeja');
    expect(out).not.toContain('el secreto no debe imprimirse');
  });

  it('lista a los otros agentes con su rol y su estado', async () => {
    await setupAgents();
    const { out } = await cli(['estado']);
    expect(out).toContain('@opencito');
    expect(out).toContain('valida código fuente');
    expect(out).not.toMatch(/en el loop:.*@claudio/); // yo no me listo a mí mismo
  });

  it('working / waiting cambian el estado de verdad', async () => {
    await setupAgents();
    expect((await cli(['estado', 'working'])).out).toContain('working');
    expect((await getAgent(cwd, 'claudio')).state).toBe('working');

    await cli(['estado', 'waiting']);
    expect((await getAgent(cwd, 'claudio')).state).toBe('waiting');
  });

  it('rechaza un estado inventado diciendo cuáles valen', async () => {
    await setupAgents();
    const { code, err } = await cli(['estado', 'ocupadisimo']);
    expect(code).toBe(1);
    expect(err).toContain('waiting');
    expect(err).toContain('working');
  });

  it('si no estoy registrado lo dice en vez de fallar raro', async () => {
    const { code, err } = await cli(['estado'], { as: 'fantasma' });
    expect(code).toBe(1);
    expect(err).toContain('@fantasma');
  });

  it('--json devuelve algo parseable', async () => {
    await setupAgents();
    const { out } = await cli(['estado', '--json']);
    const data = JSON.parse(out);
    expect(data.name).toBe('claudio');
    expect(data.pendientes).toBe(0);
  });
});

describe('bandeja', () => {
  it('sin mensajes lo dice y sale con 0', async () => {
    await setupAgents();
    const { code, out } = await cli(['bandeja']);
    expect(code).toBe(0);
    expect(out).toContain('Sin mensajes');
  });

  it('lista los pendientes con su remitente', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'el botón no anda' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'dale prioridad' });

    const { out } = await cli(['bandeja']);
    expect(out).toContain('@opencito');
    expect(out).toContain('el botón no anda');
    expect(out).toContain('el usuario'); // al humano se lo nombra en humano
    expect(out).toContain('dale prioridad');
  });

  it('--ultimo trae sólo el más reciente', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'viejo' });
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'nuevo' });

    const { out } = await cli(['bandeja', '--ultimo']);
    expect(out).toContain('nuevo');
    expect(out).not.toContain('viejo');
  });

  it('no trae mensajes de otro', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'ajeno' });
    expect((await cli(['bandeja'])).out).not.toContain('ajeno');
  });

  // El cursor lo mueve Bento al pegar en el pty, no el agente al leer:
  // si avanzara acá, un reinicio a mitad del pegado se comería el mensaje.
  it('leer la bandeja no consume los mensajes', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'sigue ahí' });

    await cli(['bandeja']);
    expect(await inbox(cwd, 'claudio')).toHaveLength(1);
  });
});

describe('enviar', () => {
  it('postea el mensaje y lo confirma', async () => {
    await setupAgents();
    const { code, out } = await cli(['enviar', '@opencito', 'revisá la landing']);
    expect(code).toBe(0);
    expect(out).toContain('@opencito');

    const msgs = await listMessages(cwd);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ from: 'claudio', to: 'opencito', text: 'revisá la landing' });
  });

  it('junta el texto aunque venga sin comillas', async () => {
    await setupAgents();
    await cli(['enviar', '@opencito', 'revisá', 'la', 'landing']);
    expect((await listMessages(cwd))[0].text).toBe('revisá la landing');
  });

  it('le puedo escribir al usuario', async () => {
    await setupAgents();
    const { code } = await cli(['enviar', '@usuario', 'terminé la landing']);
    expect(code).toBe(0);
    expect((await listMessages(cwd))[0].to).toBe('usuario');
  });

  it('sin destinatario o sin texto explica el uso', async () => {
    await setupAgents();
    const sinDestino = await cli(['enviar']);
    expect(sinDestino.code).toBe(1);
    expect(sinDestino.err).toContain('ybento enviar');

    const sinTexto = await cli(['enviar', '@opencito']);
    expect(sinTexto.code).toBe(1);
    expect(sinTexto.err).toContain('ybento enviar');
  });

  it('un destinatario inválido no escribe nada', async () => {
    await setupAgents();
    const { code } = await cli(['enviar', '../../evil', 'hola']);
    expect(code).toBe(1);
    expect(await listMessages(cwd)).toEqual([]);
  });
});

// Feedback de campo: pasar un reporte largo entre comillas es lo único
// donde el agente tuvo que escribir esquivando caracteres. Un backtick o
// un `$` los expande el shell en silencio.
describe('enviar sin pelearse con el shell', () => {
  const PELIGROSO = 'Revisá `git log` y $HOME/config, ¡ojo con "esto"!';

  it('lee el mensaje de un archivo con -f', async () => {
    await setupAgents();
    const file = path.join(cwd, 'reporte.md');
    await fs.writeFile(file, PELIGROSO, 'utf8');

    const { code } = await cli(['enviar', '@opencito', '-f', 'reporte.md']);
    expect(code).toBe(0);
    expect((await listMessages(cwd))[0].text).toBe(PELIGROSO);
  });

  it('-f acepta rutas relativas a donde está parado el agente', async () => {
    await setupAgents();
    const sub = path.join(cwd, 'docs');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, 'qa.md'), 'desde una subcarpeta', 'utf8');

    await cli(['enviar', '@opencito', '-f', 'docs/qa.md']);
    expect((await listMessages(cwd))[0].text).toBe('desde una subcarpeta');
  });

  it('un archivo que no existe lo dice, y no manda nada', async () => {
    await setupAgents();
    const { code, err } = await cli(['enviar', '@opencito', '-f', 'no-existe.md']);
    expect(code).toBe(1);
    expect(err).toContain('no-existe.md');
    expect(await listMessages(cwd)).toEqual([]);
  });

  it('lee de stdin cuando no hay texto y stdin está canalizado (heredoc)', async () => {
    await setupAgents();
    const code = await run(['enviar', '@opencito'], {
      cwd,
      env: { YBENTO_AGENT: 'claudio' },
      out: () => {},
      err: () => {},
      readStdin: async () => `${PELIGROSO}\n`,
      isTTY: false,
    });

    expect(code).toBe(0);
    expect((await listMessages(cwd))[0].text).toBe(PELIGROSO);
  });

  // Sin esto, `ybento enviar @x` tipeado a mano se colgaría esperando input.
  it('sin texto y con stdin en terminal, es error de uso y no se cuelga', async () => {
    await setupAgents();
    const { code, err } = await cli(['enviar', '@opencito']);
    expect(code).toBe(1);
    expect(err).toContain('-f');
  });
});

describe('waiting automático al enviar', () => {
  // Acordarse de volver a waiting a mano es un footgun: si el agente se
  // olvida queda incomunicado y su bandeja se frena.
  it('enviar devuelve al agente a waiting', async () => {
    await setupAgents();
    await cli(['estado', 'working']);

    const { out } = await cli(['enviar', '@opencito', 'terminé']);
    expect((await getAgent(cwd, 'claudio')).state).toBe('waiting');
    expect(out).toContain('waiting');
  });

  it('--ocupado lo deja en working (aviso a mitad de tarea)', async () => {
    await setupAgents();
    await cli(['estado', 'working']);

    const { out } = await cli(['enviar', '@opencito', 'voy por la mitad', '--ocupado']);
    expect((await getAgent(cwd, 'claudio')).state).toBe('working');
    expect(out).not.toContain('waiting');
  });

  it('si el que envía no está registrado, el mensaje igual se manda', async () => {
    await registerAgent(cwd, { name: 'opencito' });
    const { code } = await cli(['enviar', '@opencito', 'hola'], { as: 'suelto' });
    expect(code).toBe(0);
    expect(await listMessages(cwd)).toHaveLength(1);
  });
});

describe('el ciclo completo del agente', () => {
  // El recorrido del diagrama: leo mi estado -> tengo mensajes -> me marco
  // working -> trabajo -> aviso al otro -> me marco waiting.
  it('claudio recibe, trabaja, reporta y se libera', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'crea una landing' });

    expect((await cli(['estado'])).out).toContain('1 pendiente');
    expect((await cli(['bandeja'])).out).toContain('crea una landing');

    await cli(['estado', 'working']);
    expect((await getAgent(cwd, 'claudio')).state).toBe('working');

    await cli(['enviar', '@opencito', 'landing lista, revisala']);
    await cli(['estado', 'waiting']);

    expect((await getAgent(cwd, 'claudio')).state).toBe('waiting');
    expect((await inbox(cwd, 'opencito')).map((m) => m.text)).toEqual(['landing lista, revisala']);

    // y opencito lo ve desde su propia identidad
    const { out } = await cli(['bandeja'], { as: 'opencito' });
    expect(out).toContain('landing lista, revisala');
    expect(out).toContain('@claudio');
  });
});

// C4 — el comando diag imprime veredicto en texto, no sólo números
describe('diag', () => {
  async function writeRec(rec) {
    const diagDir = path.join(cwd, '.ybento', 'loop', 'diag');
    await fs.mkdir(diagDir, { recursive: true });
    await fs.writeFile(
      path.join(diagDir, `${rec.agent}.json`),
      JSON.stringify(rec, null, 2),
      'utf8',
    );
  }

  function makeRec(overrides = {}) {
    const b1 = overrides.b1 ?? 'hola mundo';
    // En el caso sano, B2 = B1 + '\r' (el Enter entra dentro de la ventana)
    const b2 = overrides.b2 ?? (b1 + '\r');
    return {
      timestamp: new Date().toISOString(),
      agent: 'claudio',
      messageId: 'msg-test',
      b1,
      b1Len: b1.length,
      b2,
      b2Len: b2.length,
      b2Chunks: 1,
      truncadoPorTope: false,
      colaVaciadaPorError: false,
      drenajeVencido: false,
      ...overrides,
    };
  }

  it('sin registros informa que no hay nada', async () => {
    const { code, out } = await cli(['diag'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('No hay registros');
  });

  it('@agente sin registro muestra error explicativo con el nombre del agente', async () => {
    const { code, err } = await cli(['diag', '@opencito'], { as: 'claudio' });
    expect(code).toBe(1);
    expect(err).toContain('@opencito');
    expect(err).toContain('registro');
    expect(err).toContain('entrega');
  });

  it('veredicto B1 = B2: señala node-pty/ConPTY/TUI', async () => {
    await writeRec(makeRec({ b1: 'texto ok' })); // b2 = 'texto ok\r' por defecto
    const { code, out } = await cli(['diag', '@claudio'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('B1 = B2');
    expect(out).toContain('node-pty');
  });

  it('veredicto B1 ≠ B2: señala la cola con la posición exacta', async () => {
    await writeRec(makeRec({ b1: 'abcdefghij', b2: 'abcXXXghij' }));
    const { code, out } = await cli(['diag', '@claudio'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('B1 ≠ B2');
    expect(out).toContain('posición 3');
    expect(out).toContain('cola');
  });

  it('veredicto drenajeVencido: señala el timeout del dispatcher', async () => {
    await writeRec(makeRec({ drenajeVencido: true }));
    const { code, out } = await cli(['diag', '@claudio'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('drenaje');
  });

  it('veredicto colaVaciadaPorError: señala drain/clear', async () => {
    await writeRec(makeRec({ colaVaciadaPorError: true }));
    const { code, out } = await cli(['diag', '@claudio'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('drain');
  });

  it('lista registros disponibles con @agente y antigüedad', async () => {
    await writeRec(makeRec());
    const { code, out } = await cli(['diag'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('@claudio');
    expect(out).toContain('msg-test');
  });

  it('--payload vuelca B2 completo al final', async () => {
    const b2 = 'contenido completo del B2 para diffear';
    await writeRec(makeRec({ b1: b2, b2 }));
    const { code, out } = await cli(['diag', '@claudio', '--payload'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain(b2);
    expect(out).toContain('B2 completo');
  });

  it('imprime largos de B1 y B2 explícitamente', async () => {
    await writeRec(makeRec({ b1: 'a'.repeat(500), b2: 'a'.repeat(500) }));
    const { code, out } = await cli(['diag', '@claudio'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('500');
  });

  // C3 del comando: escritura ajena durante la ventana → aviso de contaminación
  it('avisa contaminación cuando B2 tiene más datos que B1+\\r', async () => {
    // Simula tipeo del usuario solapado con el drenaje de un mensaje largo:
    // B2 = payload + tipeo_ajeno + '\r'
    const b1 = 'mensaje del loop de 50 chars, lorem ipsum dolor sit';
    const b2 = b1 + 'ls -la\n' + '\r'; // tipeo del usuario se coló
    await writeRec(makeRec({ b1, b2 }));
    const { code, out } = await cli(['diag', '@claudio'], { as: 'claudio' });
    expect(code).toBe(0);
    expect(out).toContain('ajenas');           // avisa contaminación
    expect(out).toContain('Repetir');          // pide repetir la captura
    expect(out).not.toContain('createWriteQueue'); // NO acusa la cola
    expect(out).not.toContain('node-pty');         // NO acusa node-pty
  });
});
