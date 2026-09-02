/**
 * src/main/ipc.js
 * --------------------------------------------------------------
 * Punto único donde se registran los handlers de IPC.
 * Mantiene el main.js limpio y centraliza la lógica de:
 *   - Perfiles (CRUD)
 *   - PTY (crear terminales por webContents del sender)
 * --------------------------------------------------------------
 */
import { BrowserWindow, clipboard, ipcMain, Menu, shell } from 'electron';
import { statSync } from 'fs';
import { join, resolve } from 'path';
import { ProfileStorage } from './storage.js';
import { detectTools } from './toolDetector.js';
import { createEntry, duplicateEntry, listDir, readFilePreview, readMediaBytes, renameEntry, resolveEntryPath, resolvePath, searchFiles, writeFile } from './explorerFs.js';
import * as gitOps from './gitOps.js';
import * as agentOps from './agentOps.js';
import * as tasksOps from './tasksOps.js';
import * as pexelsOps from './pexelsOps.js';
import * as loopOps from './loopOps.js';
import { createDispatcher, looksLikeShell } from './loopDispatcher.js';
import { buildPtyEnv, ensureShim } from './loopShim.js';
import { createWriteQueue } from './ptyWriteQueue.js';
import { SnippetsStore } from './snippetsOps.js';
import * as diag from './loopDiag.js';

// Carga pty de forma perezosa: si falla (p.ej. sin recompilar)
// no rompemos el arranque de la app.
let pty = null;
function getPty() {
  if (pty) return pty;
  try {
    pty = require('node-pty');
    return pty;
  } catch (err) {
    console.warn('[ipc] node-pty no disponible:', err.message);
    return null;
  }
}

/**
 * @param {{ app: import('electron').App, profilesDir: string }} opts
 * @returns {{ storage: ProfileStorage, dispose: () => void }}
 */
