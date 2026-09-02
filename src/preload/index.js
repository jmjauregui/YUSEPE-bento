/**
 * src/preload/index.js
 * --------------------------------------------------------------
 * Expone una API mínima y explícita al renderer.
 *   - window.yusepe.profiles  -> CRUD de perfiles
 *   - window.yusepe.pty       -> ciclo de vida de la terminal
 *   - window.yusepe.tools     -> detección de CLIs instaladas
 *   - window.yusepe.shell     -> utilidades (abrir URL externa)
 *   - window.yusepe.menu      -> atajos del menu (accelerators globales)
 * --------------------------------------------------------------
 */
import { contextBridge, ipcRenderer } from 'electron';

const on = (channel, handler) => {
  const listener = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('yusepe', {
  // Plataforma del host — el renderer la usa para decisiones de UI
  // específicas de macOS (inset de los traffic lights con hiddenInset).
  platform: process.platform,

  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (payload) => ipcRenderer.invoke('profiles:create', payload),
    load: (id) => ipcRenderer.invoke('profiles:load', id),
    save: (profile) => ipcRenderer.invoke('profiles:save', profile),
    delete: (id) => ipcRenderer.invoke('profiles:delete', id),
    rename: (id, name) => ipcRenderer.invoke('profiles:rename', { id, name }),
    exists: (name) => ipcRenderer.invoke('profiles:exists', name),
    setCwd: (id, cwd) => ipcRenderer.invoke('profiles:set-cwd', { id, cwd }),
    touch: (id) => ipcRenderer.invoke('profiles:touch', id),
    setWallpaper: (id, wallpaper) => ipcRenderer.invoke('profiles:set-wallpaper', { id, wallpaper }),
    export: (id) => ipcRenderer.invoke('profiles:export', { id }),
    import: () => ipcRenderer.invoke('profiles:import'),
  },

  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    input: (ptyId, data) => ipcRenderer.send('pty:input', { ptyId, data }),
    resize: (ptyId, cols, rows) =>
      ipcRenderer.send('pty:resize', { ptyId, cols, rows }),
    kill: (ptyId) => ipcRenderer.send('pty:kill', { ptyId }),
    onData: (ptyId, handler) => on(`pty:data:${ptyId}`, handler),
    onExit: (ptyId, handler) => on(`pty:exit:${ptyId}`, handler),
  },

  tools: {
    detect: () => ipcRenderer.invoke('tools:detect'),
  },

  explorer: {
    list: (root, relPath) => ipcRenderer.invoke('explorer:list', { root, relPath }),
    read: (root, relPath) => ipcRenderer.invoke('explorer:read', { root, relPath }),
    search: (root, query) => ipcRenderer.invoke('explorer:search', { root, query }),
    write: (root, relPath, content) => ipcRenderer.invoke('explorer:write', { root, relPath, content }),
    create: (root, relPath, isDir) => ipcRenderer.invoke('explorer:create', { root, relPath, isDir }),
    rename: (root, relPath, newName) => ipcRenderer.invoke('explorer:rename', { root, relPath, newName }),
    duplicate: (root, relPath) => ipcRenderer.invoke('explorer:duplicate', { root, relPath }),
    trash: (root, relPath) => ipcRenderer.invoke('explorer:trash', { root, relPath }),
    reveal: (root, relPath) => ipcRenderer.invoke('explorer:reveal', { root, relPath }),
    absPath: (root, relPath) => ipcRenderer.invoke('explorer:abs-path', { root, relPath }),
    readMedia: (root, relPath) => ipcRenderer.invoke('explorer:read-media', { root, relPath }),
    openInSystem: (root, relPath) => ipcRenderer.invoke('explorer:open-in-system', { root, relPath }),
  },

  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', { cwd }),
    diff: (cwd, filePath, staged) => ipcRenderer.invoke('git:diff', { cwd, filePath, staged }),
    stage: (cwd, filePath) => ipcRenderer.invoke('git:stage', { cwd, filePath }),
    stageAll: (cwd) => ipcRenderer.invoke('git:stage-all', { cwd }),
    unstage: (cwd, filePath) => ipcRenderer.invoke('git:unstage', { cwd, filePath }),
    discard: (cwd, filePath) => ipcRenderer.invoke('git:discard', { cwd, filePath }),
    commit: (cwd, message) => ipcRenderer.invoke('git:commit', { cwd, message }),
    push: (cwd) => ipcRenderer.invoke('git:push', { cwd }),
    fetch: (cwd) => ipcRenderer.invoke('git:fetch', { cwd }),
    pull: (cwd) => ipcRenderer.invoke('git:pull', { cwd }),
    branches: (cwd) => ipcRenderer.invoke('git:branches', { cwd }),
    switchBranch: (cwd, branch) => ipcRenderer.invoke('git:switch-branch', { cwd, branch }),
    createBranch: (cwd, name) => ipcRenderer.invoke('git:create-branch', { cwd, name }),
  },

  agents: {
    instructionFiles: (cwd) => ipcRenderer.invoke('agents:instruction-files', { cwd }),
    readInstructionFile: (cwd, relPath) => ipcRenderer.invoke('agents:read-instruction-file', { cwd, relPath }),
    writeInstructionFile: (cwd, relPath, content) =>
      ipcRenderer.invoke('agents:write-instruction-file', { cwd, relPath, content }),
    subagents: (cwd) => ipcRenderer.invoke('agents:subagents', { cwd }),
  },

  tasks: {
    list: (cwd) => ipcRenderer.invoke('tasks:list', { cwd }),
    create: (cwd, title) => ipcRenderer.invoke('tasks:create', { cwd, title }),
    setDone: (cwd, id, done) => ipcRenderer.invoke('tasks:set-done', { cwd, id, done }),
    update: (cwd, id, { title, notes } = {}) => ipcRenderer.invoke('tasks:update', { cwd, id, title, notes }),
    remove: (cwd, id) => ipcRenderer.invoke('tasks:delete', { cwd, id }),
    launchText: (cwd, id) => ipcRenderer.invoke('tasks:launch-text', { cwd, id }),
    // Vigilancia de .ybento/tasks — devuelve false si la carpeta aún no existe.
    watch: (cwd) => ipcRenderer.invoke('tasks:watch', { cwd }),
    unwatch: (cwd) => ipcRenderer.invoke('tasks:unwatch', { cwd }),
    onChangedOnDisk: (handler) => on('tasks:changed-on-disk', handler),
    launchTemplate: (cwd) => ipcRenderer.invoke('tasks:launch-template', { cwd }),
    setLaunchTemplate: (cwd, content) => ipcRenderer.invoke('tasks:set-launch-template', { cwd, content }),
  },

  pexels: {
    search: (query, page) => ipcRenderer.invoke('pexels:search', { query, page }),
  },

  // Loop multiagente: mensajería entre terminales. El reparto (vigilar el
  // disco y escribir en el pty destino) lo hace el proceso main; de acá
  // sale sólo lo que necesita la UI del panel de mensajes.
  loop: {
    agents: (cwd) => ipcRenderer.invoke('loop:agents', { cwd }),
    register: (cwd, { name, role, tileId, color }) =>
      ipcRenderer.invoke('loop:register', { cwd, name, role, tileId, color }),
    unregister: (cwd, name) => ipcRenderer.invoke('loop:unregister', { cwd, name }),
    setState: (cwd, name, state) => ipcRenderer.invoke('loop:set-state', { cwd, name, state }),

    messages: (cwd, opts = {}) => ipcRenderer.invoke('loop:messages', { cwd, ...opts }),
    post: (cwd, { from, to, text, replyTo }) =>
      ipcRenderer.invoke('loop:post', { cwd, from, to, text, replyTo }),
    inbox: (cwd, name) => ipcRenderer.invoke('loop:inbox', { cwd, name }),

    skill: (cwd) => ipcRenderer.invoke('loop:skill', { cwd }),
    setSkill: (cwd, content) => ipcRenderer.invoke('loop:set-skill', { cwd, content }),
    ensureSkill: (cwd) => ipcRenderer.invoke('loop:ensure-skill', { cwd }),

    // Asocia un agente con la terminal donde corre (efímero: el ptyId
    // muere con la terminal, la identidad no).
    bind: (name, ptyId, cwd) => ipcRenderer.invoke('loop:bind', { name, ptyId, cwd }),
    unbind: (name, cwd) => ipcRenderer.invoke('loop:unbind', { name, cwd }),

    start: (cwd) => ipcRenderer.invoke('loop:start', { cwd }),
    stop: (cwd) => ipcRenderer.invoke('loop:stop', { cwd }),

    // Presencia: si el proceso del agente terminó, su terminal volvió al
    // prompt y no se le entrega nada (el mensaje queda pendiente).
    presence: (cwd) => ipcRenderer.invoke('loop:presence', { cwd }),
    atPrompt: (ptyId) => ipcRenderer.invoke('loop:at-prompt', { ptyId }),

    onDelivered: (handler) => on('loop:delivered', handler),
    onChanged: (handler) => on('loop:changed', handler),
    onPresence: (handler) => on('loop:presence', handler),
  },

  snippets: {
    list: () => ipcRenderer.invoke('snippets:list'),
    create: (payload) => ipcRenderer.invoke('snippets:create', payload),
    update: (id, patch) => ipcRenderer.invoke('snippets:update', { id, ...patch }),
    delete: (id) => ipcRenderer.invoke('snippets:delete', { id }),
  },

  shell: {
    openExternal: (url) => {
      if (/^https?:\/\//i.test(url)) {
        ipcRenderer.send('shell:open-external', url);
      }
    },
  },

  theme: {
    set: (mode) => ipcRenderer.send('theme:set', mode),
  },

  window: {
    onFullscreen: (handler) => on('window:fullscreen', handler),
  },

  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
    pickImage: () => ipcRenderer.invoke('dialog:pick-image'),
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', { text }),
  },

  menu: {
    // Abre un menú contextual nativo y resuelve con el id elegido (o null).
    popup: (items) => ipcRenderer.invoke('menu:popup', { items }),
    onCloseTile:       (handler) => on('menu:close-tile', handler),
    onTileAction:      (handler) => on('menu:tile-action', handler),
    onCommandPalette:  (handler) => on('menu:command-palette', handler),
    onQuickOpenFile:   (handler) => on('menu:quick-open-file', handler),
    onSwitchWorkspace: (handler) => on('menu:switch-workspace', handler),
    onShortcuts:       (handler) => on('menu:shortcuts', handler),
    onAddToSpace:      (handler) => on('menu:add-to-space', handler),
    onNewTerminal:     (handler) => on('menu:new-terminal', handler),
    onNewCalc:         (handler) => on('menu:new-calc', handler),
    onSettings:        (handler) => on('menu:settings', handler),
  },
});
