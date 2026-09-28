/**
 * e2e/smoke.mjs
 * --------------------------------------------------------------
 * Prueba de humo de la app real (Electron + Playwright) sobre una carpeta
 * de datos temporal (YUSEPE_USER_DATA), así nunca toca los perfiles del
 * usuario. Requiere `npm run build` previo (lanza out/main/index.js).
 *
 *   npm run e2e
 *
 * Verifica, en este orden:
 *   1. La app abre en la lista de workspaces.
 *   2. Un perfil sembrado en gridVersion 2 se migra a 3 (×2) al abrirlo y
 *      el grid se pinta con 24 columnas.
 *   3. "Nuevo workspace" ofrece plantillas; "Cuatro columnas" crea 4
 *      terminales en las columnas 1, 7, 13 y 19 con span 6.
 *   4. "Guardar distribución como plantilla" persiste la plantilla y
 *      aparece en "Mis plantillas" al crear otro workspace.
 *   5. Borrar la plantilla desde el selector la saca del disco.
 *   6. Cerrar el selector con Escape no crea el workspace.
 * --------------------------------------------------------------
 */
import { _electron as electron } from 'playwright';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-e2e-'));
const profilesDir = path.join(userData, 'profiles');
await fs.mkdir(profilesDir, { recursive: true });

// Perfil sembrado en v2 (12 columnas): dos tiles de 6 columnas.
const seeded = {
  id: 'seed-v2', name: 'Sembrado v2', cwd: null, createdAt: 1, updatedAt: 1, gridVersion: 2,
  tiles: [
    { id: 's1', kind: 'calculator', title: 'Calc A', col: 1, row: 1, colSpan: 6, rowSpan: 4 },
    { id: 's2', kind: 'calculator', title: 'Calc B', col: 7, row: 1, colSpan: 6, rowSpan: 4 },
  ],
};
await fs.writeFile(path.join(profilesDir, 'seed-v2.json'), JSON.stringify(seeded, null, 2));
await fs.writeFile(path.join(profilesDir, '_index.json'), JSON.stringify({
  profiles: [{ id: 'seed-v2', name: 'Sembrado v2', cwd: null, updatedAt: 1, lastOpenedAt: 0 }],
}, null, 2));

const failures = [];
function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures.push(msg);
}

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  env: { ...process.env, YUSEPE_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
});
const page = await app.firstWindow();
page.on('pageerror', (err) => console.log('  [pageerror]', err.message));
await page.waitForLoadState('domcontentloaded');

