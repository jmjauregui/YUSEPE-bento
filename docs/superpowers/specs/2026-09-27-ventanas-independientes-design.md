# P1 · Abrir un workspace en una ventana independiente

Fecha: 2026-09-27 · Rama: `feature/ventanas-independientes` (sobre P2/P4/P5) · Propuesta P1 del roadmap.

## Problema

Bento tiene una sola ventana. Con dos workspaces abiertos (Motor y Jurimetría) solo se ve uno a la vez. El usuario quiere sacar una pestaña a su propia ventana, como en Chrome, para tener ambos a la vista en un monitor ancho o en dos monitores.

## Decisión

Cada workspace puede vivir en su propia `BrowserWindow`. "Soltar" un workspace de una ventana a otra **no mata sus terminales**: los ptys viven en main, cambian de dueño y la ventana nueva vuelve a dibujarlos con la salida reciente. Los webviews se recrean en la ventana nueva (su partición persistente conserva login y sesión).

Gesto: clic derecho en la pestaña → "Abrir en ventana nueva", y arrastrar la pestaña fuera de la ventana (soltarla fuera del rectángulo de la ventana). No hay animación de ventana siguiendo al cursor: Electron no la ofrece.

Un workspace está abierto en **una** ventana a la vez. Si otra ventana intenta abrirlo, se enfoca la que ya lo tiene y se avisa con un toast.

## Alternativas descartadas

- **Mover el DOM/xterm entre ventanas:** imposible entre procesos de renderer.
- **Segunda instancia de la app:** dos procesos pelean por los mismos JSON de perfiles y por el loop. Descartada.
- **Reiniciar los ptys en la ventana nueva (sin traspaso):** pierde la sesión de Claude en curso; el traspaso es el punto de la función.

## Componentes

| Archivo | Cambio |
|---|---|
| `src/main/multiWindow.js` (nuevo, puro) | `OutputRing` (últimos 256 KB de salida por pty), `HandoffRegistry` (profileId → { tileId: ptyId } pendiente de retirar), `WorkspaceClaims` (profileId → ownerId; `claim/release/releaseAll/ownerOf`). |
| `src/main/index.js` | `createWindow({ profileId })` reutilizable: carga el renderer con `?profile=<id>`; registra la ventana en un `Set`; eventos de fullscreen por ventana; diálogos contra `BrowserWindow.fromWebContents(event.sender)`; menú contra la ventana enfocada; `window:open-workspace`, `window:focus-owner`; al cerrar una ventana, libera sus reclamos y mata sus ptys huérfanos. |
| `src/main/ipc.js` | Cada pty guarda `sender` mutable + `ring`; `onData` escribe al ring y envía al `sender` actual. `pty:attach` cambia el dueño y devuelve `{ ok, buffer, shell }`. `handoff:take`, `workspace:claim`, `workspace:release`. Broadcast `profiles:changed` a todas las ventanas tras create/delete/rename/import. |
| `src/preload/index.js` | `pty.attach`, `windows.{openWorkspace, focusOwner, takeHandoff}`, `workspaces.{claim, release}`, `profiles.onChanged`. |
| `src/renderer/core/profileManager.js` | `load(id)` reclama el workspace antes de cargarlo; si otra ventana lo tiene, toast + `focusOwner` y no carga. |
| `src/renderer/core/liveTiles.js` | `release(tileId)`: saca el tile del registro llamando `entry.detach()` (sin matar el proceso). |
| `src/renderer/components/terminal.js` | Registra `detach` (dispone xterm y listeners, no el pty). Al crear, si hay un `ptyId` traspasado para ese tile, hace `pty.attach` y repinta el buffer en vez de `pty.create`; si el pty ya murió, cae al camino normal. |
| `src/renderer/main.js` | Boot con `?profile=<id>`: retira el traspaso y activa ese workspace. `detachWorkspace(id)`: recolecta `tileId → ptyId`, libera terminales, mata webviews, quita la pestaña, libera el reclamo y pide la ventana nueva. Menú contextual y drag-out en las pestañas. Refresca listas al recibir `profiles:changed`. |

## Flujo del traspaso

1. Ventana A: usuario elige "Abrir en ventana nueva" en la pestaña de Motor.
2. Renderer A arma `{ tileId: ptyId }` de las terminales vivas de Motor, dispone sus xterm (los ptys siguen corriendo), mata los webviews, quita la pestaña, libera el reclamo y llama `window:open-workspace(Motor, mapa)`.
3. Main guarda el mapa en `HandoffRegistry` y crea la ventana B con `?profile=Motor`.
4. Renderer B arranca, retira el mapa (`handoff:take`), reclama Motor y lo carga. Por cada terminal con `ptyId` en el mapa, `pty:attach` cambia el dueño del pty a B y devuelve el buffer reciente, que B escribe en el xterm nuevo antes de conectar la entrada. Los tiles sin traspaso (webviews, terminales cuyo pty murió) se crean como siempre.

## Errores y casos borde

- El pty murió entre el traspaso y el attach: `pty:attach` devuelve `{ ok: false }` y la terminal se crea de cero, con su `command` precargado.
- La ventana B nunca retira el traspaso (falló al abrir): el mapa queda en el registro; los ptys siguen vivos con dueño A destruido → al cerrar A se matan los huérfanos. Aceptado: es el mismo destino que cerrar la pestaña.
- Cerrar una ventana con workspaces abiertos: se liberan sus reclamos y se matan sus ptys, igual que cerrar esas pestañas (hoy los ptys de la ventana principal quedaban vivos hasta salir de la app; eso deja de pasar).
- `Cmd+1..9` y la lista de workspaces respetan el reclamo: no se puede abrir el mismo workspace en dos ventanas.
- Diálogos nativos (elegir carpeta, exportar/importar) se abren sobre la ventana que los pidió.
- El loop (`loop:bind` nombre→ptyId) no cambia: el `ptyId` es el mismo antes y después del traspaso.

## Pruebas

- Unitarias (`multiWindow.test.js`): ring recorta por el frente y conserva el final; handoff se retira una sola vez; claims: mismo dueño idempotente, otro dueño rechazado, release/releaseAll.
- Unitarias (`ipc` sin Electron no es testeable): la lógica de attach vive en `multiWindow.js` (`attachPty(entry, sender)`), testeada.
- E2E (`e2e/windows.mjs`): abrir un workspace con una terminal, escribir `echo HOLA-E2E` en ella, "Abrir en ventana nueva" desde el menú contextual de la pestaña → aparece una segunda ventana con `?profile=`, su terminal muestra `HOLA-E2E` (buffer traspasado), la primera ventana ya no tiene esa pestaña, e intentar abrir el mismo workspace en la primera ventana muestra el toast y no lo carga.

## Fuera de alcance

Animación de ventana siguiendo al cursor; traspaso de webviews con estado de página; recordar posición/tamaño de ventanas secundarias entre sesiones.
