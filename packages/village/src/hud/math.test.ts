import { portraitFor, describe, expect, it } from 'vitest';
import type { AgentInfo } from '../world/api';
import { chipOrder, formatClock, initialOf } from './math';

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

describe('portraitFor', () => {
  it('maps every agent kind to a cast portrait path, stable per id', () => {
    for (const kind of ['student', 'dean', 'council', 'expert', 'mediator'] as const) {
      const p = portraitFor({ id: `${kind}:x`, kind });
      expect(p).toMatch(/^assets\/pixel\/composed\/characters\/[a-z-]+\/portrait\.png$/);
      expect(portraitFor({ id: `${kind}:x`, kind })).toBe(p);
    }
  });
});
