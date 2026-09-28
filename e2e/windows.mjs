/**
 * e2e/windows.mjs
 * --------------------------------------------------------------
 * Workspace en ventana independiente (P1), sobre la app real con datos
 * aislados. Requiere `npm run build` previo.
 *
 *   node e2e/windows.mjs
 *
 * Verifica:
 *   1. Un workspace con una terminal viva se suelta a una ventana nueva
 *      con el botón de la pestaña; la ventana nueva arranca en ese
 *      workspace y su terminal muestra la salida previa (traspaso de pty).
 *   2. La ventana original ya no tiene la pestaña y, si intenta abrir el
 *      mismo workspace, recibe el aviso y no lo carga.
 *   3. Al cerrar la ventana nueva, el workspace vuelve a poder abrirse en
 *      la original, con una terminal nueva.
 * --------------------------------------------------------------
 */
import { _electron as electron } from 'playwright';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-e2e-win-'));
const profilesDir = path.join(userData, 'profiles');
await fs.mkdir(profilesDir, { recursive: true });

const seeded = {
  id: 'ventanas', name: 'Ventanas', cwd: null, createdAt: 1, updatedAt: 1, gridVersion: 3,
  tiles: [{ id: 't-term', kind: 'terminal', title: 'Shell', col: 1, row: 1, colSpan: 12, rowSpan: 20 }],
};
await fs.writeFile(path.join(profilesDir, 'ventanas.json'), JSON.stringify(seeded, null, 2));
await fs.writeFile(path.join(profilesDir, '_index.json'), JSON.stringify({
  profiles: [{ id: 'ventanas', name: 'Ventanas', cwd: null, updatedAt: 1, lastOpenedAt: 0 }],
}, null, 2));

const failures = [];
function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures.push(msg);
}
const termText = (page) => page.$eval('#bento .tile .xterm-rows', (el) => el.textContent || '').catch(() => '');
async function waitForTermText(page, needle, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await termText(page)).includes(needle)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  env: { ...process.env, YUSEPE_USER_DATA: userData },
});
const page = await app.firstWindow();
page.on('pageerror', (err) => console.log('  [pageerror ventana 1]', err.message));
await page.waitForLoadState('domcontentloaded');

try {
  await page.waitForSelector('#profile-screen:not(.hidden)', { timeout: 15000 });
  await page.locator('#profile-list').getByText('Ventanas').first().click();
  await page.waitForSelector('#bento .tile .xterm', { timeout: 20000 });
  check(true, 'el workspace abre con su terminal');

  // Escribir algo en la terminal para tener salida que traspasar.
  await page.locator('#bento .tile .xterm').click();
  await page.waitForTimeout(800); // que el shell esté listo
  await page.keyboard.type('echo HOLA-E2E');
  await page.keyboard.press('Enter');
  check(await waitForTermText(page, 'HOLA-E2E'), 'la terminal muestra la salida escrita');

  // 1. Soltar a una ventana nueva desde el botón de la pestaña.
  const secondWindow = app.waitForEvent('window', { timeout: 20000 });
  await page.locator('#workspace-tabs [data-action="detach"]').first().click();
  const page2 = await secondWindow;
  page2.on('pageerror', (err) => console.log('  [pageerror ventana 2]', err.message));
  await page2.waitForLoadState('domcontentloaded');
  const profileParam = new URL(page2.url()).searchParams.get('profile');
  check(profileParam === 'ventanas', `la ventana nueva arranca con ?profile=ventanas (medido: ${profileParam})`);
  await page2.waitForSelector('#bento .tile .xterm', { timeout: 20000 });
  check(await waitForTermText(page2, 'HOLA-E2E'), 'la terminal de la ventana nueva muestra la salida previa (pty traspasado)');

  // La terminal traspasada sigue viva: escribir en la ventana nueva produce salida.
  await page2.locator('#bento .tile .xterm').click();
  await page2.keyboard.type('echo SEGUNDA-VENTANA');
  await page2.keyboard.press('Enter');
  check(await waitForTermText(page2, 'SEGUNDA-VENTANA'), 'el mismo shell responde desde la ventana nueva');

  // 2. La ventana original soltó el workspace.
  await page.waitForSelector('#profile-screen:not(.hidden)', { timeout: 10000 });
  const tabsText = await page.locator('#workspace-tabs').textContent();
  check(!tabsText.includes('Ventanas'), 'la ventana original ya no tiene la pestaña');
  await page.locator('#profile-list').getByText('Ventanas').first().click();
  const warned = await page.getByText('abierto en otra ventana').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check(warned, 'intentar abrirlo en la original avisa que está en otra ventana');
  const stillList = await page.$eval('#profile-screen', (el) => !el.classList.contains('hidden'));
  check(stillList, 'y la original sigue en la lista, sin cargarlo');

  // 3. Cerrar la ventana nueva libera el workspace.
  await page2.close();
  await page.waitForTimeout(800);
  await page.locator('#profile-list').getByText('Ventanas').first().click();
  await page.waitForSelector('#bento .tile .xterm', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const fresh = await termText(page);
  check(!fresh.includes('HOLA-E2E'), 'tras cerrar la ventana nueva, la original abre el workspace con una terminal nueva');
} catch (err) {
  failures.push(`excepción: ${err.message}`);
  console.log('✗ excepción:', err.message);
  try { await page.screenshot({ path: path.join(root, 'e2e', 'failure-windows.png') }); } catch { /* noop */ }
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} verificación(es) fallida(s)`);
  process.exit(1);
}
console.log('\nE2E ventanas OK');
