import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../world/api';
import { chipOrder, closePopovers, formatClock, initialOf } from './math';

const a = (
  id: string,
  kind: AgentInfo['kind'],
  state: AgentInfo['state'] = 'idle',
  hidden = false,
): AgentInfo => ({ id, name: id, kind, state, hidden });
describe('hud math', () => {
  it('formats the village clock', () => {
    expect(formatClock(21.69)).toBe('9:41 PM');
    expect(formatClock(0.5)).toBe('12:30 AM');
    expect(formatClock(12)).toBe('12:00 PM');
  });
  it('orders chips: waiting first, students before experts, hidden dropped', () => {
    const out = chipOrder([
      a('e1', 'expert'),
      a('s1', 'student'),
      a('e2', 'expert', 'waiting_for_student'),
      a('h', 'student', 'idle', true),
    ]);
    expect(out.map((x) => x.id)).toEqual(['e2', 's1', 'e1']);
  });
  it('initial skips articles', () => {
    expect(initialOf('The Dean')).toBe('D');
    expect(initialOf('')).toBe('?');
  });
});

describe('closePopovers (Escape)', () => {
  const mk = (open: string) => {
    const attrs: Record<string, string> = {};
    return {
      panel: { dataset: { open } as Record<string, string | undefined> },
      button: { setAttribute: (n: string, v: string) => (attrs[n] = v) },
      attrs,
    };
  };
  it('closes open popovers, syncs aria-expanded, reports consumption', () => {
    const help = mk('true');
    const pop = mk('false');
    expect(closePopovers([help, pop])).toBe(true);
    expect(help.panel.dataset.open).toBe('false');
    expect(help.attrs['aria-expanded']).toBe('false');
    expect(pop.attrs['aria-expanded']).toBeUndefined();
  });
  it('does not consume Escape when nothing is open', () => {
    expect(closePopovers([mk('false'), mk('')])).toBe(false);
  });
});

describe('hud chips: portraits and status words', () => {
  it('every state has a status word (Resting, Thinking, Speaking, Waiting), never a letter or dot', async () => {
    const { STATUS_WORD, portraitKeyFor, portraitPath } = await import('./math');
    expect(Object.values(STATUS_WORD).sort()).toEqual(['Idle', 'On a call', 'Waiting on you', 'Working']);
    const { chipName, KIND_BLURB } = await import('./math');
    expect(chipName('Tutor', 'idle')).toBe('Tutor, idle: open');
    expect(chipName('Planner', 'waiting_for_student')).toBe('Planner, waiting on you: open');
    for (const s of Object.values(KIND_BLURB)) expect(s.split('.').length).toBe(2); // one sentence
    for (const w of Object.values(STATUS_WORD)) expect(w.length).toBeGreaterThan(3);
    expect(portraitKeyFor({ id: 'council:ask-chair', kind: 'council' })).toBe('chairman');
    expect(portraitKeyFor({ id: 'council:planner-chill', kind: 'council' })).toBe('council-chill');
    expect(portraitKeyFor({ id: 'student:s_ana', kind: 'student' }, 's_ana')).toBe('student');
    expect(portraitKeyFor({ id: 'student:s_ben', kind: 'student' }, 's_ana')).toBe('freshman');
    expect(portraitKeyFor({ id: 'dean', kind: 'dean' })).toBe('dean');
    expect(portraitPath('dean')).toBe('assets/pixel/composed/characters/dean/portrait.png');
  });
});
