# P5 · Plantillas de distribución al crear un workspace

Fecha: 2026-09-27 · Rama: `feature/grid-24-columnas` (sobre P2) · Propuesta P5 del roadmap.

## Problema

Un workspace nuevo nace vacío y hay que armar la distribución tile por tile. Las distribuciones útiles se repiten (dos terminales, cuatro columnas, terminales más panel) y no hay forma de reutilizar una que ya quedó bien.

## Decisión

Un tercer paso en "Nuevo workspace": elegir una **plantilla de distribución**. Las plantillas son listas de tiles con posición y tamaño en la grilla de 24 columnas; al crear el perfil se instancian con ids nuevos. Hay plantillas incorporadas y plantillas del usuario, que se guardan desde el administrador del workspace con "Guardar distribución como plantilla".

## Plantillas incorporadas (coordenadas v3: 24 columnas, 20 filas de alto)

| id | nombre | tiles |
|---|---|---|
| `vacio` | Empezar en blanco | ninguno (comportamiento actual, es la primera opción) |
| `dos-terminales` | Dos terminales | terminal 12×20 en col 1 · terminal 12×20 en col 13 |
| `cuatro-columnas` | Cuatro columnas | 4 terminales 6×20 en cols 1, 7, 13, 19 |
| `cuatro-mas-panel` | Cuatro terminales + panel | 4 terminales 4×20 en cols 1, 5, 9, 13 · webview Google 8×10 en (17,1) · webview Discord 8×10 en (17,11) |
| `terminal-tareas` | Terminal principal + tareas | terminal 24×14 en (1,1) · terminal 12×6 en (1,15) · tareas 12×6 en (13,15) |

Los terminales no traen `cwd`: usan la carpeta del workspace, como hoy. Los títulos son genéricos ("Terminal 1", …) y se editan después desde el administrador.

## Plantillas del usuario

- Se crean desde el administrador del workspace: botón "Guardar distribución como plantilla" → nombre → se guarda `{ id, name, description, tiles, createdAt }` en `<userData>/layout-templates.json` (mismo patrón atómico que `snippets.json`).
- De cada tile se guarda solo `kind, title, col, row, colSpan, rowSpan, command, url, zoom`. Nunca `id`, `cwd`, `createdAt` ni `loopAgent` (son del workspace, no de la distribución).
- Se pueden borrar desde el selector (icono de papelera en la tarjeta).

## Componentes

| Archivo | Responsabilidad |
|---|---|
| `src/renderer/core/layoutTemplates.js` (nuevo, puro) | `BUILTIN_TEMPLATES`, `validateTemplate(t)` (kinds conocidos, dentro de 24 columnas, sin solapes), `instantiateTemplate(t, { newId })` (tiles con ids nuevos), `templateFromProfile(profile, { name, description })`. |
| `src/main/templatesOps.js` (nuevo) | `TemplatesStore` con `list()`, `create({ name, description, tiles })`, `remove(id)`. Valida nombre no vacío y `tiles` array. |
| `src/main/ipc.js` | `templates:list`, `templates:create`, `templates:delete` (+ `removeHandler`). |
| `src/preload/index.js` | `window.yusepe.templates.{list, create, delete}`. |
| `src/main/storage.js` | `create({ name, cwd, tiles = [] })`: acepta tiles iniciales; a cada tile sin `id` le asigna uno. |
| `src/renderer/core/profileManager.js` | `create(name, cwd, tiles = [])`. |
| `src/renderer/components/modal.js` | `openModal({ onClose })`: callback al cerrar (Esc, ×, clic fuera) para que un selector pueda resolver `null`. |
| `src/renderer/components/templatePicker.js` (nuevo) | `pickTemplate()` → `Promise<template \| null>`: modal `lg` con tarjetas (miniatura de la grilla + nombre + descripción); incorporadas primero, luego del usuario con papelera. |
| `src/renderer/main.js` | `createNewProfile()`: nombre → carpeta → plantilla → `ProfileManager.create(name, cwd, instantiateTemplate(tpl))`. Cancelar el selector aborta la creación. |
| `src/renderer/components/workspaceManager.js` | Botón "Guardar distribución como plantilla". |

## Flujo

1. Usuario: "Nuevo workspace" → nombre → carpeta (opcional) → selector de plantilla.
2. Renderer instancia la plantilla (ids nuevos vía `crypto.randomUUID()`), llama a `profiles:create` con `tiles`.
3. Main valida/asigna ids, escribe el perfil con `gridVersion: 3`.
4. El renderer carga el perfil; `ensurePositions` no tiene nada que hacer porque todo viene posicionado.

## Errores y casos borde

- Plantilla inválida (fuera de la grilla, kind desconocido, solapes): `validateTemplate` devuelve `{ ok: false, error }`; el selector no la ofrece y avisa con toast al guardar.
- Nombre vacío al guardar: error de `TemplatesStore.create`, mostrado en el prompt.
- Workspace sin tiles al guardar como plantilla: se permite (equivale a "vacío" con nombre propio) pero el botón avisa.
- `layout-templates.json` ausente: lista vacía. Corrupto: se propaga el error (igual que snippets).

## Pruebas

- `layoutTemplates.test.js`: todas las incorporadas pasan `validateTemplate`; `instantiateTemplate` da ids únicos y conserva geometría/comando/url; `templateFromProfile` descarta `id/cwd/createdAt/loopAgent`; solapes y fuera de grilla se detectan.
- `templatesOps.test.js`: create/list ordenada por nombre/remove; nombre vacío y tiles no array fallan.
- `storage.test.js`: `create` con `tiles` los persiste y completa ids faltantes.
- Manual en la app compilada: crear un workspace con "Cuatro columnas" y ver los 4 terminales; guardar "Motor + Jurimetría" como plantilla y crear otro workspace con ella.

## Fuera de alcance

Editar plantillas guardadas, exportarlas/importarlas, plantillas con wallpaper o cwd.
