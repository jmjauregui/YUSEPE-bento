import { describe, it, expect } from 'vitest';
import { insertAtCursor, mixToMono } from './dictationText.js';

describe('insertAtCursor', () => {
  it('en una caja vacía queda el texto solo', () => {
    expect(insertAtCursor('', 0, 0, ' hola mundo ')).toEqual({ value: 'hola mundo', caret: 10 });
  });

  it('al final de un texto, separa con un espacio', () => {
    expect(insertAtCursor('revisá', 6, 6, 'el login')).toEqual({ value: 'revisá el login', caret: 15 });
  });

  it('en el medio, separa de los dos lados', () => {
    const r = insertAtCursor('ab', 1, 1, 'X');
    expect(r.value).toBe('a X b');
    expect(r.caret).toBe(3);
  });

  it('reemplaza la selección', () => {
    expect(insertAtCursor('hola mundo', 5, 10, 'gente').value).toBe('hola gente');
  });

  it('no duplica espacios que ya estaban', () => {
    expect(insertAtCursor('a ', 2, 2, 'b').value).toBe('a b');
  });

  it('un dictado vacío no cambia nada', () => {
    expect(insertAtCursor('texto', 5, 5, '   ')).toEqual({ value: 'texto', caret: 5 });
  });
});

describe('mixToMono', () => {
  it('promedia los canales', () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect([...mono]).toEqual([0.5, 0.5]);
  });

  it('un solo canal pasa tal cual', () => {
    const ch = new Float32Array([0.1, 0.2]);
    expect(mixToMono([ch])).toBe(ch);
  });
});
