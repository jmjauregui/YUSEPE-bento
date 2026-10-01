/**
 * src/main/loopOps.test.js
 * --------------------------------------------------------------
 * Motor del loop multiagente sobre disco real (dir temporal), igual que
 * tasksOps.test.js / storage.test.js.
 *
 * Lo que más importa acá, que es distinto del resto del proyecto: los
 * archivos del loop los escriben **varios procesos a la vez** (Bento más
 * un CLI por cada agente). Así que se cubre (a) que dos escritores
 * concurrentes no se pisen, (b) que Bento no le pegue un mensaje a una
 * terminal ocupada, (c) que el cursor de entrega no repita ni se coma
 * mensajes, y (d) que un archivo tocado a mano no deje al loop sin bandeja.
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import {
  crossedMessages, DEFAULT_SKILL, ensureSkill, findMessage, formatForTerminal, getAgent, inbox, inboxSummary,
  listAgents, listMessages, LOOP_DIR, markDelivered, MESSAGES_FILE, normalizeName,
  pendingDeliveries, postMessage, readHead, registerAgent, readSkill, setAgentState,
  SKILL_FILE, STATUS_FILE, unregisterAgent, writeSkill,
} from './loopOps.js';

const run = promisify(execFile);

let cwd;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-loop-test-'));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

/** Registra los dos agentes del ejemplo del diseño. */
async function setupAgents() {
  await registerAgent(cwd, { name: 'claudio', role: 'codifica y gestiona archivos' });
  await registerAgent(cwd, { name: 'opencito', role: 'valida código fuente' });
}

describe('normalizeName', () => {
  it('acepta el @ y normaliza a minúsculas', () => {
    expect(normalizeName('@Claudio')).toBe('claudio');
    expect(normalizeName('  opencito ')).toBe('opencito');
  });

  it('rechaza nombres que no sirven como identidad', () => {
    for (const bad of ['', '@', 'con espacio', '../otro', 'a'.repeat(33), '-arranca-con-guion']) {
      expect(() => normalizeName(bad)).toThrow();
    }
  });
});

describe('registro de agentes', () => {
  it('registra con rol y arranca en waiting', async () => {
    const agent = await registerAgent(cwd, { name: '@Claudio', role: 'codifica' });
    expect(agent.name).toBe('claudio');
    expect(agent.role).toBe('codifica');
    expect(agent.state).toBe('waiting');
    expect(agent.cursor).toBeNull();
  });

  it('no crea .ybento sólo por listar', async () => {
    expect(await listAgents(cwd)).toEqual([]);
    await expect(fs.stat(path.join(cwd, '.ybento'))).rejects.toThrow();
  });

  it('re-registrar conserva estado y cursor (cambiar el rol no reenvía la bandeja)', async () => {
    await registerAgent(cwd, { name: 'claudio', role: 'viejo rol' });
    await setAgentState(cwd, 'claudio', 'working');
    const msg = await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });
    await markDelivered(cwd, 'claudio', msg.id);

    await registerAgent(cwd, { name: 'claudio', role: 'rol nuevo' });

    const agent = await getAgent(cwd, 'claudio');
    expect(agent.role).toBe('rol nuevo');
    expect(agent.state).toBe('working');
    expect(agent.cursor).toBe(msg.id);
  });

  it('unregisterAgent lo saca del loop', async () => {
    await setupAgents();
    await unregisterAgent(cwd, 'claudio');
    expect((await listAgents(cwd)).map((a) => a.name)).toEqual(['opencito']);
  });

  // El color se pinta con un `style` inline en el panel, así que un valor
  // arbitrario en status.json sería inyección de CSS. status.json vive dentro
  // del proyecto y lo tocan tanto el usuario como los agentes, así que no
  // alcanza con validar al escribir: el camino de lectura tampoco confía.
  it('guarda el color sólo si es un hex, y lo conserva al reeditar el rol', async () => {
    const agent = await registerAgent(cwd, { name: 'claudio', color: '#4AA3F0' });
    expect(agent.color).toBe('#4aa3f0');

    await registerAgent(cwd, { name: 'claudio', role: 'otro rol' });
    expect((await getAgent(cwd, 'claudio')).color).toBe('#4aa3f0');

    for (const junk of ['red', 'url(x)', '#fff', '#4aa3f0; background: url(evil)', '']) {
      await registerAgent(cwd, { name: 'malo', color: junk });
      expect((await getAgent(cwd, 'malo')).color).toBeNull();
    }
  });

  it('un color escrito a mano en status.json se descarta al leer', async () => {
    await registerAgent(cwd, { name: 'claudio' });
    const raw = JSON.parse(await fs.readFile(path.join(cwd, STATUS_FILE), 'utf8'));
    raw.agents.claudio.color = '#000; position: fixed; inset: 0';
    await fs.writeFile(path.join(cwd, STATUS_FILE), JSON.stringify(raw), 'utf8');

    expect((await listAgents(cwd))[0].color).toBeNull();
  });

  it('un status.json corrupto no deja al loop sin agentes', async () => {
    await setupAgents();
    await fs.writeFile(path.join(cwd, STATUS_FILE), '{ roto', 'utf8');

    expect(await listAgents(cwd)).toEqual([]); // se degrada, no explota
    const agent = await registerAgent(cwd, { name: 'claudio', role: 'codifica' });
    expect(agent.name).toBe('claudio'); // y se reconstruye
  });
});

