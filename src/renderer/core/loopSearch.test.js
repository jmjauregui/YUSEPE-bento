import { describe, it, expect } from 'vitest';
import { matchMessages, highlightSegments, initialNavIndex, moveNavIndex, navLabel } from './loopSearch.js';

const msg = (text) => ({
  id: Math.random().toString(36).slice(2),
  text,
  from: 'a',
  to: 'b',
  createdAt: new Date().toISOString(),
});

describe('matchMessages', () => {
  it('encuentra sin distinguir mayúsculas', () => {
    const msgs = [msg('Hello world'), msg('otro mensaje'), msg('HELLO again')];
    const results = matchMessages(msgs, 'hello');
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('Hello world');
    expect(results[1].text).toBe('HELLO again');
  });

  it('consulta vacía o con sólo espacios → la lista entera sin filtrar', () => {
    const msgs = [msg('uno'), msg('dos')];
    expect(matchMessages(msgs, '')).toBe(msgs);
    expect(matchMessages(msgs, '   ')).toBe(msgs);
    expect(matchMessages(msgs, null)).toBe(msgs);
  });

  it('consulta con (, [, .*, ? → se trata literal, sin excepción', () => {
    const msgs = [msg('precio (con IVA)'), msg('otro')];
    expect(() => matchMessages(msgs, '(')).not.toThrow();
    expect(() => matchMessages(msgs, '[abc')).not.toThrow();
    expect(() => matchMessages(msgs, '.*')).not.toThrow();
    const results = matchMessages(msgs, '(con');
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('precio (con IVA)');
    // highlightSegments también debe tratar el texto como literal
    expect(() => highlightSegments('precio (con IVA)', '(')).not.toThrow();
    const segs = highlightSegments('(test) y (test)', '(test)');
    expect(segs.filter((s) => s.match)).toHaveLength(2);
  });

  it('conserva el orden del hilo', () => {
    // Fixture intencionalmente NO alfabético: un .sort() por texto lo rompería.
    const msgs = [msg('gamma matches'), msg('alpha matches'), msg('beta matches')];
    const results = matchMessages(msgs, 'matches');
    expect(results.map((m) => m.text)).toEqual(['gamma matches', 'alpha matches', 'beta matches']);
  });

  it('mensajes sin text → no explota y los excluye del resultado', () => {
    const sinText = { id: '1', from: 'a', to: 'b', createdAt: '' };
    const conText = msg('visible');
    const msgs = [sinText, conText];
    expect(() => matchMessages(msgs, 'visible')).not.toThrow();
    const results = matchMessages(msgs, 'visible');
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('visible');
    // Con query que no coincide con ninguno de los dos
    expect(matchMessages(msgs, 'nada')).toHaveLength(0);
  });
});

describe('highlightSegments', () => {
  it('mensaje con dos coincidencias → devuelve los dos tramos con match:true', () => {
    const segs = highlightSegments('uno dos uno', 'uno');
    const matches = segs.filter((s) => s.match);
    expect(matches).toHaveLength(2);
    expect(matches[0].text.toLowerCase()).toBe('uno');
    expect(matches[1].text.toLowerCase()).toBe('uno');
  });

  it('coincidencia al principio y al final → tramos correctos, sin vacíos espurios', () => {
    const segs = highlightSegments('ababab', 'ab');
    expect(segs.every((s) => s.text.length > 0)).toBe(true);
    expect(segs.filter((s) => s.match)).toHaveLength(3);
  });

  it('concatenar los tramos reconstruye el texto original', () => {
    const text = 'El buscador encuentra texto en el hilo del loop.';
    const segs = highlightSegments(text, 'texto');
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('coincidencia que es todo el texto → un solo tramo con match:true', () => {
    const segs = highlightSegments('todo', 'todo');
    expect(segs).toHaveLength(1);
    expect(segs[0].match).toBe(true);
    expect(segs[0].text).toBe('todo');
  });
});

describe('navegación — initialNavIndex / moveNavIndex / navLabel', () => {
  it('initialNavIndex con 17 resultados → 16 (el más reciente; si fuera 0 el usuario empezaría por el más viejo)', () => {
    expect(initialNavIndex(new Array(17).fill(null))).toBe(16);
  });

  it('initialNavIndex con lista vacía → -1, sin romper; moveNavIndex(-1, 0, next) → -1 (no da un índice válido en lista vacía)', () => {
    expect(initialNavIndex([])).toBe(-1);
    expect(moveNavIndex(-1, 0, 'next')).toBe(-1);
    expect(moveNavIndex(-1, 0, 'prev')).toBe(-1);
  });

  it('moveNavIndex(5, 17, next) → 4; prev → 6 (next sube hacia viejos, prev baja hacia nuevos; si estuvieran invertidos la navegación iría al revés)', () => {
    expect(moveNavIndex(5, 17, 'next')).toBe(4);
    expect(moveNavIndex(5, 17, 'prev')).toBe(6);
  });

  it('en extremos no da la vuelta: next en 0 → 0; prev en 16 → 16 (si diera la vuelta el usuario se perdería)', () => {
    expect(moveNavIndex(0, 17, 'next')).toBe(0);
    expect(moveNavIndex(16, 17, 'prev')).toBe(16);
  });

  it('navLabel(16, 17) → "1 de 17" (inicio, el más reciente); navLabel(0, 17) → "17 de 17" (el más viejo)', () => {
    expect(navLabel(16, 17)).toBe('1 de 17');
    expect(navLabel(0, 17)).toBe('17 de 17');
  });

  it('navLabel con lista vacía → "" (sin "0 de 0" ni NaN)', () => {
    expect(navLabel(-1, 0)).toBe('');
    expect(navLabel(0, 0)).toBe('');
  });
});
