/**
 * e2e/actividad.mjs
 * --------------------------------------------------------------
 * Color de actividad de las terminales (core/activityState.js), sobre la
 * app real. Dos terminales: en A se lanza un comando que escribe durante
 * ~2 s; se enfoca B. A debe pasar a `is-working` y, al callarse sin el
 * foco, a `is-done`; al hacer clic en A, se limpia.
 * --------------------------------------------------------------
 */
import { _electron as electron } from 'playwright';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-e2e-act-'));
const profilesDir = path.join(userData, 'profiles');
await fs.mkdir(profilesDir, { recursive: true });
await fs.writeFile(path.join(profilesDir, 'act.json'), JSON.stringify({
  id: 'act', name: 'Actividad', cwd: null, createdAt: 1, updatedAt: 1, gridVersion: 4,
  tiles: [
    { id: 'ta', kind: 'terminal', title: 'A', col: 1, row: 1, colSpan: 24, rowSpan: 8 },
    { id: 'tb', kind: 'terminal', title: 'B', col: 25, row: 1, colSpan: 24, rowSpan: 8 },
  ],
}, null, 2));
await fs.writeFile(path.join(profilesDir, '_index.json'), JSON.stringify({
  profiles: [{ id: 'act', name: 'Actividad', cwd: null, updatedAt: 1, lastOpenedAt: 0 }],
}, null, 2));

const failures = [];
function check(cond, msg) { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures.push(msg); }
const cls = (id) => page.$eval(`#bento .tile[data-tile-id="${id}"]`, (el) => el.className);

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  env: { ...process.env, YUSEPE_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
});
const page = await app.firstWindow();
page.on('pageerror', (err) => console.log('  [pageerror]', err.message));
await page.waitForLoadState('domcontentloaded');

try {
  await page.waitForSelector('#profile-screen:not(.hidden)', { timeout: 15000 });
  await page.locator('#profile-list').getByText('Actividad').first().click();
  await page.waitForSelector('#bento .tile[data-tile-id="tb"] .xterm', { timeout: 20000 });
  // Gracia de 10 s desde el primer byte del shell (core/activityState.js).
  await page.waitForTimeout(11_000);
  check(!(await cls('ta')).includes('is-working'), 'la terminal A arranca sin marca de actividad');

  // Escribe en A un comando que produce salida durante ~2 s, y enfoca B.
  await page.locator('#bento .tile[data-tile-id="ta"]').dispatchEvent('mousedown');
  await page.locator('#bento .tile[data-tile-id="ta"] .xterm-helper-textarea').focus();
  // ≥ 3 segundos distintos con salida y ≥ 3 s de trabajo: 14 líneas cada 0,3 s.
  await page.keyboard.type('for i in $(seq 1 14); do echo "trabajando $i ......................................"; sleep 0.3; done; echo LISTO');
  await page.keyboard.press('Enter');
  await page.locator('#bento .tile[data-tile-id="tb"]').dispatchEvent('mousedown');
  await page.waitForFunction(() => document.querySelector('#bento .tile[data-tile-id="ta"]').classList.contains('is-working'), null, { timeout: 6000 });
  check(true, 'A pasa a is-working mientras escribe');
  check((await cls('tb')).includes('focused') && !(await cls('ta')).includes('focused'), 'B tiene el foco y A no');

  await page.waitForFunction(() => document.querySelector('#bento .tile[data-tile-id="ta"]').classList.contains('is-done'), null, { timeout: 8000 });
  check(true, 'al callarse sin el foco, A pasa a is-done');
  const dotVisible = await page.$eval('#bento .tile[data-tile-id="ta"] .tile-activity-dot', (el) => getComputedStyle(el).display !== 'none');
  check(dotVisible, 'y muestra el punto «terminó de trabajar»');

  await page.locator('#bento .tile[data-tile-id="ta"]').dispatchEvent('mousedown');
  await page.waitForFunction(() => !document.querySelector('#bento .tile[data-tile-id="ta"]').classList.contains('is-done'), null, { timeout: 3000 });
  check(true, 'al enfocar A, la marca se limpia');
} catch (err) {
  console.log('✗ excepción:', err.message);
  failures.push(err.message);
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
if (failures.length) { console.log(`E2E actividad FALLÓ (${failures.length})`); process.exit(1); }
console.log('E2E actividad OK');