describe('estados', () => {
  it('cambia entre waiting y working', async () => {
    await setupAgents();
    expect((await setAgentState(cwd, 'claudio', 'working')).state).toBe('working');
    expect((await getAgent(cwd, 'claudio')).state).toBe('working');
    expect((await setAgentState(cwd, 'claudio', 'waiting')).state).toBe('waiting');
  });

  it('rechaza estados inventados', async () => {
    await setupAgents();
    await expect(setAgentState(cwd, 'claudio', 'ocupadisimo')).rejects.toThrow(/Estado inválido/);
  });

  it('rechaza agentes que no están en el loop', async () => {
    await expect(setAgentState(cwd, 'fantasma', 'working')).rejects.toThrow(/no está registrado/);
  });
});

describe('mensajes', () => {
  it('postea y lee en orden', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'crea una landing' });
    await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'revisá esto' });

    const all = await listMessages(cwd);
    expect(all.map((m) => m.text)).toEqual(['crea una landing', 'revisá esto']);
    expect(all[0].from).toBe('usuario');
    expect(all[1].from).toBe('claudio');
  });

  it('normaliza el destinatario escrito como @nombre', async () => {
    await setupAgents();
    const msg = await postMessage(cwd, { from: 'usuario', to: '@Claudio', text: 'hola' });
    expect(msg.to).toBe('claudio');
  });

  it('rechaza mensajes vacíos', async () => {
    await setupAgents();
    await expect(postMessage(cwd, { from: 'usuario', to: 'claudio', text: '   ' }))
      .rejects.toThrow(/vacío/);
  });

  it('un mensaje multilínea sigue ocupando una sola línea del .jsonl', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'línea 1\nlínea 2\nlínea 3' });

    const raw = await fs.readFile(path.join(cwd, MESSAGES_FILE), 'utf8');
    expect(raw.trimEnd().split('\n')).toHaveLength(1);
    expect((await listMessages(cwd))[0].text).toBe('línea 1\nlínea 2\nlínea 3');
  });

  it('una línea corrupta no tira la bandeja abajo', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'antes' });
    await fs.appendFile(path.join(cwd, MESSAGES_FILE), 'esto no es json\n', 'utf8');
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'después' });

    expect((await listMessages(cwd)).map((m) => m.text)).toEqual(['antes', 'después']);
  });

  it('filtra por destinatario', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'para claudio' });
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'para opencito' });

    expect((await listMessages(cwd, { to: 'claudio' })).map((m) => m.text)).toEqual(['para claudio']);
  });
});

