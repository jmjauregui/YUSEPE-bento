import { describe, it, expect } from 'vitest';
import { THINKING_PHRASES, thinkingPhrase, workingFor, thinkingLine } from './loopThinking.js';

describe('loopThinking', () => {
  it('hay al menos 40 frases y no se repiten', () => {
    expect(THINKING_PHRASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(THINKING_PHRASES).size).toBe(THINKING_PHRASES.length);
  });

  it('rota con el tick y es estable por agente', () => {
    expect(thinkingPhrase('claudio', 0)).toBe(thinkingPhrase('claudio', 0));
    expect(thinkingPhrase('claudio', 1)).not.toBe(thinkingPhrase('claudio', 0));
    expect(THINKING_PHRASES).toContain(thinkingPhrase('claudio', 12345));
  });

  it('dos agentes trabajando a la vez no dicen lo mismo', () => {
    expect(thinkingPhrase('claudio', 3)).not.toBe(thinkingPhrase('devops', 3));
  });

  it('workingFor: vacío el primer minuto, después minutos y horas', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(workingFor('2026-10-02T11:59:30Z', now)).toBe('');
    expect(workingFor('2026-10-02T11:57:00Z', now)).toBe('3 min');
    expect(workingFor('2026-10-02T10:30:00Z', now)).toBe('1 h 30 min');
    expect(workingFor('basura', now)).toBe('');
  });
});

describe('thinkingLine', () => {
  it('rojo titilando → kind phrase, text es la frase, color red', () => {
    const dot = { color: 'red', blink: true, label: 'Ocupado: está trabajando ahora' };
    expect(thinkingLine({ dot, phrase: 'dilucidando' })).toEqual({ kind: 'phrase', color: 'red', text: 'dilucidando' });
  });

  it('rojo sin titilar → también kind phrase (blink no cambia el kind — decisión 044-B)', () => {
    const dot = { color: 'red', blink: false, label: 'Ocupado: está trabajando ahora' };
    expect(thinkingLine({ dot, phrase: 'peinando el código' })).toEqual({ kind: 'phrase', color: 'red', text: 'peinando el código' });
  });

  it('ámbar → kind problem, text es el label del dot (sin frase rotatoria)', () => {
    const label = 'Trabado: figura ocupado y no imprime hace 10 min — su bandeja está frenada';
    const dot = { color: 'amber', blink: false, label };
    const result = thinkingLine({ dot, phrase: 'dilucidando' });
    expect(result?.kind).toBe('problem');
    expect(result?.color).toBe('amber');
    expect(result?.text).toBe(label);
    expect(result?.text).not.toBe('dilucidando');
  });

  it('verde → null', () => {
    const dot = { color: 'green', blink: false, label: 'Disponible: recibe mensajes' };
    expect(thinkingLine({ dot, phrase: 'dilucidando' })).toBeNull();
  });

  it('gris → null', () => {
    const dot = { color: 'gray', blink: false, label: 'Caído: su terminal volvió al prompt' };
    expect(thinkingLine({ dot, phrase: 'dilucidando' })).toBeNull();
  });

  it('color desconocido → null', () => {
    const dot = { color: 'purple', blink: false, label: '' };
    expect(thinkingLine({ dot, phrase: '' })).toBeNull();
  });
});
