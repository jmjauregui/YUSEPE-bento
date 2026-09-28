/**
 * src/main/index.js
 * --------------------------------------------------------------
 * Proceso principal de Electron.
 *
 * Seguridad + Menu con accelerators globales (Cmd+W, Cmd+K, etc.)
 * que funcionan incluso cuando un <webview> tiene el foco.
 * --------------------------------------------------------------
 */
import { app, BrowserWindow, shell, session, ipcMain, Menu, nativeTheme, dialog } from 'electron';
import { join, extname } from 'path';
import { promises as fs } from 'fs';
import { registerIpc } from './ipc.js';

// Commits quemados en build-time por electron.vite.config.mjs.
// En dev (npm run dev) el bundler también los sustituye, así que el valor
// siempre refleja el árbol git en el momento en que se construyó.
const CHANGELOG = typeof __CHANGELOG__ !== 'undefined' ? __CHANGELOG__ : [];

const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024; // 8 MB
const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

// __dirname está disponible en CJS (electron-vite compila main a CJS).
const isDev = !app.isPackaged;

// Carpeta de datos alternativa (perfiles, snippets, plantillas). La usan
// las pruebas E2E para no tocar los datos reales del usuario; tiene que
// fijarse antes de `app.whenReady()`.
if (process.env.YUSEPE_USER_DATA) {
  app.setPath('userData', process.env.YUSEPE_USER_DATA);
}

let mainWindow = null;
let ipcHandle = null;
/** Todas las ventanas vivas (la principal y las de workspaces sueltos). */
const windows = new Set();

/** Ventana que originó un evento IPC (o la enfocada, o la principal). */
function windowFor(event) {
  const own = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  return own || BrowserWindow.getFocusedWindow() || mainWindow;
}

/** Envía un mensaje a todas las ventanas vivas. */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Muestra el diálogo "Acerca de" con la versión y el historial de commits
 * quemado en build-time. Funciona en todas las plataformas.
 */
function showAbout(win) {
  const version = app.getVersion();
  const changeDetail = CHANGELOG.length
    ? CHANGELOG.map((c) => `• ${c.msg}  [${c.hash}]  ${c.date}`).join('\n')
    : '(historial no disponible — build sin git)';

  dialog.showMessageBox(win, {
    type: 'info',
    title: 'Acerca de YUSEPE Bento',
    message: `YUSEPE Bento`,
    detail: `Versión ${version}\n\nCambios recientes:\n\n${changeDetail}`,
    buttons: ['Cerrar'],
    noLink: true,
  });
}

/**
 * Menu con accelerators globales para atajos de teclado. Los atajos van a
 * la ventana ENFOCADA (con varias ventanas abiertas, cada una tiene su
 * propio workspace activo); `win` solo se usa para el "Acerca de".
 */