describe('concurrencia', () => {
  // El escenario real: cada agente corre su propio proceso del CLI y postea
  // cuando termina. Con un JSON único esto perdía mensajes.
  it('N escritores simultáneos no se pisan mensajes', async () => {
    await setupAgents();
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        postMessage(cwd, { from: 'usuario', to: 'claudio', text: `msg ${i}` })),
    );

    const all = await listMessages(cwd);
    expect(all).toHaveLength(40);
    expect(new Set(all.map((m) => m.text)).size).toBe(40);
  });

  it('cambios de estado simultáneos no se pisan entre agentes', async () => {
    await registerAgent(cwd, { name: 'a' });
    await registerAgent(cwd, { name: 'b' });
    await registerAgent(cwd, { name: 'c' });

    await Promise.all([
      setAgentState(cwd, 'a', 'working'),
      setAgentState(cwd, 'b', 'working'),
      setAgentState(cwd, 'c', 'working'),
    ]);

    expect((await listAgents(cwd)).map((x) => x.state)).toEqual(['working', 'working', 'working']);
  });

  it('registros simultáneos no pierden agentes', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => registerAgent(cwd, { name: `agente-${i}` })),
    );
    expect(await listAgents(cwd)).toHaveLength(10);
  });
});

describe('bandeja y cursor de entrega', () => {
  it('sólo trae los mensajes propios', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'ajeno' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'propio' });

    expect((await inbox(cwd, 'claudio')).map((m) => m.text)).toEqual(['propio']);
  });

  it('el cursor no repite lo ya entregado', async () => {
    await setupAgents();
    const first = await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'dos' });

    await markDelivered(cwd, 'claudio', first.id);
    expect((await inbox(cwd, 'claudio')).map((m) => m.text)).toEqual(['dos']);
  });

  it('vaciada la bandeja, queda vacía', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    const last = await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'dos' });

    await markDelivered(cwd, 'claudio', last.id);
    expect(await inbox(cwd, 'claudio')).toEqual([]);
  });

  it('un mensaje nuevo después del cursor sí aparece', async () => {
    await setupAgents();
    const first = await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    await markDelivered(cwd, 'claudio', first.id);
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'encontré un bug' });

    expect((await inbox(cwd, 'claudio')).map((m) => m.text)).toEqual(['encontré un bug']);
  });

  // Preferimos repetir un mensaje antes que dejar el loop mudo sin aviso.
  it('si el cursor apunta a un mensaje que ya no existe, entrega todo', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    await markDelivered(cwd, 'claudio', 'id-que-no-existe');

    expect((await inbox(cwd, 'claudio')).map((m) => m.text)).toEqual(['uno']);
  });

  it('inboxSummary da el conteo y el último sin traer todo', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'dos' });

    const summary = await inboxSummary(cwd, 'claudio');
    expect(summary.count).toBe(2);
    expect(summary.last.text).toBe('dos');

    expect((await inboxSummary(cwd, 'opencito')).count).toBe(0);
    expect((await inboxSummary(cwd, 'opencito')).last).toBeNull();
  });
});

