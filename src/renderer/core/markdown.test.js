/**
 * src/renderer/core/markdown.test.js
 * --------------------------------------------------------------
 * Regresión de seguridad: el Markdown se renderiza con innerHTML en un
 * renderer que tiene window.yusepe (terminales incluidas). Si algo de esto
 * falla, un README o un mensaje de agente puede ejecutar código.
 * --------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest';
import { isSafeUrl, renderMarkdown } from './markdown.js';

describe('HTML crudo', () => {
  it.each([
    '<img src=x onerror="alert(1)">',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    'texto <b onmouseover="alert(1)">inline</b> en un párrafo',
  ])('se muestra como texto: %s', (raw) => {
    const html = renderMarkdown(raw);
    expect(html).not.toMatch(/<(img|script|iframe|b)\b/i);
    expect(html).toContain('&lt;');
  });
});

describe('links', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('%s no genera link', (href) => {
    const html = renderMarkdown(`[click](${href})`);
    expect(html).not.toContain('<a');
    expect(html).toContain('click');
  });

  it('http(s), mailto, anclas y relativas sí', () => {
    expect(renderMarkdown('[a](https://example.com)')).toContain('<a href="https://example.com"');
    expect(renderMarkdown('[a](mailto:x@y.z)')).toContain('<a href="mailto:x@y.z"');
    expect(renderMarkdown('[a](#seccion)')).toContain('<a href="#seccion"');
    expect(renderMarkdown('[a](docs/guia.md)')).toContain('<a href="docs/guia.md"');
  });

  it('isSafeUrl', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(' javascript:x')).toBe(false);
    expect(isSafeUrl('./a.png')).toBe(true);
  });
});

describe('imágenes', () => {
  it('con src seguro, en documentos se muestran', () => {
    expect(renderMarkdown('![logo](img/logo.png)')).toContain('<img src="img/logo.png"');
  });

  it('con src inseguro, sólo el texto', () => {
    const html = renderMarkdown('![x](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a');
  });

  it('sin imágenes (loop): link al src, no se cargan', () => {
    const html = renderMarkdown('![captura](https://example.com/a.png)', { images: false });
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com/a.png"');
  });
});

describe('formato', () => {
  it('lo básico de un reporte de agente', () => {
    const html = renderMarkdown('## QA\n\n- **ok** el login\n- `npm test` verde');
    expect(html).toContain('<h2');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>ok</strong>');
    expect(html).toContain('<code>npm test</code>');
  });

  it('bloques de código con highlight', () => {
    expect(renderMarkdown('```js\nconst a = 1;\n```')).toContain('<pre class="hljs">');
  });

  it('breaks respeta saltos simples (loop), sin breaks no (documentos)', () => {
    expect(renderMarkdown('línea 1\nlínea 2', { breaks: true })).toContain('<br>');
    expect(renderMarkdown('línea 1\nlínea 2')).not.toContain('<br>');
  });
});
