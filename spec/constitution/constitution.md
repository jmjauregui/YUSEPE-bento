# Constitución de YUSEPE Bento

> Este documento define qué es Bento, qué no es, y cómo se gobierna.
> Es la vara contra la que se mide toda contribución. Una vez escrito,
> todos nos sometemos a él — incluido quien lo escribió.
>
> Estado: borrador para revisar en el escritorio. Afinar lo marcado con [revisar].
>
> Manda sobre el resto de `spec/constitution/`: si `mission.md`,
> `tech-stack.md` o `roadmap.md` chocan con este documento, se corrigen
> ellos, no la constitución.

## 1. Qué es Bento

Bento es **el cockpit para orquestar agentes de IA**.

Un espacio de trabajo opinado donde el flujo con agentes de código
—terminales reales, agentes hablando entre sí (*loop engineering*), tareas que
alimentan directo al agente— vive en un solo lugar, redimensionable y
reorganizable a mano.

Bento no busca adaptarse a cualquier flujo. **Propone uno.** El usuario se
adapta al anillo que Bento ofrece; Bento no hace anillos a la medida de cada
dedo.

## 2. Qué NO es Bento

Líneas rojas. Una propuesta que empuje a Bento hacia cualquiera de estas
cosas se rechaza **por principio, no por gusto**.

- **Bento no es un editor de código tradicional.** No competimos con VS Code,
  Vim ni ningún IDE. Bento orquesta, no edita.
- **Bento no es un sistema para reproducir contenido.** Nada de Netflix, HBO
  ni video. Bento es para orquestar trabajo, no para consumirlo.
- **Bento no es un browser.** Las webapps embebidas sirven al flujo de
  trabajo, no convierten a Bento en un navegador de propósito general.
- **Bento no es un gestor de workspaces genérico.** Hay muchos. Bento es
  específicamente para orquestar agentes de IA.

## 3. El diferenciador

Lo que hace a Bento distinto no son las piezas sueltas, sino **la
combinación con criterio**. En el centro:

- **Loop engineering**: agentes hablando entre sí —Claude Code con Codex,
  Open Code, Kimi— orquestados visualmente en el grid. Lo que tmux + VS Code
  a mano no puede dar. [revisar: nombre propio y sección destacada en README
  y web]
- **Tareas como markdown real versionado en git**, sin índice: el directorio
  es la única fuente de verdad.
- **launchText**: cada tarea genera texto listo para pegarle al agente.

## 4. Gobernanza: dictador benevolente + generales

- **Dictador benevolente.** Una sola persona decide qué es Bento y qué entra
  al núcleo: el mantenedor principal (Joseph). La visión no se vota: el
  consenso escala a la tibieza y diluye lo opinado.
- **Generales (*lieutenants*).** Cada mantenedor es dueño de un territorio y
  decide el *cómo* dentro de su área. El dictador decide el *qué* del
  proyecto entero. Se escala sin diluir y sin volverse cuello de botella.
  [revisar: asignar territorios]

### La regla de oro: benevolente

Todo "no" viene con un porqué que apunta a esta constitución, nunca al gusto
personal.

- Sí: "No, porque Bento no es para consumir contenido."
- No: "No, porque no me gusta."

## 5. Cómo se decide qué entra al núcleo

La pregunta no es "¿me gusta?" sino **"¿calza con lo que Bento quiere ser?"**.

- Resuelve un dolor dentro de la visión → **entra**.
- Valiosa pero fuera de la visión → **plugin/extensión, no núcleo**.
  [revisar: definir sistema de plugins]
- Contradice la sección 2 → **no entra**.

---

*Hecho por alguien que usa Bento ~12 horas al día. Pulido por uso real, no
por una lista de features copiada.*