describe('numeración y cruces', () => {
  it('los mensajes vienen numerados por orden de llegada', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'dos' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'tres' });

    expect((await listMessages(cwd)).map((m) => m.seq)).toEqual([1, 2, 3]);
    // El número es global al hilo, no por destinatario: si fuera por
    // bandeja, dos agentes hablarían de "el #2" refiriéndose a mensajes
    // distintos.
    expect((await listMessages(cwd, { to: 'claudio' })).map((m) => m.seq)).toEqual([1, 3]);
  });

  it('guarda hasta dónde había leído el que escribe', async () => {
    await setupAgents();
    const first = await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'hola' });
    await markDelivered(cwd, 'claudio', first.id);

    const reply = await postMessage(cwd, { from: 'claudio', to: 'usuario', text: 'listo' });
    expect(reply.seenUpTo).toBe(first.id);
  });

  // El caso que reportó el agente teamlead: decidió algo y lo mandó, y en
  // paralelo el otro le estaba pidiendo esa misma decisión. Se dieron
  // cuenta después, por el contenido.
  it('detecta que dos agentes se escribieron a la vez', async () => {
    await setupAgents();

    // claudio le pregunta algo a opencito; opencito todavía no lo recibió.
    const pregunta = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: '¿qué hacemos con X?' });
    // ...y opencito, sin haberlo visto, decide y le escribe.
    const decision = await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'decidí X así' });

    const all = await listMessages(cwd);
    const crossed = crossedMessages(all, decision);

    expect(crossed.map((m) => m.id)).toEqual([pregunta.id]);
  });

  it('no marca cruce cuando el mensaje sí fue leído antes de responder', async () => {
    await setupAgents();
    const pregunta = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: '¿qué hacemos?' });
    await markDelivered(cwd, 'opencito', pregunta.id);

    const respuesta = await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'hacemos esto' });
    expect(crossedMessages(await listMessages(cwd), respuesta)).toEqual([]);
  });

  it('sólo cuenta como cruce lo que iba dirigido al que escribe', async () => {
    await setupAgents();
    // Un mensaje entre terceros no es un cruce con opencito.
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'ajeno' });
    const suyo = await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'algo' });

    expect(crossedMessages(await listMessages(cwd), suyo)).toEqual([]);
  });

  it('el aviso de cruce sale en el texto que se pega, con el número', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'claudio', to: 'opencito', text: '¿qué hacemos?' });
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'decidí' });

    // Leídos, no los que devuelve postMessage: el `seq` se calcula al leer,
    // que es de donde los saca el repartidor.
    const all = await listMessages(cwd);
    const decision = all[1];
    const text = formatForTerminal(decision, { crossed: crossedMessages(all, decision) });

    expect(text).toContain('#2');              // su propio número
    expect(text).toContain('sin haber visto');
    expect(text).toContain('#1');              // el que se cruzó
  });

  it('sin cruce no ensucia el mensaje con avisos', async () => {
    const text = formatForTerminal({ from: 'claudio', to: 'opencito', text: 'hola', seq: 1 });
    expect(text).not.toContain('sin haber visto');
  });

  // @claudio: "@opencodito respondió dos veces a un mensaje mío ya superado,
  // porque no hay forma de saber a qué mensaje contesta cada respuesta".
  it('el mensaje dice a cuál está respondiendo', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'pregunta A' });
    await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'pregunta B' });
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'contesto la primera', replyTo: 1 });

    const all = await listMessages(cwd);
    expect(all[2].replyTo).toBe(1);
    expect(formatForTerminal(all[2])).toContain('responde a tu #1');
  });

  it('sin replyTo no inventa nada', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'suelto' });
    expect(formatForTerminal((await listMessages(cwd))[0])).not.toContain('responde a');
  });
});