try {
  // 1. Lista de workspaces
  await page.waitForSelector('#profile-screen:not(.hidden)', { timeout: 15000 });
  check(true, 'la app abre en la lista de workspaces');

  // 2. Migración v2 → v3 al abrir el perfil sembrado
  await page.locator('#profile-list').getByText('Sembrado v2').first().click();
  await page.waitForSelector('#bento .tile', { timeout: 15000 });
  const cols = await page.$eval('#bento', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check(cols === 24, `el grid se pinta con 24 columnas (medido: ${cols})`);
  const migrated = JSON.parse(await fs.readFile(path.join(profilesDir, 'seed-v2.json'), 'utf8'));
  check(migrated.gridVersion === 3, `el perfil sembrado quedó en gridVersion 3 (medido: ${migrated.gridVersion})`);
  check(migrated.tiles[1].col === 13 && migrated.tiles[1].colSpan === 12,
    `el segundo tile pasó de col 7/span 6 a col 13/span 12 (medido: ${migrated.tiles[1].col}/${migrated.tiles[1].colSpan})`);
  const gridCol = await page.$eval('#bento .tile[data-tile-id="s2"]', (el) => el.style.gridColumn);
  check(gridCol === '13 / span 12', `el tile se posiciona en la grilla nueva (style: "${gridCol}")`);

  // 3. Nuevo workspace con plantilla "Cuatro columnas"
  await page.locator('#btn-back-profiles').click();
  await page.waitForSelector('#profile-screen:not(.hidden)');
  await page.locator('#btn-profile-new').click();
  await page.waitForSelector('#modal-root:not(.hidden) input');
  await page.locator('#modal-root input').fill('E2E cuatro');
  await page.locator('#modal-root button', { hasText: 'Crear' }).click();
  await page.locator('#modal-root button', { hasText: 'Omitir' }).click();
  await page.waitForSelector('#modal-root:not(.hidden)');
  const title = await page.locator('#modal-title').textContent();
  check(title === 'Distribución del workspace', `aparece el selector de plantillas (título: "${title}")`);
  await page.locator('#modal-body button', { hasText: 'Cuatro columnas' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#bento .tile').length === 4, null, { timeout: 20000 });
  const positions = await page.$$eval('#bento .tile', (els) => els.map((el) => el.style.gridColumn).sort());
  check(JSON.stringify(positions) === JSON.stringify(['1 / span 6', '13 / span 6', '19 / span 6', '7 / span 6']),
    `cuatro terminales en las columnas 1, 7, 13 y 19 con span 6 (medido: ${positions.join(' · ')})`);
  const idx = JSON.parse(await fs.readFile(path.join(profilesDir, '_index.json'), 'utf8'));
  const created = idx.profiles.find((p) => p.name === 'E2E cuatro');
  check(!!created, 'el workspace nuevo quedó en el índice');
  if (created) {
    const prof = JSON.parse(await fs.readFile(path.join(profilesDir, `${created.id}.json`), 'utf8'));
    check(prof.gridVersion === 3 && prof.tiles.length === 4 && prof.tiles.every((t) => t.id),
      'el perfil nuevo tiene gridVersion 3 y 4 tiles con id');
  }

  // 4. Guardar distribución como plantilla y reutilizarla
  await page.locator('#btn-workspace-manager').click();
  await page.locator('#modal-body button', { hasText: 'Guardar distribución como plantilla' }).click();
  await page.waitForSelector('#modal-root input');
  await page.locator('#modal-root input').fill('Mi cuatro');
  await page.locator('#modal-root button', { hasText: 'Guardar' }).click();
  await page.waitForFunction(() => document.querySelector('#modal-title')?.textContent === 'Administrador del workspace');
  const tplFile = JSON.parse(await fs.readFile(path.join(userData, 'layout-templates.json'), 'utf8'));
  check(tplFile.templates?.length === 1 && tplFile.templates[0].name === 'Mi cuatro' && tplFile.templates[0].tiles.length === 4,
    'la plantilla del usuario quedó guardada con 4 tiles');
  await page.locator('#modal-close').click();

  await page.locator('#btn-back-profiles').click();
  await page.locator('#btn-profile-new').click();
  await page.waitForSelector('#modal-root:not(.hidden) input');
  await page.locator('#modal-root input').fill('E2E desde plantilla');
  await page.locator('#modal-root button', { hasText: 'Crear' }).click();
  await page.locator('#modal-root button', { hasText: 'Omitir' }).click();
  await page.waitForSelector('#modal-body');
  const mine = page.locator('#modal-body button', { hasText: 'Mi cuatro' });
  check(await mine.count() === 1, 'la plantilla guardada aparece en "Mis plantillas"');
  await mine.click();
  await page.waitForFunction(() => document.querySelectorAll('#bento .tile').length === 4, null, { timeout: 20000 });
  check(true, 'un workspace creado desde la plantilla guardada abre con sus 4 tiles');

  // 5. Borrar la plantilla guardada desde el selector
  await page.locator('#btn-back-profiles').click();
  await page.locator('#btn-profile-new').click();
  await page.waitForSelector('#modal-root:not(.hidden) input');
  await page.locator('#modal-root input').fill('E2E borrar');
  await page.locator('#modal-root button', { hasText: 'Crear' }).click();
  await page.locator('#modal-root button', { hasText: 'Omitir' }).click();
  await page.locator('#modal-body button', { hasText: 'Mi cuatro' }).waitFor();
  await page.locator('#modal-body button', { hasText: 'Mi cuatro' }).locator('[title="Borrar esta plantilla"]').click();
  await page.locator('#modal-root button', { hasText: 'Borrar' }).click();
  await page.waitForFunction(() => document.querySelector('#modal-title')?.textContent === 'Distribución del workspace');
  await page.waitForTimeout(300);
  const stillThere = await page.locator('#modal-body button', { hasText: 'Mi cuatro' }).count();
  const tplAfter = JSON.parse(await fs.readFile(path.join(userData, 'layout-templates.json'), 'utf8'));
  check(stillThere === 0 && tplAfter.templates.length === 0, 'la plantilla borrada desaparece del selector y del disco');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const idxAfterDelete = JSON.parse(await fs.readFile(path.join(profilesDir, '_index.json'), 'utf8'));
  check(!idxAfterDelete.profiles.some((p) => p.name === 'E2E borrar'), 'salir del selector tras borrar no crea el workspace');

  // 6. Cancelar el selector no crea workspace (ya estamos en la lista)
  const before = JSON.parse(await fs.readFile(path.join(profilesDir, '_index.json'), 'utf8')).profiles.length;
  await page.locator('#btn-profile-new').click();
  await page.waitForSelector('#modal-root:not(.hidden) input');
  await page.locator('#modal-root input').fill('E2E cancelado');
  await page.locator('#modal-root button', { hasText: 'Crear' }).click();
  await page.locator('#modal-root button', { hasText: 'Omitir' }).click();
  await page.waitForSelector('#modal-body');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = JSON.parse(await fs.readFile(path.join(profilesDir, '_index.json'), 'utf8')).profiles.length;
  check(after === before, 'cerrar el selector con Escape no crea el workspace');
} catch (err) {
  failures.push(`excepción: ${err.message}`);
  console.log('✗ excepción:', err.message);
  try { await page.screenshot({ path: path.join(root, 'e2e', 'failure.png') }); console.log('  captura en e2e/failure.png'); } catch { /* noop */ }
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} verificación(es) fallida(s)`);
  process.exit(1);
}
console.log('\nE2E OK');
