# Color de actividad en tiles de terminal · diseño

Fecha: 2026-09-29 · Pedido de Abel: «cuando una terminal esté trabajando (dentro de Bento) cambie ligeramente de color».
Decisión de Abel: mostrar dos estados: **trabajando** y **terminó sin que lo mires**.

## Señal (MEDIDO 2026-09-29)
Una sesión de Claude Code ociosa en un pty emite 7 fragmentos en el primer segundo (pintura inicial) y ninguno en los
19 s siguientes; trabajando emite varios por segundo. «Sin salida durante 1,5 s» separa bien trabajando de quieto, e
incluye como «quieto» la espera de una confirmación (que también conviene ver).

## Estados (`src/renderer/core/activityState.js`, puro, testeable)
- `idle` → llega salida útil → `working`.
- `working` → 1,5 s sin salida → `done` si el tile NO tiene el foco, `idle` si lo tiene.
- `done` → el tile recibe el foco → `idle`. (`done` → salida nueva → `working`.)
- Filtro de arranque: los primeros 3 s desde la creación del pty no cuentan. Fragmentos < 20 bytes no cuentan
  (parpadeos de barra de estado). Un fragmento cuenta si supera ese umbral o si llegan ≥ 3 chicos en 1 s.
- API: `createActivity({ now, isFocused, onChange, quietMs = 1500, warmupMs = 3000, minBytes = 20 })` devuelve
  `{ data(bytes), focus(), state(), dispose() }`. Sin DOM ni timers reales adentro: recibe `setTimeout/clearTimeout`
  inyectables para los tests (por defecto los globales).

## Presentación (CSS, `style.css`)
- `.tile.is-working`: `box-shadow: inset 0 0 0 1px rgb(var(--color-accent-rgb) / .45)` + fondo `color-mix` 6 % más claro;
  transición 300 ms; con foco se suma el inset de 2 px del acento (no lo reemplaza).
- `.tile.is-done`: borde inset 1 px salvia (`#A8BC98` al 55 %) + punto de 8 px arriba a la derecha (`.tile-activity-dot`,
  `title="Terminó de trabajar"`), a la izquierda del badge del loop si existe.
- `prefers-reduced-motion`: sin transición.

## Integración (`terminal.js`)
- Se crea la actividad junto al pty; `onData` llama `activity.data(data.length)` además de `term.write`.
- `isFocused = () => root.classList.contains('focused')`; `bus.on('tile:focus')` con este id → `activity.focus()`.
  También el `mousedown` del tile (bentoGrid ya enfoca) dispara `tile:focus`? No: bentoGrid llama `focusTile()`
  directamente. Se agrega en `focusTile()` un `bus.emit('tile:focused', { id })` y el terminal escucha eso.
- `onChange(state)` → `root.classList.toggle('is-working', …)`, `toggle('is-done', …)`.
- Al desmontar de verdad (kill) → `activity.dispose()`.

## Tests
- Unitarios `activityState.test.js` con timers falsos: cada transición, filtro de arranque, filtro de bytes,
  done solo sin foco, limpieza al enfocar, dispose cancela timers.
- E2E `e2e/actividad.mjs`: dos terminales; en la NO enfocada se escribe `sleep 2; echo listo`
  (vía el pty de la otra ventana no: se enfoca, se escribe, se enfoca la otra) → `is-working` aparece,
  luego `is-done` (≤ 5 s), y al hacer clic desaparece.

## Corrección 2026-09-29 (Abel: «sesiones ociosas lanzan listo»)
MEDIDO con node-pty: `claude --resume` local pinta 413 B (s0), 4.098 B (s1), 13 B (s2), 79 B (s3), 199 B (s4) y un
repintado aislado de 44 B en s11; un claude nuevo local: 413/960/121/199 B en s0-s3 y 44 B en s11; por ssh al mini
todo llega más tarde. Con gracia de 3 s desde el pty y 20 B mínimos, el s4 y el s11 daban working → done → «listo».
Reglas nuevas: gracia 10 s desde el PRIMER byte; working solo con salida en ≥ 3 segundos distintos y ≥ 300 B en una
ventana de 5 s; «listo» solo si working duró ≥ 3 s (si no, vuelve a idle en silencio).