// Feedback de campo (@opencodito): "claudio me reportó bugs que yo ya había
// fixeado en el commit anterior — los dos sobre el mismo árbol, pero él
// revisando una versión uno o dos commits atrás". Se aclaró hablando, que
// es justo lo que la herramienta debería ahorrar.
describe('desfase de código entre agentes', () => {
  const git = async (...args) => run('git', args, { cwd });

  /** Repo de verdad: `readHead` invoca git, no vale simularlo. */
  async function initRepo() {
    await git('init', '-q');
    await git('config', 'user.email', 'test@test.dev');
    await git('config', 'user.name', 'Test');
    await fs.writeFile(path.join(cwd, 'a.txt'), 'v1', 'utf8');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'primero');
  }

  async function commitMore() {
    await fs.writeFile(path.join(cwd, 'a.txt'), 'v2', 'utf8');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'segundo');
  }

  it('sella cada mensaje con el commit sobre el que se escribió', async () => {
    await initRepo();
    await setupAgents();

    const head = await readHead(cwd);
    const msg = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'hay un bug en a.txt' });

    expect(msg.commit).toBe(head);
    expect(msg.commit).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('avisa cuando el árbol ya avanzó desde que se escribió el reporte', async () => {
    await initRepo();
    await setupAgents();
    const msg = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'hay un bug' });

    await commitMore();
    const head = await readHead(cwd);

    const text = formatForTerminal(msg, { head });
    expect(text).toContain(msg.commit);
    expect(text).toContain(head);
    expect(text).toContain('puede que ya esté resuelto');
  });

  it('sin desfase no ensucia el mensaje', async () => {
    await initRepo();
    await setupAgents();
    const msg = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'hay un bug' });

    expect(formatForTerminal(msg, { head: await readHead(cwd) })).not.toContain('el árbol ya está');
  });

  // El loop tiene que andar igual fuera de un repo: no todo workspace es git.
  it('sin repo, ni sella ni avisa', async () => {
    await setupAgents();
    expect(await readHead(cwd)).toBeNull();

    const msg = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'hola' });
    expect(msg.commit).toBeNull();
    expect(formatForTerminal(msg, { head: 'abc1234' })).not.toContain('el árbol ya está');
  });

  // @claudio: "no tenía forma de saber qué commit o qué diff constituía la
  // entrega; un par de veces revisé código a medio escribir sin querer".
  it('el sello de entrega se muestra siempre, no sólo cuando hay desfase', async () => {
    await initRepo();
    await setupAgents();
    const msg = await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'listo, revisá' });

    const text = formatForTerminal(msg, { head: await readHead(cwd) });
    expect(text).toContain(`[sobre ${msg.commit}]`);
  });

  it('avisa si el árbol tenía cambios sin commitear', async () => {
    await initRepo();
    await setupAgents();
    await fs.writeFile(path.join(cwd, 'a.txt'), 'a medio escribir', 'utf8');

    const msg = await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'listo' });
    expect(msg.dirty).toBe(true);
    expect(formatForTerminal(msg, { head: msg.commit })).toContain('+cambios sin commitear');
  });

  it('un archivo sin trackear no cuenta como trabajo a medias', async () => {
    await initRepo();
    await setupAgents();
    await fs.writeFile(path.join(cwd, 'notas-sueltas.md'), 'scratch', 'utf8');

    expect((await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'listo' })).dirty)
      .toBe(false);
  });

  it('los dos avisos conviven en un mismo mensaje', async () => {
    await initRepo();
    await setupAgents();

    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'pregunta' });
    await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'reporte' });
    await commitMore();

    const all = await listMessages(cwd);
    const reporte = all[1];
    const text = formatForTerminal(reporte, {
      crossed: crossedMessages(all, reporte),
      head: await readHead(cwd),
    });

    expect(text).toContain('sin haber visto');
    expect(text).toContain('el árbol ya está');
  });
});

describe('pendingDeliveries', () => {
  // Ésta es la razón de existir de status.json: pegar en el pty de un
  // agente ocupado entrelaza el texto con su TUI y rompe las dos cosas.
  it('no entrega a una terminal que está working', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'trabajá' });
    await setAgentState(cwd, 'claudio', 'working');

    expect(await pendingDeliveries(cwd)).toEqual([]);
  });

  it('entrega en cuanto vuelve a waiting, sin perder el mensaje', async () => {
    await setupAgents();
    await setAgentState(cwd, 'claudio', 'working');
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'hay un bug' });
    expect(await pendingDeliveries(cwd)).toEqual([]);

    await setAgentState(cwd, 'claudio', 'waiting');
    const ready = await pendingDeliveries(cwd);
    expect(ready).toHaveLength(1);
    expect(ready[0].agent.name).toBe('claudio');
    expect(ready[0].messages.map((m) => m.text)).toEqual(['hay un bug']);
  });

  it('agrupa por agente y omite a los que no tienen nada', async () => {
    await setupAgents();
    await registerAgent(cwd, { name: 'tercero' });
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'a' });
    await postMessage(cwd, { from: 'usuario', to: 'opencito', text: 'b' });

    const ready = await pendingDeliveries(cwd);
    expect(ready.map((r) => r.agent.name)).toEqual(['claudio', 'opencito']);
  });

  it('un mensaje a alguien que no está en el loop no se entrega a nadie', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'fantasma', text: 'nadie lo lee' });

    expect(await pendingDeliveries(cwd)).toEqual([]);
    expect(await listMessages(cwd)).toHaveLength(1); // pero queda en el historial
  });
});

