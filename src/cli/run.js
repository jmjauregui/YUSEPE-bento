/**
 * src/cli/run.js
 * --------------------------------------------------------------
 * Lógica del comando `ybento`: la interfaz que usan los agentes de IA
 * desde su terminal para participar del loop (ver loopOps.js).
 *
 * Está separada del ejecutable (`ybento.mjs`) para poder testearla sin
 * spawnear procesos: `run()` recibe argv y su entorno (cwd, env, salidas)
 * y devuelve el código de salida, sin tocar `process` ni `console`.
 *
 * Dos criterios de diseño, los dos por el mismo motivo — cada línea que
 * imprime este CLI la paga el usuario en tokens del agente:
 *
 *   1. La salida por defecto es mínima y en prosa corta. `--json` está
 *      para cuando algo la consume de verdad, no para el agente.
 *   2. `estado` sin argumentos resume la bandeja (cuántos y de quién) en
 *      vez de volcarla entera: es el comando del ciclo, el que más se
 *      repite, y casi siempre la respuesta útil es "no tenés nada".
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';
import {
  formatForTerminal, getAgent, inbox, inboxSummary, listAgents, listMessages,
  normalizeName, postMessage, setAgentState, STATES,
} from '../main/loopOps.js';

const HELP = `ybento — mensajería entre terminales del loop de YUSEPE Bento

  ybento estado                    mi estado, mi bandeja y quién más está en el loop
  ybento estado working            me marco ocupado (arranco una tarea)
  ybento estado waiting            me marco libre (terminé, puedo recibir)
  ybento bandeja                   mis mensajes pendientes
  ybento bandeja --ultimo          sólo el último
  ybento enviar @nombre "texto"    le mando un mensaje a otro agente
  ybento enviar @usuario "texto"   le aviso al humano
  ybento diag @agente              diagnóstico de la última entrega a ese agente
  ybento diag @agente --payload    igual, más el texto B2 completo para diffear
  ybento diag                      lista los registros de diagnóstico disponibles

Para mensajes largos, evitá el quoting del shell — pasalos por stdin o
por archivo, así un backtick o un $ dentro del texto no te lo rompe:

  ybento enviar @claudio <<'FIN'
  texto libre, con \`backticks\`, $variables y "comillas"
  FIN

  ybento enviar @claudio -f reporte.md

Opciones:
  --as <nombre>   quién soy (por defecto, la variable YBENTO_AGENT)
  -f <archivo>    leer el mensaje de un archivo ("-" = stdin)
  --re <n>        este mensaje responde al #n (lo ve el otro al recibirlo)
  --ocupado       al enviar, seguir en working (por defecto pasa a waiting)
  --payload       (diag) vuelca B2 completo al final
  --json          salida en JSON
  --help          esta ayuda
`;

/**
 * Busca la raíz del workspace subiendo desde `cwd` hasta encontrar
 * `.ybento`.
 *
 * El agente puede estar parado en cualquier subcarpeta del proyecto
 * (entró a `src/`, corrió algo en `tests/`), y no tiene por qué saber
 * dónde está la raíz. `YBENTO_ROOT` la fuerza, que es lo que hace Bento
 * al lanzar la terminal.
 */
