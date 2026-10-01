/**
 * src/renderer/components/agentPanel.js
 * --------------------------------------------------------------
 * Panel "Agentes" en un modal (mismo patrón que gitPanel.js):
 *   - Pestaña "Instrucciones": detecta AGENTS.md/CLAUDE.md/.cursorrules/
 *     etc. en el workspace, deja crearlos (plantilla) y editarlos.
 *   - Pestaña "Subagentes": lista .claude/agents/*.md (solo lectura),
 *     parseando su frontmatter (name/description/tools/model).
 * --------------------------------------------------------------
 */
import { renderMarkdown } from '../core/markdown.js';
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { openModal } from './modal.js';

const TEMPLATES = {
  'AGENTS.md': '# AGENTS.md\n\nInstrucciones para agentes de IA que trabajen en este repo.\n\n## Cómo correr el proyecto\n\n## Convenciones de código\n\n## Qué evitar\n',
  'CLAUDE.md': '# CLAUDE.md\n\nContexto e instrucciones de este proyecto para Claude Code.\n\n## Resumen del proyecto\n\n## Comandos útiles\n\n## Convenciones\n',
  '.cursorrules': '# Reglas para Cursor\n\n',
  '.windsurfrules': '# Reglas para Windsurf\n\n',
  '.clinerules': '# Reglas para Cline\n\n',
  '.github/copilot-instructions.md': '# Instrucciones para GitHub Copilot\n\n',
};

