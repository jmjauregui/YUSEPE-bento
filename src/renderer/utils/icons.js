/**
 * src/renderer/utils/icons.js
 * --------------------------------------------------------------
 * Set único de iconos monoline (estilo SF Symbols) para toda la UI.
 * Reemplaza a los emojis dispersos por paneles/modales/command palette,
 * para que la app lea como nativa de macOS y no como app híbrida.
 *
 *   - svgIcon(name, { size })  -> devuelve un elemento <svg> (para h()).
 *   - iconMarkup(name, { size, cls }) -> devuelve el string (para innerHTML).
 *
 * Todos heredan el color vía `currentColor`, así que se tiñen con la clase
 * de texto del contenedor (text-fg-muted, text-accent, etc.).
 * --------------------------------------------------------------
 */

// Trazos internos de cada icono (viewBox 0 0 24 24, sin relleno).
const PATHS = {
  terminal: '<path d="M5 7l5 5-5 5M12 17h7"/>',
  webview: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  git: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M6 8.4v7.2M8.4 6H14a2 2 0 0 1 2 2v.6"/>',
  agents: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M8 13h.01M16 13h.01"/>',
  snippets: '<path d="M8 6 4 12l4 6M16 6l4 6-4 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  import: '<path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  export: '<path d="M12 3v12M8 11l4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2 2M17 17l2 2M19.1 4.9l-2 2M7 17l-2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>',
  link: '<path d="M9 15l6-6M10.5 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7l-1.8 1.8M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.8-1.8"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 17v4"/>',
  save: '<path d="M5 3h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7M8 21v-6h8v6"/>',
  upload: '<path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  external: '<path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  'file-plus': '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M19 11.5V8l-5-5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6.5"/><path d="M16 18h6M19 15v6"/>',
  'folder-plus': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3"/><path d="M3 7v10a2 2 0 0 0 2 2h7"/><path d="M16 18h6M19 15v6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.7-6L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.7 6L3 16M3 21v-5h5"/>',
  collapse: '<path d="M7 20l5-5 5 5M7 4l5 5 5-5"/>',
  tasks: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.4 1.4L7.5 4.8M3.5 12l1.4 1.4 2.6-2.6M3.5 18l1.4 1.4 2.6-2.6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  loop: '<path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h8a4 4 0 0 0 4-4"/><path d="M7 6 4 9l3 3M17 15l3 3-3 3"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4z"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
};

/** String del <svg> — para insertar en templates/innerHTML. */
export function iconMarkup(name, { size = 16, cls = '', stroke = 1.7 } = {}) {
  const inner = PATHS[name] || PATHS.square;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}"${cls ? ` class="${cls}"` : ''}>${inner}</svg>`;
}

/** Elemento <svg> — para pasar como hijo a h(). */
export function svgIcon(name, opts = {}) {
  const wrap = document.createElement('span');
  wrap.innerHTML = iconMarkup(name, opts);
  return wrap.firstElementChild;
}