export async function findRoot(cwd, env = {}) {
  if (env.YBENTO_ROOT) return env.YBENTO_ROOT;

  let dir = path.resolve(cwd);
  for (;;) {
    try {
      await fs.access(path.join(dir, '.ybento'));
      return dir;
    } catch { /* seguimos subiendo */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parseo mínimo: flags conocidas y el resto posicional. */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--as') { flags.as = argv[++i]; continue; }
    if (arg === '-f' || arg === '--archivo' || arg === '--file') { flags.file = argv[++i]; continue; }
    if (arg === '--ocupado' || arg === '--busy') { flags.ocupado = true; continue; }
    if (arg === '--re' || arg === '--responde') { flags.re = argv[++i]; continue; }
    if (arg === '--json') { flags.json = true; continue; }
    if (arg === '--ultimo' || arg === '--last') { flags.ultimo = true; continue; }
    if (arg === '--payload') { flags.payload = true; continue; }
    if (arg === '--help' || arg === '-h' || arg === 'ayuda') { flags.help = true; continue; }
    positional.push(arg);
  }

  return { positional, flags };
}

// Al humano se lo nombra en humano ("del usuario") y a los agentes con su
// arroba. Las dos formas contraídas están porque este texto lo lee un
// modelo: "de el usuario" se entiende, pero suena a plantilla rota.
const label = (name) => (name === 'usuario' ? 'el usuario' : `@${name}`);
const from = (name) => (name === 'usuario' ? 'del usuario' : `de @${name}`);
const to = (name) => (name === 'usuario' ? 'al usuario' : `a @${name}`);

function formatMessage(msg) {
  // El `#seq` y no un índice de la lista: es el número con el que se le
  // contesta (`ybento enviar @x --re 7`), así que tiene que ser el global.
  const num = msg.seq ? `#${msg.seq} ` : '';
  const stamp = msg.commit ? ` [sobre ${msg.commit}${msg.dirty ? ' +sin commitear' : ''}]` : '';
  return `${num}${from(msg.from)} — ${msg.text}${stamp}`;
}

/**
 * Ejecuta un comando. Devuelve el código de salida (0 ok, 1 error), y
 * escribe por `out`/`err` en vez de por consola para que el test pueda
 * mirar la salida.
 */
export async function run(argv, {
  cwd, env = {}, out, err,
  // Inyectables para poder testear `enviar` por stdin sin spawnear nada.
  readStdin = async () => '',
  isTTY = true,
} = {}) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;

  const print = (text) => out(`${text}\n`);
  const fail = (text) => { err(`${text}\n`); return 1; };
  const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);

  if (flags.help || !command) {
    print(HELP.trimEnd());
    return flags.help ? 0 : 1;
  }

  const root = await findRoot(cwd, env);
  if (!root) {
    return fail('No encontré un workspace de Bento (falta .ybento). '
      + '¿Estás corriendo esto dentro del proyecto?');
  }

  // La identidad viene del entorno que arma Bento al lanzar la terminal;
  // `--as` es el escape para probar a mano.
  const rawMe = flags.as || env.YBENTO_AGENT;
  const needsIdentity = ['estado', 'bandeja', 'enviar'].includes(command);
  if (needsIdentity && !rawMe) {
    return fail('No sé quién sos en el loop. Usá --as <nombre> o definí YBENTO_AGENT.');
  }

  let me = null;
  try {
    if (rawMe) me = normalizeName(rawMe);
  } catch (e) {
    return fail(e.message);
  }

  try {
    switch (command) {
      case 'estado': {
        const [target] = rest;

        if (target) {
          if (!STATES.includes(target)) {
            return fail(`Estado inválido: "${target}" (esperaba ${STATES.join(' | ')})`);
          }
          const agent = await setAgentState(root, me, target);
          if (flags.json) { json(agent); return 0; }
          print(`${label(me)} — ${agent.state}`);
          return 0;
        }

        // "Leo mi estado": el primer paso del ciclo del agente.
        const agent = await getAgent(root, me);
        if (!agent) return fail(`${label(me)} no está registrado en el loop de este workspace.`);

        const summary = await inboxSummary(root, me);
        const others = (await listAgents(root)).filter((a) => a.name !== me);

        if (flags.json) { json({ ...agent, pendientes: summary.count, otros: others }); return 0; }

        print(`${label(me)} — ${agent.state}`);
        print(summary.count
          ? `bandeja: ${summary.count} pendiente${summary.count === 1 ? '' : 's'} `
            + `(último ${from(summary.last.from)}) — leelos con: ybento bandeja`
          : 'bandeja: sin mensajes');
        if (others.length) {
          print(`en el loop: ${others.map((a) =>
            `@${a.name}${a.role ? ` (${a.role})` : ''} [${a.state}]`).join(', ')}`);
        }
        return 0;
      }

      case 'bandeja': {
        const pending = await inbox(root, me);
        const shown = flags.ultimo ? pending.slice(-1) : pending;

        if (flags.json) { json(shown); return 0; }
        if (!shown.length) { print('Sin mensajes pendientes.'); return 0; }

        print(`${shown.length} mensaje${shown.length === 1 ? '' : 's'} pendiente${shown.length === 1 ? '' : 's'}:`);
        shown.forEach((msg) => print(formatMessage(msg)));
        return 0;
      }

      case 'enviar': {
        // `destino` y no `to`: el helper de formato se llama `to()` y una
        // variable con ese nombre lo taparía.
        const [destino, ...textParts] = rest;
        if (!destino) return fail('¿A quién? Ej: ybento enviar @opencito "revisá la landing"');

        // Tres fuentes, en orden de preferencia. Las dos primeras existen
        // para que un mensaje largo no tenga que pasar por el quoting del
        // shell: ahí un backtick o un `$` se expanden en silencio y el
        // agente no se entera de que mandó otra cosa.
        let text;
        if (flags.file && flags.file !== '-') {
          try {
            text = await fs.readFile(path.resolve(cwd, flags.file), 'utf8');
          } catch (e) {
            return fail(`No pude leer ${flags.file}: ${e.message}`);
          }
        } else if (flags.file === '-' || (!textParts.length && !isTTY)) {
          text = await readStdin();
        } else {
          text = textParts.join(' ');
        }

        text = String(text ?? '').trim();
        if (!text) {
          return fail('El mensaje está vacío. Pasalo como argumento, con -f archivo, '
            + 'o por stdin: ybento enviar @opencito <<\'FIN\' … FIN');
        }

        const msg = await postMessage(root, {
          from: me, to: destino, text, replyTo: flags.re,
        });

        // Volver a `waiting` al enviar, salvo que se pida lo contrario.
        // Depender de que el agente se acuerde de hacerlo a mano es un
        // footgun: si se olvida queda incomunicado y su bandeja se frena,
        // y el olvido aparece justo cuando la iteración se pone larga.
        // Enviar es, en el protocolo, lo que hacés al terminar tu turno.
        let freed = false;
        if (!flags.ocupado) {
          try {
            await setAgentState(root, me, 'waiting');
            freed = true;
          } catch { /* no está registrado: el mensaje igual se mandó */ }
        }

        if (flags.json) { json({ ...msg, waiting: freed }); return 0; }
        print(`Enviado ${to(msg.to)}.${freed ? ' Quedaste en waiting.' : ''}`);
        return 0;
      }

      case 'diag': {
        const [target] = rest;

        if (!target) {
          // Lista los registros disponibles
          const diagDir = path.join(root, '.ybento', 'loop', 'diag');
          let files;
          try { files = await fs.readdir(diagDir); }
          catch { print('No hay registros de diagnóstico disponibles.'); return 0; }
          const recs = files.filter((f) => f.endsWith('.json'));
          if (!recs.length) { print('No hay registros de diagnóstico disponibles.'); return 0; }
          print('Registros disponibles:');
          for (const f of recs) {
            const agentName = f.slice(0, -5);
            try {
              const rec = JSON.parse(await fs.readFile(path.join(diagDir, f), 'utf8'));
              const secsAgo = Math.round((Date.now() - new Date(rec.timestamp)) / 1000);
              print(`  @${agentName} — hace ${secsAgo}s (mensaje ${rec.messageId})`);
            } catch {
              print(`  @${agentName} — (registro ilegible)`);
            }
          }
          return 0;
        }

        const agentName = normalizeName(target);
        const diagFile = path.join(root, '.ybento', 'loop', 'diag', `${agentName}.json`);
        let rec;
        try {
          rec = JSON.parse(await fs.readFile(diagFile, 'utf8'));
        } catch {
          return fail(`No hay registro de diagnóstico para @${agentName}. `
            + '¿Ya hubo una entrega a ese agente? '
            + 'Los registros se crean al entregar un mensaje del loop.');
        }

        // Busca el mensaje fuente para obtener la longitud de A y recalcular
        // el B1 esperado (re-ejecutando formatForTerminal sin cruce ni HEAD).
        let aLen = null;
        let expectedB1 = null;
        try {
          const msgs = await listMessages(root, { limit: 10000 });
          const msg = msgs.find((m) => m.id === rec.messageId);
          if (msg) {
            aLen = msg.text.length;
            expectedB1 = formatForTerminal(msg);
          }
        } catch { /* mensaje ya no disponible: se continúa sin A */ }

        // Separa la parte de texto de B2 (B1) del \r final
        const b2TextPart = rec.b2.slice(0, rec.b1Len);
        const b2EnterPart = rec.b2.slice(rec.b1Len);
        const b1EqB2Text = b2TextPart === rec.b1;
        const b2HasEnter = b2EnterPart === '\r';

        // Primer carácter distinto entre B1 y B2 (en la parte de texto)
        let firstDiff = -1;
        if (!b1EqB2Text) {
          const minLen = Math.min(rec.b1Len, rec.b2Len);
          for (let i = 0; i < minLen; i++) {
            if (rec.b1[i] !== rec.b2[i]) { firstDiff = i; break; }
          }
          if (firstDiff === -1) firstDiff = minLen; // uno es prefijo del otro
        }

        const ts = new Date(rec.timestamp).toLocaleString('es', { hour12: false });
        print(`Última entrega a @${rec.agent} — ${ts}`);
        print(`  Mensaje: ${rec.messageId}`);
        if (aLen !== null) print(`  A (texto en messages.jsonl): ${aLen} chars`);
        if (expectedB1 !== null && Math.abs(expectedB1.length - rec.b1Len) > 2) {
          print(`  B1 esperado (sin cruce/HEAD): ${expectedB1.length} chars`);
        }
        print(`  B1 (payload a writeToPty):  ${rec.b1Len} chars`);
        print(`  B2 (chunks a proc.write):   ${rec.b2Len} chars en ${rec.b2Chunks} chunks`
          + (b2HasEnter ? ' (incluye el \\r)' : ' — falta el \\r'));
        if (b1EqB2Text) {
          print('  B1 vs B2: IGUALES (texto idéntico)');
        } else {
          print(`  B1 vs B2: DIFIEREN — primer carácter distinto en posición ${firstDiff}`);
        }
        if (rec.truncadoPorTope) print('  ⚠ B2 truncado por tope (>64 KB): registro parcial');
        if (rec.colaVaciadaPorError) print('  ⚠ cola vaciada por error (catch en drain)');
        if (rec.drenajeVencido) print('  ⚠ drenaje venció por tiempo (timeout del dispatcher)');

        // Detecta escrituras ajenas durante la ventana: tipeo del usuario,
        // snippets o tile.command que llegaron mientras la cola drenaba.
        // En ese caso el diagnóstico no es confiable y no se acusa a nadie.
        const b2HasExtraData = rec.b2Len > rec.b1Len + 1;

        print('');

        // Veredicto: tabla de la spec resuelta en texto
        if (b2HasExtraData) {
          print('Veredicto: escrituras ajenas durante la ventana de captura.');
          print(`  B2 tiene ${rec.b2Len - rec.b1Len - 1} char(s) de más`
            + ` (esperado: ${rec.b1Len + 1} chars, recibido: ${rec.b2Len} chars).`);
          print('  La cola drenó mientras el usuario tipeaba, un snippet se ejecutó');
          print('  o un tile.command llegó al pty: los chunks ajenos se mezclaron con');
          print('  el payload y el diagnóstico no es confiable.');
          print('  → Repetir la captura cuando el agente reciba el próximo mensaje');
          print('    sin usar esa terminal.');
        } else if (rec.colaVaciadaPorError || rec.drenajeVencido) {
          print('Veredicto: la cola se vació por error o el drenaje venció por tiempo.');
          print('  La vía de pérdida es el catch/clear() de drain() en createWriteQueue,');
          print('  o el pty tardó más de 5 s en drenar (pty muerto, proceso bloqueado).');
          print('  Compará B1 vs B2 para ver cuánto llegó a proc.write antes del error.');
        } else if (!b1EqB2Text) {
          print(`Veredicto: B1 ≠ B2 — se perdió en nuestra cola (createWriteQueue).`);
          print(`  El primer carácter distinto está en la posición ${firstDiff}.`);
          print('  B1 es lo que Bento quiso escribir; B2 es lo que proc.write recibió.');
          print('  Revisar drain() y el writeFn de ipc.js. No es node-pty ni el TUI.');
        } else if (!b2HasEnter) {
          print('Veredicto: texto (B1) llegó completo pero falta el \\r.');
          print('  El Enter no llegó a proc.write — revisar el writeToPty del repartidor.');
        } else if (expectedB1 !== null && expectedB1.length > rec.b1Len + 10) {
          print('Veredicto: A completo pero B1 más corto de lo esperado.');
          print('  Posible problema en formatForTerminal o en la construcción del payload.');
          print('  B1 tiene lo que writeToPty recibió; si falta texto, se perdió antes.');
        } else {
          print('Veredicto: B1 = B2 → no hubo pérdida en la cola de Bento.');
          print('  Si el agente reportó texto cortado, la pérdida está aguas abajo:');
          print('  → node-pty, ConPTY (Windows) o el TUI del agente (Claude Code, opencode).');
          print('  Pedirle al agente que muestre exactamente qué vio en su terminal.');
        }

        if (flags.payload) {
          print('');
          print('--- B2 completo ---');
          print(rec.b2);
        }
        return 0;
      }

      default:
        return fail(`Comando desconocido: "${command}". Probá: ybento --help`);
    }
  } catch (e) {
    return fail(e.message);
  }
}