export function openAgentPanel() {
  const cwd = state.profile?.cwd;
  if (!cwd) {
    openModal({
      title: 'Agentes',
      body: h('p', { class: 'text-sm text-fg-soft' },
        'Este workspace no tiene una carpeta de inicio configurada. Elegí una carpeta en la lista de perfiles para usar el panel de Agentes.'),
    });
    return;
  }

  const tabInstructionsBtn = h('button', { class: tabClass(true), onClick: () => setTab('instructions') }, 'Instrucciones');
  const tabSubagentsBtn = h('button', { class: tabClass(false), onClick: () => setTab('subagents') }, 'Subagentes');
  const tabs = h('div', { class: 'flex gap-1 mb-3 border-b border-line' }, [tabInstructionsBtn, tabSubagentsBtn]);

  const instructionsView = h('div', { class: 'flex h-[52vh]' });
  const subagentsView = h('div', { class: 'h-[52vh] overflow-y-auto hidden' });

  openModal({
    title: 'Agentes',
    body: h('div', {}, [tabs, instructionsView, subagentsView]),
    size: 'lg',
  });

  function tabClass(active) {
    return `text-xs px-3 py-1.5 -mb-px border-b-2 transition ${
      active ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg-soft'
    }`;
  }

  function setTab(tab) {
    tabInstructionsBtn.className = tabClass(tab === 'instructions');
    tabSubagentsBtn.className = tabClass(tab === 'subagents');
    instructionsView.classList.toggle('hidden', tab !== 'instructions');
    subagentsView.classList.toggle('hidden', tab !== 'subagents');
    if (tab === 'instructions') renderInstructions();
    else renderSubagents();
  }

  // ---------- Instrucciones ----------

  const fileListEl = h('div', { class: 'w-56 shrink-0 overflow-y-auto border-r border-line pr-2' });
  const editorArea = h('div', { class: 'flex-1 min-w-0 pl-3 flex flex-col' }, [
    h('p', { class: 'text-fg-subtle text-xs' }, 'Elegí un archivo de la izquierda.'),
  ]);
  instructionsView.append(fileListEl, editorArea);

  async function renderInstructions() {
    fileListEl.innerHTML = '';
    fileListEl.append(h('p', { class: 'text-fg-subtle text-xs px-1' }, 'Cargando…'));
    let files;
    try {
      files = await window.yusepe.agents.instructionFiles(cwd);
    } catch (err) {
      fileListEl.innerHTML = '';
      fileListEl.append(h('p', { class: 'text-red-400 text-xs px-1' }, err?.message || String(err)));
      return;
    }
    fileListEl.innerHTML = '';
    for (const f of files) fileListEl.append(instructionRow(f));
  }

  function instructionRow(f) {
    const row = h('div', {
      class: 'flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-elev cursor-pointer text-xs',
      title: f.hint,
      onClick: () => openInstructionFile(f),
    }, [
      h('span', { class: f.exists ? 'text-accent-soft' : 'text-fg-subtle' }, f.exists ? '●' : '○'),
      h('span', { class: 'truncate flex-1' }, f.label),
    ]);
    return row;
  }

  async function openInstructionFile(f) {
    editorArea.innerHTML = '';
    editorArea.append(h('p', { class: 'text-fg-subtle text-xs' }, 'Cargando…'));

    let raw = '';
    if (f.exists) {
      try {
        raw = await window.yusepe.agents.readInstructionFile(cwd, f.relPath);
      } catch (err) {
        editorArea.innerHTML = '';
        editorArea.append(h('p', { class: 'text-red-400 text-xs' }, err?.message || String(err)));
        return;
      }
    } else {
      raw = TEMPLATES[f.relPath] || `# ${f.label}\n\n`;
    }

    // Los archivos nuevos arrancan en modo edición (nada que previsualizar
    // todavía); los existentes arrancan como vista renderizada.
    let editing = !f.exists;
    let saveError = '';

    const toolbar = h('div', { class: 'flex items-center justify-between mb-2 min-h-[1.75rem]' });
    const contentArea = h('div', { class: 'flex-1 min-h-0 overflow-auto' });

    function renderToolbar() {
      toolbar.innerHTML = '';
      const status = h('span', { class: 'text-[10px] text-fg-subtle' },
        f.exists ? f.relPath : `${f.relPath} (nuevo — se crea al guardar)`);
      const actions = h('div', { class: 'flex items-center gap-2' });

      if (!editing) {
        actions.append(h('button', {
          class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
          onClick: () => { editing = true; saveError = ''; renderContent(); renderToolbar(); },
        }, [svgIcon('edit', { size: 13 }), h('span', {}, 'Editar')]));
      } else {
        actions.append(
          h('button', {
            class: 'text-xs px-2.5 py-1.5 rounded-md bg-accent hover:bg-accent-soft text-white transition',
            onClick: saveEdit,
          }, 'Guardar'),
          h('button', {
            class: 'text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
            onClick: () => {
              if (!f.exists) return; // nada que ver todavía — se queda en edición
              editing = false; saveError = ''; renderContent(); renderToolbar();
            },
          }, f.exists ? 'Cancelar' : 'Vista previa'),
        );
        if (saveError) actions.append(h('span', { class: 'text-[10px] text-red-400' }, saveError));
      }

      toolbar.append(status, actions);
    }

    async function saveEdit() {
      const textarea = contentArea.querySelector('textarea');
      if (!textarea) return;
      raw = textarea.value;
      try {
        await window.yusepe.agents.writeInstructionFile(cwd, f.relPath, raw);
        f.exists = true;
        editing = false;
        saveError = '';
        renderContent();
        renderToolbar();
        await renderInstructions();
      } catch (err) {
        saveError = err?.message || String(err);
        renderToolbar();
      }
    }

    function renderContent() {
      contentArea.innerHTML = '';
      if (editing) {
        const textarea = h('textarea', {
          class: 'w-full h-[48vh] bg-bg-elev border border-line rounded-md p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent',
          spellcheck: 'false',
        });
        textarea.value = raw;
        textarea.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); e.stopPropagation(); saveEdit(); }
          if (e.key === 'Escape') e.stopPropagation(); // no cerrar el modal mientras se edita
        });
        contentArea.append(textarea);
        setTimeout(() => textarea.focus(), 0);
      } else {
        const rendered = h('div', { class: 'prose-bento' });
        rendered.innerHTML = renderMarkdown(raw);
        contentArea.append(rendered);
      }
    }

    editorArea.innerHTML = '';
    editorArea.append(toolbar, contentArea);
    renderToolbar();
    renderContent();
  }

  // ---------- Subagentes ----------

  async function renderSubagents() {
    subagentsView.innerHTML = '';
    subagentsView.append(h('p', { class: 'text-fg-subtle text-xs' }, 'Cargando…'));
    let agents;
    try {
      agents = await window.yusepe.agents.subagents(cwd);
    } catch (err) {
      subagentsView.innerHTML = '';
      subagentsView.append(h('p', { class: 'text-red-400 text-xs' }, err?.message || String(err)));
      return;
    }

    subagentsView.innerHTML = '';
    if (!agents.length) {
      subagentsView.append(h('div', { class: 'text-xs text-fg-subtle' }, [
        h('p', {}, 'No se encontraron subagentes en .claude/agents/.'),
        h('p', { class: 'mt-1' },
          'Un subagente es un archivo .md con frontmatter (name, description, tools, model) en esa carpeta.'),
      ]));
      return;
    }

    for (const a of agents) {
      subagentsView.append(h('div', { class: 'border border-line rounded-md p-3 mb-2' }, [
        h('div', { class: 'flex items-center gap-2' }, [
          h('span', { class: 'text-sm font-medium' }, a.name),
          h('span', { class: 'text-[10px] text-fg-subtle ml-auto' }, a.relPath),
        ]),
        a.description && h('p', { class: 'text-xs text-fg-soft mt-1' }, a.description),
        h('div', { class: 'flex gap-3 mt-2 text-[10px] text-fg-subtle' }, [
          a.model && h('span', {}, `modelo: ${a.model}`),
          a.tools && h('span', {}, `tools: ${a.tools}`),
        ]),
      ]));
    }
  }

  renderInstructions();
}
