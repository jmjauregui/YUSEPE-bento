/**
 * e2e/navbar.mjs
 * --------------------------------------------------------------
 * Barra de navegación de los tiles webview, sobre la app real (Electron
 * + Playwright) con datos temporales. Requiere `npm run build` previo.
 *
 * Verifica:
 *   1. Un webview con `nav: true` pinta la barra; otro sin el campo, no.
 *   2. El campo de dirección muestra la URL del tile.
 *   3. Cmd+L (acción de menú `address-bar`) sobre el tile sin barra la
 *      enciende y el perfil en disco queda con `nav: true`.
 *   4. El botón ⌄ la oculta y el disco vuelve a `nav: false`.
 *   5. Escribir texto sin punto + Enter navega a una búsqueda de Google
 *      (se mide el intento vía did-start-loading; sin red igual vale).
 * --------------------------------------------------------------
 */
import { _electron as electron } from 'playwright';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-e2e-nav-'));
const profilesDir = path.join(userData, 'profiles');
await fs.mkdir(profilesDir, { recursive: true });

const profilePath = path.join(profilesDir, 'nav.json');
const seeded = {
  id: 'nav', name: 'Nav', cwd: null, createdAt: 1, updatedAt: 1, gridVersion: 4,
  tiles: [
    { id: 'w-on', kind: 'webview', title: 'Con barra', url: 'about:blank', nav: true, col: 1, row: 1, colSpan: 24, rowSpan: 8 },
    { id: 'w-off', kind: 'webview', title: 'Sin barra', url: 'about:blank', col: 25, row: 1, colSpan: 24, rowSpan: 8 },
  ],
};
await fs.writeFile(profilePath, JSON.stringify(seeded, null, 2));
await fs.writeFile(path.join(profilesDir, '_index.json'), JSON.stringify({
  profiles: [{ id: 'nav', name: 'Nav', cwd: null, updatedAt: 1, lastOpenedAt: 0 }],
}, null, 2));

const failures = [];
function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures.push(msg);
}
const readNav = async (id) => JSON.parse(await fs.readFile(profilePath, 'utf8')).tiles.find((t) => t.id === id).nav;
const sendAddressBar = () => app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].webContents.send('menu:tile-action', { type: 'address-bar' });
});

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  env: { ...process.env, YUSEPE_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
});
const page = await app.firstWindow();
page.on('pageerror', (err) => console.log('  [pageerror]', err.message));
await page.waitForLoadState('domcontentloaded');

try {
  await page.waitForSelector('#profile-screen:not(.hidden)', { timeout: 15000 });
  await page.locator('#profile-list').getByText('Nav').first().click();
  await page.waitForSelector('#bento .tile[data-tile-id="w-on"] .webview-navbar', { timeout: 15000 });

  // 1. visibilidad según nav
  const onHas = await page.locator('#bento .tile[data-tile-id="w-on"] .webview-navbar').count();
  const offHas = await page.locator('#bento .tile[data-tile-id="w-off"] .webview-navbar').count();
  check(onHas === 1 && offHas === 0, `solo el tile con nav:true pinta la barra (medido: ${onHas}/${offHas})`);

  // 2. campo de dirección
  const addr = await page.inputValue('#bento .tile[data-tile-id="w-on"] .webview-navbar-address');
  check(addr === 'about:blank', `el campo de dirección muestra la URL del tile (medido: "${addr}")`);

  // 3. Cmd+L sobre el tile sin barra
  await page.locator('#bento .tile[data-tile-id="w-off"]').dispatchEvent('mousedown');
  await sendAddressBar();
  await page.waitForSelector('#bento .tile[data-tile-id="w-off"] .webview-navbar', { timeout: 5000 });
  check(true, 'Cmd+L enciende la barra del webview enfocado');
  const focusedIsAddress = await page.evaluate(() =>
    document.activeElement?.classList.contains('webview-navbar-address')
    && document.activeElement.closest('.tile')?.dataset.tileId === 'w-off');
  check(focusedIsAddress, 'y deja el cursor en su campo de dirección');
  await page.waitForFunction(async () => true);
  let navOnDisk = null;
  for (let i = 0; i < 20 && navOnDisk !== true; i++) { await new Promise((r) => setTimeout(r, 150)); navOnDisk = await readNav('w-off'); }
  check(navOnDisk === true, `el perfil en disco quedó con nav:true (medido: ${navOnDisk})`);

  // 4. ocultar con ⌄
  await page.locator('#bento .tile[data-tile-id="w-off"] .webview-navbar-hide').click();
  await page.waitForFunction(() => !document.querySelector('#bento .tile[data-tile-id="w-off"] .webview-navbar'), null, { timeout: 5000 });
  navOnDisk = null;
  for (let i = 0; i < 20 && navOnDisk !== false; i++) { await new Promise((r) => setTimeout(r, 150)); navOnDisk = await readNav('w-off'); }
  check(navOnDisk === false, `⌄ oculta la barra y el disco vuelve a nav:false (medido: ${navOnDisk})`);
  const stillWebview = await page.locator('#bento .tile[data-tile-id="w-off"] webview').count();
  check(stillWebview === 1, 'el <webview> sigue en su lugar tras ocultar la barra');

  // 4b. el botón ⌕ (junto al grip) también enciende la barra, sin teclado
  const toggleCount = await page.locator('#bento .tile[data-tile-id="w-off"] .webview-navbar-toggle:not([hidden])').count();
  check(toggleCount === 1, 'el tile sin barra ofrece el botón ⌕ para mostrarla');
  await page.locator('#bento .tile[data-tile-id="w-off"] .webview-navbar-toggle').click({ force: true });
  await page.waitForSelector('#bento .tile[data-tile-id="w-off"] .webview-navbar', { timeout: 5000 });
  const toggleHidden = await page.locator('#bento .tile[data-tile-id="w-off"] .webview-navbar-toggle[hidden]').count();
  check(toggleHidden === 1, 'el botón ⌕ enciende la barra y se esconde mientras está encendida');
  await page.locator('#bento .tile[data-tile-id="w-off"] .webview-navbar-hide').click();
  await page.waitForFunction(() => !document.querySelector('#bento .tile[data-tile-id="w-off"] .webview-navbar'), null, { timeout: 5000 });

  // 5. Enter en la dirección navega (búsqueda)
  const started = page.evaluate(() => new Promise((resolve) => {
    const wv = document.querySelector('#bento .tile[data-tile-id="w-on"] webview');
    const t = setTimeout(() => resolve(null), 8000);
    // La URL destino se conoce al confirmarse la navegación (load-commit)
    // o al fallar (did-fail-load trae validatedURL): sin red igual vale.
    const done = (url) => { clearTimeout(t); resolve(url); };
    wv.addEventListener('load-commit', (e) => { if (e.isMainFrame && e.url !== 'about:blank') done(e.url); });
    wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame) done(e.validatedURL); });
  }));
  const input = page.locator('#bento .tile[data-tile-id="w-on"] .webview-navbar-address');
  await input.click();
  await input.fill('corte suprema');
  await input.press('Enter');
  const target = await started;
  check(typeof target === 'string' && target.startsWith('https://www.google.com/search?q=corte%20suprema'),
    `Enter con texto navega a una búsqueda de Google (medido: ${target})`);
} catch (err) {
  console.log('✗ excepción:', err.message);
  failures.push(err.message);
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}

if (failures.length) { console.log(`E2E navbar FALLÓ (${failures.length})`); process.exit(1); }
console.log('E2E navbar OK');