describe('formatForTerminal', () => {
  it('incluye el remitente, el destinatario y la ruta del skill', () => {
    const text = formatForTerminal(
      { from: 'opencito', to: 'claudio', text: 'el botón no anda', seq: 7 },
    );
    expect(text).toContain('@opencito');
    expect(text).toContain('@claudio');
    expect(text).toContain(SKILL_FILE);
  });

  // Entrega por referencia (032): por el pty viaja dónde leerlo, no el
  // cuerpo. Un cuerpo largo era lo que hacía tragar el Enter (025) y
  // truncar (027).
  it('no lleva el cuerpo, sólo cómo leerlo', () => {
    const text = formatForTerminal({ from: 'opencito', to: 'claudio', text: 'el botón no anda', seq: 7 });
    expect(text).not.toContain('el botón no anda');
    expect(text).toContain('ybento leer 7');
  });

  it('sin seq apunta al id', () => {
    const text = formatForTerminal({ id: 'abc-123', from: 'opencito', to: 'claudio', text: 'x' });
    expect(text).toContain('ybento leer abc-123');
  });

  it('el aviso mide lo mismo con un cuerpo de 10 000 caracteres que con uno de 10', () => {
    const base = { from: 'opencito', to: 'claudio', seq: 3 };
    const chico = formatForTerminal({ ...base, text: 'x'.repeat(10) });
    const grande = formatForTerminal({ ...base, text: 'x'.repeat(10_000) });
    expect(grande.length).toBe(chico.length);
  });

  it('al usuario lo nombra en humano, no como @usuario', () => {
    const text = formatForTerminal({ from: 'usuario', to: 'claudio', text: 'hola' });
    expect(text).toContain('del usuario');
  });

  // Regresión de la primera prueba de campo: del otro lado hay un TUI, y
  // un `\n` ahí adentro no es un separador visual sino un Enter dentro de
  // su caja de texto — parte el mensaje y el envío deja de funcionar solo.
  it('sale en una sola línea aunque el mensaje tenga saltos', () => {
    const text = formatForTerminal({
      from: 'opencito',
      to: 'claudio',
      text: 'Corregidos los 4 defectos:\n[1] penPreview\n\n[2] filtros únicos',
    });

    expect(text).not.toContain('\n');
  });

  it('el texto original conserva sus saltos (sólo se aplana al viajar por el pty)', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'opencito', to: 'claudio', text: 'linea 1\nlinea 2' });
    expect((await listMessages(cwd))[0].text).toBe('linea 1\nlinea 2');
  });

  // Regresión de la segunda prueba de campo. Si el proceso del agente
  // terminó, la terminal está en el prompt y lo que pegamos lo interpreta
  // el shell. Estos tres casos se vieron de verdad.
  describe('seguridad frente al shell', () => {
    /** Un token de shell bien formado empieza y termina en comilla simple. */
    const wrapped = (text) => {
      const out = formatForTerminal({ from: 'opencito', to: 'claudio', text });
      expect(out.startsWith("'")).toBe(true);
      expect(out.endsWith("'")).toBe(true);
      // Y no hay ninguna comilla suelta en el medio que lo cierre antes.
      expect(out.slice(1, -1)).not.toContain("'");
      return out;
    };

    // Con la entrega por referencia el cuerpo ya ni viaja por el pty: lo
    // que escribió el agente no llega al shell de ninguna forma.
    it('un backtick no puede ejecutar nada', () => {
      expect(wrapped('revisá el modulo `touch /tmp/exploit` porfa')).not.toContain('`');
    });

    it('$(...) tampoco', () => {
      expect(wrapped('corré $(rm -rf ~) para probar')).not.toContain('$(');
    });

    it('una comilla sin cerrar no deja al shell esperando', () => {
      // Éste es el peor: zsh entra en continuación y se traga el Enter.
      wrapped("no anda el boton 'guardar");
    });

    it('los paréntesis dejan de romper el parseo', () => {
      expect(wrapped('QA pinceles (3 botones) units.ts:128')).not.toContain('(3 botones)');
    });

    it('las comillas dobles y el $ pelado no rompen nada', () => {
      wrapped('el label dice "Guardar" y cuesta $5');
    });
  });
});

