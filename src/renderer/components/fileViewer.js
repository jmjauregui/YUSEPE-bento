/**
 * src/renderer/components/fileViewer.js
 * --------------------------------------------------------------
 * Renderizado de archivos, compartido por los dos lugares que muestran
 * contenido: el modal de preview del árbol (fileTreeSidebar.js) y el
 * tile fijado en el mosaico (fileTile.js).
 *
 * Vive en su propio módulo justamente para que sean el mismo código: un
 * archivo tiene que verse igual fijado que en el modal, y cualquier
 * formato nuevo aparece en los dos lados a la vez.
 *
 * Formatos: Markdown (marked + highlight de los bloques), imágenes, PDF
 * (pdf.js sobre <canvas>), SVG, CSV (tabla) y texto plano/código con
 * resaltado por extensión.
 *
 * El modal agrega encima la edición (textarea + guardar); eso NO está
 * acá porque es propio del modal — ver openFileModal.
 * --------------------------------------------------------------
 */
import { renderMarkdown } from '../core/markdown.js';
// Build "legacy" a propósito: apunta a runtimes más viejos y evita APIs
// muy nuevas (p.ej. Uint8Array.prototype.toHex) que el Chromium de
// Electron 33 todavía no trae. Con el build normal daba "a.toHex is not a
// function". Igual usamos pdfjs-dist v4 (v6 asume runtimes aún más nuevos).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { h } from '../utils/dom.js';
import { highlightCode, languageForFilename } from '../core/codeHighlight.js';

// El visor de PDF nativo de Chromium no coopera con archivos locales fuera
// de http(s):// — en vez de pelear con eso, renderizamos el PDF nosotros
// mismos con pdf.js, página por página, en <canvas>, a partir de los bytes
// que leemos por IPC (ver mountMediaView). Evita por completo el visor
// nativo y todos los líos de esquema/CORS.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
const MAX_PDF_PAGES_RENDERED = 30;

const MARKDOWN_RE = /\.(md|markdown)$/i;
const HTML_RE = /\.html?$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
const PDF_RE = /\.pdf$/i;
const SVG_RE = /\.svg$/i;
const CSV_RE = /\.csv$/i;

/** ¿Se lee por bytes (imagen/PDF) en vez de como texto? */
export function isMediaFile(name) {
  return IMAGE_RE.test(name) || PDF_RE.test(name);
}

/** Parser CSV simple: soporta comillas con comas/comillas escapadas dentro. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function renderCsvTable(raw, maxHeight) {
  const rows = parseCsv(raw);
  if (!rows.length) return h('p', { class: 'text-fg-subtle text-xs' }, '(csv vacío)');

  const [header, ...body] = rows;
  const wrap = h('div', { class: `overflow-auto ${maxHeight}` });
  const table = h('table', { class: 'text-xs w-full border-collapse' }, [
    h('thead', {}, [h('tr', {}, header.map((cell) => h('th', {
      class: 'text-left px-2 py-1 border-b border-line sticky top-0 bg-bg-elev whitespace-nowrap',
    }, cell)))]),
    h('tbody', {}, body.map((r) => h('tr', { class: 'hover:bg-bg-elev' },
      r.map((cell) => h('td', { class: 'px-2 py-1 border-b border-line/50 whitespace-nowrap' }, cell))))),
  ]);
  wrap.append(table);
  return wrap;
}

/**
 * Renderiza contenido de texto ya leído según su tipo.
 * `maxHeight` es una clase de Tailwind: el modal acota a la altura de la
 * ventana, el tile deja que el contenedor mande (ver fileTile.js).
 */
export function renderTextInto(container, { name, raw, maxHeight = 'max-h-[60vh]' }) {
  container.innerHTML = '';

  if (MARKDOWN_RE.test(name)) {
    const rendered = h('div', { class: 'prose-bento' });
    rendered.innerHTML = renderMarkdown(raw);
    container.append(rendered);
    return;
  }
  if (HTML_RE.test(name)) {
    // Render real, no código: mismo trato que Markdown pero con un iframe
    // sandboxeado (sin allow-same-origin) sobre un blob URL propio — así
    // el HTML del usuario corre aislado del origin de la app.
    const blobUrl = URL.createObjectURL(new Blob([raw], { type: 'text/html' }));
    // `max-h-*` sólo clampea; sin una altura real el iframe cae al alto por
    // default de 150px. Los llamadores siempre pasan `max-h-`, así que
    // derivamos el `h-` equivalente en vez de sumar otro parámetro.
    const heightClass = maxHeight.replace(/^max-h-/, 'h-');
    const iframe = h('iframe', {
      src: blobUrl,
      sandbox: 'allow-scripts allow-forms allow-popups',
      class: `w-full ${heightClass} bg-white rounded border border-line`,
    });
    iframe.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
    container.append(iframe);
    return;
  }
  if (SVG_RE.test(name)) {
    const img = h('img', {
      src: `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`,
      class: `max-w-full ${maxHeight} mx-auto block bg-white rounded`,
      alt: name,
    });
    container.append(h('div', { class: 'p-3 text-center' }, [img]));
    return;
  }
  if (CSV_RE.test(name)) {
    container.append(renderCsvTable(raw, maxHeight));
    return;
  }

  const pre = h('pre', { class: 'hljs' });
  const code = h('code');
  code.innerHTML = highlightCode(raw, languageForFilename(name));
  pre.append(code);
  container.append(pre);
}

