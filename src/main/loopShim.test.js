/**
 * src/main/loopShim.test.js
 * --------------------------------------------------------------
 * El shim que deja `ybento` disponible en la terminal del agente.
 *
 * Lo importante acá es que el wrapper generado sea *ejecutable de verdad*:
 * si el PATH está bien pero el archivo no tiene permisos, o las comillas se
 * rompen con un espacio en la ruta (y en macOS la ruta real siempre tiene
 * uno: "Application Support"), el agente ve "command not found" y el loop
 * se corta sin explicación.
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { buildPtyEnv, ensureShim } from './loopShim.js';

const run = promisify(execFile);

let dir;
const binDir = () => path.join(dir, 'bin');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-shim-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ensureShim', () => {
  it('crea el wrapper y lo deja ejecutable', async () => {
    const { file } = await ensureShim({
      binDir: binDir(), cliPath: '/app/cli.mjs', execPath: '/app/bento', platform: 'darwin',
    });

    const stat = await fs.stat(file);
    // NTFS no tiene bits de ejecución: en Windows `chmod` es un no-op y
    // `stat.mode & 0o111` da siempre 0, aunque el wrapper esté bien.
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o111).toBeTruthy(); // tiene bit de ejecución
    }
    expect(stat.isFile()).toBe(true);
    expect(path.basename(file)).toBe('ybento');
  });

  it('usa el binario de la app con ELECTRON_RUN_AS_NODE, no `node`', async () => {
    const { file } = await ensureShim({
      binDir: binDir(), cliPath: '/app/cli.mjs', execPath: '/app/bento', platform: 'darwin',
    });

    const content = await fs.readFile(file, 'utf8');
    expect(content).toContain('ELECTRON_RUN_AS_NODE=1');
    // Depender de que el usuario tenga Node instalado sería un bug.
    expect(content).not.toMatch(/^\s*exec node /m);
  });

  it('se reescribe al cambiar la ruta del binario (app actualizada)', async () => {
    await ensureShim({ binDir: binDir(), cliPath: '/app/cli.mjs', execPath: '/v1/bento', platform: 'darwin' });
    const { file } = await ensureShim({ binDir: binDir(), cliPath: '/app/cli.mjs', execPath: '/v2/bento', platform: 'darwin' });

    const content = await fs.readFile(file, 'utf8');
    expect(content).toContain('/v2/bento');
    expect(content).not.toContain('/v1/bento');
  });

  it('en Windows genera ybento.cmd (CMD/PowerShell) y ybento sin extensión (Git Bash)', async () => {
    const { file } = await ensureShim({
      binDir: binDir(), cliPath: 'C:\\app\\cli.mjs', execPath: 'C:\\app\\bento.exe', platform: 'win32',
    });
    // file apunta al .cmd (el caso normal de terminal PowerShell)
    expect(path.basename(file)).toBe('ybento.cmd');

    // También tiene que existir el wrapper sh para la herramienta Bash de Claude Code
    const shFile = path.join(binDir(), 'ybento');
    const stat = await fs.stat(shFile);
    expect(stat.isFile()).toBe(true);
    const content = await fs.readFile(shFile, 'utf8');
    expect(content).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(content).not.toMatch(/^\s*exec node /m);
  });

  // En macOS la ruta real es ".../Application Support/...": si el quoting
  // fallara, esto sería un "command not found" en la cara del agente.
  it.skipIf(process.platform === 'win32')(
    'el wrapper corre aunque la ruta tenga espacios y comillas',
    async () => {
      const raro = path.join(dir, "carpeta con espacios y 'comillas'");
      await fs.mkdir(raro, { recursive: true });

      // Un "CLI" de mentira que sólo repite sus argumentos.
      const cli = path.join(raro, 'fake-cli.js');
      await fs.writeFile(cli, 'console.log("ok:" + process.argv.slice(2).join(","));', 'utf8');

      const { file } = await ensureShim({
        binDir: raro, cliPath: cli, execPath: process.execPath, platform: process.platform,
      });

      const { stdout } = await run(file, ['estado', '--json']);
      expect(stdout.trim()).toBe('ok:estado,--json');
    },
  );
});

describe('buildPtyEnv', () => {
  it('antepone el binDir al PATH', () => {
    const env = buildPtyEnv({
      baseEnv: { PATH: '/usr/bin:/bin' }, binDir: '/data/bin', platform: 'darwin',
    });
    expect(env.PATH).toBe('/data/bin:/usr/bin:/bin');
  });

  it('funciona aunque no haya PATH previo', () => {
    const env = buildPtyEnv({ baseEnv: {}, binDir: '/data/bin', platform: 'darwin' });
    expect(env.PATH).toBe('/data/bin');
  });

  it('usa `;` en Windows', () => {
    const env = buildPtyEnv({
      baseEnv: { PATH: 'C:\\Windows' }, binDir: 'C:\\data\\bin', platform: 'win32',
    });
    expect(env.PATH).toBe('C:\\data\\bin;C:\\Windows');
  });

  it('inyecta identidad y raíz cuando la terminal es de un agente', () => {
    const env = buildPtyEnv({
      baseEnv: {}, binDir: '/data/bin', agent: 'claudio', root: '/proyecto', platform: 'darwin',
    });
    expect(env.YBENTO_AGENT).toBe('claudio');
    expect(env.YBENTO_ROOT).toBe('/proyecto');
  });

  // Una terminal común igual tiene el CLI (para inspeccionar el loop a
  // mano), pero sin identidad no puede actuar como agente por accidente.
  it('sin agente no inyecta identidad, pero sí el PATH', () => {
    const env = buildPtyEnv({ baseEnv: {}, binDir: '/data/bin', platform: 'darwin' });
    expect(env.YBENTO_AGENT).toBeUndefined();
    expect(env.YBENTO_ROOT).toBeUndefined();
    expect(env.PATH).toContain('/data/bin');
  });

  it('no muta el entorno que recibe', () => {
    const base = { PATH: '/usr/bin' };
    buildPtyEnv({ baseEnv: base, binDir: '/data/bin', agent: 'claudio', platform: 'darwin' });
    expect(base).toEqual({ PATH: '/usr/bin' });
  });
});