describe('findMessage', () => {
  it('resuelve 42, #42 y el id', async () => {
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    const dos = await postMessage(cwd, { from: 'claudio', to: 'opencito', text: 'dos' });

    expect((await findMessage(cwd, 2)).text).toBe('dos');
    expect((await findMessage(cwd, '#2')).text).toBe('dos');
    expect((await findMessage(cwd, dos.id)).seq).toBe(2);
  });

  it('null si no existe (o no hay mensajes)', async () => {
    expect(await findMessage(cwd, 1)).toBeNull();
    await setupAgents();
    await postMessage(cwd, { from: 'usuario', to: 'claudio', text: 'uno' });
    expect(await findMessage(cwd, 99)).toBeNull();
    expect(await findMessage(cwd, 0)).toBeNull();
    expect(await findMessage(cwd, 'no-existe')).toBeNull();
  });
});

describe('skill.md', () => {
  it('devuelve el default si todavía no existe, sin crear nada', async () => {
    expect(await readSkill(cwd)).toBe(DEFAULT_SKILL);
    await expect(fs.stat(path.join(cwd, LOOP_DIR))).rejects.toThrow();
  });

  it('ensureSkill lo crea una vez y después no lo pisa', async () => {
    expect((await ensureSkill(cwd)).created).toBe(true);
    await writeSkill(cwd, '# mi protocolo propio');
    expect((await ensureSkill(cwd)).created).toBe(false);
    expect(await readSkill(cwd)).toBe('# mi protocolo propio');
  });

  it('el default explica cómo cortar el ida y vuelta infinito', async () => {
    // El único freno al loop infinito por ahora es esta instrucción.
    expect(DEFAULT_SKILL).toContain('@usuario');
    expect(DEFAULT_SKILL).toMatch(/no termina nunca/);
  });
});

describe('seguridad', () => {
  // Mismo criterio que pathSafety.test.js: el nombre del agente viene del
  // renderer y del CLI, así que no puede terminar componiendo una ruta.
  it('un nombre con separadores o traversal se rechaza antes de tocar el disco', async () => {
    for (const bad of ['../../evil', '..', 'a/b', 'a\\b', '/etc/passwd']) {
      await expect(registerAgent(cwd, { name: bad })).rejects.toThrow(/inválido/);
      await expect(postMessage(cwd, { from: 'usuario', to: bad, text: 'x' }))
        .rejects.toThrow(/inválido/);
    }
    await expect(fs.stat(path.join(cwd, LOOP_DIR))).rejects.toThrow();
  });

  it('cada workspace tiene su propio loop, sin filtraciones entre sí', async () => {
    const otro = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-loop-test-otro-'));
    try {
      await registerAgent(cwd, { name: 'claudio' });
      expect(await listAgents(otro)).toEqual([]);
      await expect(fs.stat(path.join(otro, LOOP_DIR))).rejects.toThrow();
    } finally {
      await fs.rm(otro, { recursive: true, force: true });
    }
  });
});