function setupMenu(win) {
  const isMac = process.platform === 'darwin';
  const target = () => BrowserWindow.getFocusedWindow() || (win && !win.isDestroyed() ? win : null);
  const send = (ch) => () => {
    const t = target();
    if (t && !t.isDestroyed()) t.webContents.send(ch);
  };
  const sendTile = (type, dir) => () => {
    const t = target();
    if (t && !t.isDestroyed()) t.webContents.send('menu:tile-action', { type, dir });
  };
  const sendWorkspace = (index) => () => {
    const t = target();
    if (t && !t.isDestroyed()) t.webContents.send('menu:switch-workspace', index);
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        // Reemplazamos role:'about' con handler propio para mostrar el
        // changelog quemado en build-time en vez del diálogo genérico del SO.
        { label: `Acerca de ${app.name}`, click: () => showAbout(win) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Tile',
      submenu: [
        { label: 'Cerrar tile', accelerator: 'CmdOrCtrl+W', click: send('menu:close-tile') },
        { type: 'separator' },
        { label: 'Ir a archivo…', accelerator: 'CmdOrCtrl+P', click: send('menu:quick-open-file') },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+Shift+P', click: send('menu:command-palette') },
        { label: 'Agregar al espacio', accelerator: 'CmdOrCtrl+K', click: send('menu:add-to-space') },
        { label: 'Nueva terminal', accelerator: 'CmdOrCtrl+T', click: send('menu:new-terminal') },
        { label: 'Nueva calculadora', accelerator: 'CmdOrCtrl+B', click: send('menu:new-calc') },
        { label: 'Configuración', accelerator: 'CmdOrCtrl+,', click: send('menu:settings') },
        { type: 'separator' },
        { label: 'Atajos de teclado', accelerator: 'CmdOrCtrl+/', click: send('menu:shortcuts') },
      ],
    },
    {
      label: 'Espacios',
      submenu: Array.from({ length: 9 }, (_, i) => ({
        label: `Ir al espacio ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}`,
        click: sendWorkspace(i),
      })),
    },
    {
      label: 'Mosaico',
      submenu: [
        { label: 'Foco al tile de la izquierda', accelerator: 'CmdOrCtrl+Alt+Left', click: sendTile('focus', 'left') },
        { label: 'Foco al tile de la derecha', accelerator: 'CmdOrCtrl+Alt+Right', click: sendTile('focus', 'right') },
        { label: 'Foco al tile de arriba', accelerator: 'CmdOrCtrl+Alt+Up', click: sendTile('focus', 'up') },
        { label: 'Foco al tile de abajo', accelerator: 'CmdOrCtrl+Alt+Down', click: sendTile('focus', 'down') },
        { type: 'separator' },
        { label: 'Mover tile a la izquierda', accelerator: 'CmdOrCtrl+Alt+Shift+Left', click: sendTile('move', 'left') },
        { label: 'Mover tile a la derecha', accelerator: 'CmdOrCtrl+Alt+Shift+Right', click: sendTile('move', 'right') },
        { label: 'Mover tile arriba', accelerator: 'CmdOrCtrl+Alt+Shift+Up', click: sendTile('move', 'up') },
        { label: 'Mover tile abajo', accelerator: 'CmdOrCtrl+Alt+Shift+Down', click: sendTile('move', 'down') },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        // Fuera de macOS estos roles se quedarían con Ctrl+C/X/V *antes* que
        // el renderer, y en una terminal Ctrl+C es SIGINT: el usuario pierde
        // la forma de interrumpir un proceso. Chromium ya maneja el
        // portapapeles nativo en inputs sin necesidad del acelerador, así que
        // el ítem queda visible pero sin registrar la tecla. Copiar/pegar en
        // la terminal va por Ctrl+Shift+C/V (components/terminal.js).
        { role: 'cut', registerAccelerator: isMac },
        { role: 'copy', registerAccelerator: isMac },
        { role: 'paste', registerAccelerator: isMac },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // En Windows/Linux el primer menú de la barra es "Tile", no hay menú
    // de app. Agregamos "Acerca de" al final como entrada propia.
    ...(!isMac ? [{
      label: 'Acerca de',
      submenu: [
        { label: `YUSEPE Bento v${app.getVersion()}`, click: () => showAbout(win) },
      ],
    }] : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Crea una ventana. Sin `profileId` es la ventana principal (lista de
 * workspaces). Con `profileId`, el renderer arranca directo en ese
 * workspace: es la ventana que recibe un workspace "soltado" desde otra
 * (ver window:open-workspace).
 */
function createWindow({ profileId = null } = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1c1c1e',
    show: false,
    title: 'YUSEPE Bento',
    // Chrome nativo de macOS: traffic lights embebidos en la topbar
    // (estilo Finder/Safari), sin barra de título aparte. En Windows/Linux
    // Electron ignora estas opciones y usa el frame estándar. El renderer
    // reserva el espacio de los semáforos vía la clase `platform-darwin`.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      // Habilita el visor de PDF interno de Chromium — sin esto, el
      // <embed type="application/pdf"> del preview de archivos queda en
      // blanco (ver fileTreeSidebar.js openMediaPreview).
      plugins: true,
    },
  });

  if (!mainWindow) mainWindow = win;
  windows.add(win);
  const wcId = win.webContents.id;
  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = [...windows][0] || null;
    // Suelta los workspaces de esta ventana y mata sus terminales.
    ipcHandle?.releaseWindow(wcId);
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (profileId) url.searchParams.set('profile', profileId);
    win.loadURL(url.toString());
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), profileId ? { query: { profile: profileId } } : undefined);
  }

  win.once('ready-to-show', () => win.show());

  // En pantalla completa macOS oculta los traffic lights, así que el
  // renderer no debe reservar el hueco de la izquierda de la topbar.
  const sendFullscreen = (v) => { if (!win.isDestroyed()) win.webContents.send('window:fullscreen', v); };
  win.on('enter-full-screen', () => sendFullscreen(true));
  win.on('leave-full-screen', () => sendFullscreen(false));
  // Los dos de arriba son eventos de *cambio*: si la app arranca ya en
  // pantalla completa (macOS la reabre en su mismo Space) no se dispara
  // ninguno, el renderer nunca se entera y la topbar deja reservado el
  // hueco de unos semáforos que no están — todo corrido 64px a la derecha.
  // Por eso hay que mandar el estado inicial una vez que el renderer cargó.
  win.webContents.on('did-finish-load', () => sendFullscreen(win.isFullScreen()));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL;
    if (allowed && url.startsWith(allowed)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  return win;
}

function configureSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'mediaKeySystem'];
    callback(allowed.includes(permission));
  });

  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https:; " +
          "frame-src 'self' https:; " +
          "connect-src 'self' https: http:;",
        ],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
}

app.whenReady().then(() => {
  configureSession();

  const profilesDir = join(app.getPath('userData'), 'profiles');
  ipcHandle = registerIpc({ app, profilesDir, broadcast });

  // -------- Workspaces en ventanas independientes --------
  // La ventana que suelta un workspace deja el mapa tileId → ptyId; la
  // nueva lo retira al arrancar (handoff:take) y se vuelve dueña de esos
  // ptys (pty:attach). Ver renderer/main.js detachWorkspace().
  ipcMain.handle('window:open-workspace', (event, { profileId, tileToPty }) => {
    if (!profileId) return { ok: false, reason: 'sin-perfil' };
    const ownerId = ipcHandle.claims.ownerOf(profileId);
    if (ownerId != null && ownerId !== event.sender.id) {
      const owner = BrowserWindow.getAllWindows().find((w) => w.webContents.id === ownerId);
      if (owner && !owner.isDestroyed()) { owner.focus(); return { ok: false, reason: 'abierto-en-otra-ventana' }; }
    }
    ipcHandle.stageHandoff(profileId, tileToPty);
    createWindow({ profileId });
    return { ok: true };
  });

  ipcMain.handle('window:focus-owner', (_e, { profileId }) => {
    const ownerId = ipcHandle.claims.ownerOf(profileId);
    const owner = BrowserWindow.getAllWindows().find((w) => w.webContents.id === ownerId);
    if (owner && !owner.isDestroyed()) { owner.focus(); return true; }
    return false;
  });

  ipcMain.on('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // `nativeTheme.themeSource` es global a toda la app: cambia
  // `prefers-color-scheme` para el renderer, los <webview> (webapps
  // embebidas) y los controles nativos, sin necesidad de tocar cada
  // WebContents por separado.
  ipcMain.on('theme:set', (_e, mode) => {
    nativeTheme.themeSource = mode === 'light' ? 'light' : 'dark';
  });

  ipcMain.handle('dialog:pick-folder', async (event) => {
    const win = windowFor(event);
    if (!win || win.isDestroyed()) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || !filePaths.length ? null : filePaths[0];
  });

  // Imagen local para wallpaper: se lee y codifica a data URL acá mismo
  // (no se guarda la ruta) para que el perfil quede autocontenido y no
  // se rompa si el archivo original se mueve o se borra después.
  ipcMain.handle('dialog:pick-image', async (event) => {
    const win = windowFor(event);
    if (!win || win.isDestroyed()) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (canceled || !filePaths.length) return null;

    const filePath = filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_WALLPAPER_BYTES) {
      throw new Error(`La imagen pesa ${(stat.size / 1024 / 1024).toFixed(1)} MB — el máximo es 8 MB.`);
    }

    const ext = extname(filePath).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext] || 'application/octet-stream';
    const buf = await fs.readFile(filePath);
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: stat.size };
  });

  // Export/import de perfiles como JSON portable (necesitan diálogos
  // nativos con `mainWindow`, por eso viven acá y no en ipc.js — mismo
  // criterio que dialog:pick-folder/pick-image).
  ipcMain.handle('profiles:export', async (event, { id }) => {
    const win = windowFor(event);
    if (!win || win.isDestroyed()) return { canceled: true };
    const profile = await ipcHandle.storage.load(id);
    const safeName = (profile.name || 'workspace').replace(/[\\/:*?"<>|]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `${safeName}.yusepe-bento.json`,
      filters: [{ name: 'YUSEPE Bento Workspace', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf8');
    return { canceled: false, filePath };
  });

  ipcMain.handle('profiles:import', async (event) => {
    const win = windowFor(event);
    if (!win || win.isDestroyed()) return { canceled: true };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'YUSEPE Bento Workspace', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return { canceled: true };

    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
    } catch {
      throw new Error('El archivo no es un JSON válido.');
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.name) {
      throw new Error('El archivo no tiene el formato de un workspace de YUSEPE Bento.');
    }
    const profile = await ipcHandle.storage.importProfile(parsed);
    broadcast('profiles:changed');
    return { canceled: false, profile };
  });

  createWindow();
  setupMenu(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  ipcHandle?.dispose();
});