export function registerIpc({ app, profilesDir }) {
  const storage = new ProfileStorage(profilesDir);
  const snippets = new SnippetsStore(join(app.getPath('userData'), 'snippets.json'));

  // Shim del CLI `ybento` (ver loopShim.js). Se genera al arrancar y no al
  // crear el primer loop: así una terminal cualquiera ya lo tiene en el
  // PATH, y si la app se actualizó el wrapper queda apuntando al binario
  // nuevo antes de que nadie lo use.
  const loopBinDir = join(app.getPath('userData'), 'bin');
  const loopCliPath = app.isPackaged
    ? join(process.resourcesPath, 'ybento-cli', 'src', 'cli', 'ybento.mjs')
    : join(app.getAppPath(), 'src', 'cli', 'ybento.mjs');

  ensureShim({ binDir: loopBinDir, cliPath: loopCliPath, execPath: process.execPath })
    .catch((err) => console.warn('[ipc] no se pudo instalar el shim de ybento:', err.message));

  // -------- Perfiles --------
  ipcMain.handle('profiles:list', () => storage.list());
  ipcMain.handle('profiles:create', (_e, payload) => storage.create(payload));
  ipcMain.handle('profiles:load', (_e, id) => storage.load(id));
  ipcMain.handle('profiles:save', (_e, profile) => storage.save(profile));
  ipcMain.handle('profiles:delete', (_e, id) => storage.remove(id));
  ipcMain.handle('profiles:rename', (_e, { id, name }) => storage.rename(id, name));
  ipcMain.handle('profiles:exists', (_e, name) => storage.isNameTaken(name));
  ipcMain.handle('profiles:set-cwd', (_e, { id, cwd }) => storage.setCwd(id, cwd));
  ipcMain.handle('profiles:touch', (_e, id) => storage.touchLastOpened(id));
  ipcMain.handle('profiles:set-wallpaper', (_e, { id, wallpaper }) => storage.setWallpaper(id, wallpaper));

  // -------- Detección de herramientas CLI --------
  ipcMain.handle('tools:detect', () => detectTools());

  // -------- Explorador de archivos --------
  ipcMain.handle('explorer:list', (_e, { root, relPath }) =>
    listDir(root || app.getPath('home'), relPath));
  ipcMain.handle('explorer:read', (_e, { root, relPath }) =>
    readFilePreview(root || app.getPath('home'), relPath));
  ipcMain.handle('explorer:search', (_e, { root, query }) =>
    searchFiles(root || app.getPath('home'), query));
  ipcMain.handle('explorer:write', (_e, { root, relPath, content }) =>
    writeFile(root || app.getPath('home'), relPath, content));
  ipcMain.handle('explorer:create', (_e, { root, relPath, isDir }) =>
    createEntry(root || app.getPath('home'), relPath, isDir));
  ipcMain.handle('explorer:read-media', (_e, { root, relPath }) =>
    readMediaBytes(root || app.getPath('home'), relPath));
  ipcMain.handle('explorer:open-in-system', (_e, { root, relPath }) =>
    shell.openPath(resolvePath(root || app.getPath('home'), relPath)));
  ipcMain.handle('explorer:rename', (_e, { root, relPath, newName }) =>
    renameEntry(root || app.getPath('home'), relPath, newName));
  ipcMain.handle('explorer:duplicate', (_e, { root, relPath }) =>
    duplicateEntry(root || app.getPath('home'), relPath));
  // Papelera y no borrado real: un click no debería evaporar un archivo.
  // Vive acá y no en explorerFs.js porque necesita `shell` — ese módulo no
  // importa electron a propósito, para poder testearlo con vitest.
  ipcMain.handle('explorer:trash', (_e, { root, relPath }) =>
    shell.trashItem(resolveEntryPath(root || app.getPath('home'), relPath)));
  ipcMain.handle('explorer:reveal', (_e, { root, relPath }) =>
    shell.showItemInFolder(resolveEntryPath(root || app.getPath('home'), relPath)));
  // Ruta absoluta para "copiar ruta absoluta": se resuelve acá para que el
  // renderer no tenga que saber armar rutas del sistema.
  ipcMain.handle('explorer:abs-path', (_e, { root, relPath }) =>
    resolvePath(root || app.getPath('home'), relPath));

  // -------- Clipboard --------
  ipcMain.handle('clipboard:write-text', (_e, { text }) => clipboard.writeText(String(text ?? '')));

  // -------- Menú contextual nativo --------
  // El renderer manda un template plano [{ id, label, type, enabled }] y
  // recibe de vuelta el `id` elegido (o null si se cerró sin elegir), así
  // toda la lógica de cada acción vive en el renderer y acá solo se dibuja.
  ipcMain.handle('menu:popup', (event, { items }) => new Promise((resolve) => {
    let picked = null;
    const template = (items || []).map((item) =>
      item.type === 'separator'
        ? { type: 'separator' }
        : { label: item.label, enabled: item.enabled !== false, click: () => { picked = item.id; } });

    // `picked` se lee en el callback de cierre (no se resuelve dentro del
    // click) porque el orden entre click y cierre no está garantizado: al
    // cerrar, el click ya corrió o no hubo ninguno.
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => resolve(picked),
    });
  }));

  // -------- Git --------
  ipcMain.handle('git:status', (_e, { cwd }) => gitOps.getStatus(cwd));
  ipcMain.handle('git:diff', (_e, { cwd, filePath, staged }) => gitOps.getDiff(cwd, filePath, staged));
  ipcMain.handle('git:stage', (_e, { cwd, filePath }) => gitOps.stageFile(cwd, filePath));
  ipcMain.handle('git:stage-all', (_e, { cwd }) => gitOps.stageAll(cwd));
  ipcMain.handle('git:unstage', (_e, { cwd, filePath }) => gitOps.unstageFile(cwd, filePath));
  ipcMain.handle('git:discard', (_e, { cwd, filePath }) => gitOps.discardFile(cwd, filePath));
  ipcMain.handle('git:commit', (_e, { cwd, message }) => gitOps.commit(cwd, message));
  ipcMain.handle('git:push', (_e, { cwd }) => gitOps.push(cwd));
  ipcMain.handle('git:fetch', (_e, { cwd }) => gitOps.fetch(cwd));
  ipcMain.handle('git:pull', (_e, { cwd }) => gitOps.pull(cwd));
  ipcMain.handle('git:branches', (_e, { cwd }) => gitOps.listBranches(cwd));
  ipcMain.handle('git:switch-branch', (_e, { cwd, branch }) => gitOps.switchBranch(cwd, branch));
  ipcMain.handle('git:create-branch', (_e, { cwd, name }) => gitOps.createBranch(cwd, name));

  ipcMain.handle('agents:instruction-files', (_e, { cwd }) => agentOps.listInstructionFiles(cwd));
  ipcMain.handle('agents:read-instruction-file', (_e, { cwd, relPath }) => agentOps.readInstructionFile(cwd, relPath));
  ipcMain.handle('agents:write-instruction-file', (_e, { cwd, relPath, content }) => agentOps.writeInstructionFile(cwd, relPath, content));
  ipcMain.handle('agents:subagents', (_e, { cwd }) => agentOps.listSubagents(cwd));

  // -------- Tareas (.ybento/tasks) --------
  ipcMain.handle('tasks:list', (_e, { cwd }) => tasksOps.listTasks(cwd));
  ipcMain.handle('tasks:create', (_e, { cwd, title }) => tasksOps.createTask(cwd, title));
  ipcMain.handle('tasks:set-done', (_e, { cwd, id, done }) => tasksOps.setTaskDone(cwd, id, done));
  ipcMain.handle('tasks:update', (_e, { cwd, id, title, notes }) =>
    tasksOps.updateTask(cwd, id, { title, notes }));
  ipcMain.handle('tasks:delete', (_e, { cwd, id }) => tasksOps.deleteTask(cwd, id));
  // Vigilancia de .ybento/tasks: el agente de código marca las tareas como
  // hechas escribiendo el .md (es lo que le pide el launchText), así que los
  // cambios vienen de afuera de Bento y hay que enterarse solos.
  //
  // Un watcher por (ventana, workspace). Se debouncean los eventos porque un
  // solo guardado dispara varios ('rename' + 'change', o el .tmp + rename de
  // nuestra propia escritura atómica).
  //
  // Se cuentan referencias: varios tiles de tareas de la misma ventana miran
  // el mismo workspace y comparten watcher, así que cerrar uno no puede dejar
  // ciegos a los demás. El watcher real se cierra recién con el último.
  const taskWatchers = new Map();
  const watcherKey = (sender, cwd) => `${sender.id}::${resolve(cwd)}`;

  function stopTaskWatcher(key) {
    const entry = taskWatchers.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.close();
    taskWatchers.delete(key);
  }

  ipcMain.handle('tasks:watch', (event, { cwd }) => {
    if (!cwd) return false;
    const key = watcherKey(event.sender, cwd);

    const existing = taskWatchers.get(key);
    if (existing) {
      existing.refs++;
      return true;
    }

    const entry = { timer: null, close: () => {}, refs: 1 };
    const close = tasksOps.watchTasks(cwd, () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (!event.sender.isDestroyed()) event.sender.send('tasks:changed-on-disk', { cwd });
      }, 120);
    });
    // La carpeta todavía no existe: el renderer reintenta al crear la primera.
    if (!close) return false;

    entry.close = close;
    taskWatchers.set(key, entry);
    event.sender.once('destroyed', () => stopTaskWatcher(key));
    return true;
  });

  ipcMain.handle('tasks:unwatch', (event, { cwd }) => {
    if (!cwd) return true;
    const key = watcherKey(event.sender, cwd);
    const entry = taskWatchers.get(key);
    if (!entry) return true;
    entry.refs--;
    if (entry.refs <= 0) stopTaskWatcher(key);
    return true;
  });

  ipcMain.handle('tasks:launch-text', (_e, { cwd, id }) => tasksOps.getLaunchText(cwd, id));
  ipcMain.handle('tasks:launch-template', (_e, { cwd }) => tasksOps.readLaunchTemplate(cwd));
  ipcMain.handle('tasks:set-launch-template', (_e, { cwd, content }) =>
    tasksOps.writeLaunchTemplate(cwd, content));

  // -------- Pexels (buscador de wallpapers) --------
  ipcMain.handle('pexels:search', (_e, { query, page }) => pexelsOps.searchPhotos(query, page));

  // -------- Snippets (librería global de comandos/rutinas) --------
  ipcMain.handle('snippets:list', () => snippets.list());
  ipcMain.handle('snippets:create', (_e, payload) => snippets.create(payload));
  ipcMain.handle('snippets:update', (_e, { id, ...patch }) => snippets.update(id, patch));
  ipcMain.handle('snippets:delete', (_e, { id }) => snippets.remove(id));

  // -------- PTY / Terminal --------
  /** Mapa de ptyId -> { proc, senderId } */
  const ptys = new Map();
  let ptySeq = 0;

  ipcMain.handle('pty:create', async (event, { cols, rows, cwd, shell, agent, loopRoot } = {}) => {
    const lib = getPty();
    if (!lib) throw new Error('node-pty no está disponible en este binario');

    const ptyId = `pty_${++ptySeq}`;
    const useShell =
      shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');

    const shellArgs = process.platform === 'win32' ? [] : ['-l'];

    // Toda terminal recibe el shim de `ybento` en el PATH; sólo las que
    // pertenecen a un loop reciben además su identidad. Así el usuario
    // puede usar el CLI a mano desde cualquier terminal para inspeccionar
    // el loop, sin que la terminal se convierta en un agente por eso.
    const env = buildPtyEnv({
      baseEnv: process.env,
      binDir: loopBinDir,
      agent: agent || null,
      root: agent ? (loopRoot || cwd || null) : null,
    });

    // El `cwd` guardado en el perfil puede no existir en esta máquina
    // (carpeta movida/borrada, workspace importado de otra máquina). En
    // Windows, ConPTY falla con "error code: 267" (ERROR_DIRECTORY) y la
    // terminal muere antes de nacer; mejor caer al home y avisar.
    let useCwd = cwd || app.getPath('home');
    let cwdMissing = null;
    try {
      if (!statSync(useCwd).isDirectory()) throw new Error('no es un directorio');
    } catch {
      cwdMissing = useCwd;
      useCwd = app.getPath('home');
    }

    const proc = lib.spawn(useShell, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: useCwd,
      env,
    });

    if (agent) dispatcher.bind(agent, ptyId);

    proc.onData((data) => {
      // Reenviamos solo al webContents que creó esta pty
      if (!event.sender.isDestroyed()) {
        event.sender.send(`pty:data:${ptyId}`, data);
      }
    });

    proc.onExit(({ exitCode }) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`pty:exit:${ptyId}`, exitCode);
      }
      ptys.get(ptyId)?.writer.dispose();
      ptys.delete(ptyId);
    });

    // Todo lo que se escribe al pty pasa por la cola: ConPTY (Windows)
    // pierde input ante escrituras grandes de golpe — de un pegado largo
    // sobrevive sólo la cola. Ver ptyWriteQueue.js.
    const writer = createWriteQueue((data) => { proc.write(data); diag.chunk(ptyId, data); });

    // `shell` se guarda para la sonda de presencia del loop: sirve para
    // saber si el proceso en primer plano volvió a ser el shell, o sea que
    // el agente que corría ahí ya terminó. Ver loopDispatcher.js.
    ptys.set(ptyId, { proc, writer, senderId: event.sender.id, shell: useShell });
    return { ptyId, shell: useShell, cwdMissing };
  });

  ipcMain.on('pty:input', (_e, { ptyId, data }) => {
    const entry = ptys.get(ptyId);
    if (entry) entry.writer.write(data);
  });

  ipcMain.on('pty:resize', (_e, { ptyId, cols, rows }) => {
    const entry = ptys.get(ptyId);
    if (entry) {
      try {
        entry.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
      } catch {
        // resize puede fallar si el proceso ya terminó; lo ignoramos
      }
    }
  });

  ipcMain.on('pty:kill', (_e, { ptyId }) => {
    const entry = ptys.get(ptyId);
    if (entry) {
      entry.writer.dispose();
      try { entry.proc.kill(); } catch { /* noop */ }
      ptys.delete(ptyId);
    }
  });

  // -------- Loop multiagente (mensajería entre terminales) --------
  //
  // El repartidor vive acá y no en el renderer porque los mensajes los
  // postean *otros procesos* (el CLI que corre cada agente): hace falta
  // alguien vigilando el disco, y escribir al pty desde main evita un
  // rebote de ida y vuelta por IPC en cada entrega.
  let loopSender = null;

  const notifyLoop = (channel, payload) => {
    if (loopSender && !loopSender.isDestroyed()) loopSender.send(channel, payload);
  };

  const dispatcher = createDispatcher({
    // Por la misma cola que el resto: el orden FIFO por pty garantiza que
    // el `\r` que el dispatcher manda aparte salga después del mensaje.
    writeToPty: (ptyId, data) => {
      const entry = ptys.get(ptyId);
      if (entry) entry.writer.write(data);
    },
    whenIdleForPty: (ptyId) => {
      const entry = ptys.get(ptyId);
      return entry ? entry.writer.whenIdle() : Promise.resolve();
    },
    // `proc.process` es el proceso en primer plano del pty: `claude` o
    // `node` mientras el agente vive, y el shell cuando ya salió.
    probePty: (ptyId) => {
      const entry = ptys.get(ptyId);
      return entry ? { process: entry.proc.process, shell: entry.shell } : null;
    },
    onDelivered: (info) => notifyLoop('loop:delivered', info),
    onChange: () => notifyLoop('loop:changed', {}),
    onPresence: (info) => notifyLoop('loop:presence', info),
  });

  ipcMain.handle('loop:agents', (_e, { cwd }) => loopOps.listAgents(cwd));
  // Presencia: viva sólo en memoria, como el binding nombre->pty.
  ipcMain.handle('loop:presence', (_e, { cwd } = {}) => dispatcher.presence(cwd));
  // ¿Esa terminal está en el prompt del shell? Se consulta antes de
  // tipearle un `export`: si adentro hay un agente corriendo, ese texto le
  // entraría como si fuera un mensaje del usuario.
  ipcMain.handle('loop:at-prompt', (_e, { ptyId }) => {
    const entry = ptys.get(ptyId);
    if (!entry) return false;
    return looksLikeShell({ process: entry.proc.process, shell: entry.shell });
  });
  ipcMain.handle('loop:register', (_e, { cwd, name, role, tileId, color }) =>
    loopOps.registerAgent(cwd, { name, role, tileId, color }));
  ipcMain.handle('loop:unregister', (_e, { cwd, name }) => {
    dispatcher.unbind(name, cwd);
    return loopOps.unregisterAgent(cwd, name);
  });
  ipcMain.handle('loop:set-state', (_e, { cwd, name, state }) =>
    loopOps.setAgentState(cwd, name, state));

  ipcMain.handle('loop:messages', (_e, { cwd, to, limit }) =>
    loopOps.listMessages(cwd, { to, limit }));
  ipcMain.handle('loop:post', (_e, { cwd, from, to, text, replyTo }) =>
    loopOps.postMessage(cwd, { from: from || 'usuario', to, text, replyTo }));
  ipcMain.handle('loop:inbox', (_e, { cwd, name }) => loopOps.inbox(cwd, name));

  ipcMain.handle('loop:skill', (_e, { cwd }) => loopOps.readSkill(cwd));
  ipcMain.handle('loop:set-skill', (_e, { cwd, content }) => loopOps.writeSkill(cwd, content));
  ipcMain.handle('loop:ensure-skill', (_e, { cwd }) => loopOps.ensureSkill(cwd));

  // Asocia un agente con la terminal donde corre. Es efímero a propósito
  // (ver la cabecera de loopDispatcher.js): el ptyId muere con la terminal.
  ipcMain.handle('loop:bind', (_e, { name, ptyId, cwd }) => {
    dispatcher.bind(name, ptyId, cwd);
    return true;
  });
  ipcMain.handle('loop:unbind', (_e, { name, cwd }) => {
    dispatcher.unbind(name, cwd);
    return true;
  });

  ipcMain.handle('loop:start', (event, { cwd }) => {
    loopSender = event.sender;
    dispatcher.start(cwd);
    return true;
  });
  ipcMain.handle('loop:stop', (_e, { cwd } = {}) => {
    dispatcher.stop(cwd || undefined);
    return true;
  });

  const dispose = () => {
    // No se espera: `dispose()` es async porque deja terminar la vuelta de
    // reparto en curso, pero acá estamos cerrando la app y las escrituras
    // de status.json son atómicas (tmp + rename), así que no hay a medias.
    dispatcher.dispose();
    for (const { proc } of ptys.values()) {
      try { proc.kill(); } catch { /* noop */ }
    }
    ptys.clear();
    ipcMain.removeHandler('profiles:list');
    ipcMain.removeHandler('profiles:create');
    ipcMain.removeHandler('profiles:load');
    ipcMain.removeHandler('profiles:save');
    ipcMain.removeHandler('profiles:delete');
    ipcMain.removeHandler('profiles:rename');
    ipcMain.removeHandler('profiles:exists');
    ipcMain.removeHandler('profiles:set-cwd');
    ipcMain.removeHandler('profiles:touch');
    ipcMain.removeHandler('tools:detect');
    ipcMain.removeHandler('explorer:list');
    ipcMain.removeHandler('explorer:read');
    ipcMain.removeHandler('explorer:search');
    ipcMain.removeHandler('explorer:write');
    ipcMain.removeHandler('explorer:create');
    ipcMain.removeHandler('explorer:read-media');
    ipcMain.removeHandler('explorer:open-in-system');
    ipcMain.removeHandler('explorer:rename');
    ipcMain.removeHandler('explorer:duplicate');
    ipcMain.removeHandler('explorer:trash');
    ipcMain.removeHandler('explorer:reveal');
    ipcMain.removeHandler('explorer:abs-path');
    ipcMain.removeHandler('clipboard:write-text');
    ipcMain.removeHandler('menu:popup');
    ipcMain.removeHandler('git:status');
    ipcMain.removeHandler('git:diff');
    ipcMain.removeHandler('git:stage');
    ipcMain.removeHandler('git:stage-all');
    ipcMain.removeHandler('git:unstage');
    ipcMain.removeHandler('git:discard');
    ipcMain.removeHandler('git:commit');
    ipcMain.removeHandler('git:push');
    ipcMain.removeHandler('git:fetch');
    ipcMain.removeHandler('git:pull');
    ipcMain.removeHandler('git:branches');
    ipcMain.removeHandler('git:switch-branch');
    ipcMain.removeHandler('git:create-branch');
    ipcMain.removeHandler('agents:instruction-files');
    ipcMain.removeHandler('agents:read-instruction-file');
    ipcMain.removeHandler('agents:write-instruction-file');
    ipcMain.removeHandler('agents:subagents');
    ipcMain.removeHandler('tasks:list');
    ipcMain.removeHandler('tasks:create');
    ipcMain.removeHandler('tasks:set-done');
    ipcMain.removeHandler('tasks:update');
    ipcMain.removeHandler('tasks:delete');
    ipcMain.removeHandler('tasks:launch-text');
    ipcMain.removeHandler('tasks:launch-template');
    ipcMain.removeHandler('tasks:set-launch-template');
    ipcMain.removeHandler('tasks:watch');
    ipcMain.removeHandler('tasks:unwatch');
    for (const key of [...taskWatchers.keys()]) stopTaskWatcher(key);
    ipcMain.removeHandler('profiles:set-wallpaper');
    ipcMain.removeHandler('pexels:search');
    ipcMain.removeHandler('snippets:list');
    ipcMain.removeHandler('snippets:create');
    ipcMain.removeHandler('snippets:update');
    ipcMain.removeHandler('snippets:delete');
    for (const channel of [
      'loop:agents', 'loop:register', 'loop:unregister', 'loop:set-state',
      'loop:messages', 'loop:post', 'loop:inbox',
      'loop:skill', 'loop:set-skill', 'loop:ensure-skill',
      'loop:bind', 'loop:unbind', 'loop:start', 'loop:stop', 'loop:presence', 'loop:at-prompt',
    ]) ipcMain.removeHandler(channel);
  };

  return { storage, dispose };
}
