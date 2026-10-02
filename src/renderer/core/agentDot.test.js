import { describe, it, expect } from 'vitest';
import { agentDotState } from './agentDot.js';
import { STUCK_WORKING_MS } from './rosterAccordion.js';

const idle   = { state: 'idle',   streakStartedAt: null,      sinceMs: 0 };
const blink  = { state: 'blink',  streakStartedAt: Date.now(), sinceMs: 1_000 };
const steady = { state: 'steady', streakStartedAt: Date.now() - 200_000, sinceMs: 200_000 };

const STUCK_MS  = STUCK_WORKING_MS + 1;
const FRESH_MS  = 1_000;  // bien por debajo del umbral de trabado

describe('agentDotState', () => {
  it('ausente con actividad fresca → gris (ausente gana a todo)', () => {
    const r = agentDotState({ activity: blink, absent: true, working: false, stuckMs: 0 });
    expect(r.color).toBe('gray');
    expect(r.blink).toBe(false);
  });

  it('actividad blink → rojo con blink: true', () => {
    const r = agentDotState({ activity: blink, absent: false, working: false, stuckMs: 0 });
    expect(r.color).toBe('red');
    expect(r.blink).toBe(true);
  });

  it('actividad steady → rojo con blink: false (racha larga no titila)', () => {
    const r = agentDotState({ activity: steady, absent: false, working: false, stuckMs: 0 });
    expect(r.color).toBe('red');
    expect(r.blink).toBe(false);
  });

  it('working sin actividad con etiqueta vieja → ámbar (bandeja frenada)', () => {
    const r = agentDotState({ activity: idle, absent: false, working: true, stuckMs: STUCK_MS });
    expect(r.color).toBe('amber');
    expect(r.blink).toBe(false);
  });

  it('working sin actividad con etiqueta reciente → verde (aún no trabado)', () => {
    const r = agentDotState({ activity: idle, absent: false, working: true, stuckMs: FRESH_MS });
    expect(r.color).toBe('green');
  });

  it('sin actividad, sin working, presente → verde', () => {
    const r = agentDotState({ activity: idle, absent: false, working: false, stuckMs: 0 });
    expect(r.color).toBe('green');
    expect(r.blink).toBe(false);
  });

  it('el par color-texto no se contradice (color correcto Y label que empieza con la palabra del estado)', () => {
    const cases = [
      { input: { activity: blink,  absent: true,  working: false, stuckMs: 0       }, color: 'gray',  pattern: /^Caído/ },
      { input: { activity: blink,  absent: false, working: false, stuckMs: 0       }, color: 'red',   pattern: /^Ocupado/ },
      { input: { activity: steady, absent: false, working: false, stuckMs: 0       }, color: 'red',   pattern: /^Ocupado/ },
      { input: { activity: idle,   absent: false, working: true,  stuckMs: STUCK_MS }, color: 'amber', pattern: /^Trabado/ },
      { input: { activity: idle,   absent: false, working: false, stuckMs: 0       }, color: 'green', pattern: /^Disponible/ },
    ];
    for (const { input, color, pattern } of cases) {
      const { color: c, label } = agentDotState(input);
      expect(c).toBe(color);
      expect(label).toMatch(pattern);
    }
  });
});
