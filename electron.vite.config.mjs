import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadEnv, defineConfig, externalizeDepsPlugin } from 'electron-vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Commits recientes quemados en build-time para el diálogo About.
// git log de los últimos 30 commits sin merges; si git no está disponible
// (CI shallow clone, build sin historial) queda vacío, no falla.
let changelog = [];
try {
  const raw = execSync(
    'git log -30 --pretty=format:"%s|%h|%ad" --date=short --no-merges',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
  if (raw) {
    changelog = raw.split('\n').filter(Boolean).map((line) => {
      const [msg, hash, date] = line.split('|');
      return { msg: msg || '', hash: hash || '', date: date || '' };
    });
  }
} catch { /* git no disponible en este entorno de build */ }

// Sin prefijo (no VITE_) para que loadEnv() de Vite no lo descarte —
// electron-vite solo trae automáticamente los prefijados. Se inyecta acá
// mismo, "a mano", en el bundle del proceso main vía `define`.
const env = loadEnv('production', __dirname, '');

/**
 * Configuración de electron-vite.
 *  - main / preload: electron-vite ya los compila como lib (CJS) por defecto.
 *    Solo indicamos el `input` y dejamos el resto al plugin oficial.
 *  - renderer: Vite estándar con Tailwind vía PostCSS (tailwindcss/postcss.config.js).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // La API key de Pexels se "quema" en el bundle compilado del proceso
    // main (nunca llega al renderer) — ver src/main/pexelsOps.js. Así el
    // usuario final no necesita configurar nada: viene lista desde el
    // .env con el que se compiló la app.
    define: {
      'process.env.APIKEY_PEXELS': JSON.stringify(env.APIKEY_PEXELS || ''),
      // Array de { msg, hash, date } quemado en build-time desde git log.
      // ESLint lo conoce como global de solo lectura (ver eslint.config.mjs).
      '__CHANGELOG__': JSON.stringify(changelog),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.js'),
        },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.js'),
        },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      // Los ~1250 iconos del Material Icon Theme (ver core/fileIcons.js) son
      // SVGs chicos; con el límite default Vite los inlinearía como data-URI
      // en el bundle (metiéndolos todos en memoria al arranque). En 0 se
      // emiten como archivos sueltos y el navegador solo baja el que se usa.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/renderer/shared'),
      },
    },
  },
});
