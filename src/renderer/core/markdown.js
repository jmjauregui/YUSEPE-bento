/**
 * src/renderer/core/markdown.js
 * --------------------------------------------------------------
 * El único lugar de la app que convierte Markdown a HTML: preview de
 * archivos, panel de Agentes e hilo del loop.
 *
 * Existe por seguridad, no por prolijidad. `marked` no sanitiza: deja pasar
 * `<img onerror=…>` y `[x](javascript:…)` tal cual, y con la CSP actual
 * (`script-src 'unsafe-inline'`) eso corre en el renderer, que tiene
 * `window.yusepe` — escribir en cualquier terminal incluido. Abrir el README
 * de un repo clonado, o leer el mensaje de un agente que copió algo de la
 * web, no puede ser ejecutar código. Por eso:
 *
 *   - el HTML crudo se muestra como texto (escapado), nunca se interpreta;
 *   - links e imágenes sólo con protocolos seguros (http/https/mailto,
 *     anclas y rutas relativas).
 *
 * Se hace en los hooks de render de marked y no con DOMPurify: cero
 * dependencias, y corre en node bajo vitest (DOMPurify pediría jsdom).
 * Si algún día entra otra fuente de HTML que no sea marked, ahí sí.
 * --------------------------------------------------------------
 */
import { Marked } from 'marked';
import { highlightCode } from './codeHighlight.js';

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * ¿Se puede usar como href/src? http(s), mailto, anclas o relativa.
 *
 * Se compara sin espacios ni caracteres de control: el navegador ignora
 * `java\tscript:` igual que `javascript:`, y la comparación también.
 */
export function isSafeUrl(url) {
  // eslint-disable-next-line no-control-regex -- justamente se buscan los de control
  const clean = String(url ?? '').replace(/[\x00-\x20]/g, '').toLowerCase();
  if (!clean) return false;
  if (/^(https?:|mailto:|#)/.test(clean)) return true;
  // Con esquema (`algo:`) y no es de los de arriba → afuera. Sin esquema es
  // una ruta relativa.
  return !/^[a-z][a-z0-9+.-]*:/.test(clean);
}

function createRenderer({ breaks, images }) {
  return new Marked({
    gfm: true,
    breaks,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (!isSafeUrl(href)) return label;
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(href)}"${t}>${label}</a>`;
      },
      image({ href, title, text }) {
        if (!isSafeUrl(href)) return escapeHtml(text);
        // Sin imágenes (hilo del loop): link al src en vez de cargarla — sin
        // tracking ni contenido sorpresa en medio de una conversación.
        if (!images) return `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`;
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}>`;
      },
      code({ text, lang }) {
        const language = (lang || '').split(/\s+/)[0] || null;
        return `<pre class="hljs"><code>${highlightCode(text, language)}</code></pre>\n`;
      },
    },
  });
}

const instances = new Map();

/**
 * Markdown -> HTML seguro para `innerHTML`.
 *
 * `breaks`: un salto simple es un `<br>`. Para el loop, donde los agentes
 * escriben reportes línea por línea; en un `.md` de verdad cambiaría el
 * render estándar, por eso no es el default.
 */
export function renderMarkdown(raw, { breaks = false, images = true } = {}) {
  const key = `${breaks}|${images}`;
  if (!instances.has(key)) instances.set(key, createRenderer({ breaks, images }));
  return instances.get(key).parse(String(raw ?? ''));
}
