import { describe, it, expect } from 'vitest';
import { THINKING_PHRASES, thinkingPhrase, workingFor } from './loopThinking.js';

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
