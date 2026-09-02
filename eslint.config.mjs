// Flat config de ESLint 9. Enfocado en cazar bugs reales (variables sin
// usar, referencias no definidas) — el formato lo maneja Prettier, así que
// eslint-config-prettier apaga cualquier regla estilística que choque.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**'],
  },

  js.configs.recommended,

  // Reglas comunes a todo el código fuente.
  {
    rules: {
      // Los args prefijados con `_` son "ignorados a propósito" (patrón ya
      // usado en los handlers IPC: `_e`, `_event`).
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Proceso main + preload + CLI: entorno Node (fs, path, process…).
  // El CLI (`src/cli/`) corre suelto con `node`, fuera de Electron: es lo
  // que usan los agentes desde su terminal para hablar con el loop.
  {
    files: [
      'src/main/**/*.js', 'src/preload/**/*.js', 'src/cli/**/*.{js,mjs}',
      '*.config.{js,mjs,cjs}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        // Constantes quemadas en build-time por electron.vite.config.mjs via `define`.
        __CHANGELOG__: 'readonly',
      },
    },
  },

  // Preload además toca APIs de browser (contextBridge expone a window).
  {
    files: ['src/preload/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Renderer: entorno browser (window, document, localStorage…).
  // `docs/` es el sitio estático de GitHub Pages — módulos ES que corren
  // directo en el navegador, sin bundler, así que van con el mismo entorno.
  {
    files: ['src/renderer/**/*.js', 'docs/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Tests (vitest): importan describe/it/expect explícitamente, pero usan
  // globals de Node (path, process) para armar fixtures.
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  prettier,
];