/** Dibuja cada página del PDF en su propio <canvas>, vía pdf.js, a partir de los bytes. */
async function renderPdfPreview(bytes, container, maxHeight) {
  const wrap = h('div', {
    class: `flex flex-col items-center gap-3 overflow-auto ${maxHeight} bg-bg-elev/40 p-3 rounded`,
  });
  container.append(wrap);

  // Los bytes vienen del proceso principal vía IPC (ver explorerFs.readMediaBytes)
  // y se le pasan directo a pdf.js como `data` — así pdf.js no tiene que
  // descargar nada, lo que evita todos los líos de esquema/CORS que dan los
  // protocolos custom y el fetch cross-scheme en el renderer.
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pagesToRender = Math.min(pdf.numPages, MAX_PDF_PAGES_RENDERED);

  for (let i = 1; i <= pagesToRender; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = h('canvas', { class: 'shadow bg-white max-w-full' });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.append(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }

  if (pdf.numPages > MAX_PDF_PAGES_RENDERED) {
    wrap.append(h('p', { class: 'text-fg-subtle text-xs' },
      `Mostrando las primeras ${MAX_PDF_PAGES_RENDERED} de ${pdf.numPages} páginas — abrí con la app del sistema para verlo completo.`));
  }
}

/** Preview de imágenes/PDF: bytes leídos por IPC (ver explorerFs.readMediaBytes). */
export async function mountMediaView(container, { name, relPath }, { root, maxHeight = 'max-h-[70vh]' } = {}) {
  container.innerHTML = '';
  try {
    const { mime, bytes } = await window.yusepe.explorer.readMedia(root, relPath);
    // `bytes` llega como Uint8Array (Buffer serializado por IPC).
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    if (mime === 'application/pdf') {
      await renderPdfPreview(data, container, maxHeight);
      return;
    }

    const blobUrl = URL.createObjectURL(new Blob([data], { type: mime }));
    const img = h('img', {
      src: blobUrl,
      class: `max-w-full ${maxHeight} mx-auto block rounded`,
      alt: name,
    });
    img.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
    container.append(h('div', { class: 'p-3 text-center' }, [img]));
  } catch (err) {
    container.innerHTML = '';
    container.append(h('p', { class: 'text-red-400 text-xs' },
      `No se pudo leer "${name}": ${err?.message || err}`));
  }
}

/**
 * Lee y renderiza un archivo completo, en modo lectura. Es lo que usa el
 * tile fijado; el modal hace su propio flujo porque además edita.
 * Devuelve el texto crudo (o null si es medio/binario/ilegible).
 */
export async function mountFileView(container, entry, { root, maxHeight } = {}) {
  if (isMediaFile(entry.name)) {
    await mountMediaView(container, entry, { root, maxHeight });
    return null;
  }

  container.innerHTML = '';
  container.append(h('p', { class: 'text-fg-subtle text-xs p-2' }, 'Cargando…'));

  try {
    const result = await window.yusepe.explorer.read(root, entry.relPath);
    container.innerHTML = '';

    if (result.binary) {
      container.append(h('p', { class: 'text-fg-subtle text-xs p-2' },
        'Archivo binario — no se puede previsualizar.'));
      return null;
    }
    if (result.truncated) {
      container.append(h('p', { class: 'text-fg-subtle text-xs p-2' },
        'Archivo demasiado grande para previsualizar.'));
      return null;
    }

    renderTextInto(container, { name: entry.name, raw: result.content, maxHeight });
    return result.content;
  } catch (err) {
    container.innerHTML = '';
    container.append(h('p', { class: 'text-red-400 text-xs p-2' },
      `No se pudo leer "${entry.name}": ${err?.message || err}`));
    return null;
  }
}
