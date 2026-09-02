/**
 * src/main/loopShim.js
 * --------------------------------------------------------------
 * Deja el comando `ybento` disponible dentro de la terminal de un agente.
 *
 * El agente escribe `ybento enviar @opencito "..."`, así que `ybento` tiene
 * que existir en su PATH. En vez de pedirle al usuario que instale nada, se
 * genera un wrapper en el directorio de datos de la app y ese directorio se
 * antepone al PATH de los ptys que arranca Bento.
 *
 * El wrapper **no invoca `node`**: usa el propio binario de Electron con
 * `ELECTRON_RUN_AS_NODE=1`. Es lo que hace que funcione igual empaquetado y
 * en una máquina sin Node instalado — la app ya trae su runtime, sería
 * absurdo depender de que el usuario tenga otro.
 *
 * Sin dependencia de `electron`: recibe las rutas por parámetro, así corre
 * bajo vitest sin mocks (mismo criterio que explorerFs.js).
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';

/** Comillas para sh: la ruta de la app puede tener espacios ("Application Support"). */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function unixWrapper({ execPath, cliPath }) {
  return `#!/bin/sh
# Generado por YUSEPE Bento — no editar a mano.
# Corre el CLI del loop con el runtime de la propia app.
ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(cliPath)} "$@"
`;
}

function windowsWrapper({ execPath, cliPath }) {
  return `@echo off\r
rem Generado por YUSEPE Bento - no editar a mano.\r
set ELECTRON_RUN_AS_NODE=1\r
"${execPath}" "${cliPath}" %*\r
`;
}

/**
 * Crea (o actualiza) el wrapper y devuelve el directorio que hay que
 * anteponer al PATH.
 *
 * Se reescribe siempre: si el usuario actualizó la app, la ruta al binario
 * de Electron cambió y un wrapper viejo apuntaría a algo que ya no existe.
 *
 * En Windows se generan DOS wrappers:
 *   - `ybento.cmd` para PowerShell / CMD (el caso normal del agente)
 *   - `ybento`     para Git Bash / herramienta Bash de Claude Code
 *
 * La herramienta Bash de Claude Code corre en /usr/bin/bash (Git Bash en
 * Windows) y NO ejecuta .cmd nativo: lo interpreta como shell script y
 * falla si hay algo que llama a `node`. El shim Unix resuelve esto usando
 * el mismo mecanismo (ELECTRON_RUN_AS_NODE=1 + binario de la app) pero en
 * sintaxis sh, que Git Bash sí entiende.
 *
 * @param {{ binDir: string, cliPath: string, execPath: string, platform?: string }} opts
 */
export async function ensureShim({ binDir, cliPath, execPath, platform = process.platform }) {
  await fs.mkdir(binDir, { recursive: true });

  const isWin = platform === 'win32';

  if (isWin) {
    // CMD/PowerShell
    const cmdFile = path.join(binDir, 'ybento.cmd');
    await fs.writeFile(cmdFile, windowsWrapper({ execPath, cliPath }), 'utf8');

    // Git Bash / herramienta Bash de Claude Code
    const shFile = path.join(binDir, 'ybento');
    await fs.writeFile(shFile, unixWrapper({ execPath, cliPath }), 'utf8');
    await fs.chmod(shFile, 0o755);

    return { binDir, file: cmdFile };
  }

  const file = path.join(binDir, 'ybento');
  await fs.writeFile(file, unixWrapper({ execPath, cliPath }), 'utf8');
  await fs.chmod(file, 0o755);

  return { binDir, file };
}

/**
 * Entorno con el que se lanza la terminal de un agente del loop.
 *
 * `YBENTO_AGENT` es lo que hace que el agente no tenga que acordarse de su
 * propio nombre en cada comando, y `YBENTO_ROOT` evita que el CLI tenga que
 * adivinar la raíz del workspace si el agente se movió de carpeta.
 *
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} opts.baseEnv
 * @param {string} opts.binDir
 * @param {string} [opts.agent] nombre en el loop; si falta, no se inyecta
 * @param {string} [opts.root] raíz del workspace
 */
export function buildPtyEnv({ baseEnv, binDir, agent = null, root = null, platform = process.platform }) {
  const sep = platform === 'win32' ? ';' : ':';
  const env = { ...baseEnv };

  // Al frente: si el usuario tuviera otro `ybento` instalado, mandamos
  // nosotros — el del loop tiene que ser el de esta app y este workspace.
  env.PATH = binDir + (env.PATH ? sep + env.PATH : '');

  if (agent) env.YBENTO_AGENT = agent;
  if (root) env.YBENTO_ROOT = root;

  return env;
}
