import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step } from '../../contract';
import { paintShot, po, runScript } from '../../testkit';
import { commonSuite } from '../a-suite';
import { roundTable, roundTableBundle } from './index';

const PL = 'council:planner';
const op = (member: string, text?: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId: PL,
  member,
  ...(text === undefined ? {} : { text }),
  ...(dissent ? { dissent } : {}),
});
const rank = (member: string, order?: string[]): VillageEvent => ({
  t: 'council.rank',
  councilId: PL,
  member,
  ...(order ? { order } : {}),
});
const verdict = (
  extra: { text?: string; dissent?: boolean; dissenter?: string } = {},
): VillageEvent => ({
  t: 'council.verdict',
  councilId: PL,
  member: 'chair',
  text: 'Plan A',
  ...extra,
});
const ctx = DEFAULT_CTX;

const active = [
  { at: 0, event: op('chill', 'Ease in.') },
  { at: 0, event: op('grind', 'All in.') },
  { at: 0, event: op('advisor', 'Balance.') },
  { at: 500, event: rank('chill', ['advisor', 'chill', 'grind']) },
];

commonSuite(roundTableBundle, op('chill', 'x'), { activeScript: active, defaultAccess: 'dim' });

describe('round-table mapEvent', () => {
  const s = roundTable.init();
  it('opinions are thought bubbles staggered by seat, unlocking first', () => {
    expect(roundTable.mapEvent(op('chill', 'Ease in'), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'bubble', bubble: { who: 'chill', text: 'Ease in', style: 'thought', order: 0 } },
    ]);
    const a = step(roundTable, s, op('chill', 'a'), ctx, 1);
    expect(roundTable.mapEvent(op('advisor', 'b'), a, ctx)).toEqual([
      { c: 'bubble', bubble: { who: 'advisor', text: 'b', style: 'thought', order: 2 } },
    ]);
    expect(roundTable.mapEvent(op('grind', undefined, true), a, ctx)).toEqual([
      { c: 'bubble', bubble: { who: 'grind', text: '...', style: 'dissent', order: 1 } },
    ]);
  });
  it('rank and verdict (clean and dissenting)', () => {
    const a = step(roundTable, s, op('grind', 'x'), ctx, 1);
    expect(roundTable.mapEvent(rank('chill', ['grind', 'chill']), a, ctx)).toEqual([
      { c: 'rank', by: 'chill', order: ['grind', 'chill'] },
    ]);
    expect(roundTable.mapEvent(rank('chill'), a, ctx)).toEqual([
      { c: 'rank', by: 'chill', order: [] },
    ]);
    expect(roundTable.mapEvent(verdict(), a, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'Plan A' },
      { c: 'lantern', mode: 'steady' },
    ]);
    expect(roundTable.mapEvent(verdict({ dissent: true, dissenter: 'grind' }), a, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'Plan A', dissenter: 'grind' },
      { c: 'lantern', mode: 'flicker' },
    ]);
    expect(roundTable.mapEvent(verdict({ text: '  ' }), a, ctx)[0]).toEqual({
      c: 'verdict',
      chair: 'chair',
      text: 'Plan agreed',
    });
  });
  it('the dissenter keeps one red-lined bubble and the lamp flickers', () => {
    const o = runScript(roundTable, [
      { at: 0, event: op('chill', 'a') },
      { at: 0, event: op('grind', 'b') },
      { at: 5, event: verdict({ dissent: true, dissenter: 'grind' }) },
    ]);
    expect(o.bubbles.filter((b) => b.style === 'dissent').map((b) => b.who)).toEqual(['grind']);
    expect(o.lantern).toBe('flicker');
  });
  it('only the planner council belongs here (quizkey stays in the Council Hall)', () => {
    expect(
      roundTable.handles(
        { ...op('chill', 'x'), councilId: 'council:quizkey' } as VillageEvent,
        s,
        ctx,
      ),
    ).toBe(false);
    expect(
      roundTable.handles({ ...op('chill', 'x'), councilId: 'planner' } as VillageEvent, s, ctx),
    ).toBe(true);
  });
  it('agent events from council:planner (state, message, call)', () => {
    const msg: VillageEvent = {
      t: 'agent.message',
      from: PL,
      to: 'commons',
      taskId: 't',
      kind: 'conflict',
      shared: [],
    };
    expect(roundTable.mapEvent(msg, s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'bubble', bubble: { who: 'expert', text: 'Conflict spotted', style: 'speech' } },
    ]);
    expect(roundTable.mapEvent({ t: 'call.end', agent: PL, callId: 'c' }, s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'setOccupant', state: 'idle' },
      { c: 'portrait', on: false },
      { c: 'clearBubble', who: 'expert' },
    ]);
  });
});

describe('round-table motion', () => {
  const shot = roundTableBundle.shots.find((x) => x.name === 'interior-rank')!;
  it('bubbles slide to rank slots over 320 ms (different frames), calm fades in place', () => {
    const t0 = paintShot(roundTable, shot, 2010).hash();
    const t1 = paintShot(roundTable, shot, 2160).hash();
    const t2 = paintShot(roundTable, shot, 2400).hash();
    expect(new Set([t0, t1, t2]).size).toBe(3);
    const c1 = paintShot(roundTable, { ...shot, calm: true }, 2160).hash();
    const c2 = paintShot(roundTable, { ...shot, calm: true }, 2400).hash();
    expect(c1).toBe(c2);
  });
  it('the chair stands on verdict; dissent adds the persistent bubble and lantern', () => {
    const base = runScript(roundTable, active, 1000);
    const clean = step(roundTable, base, verdict(), ctx, 3000);
    const split = step(roundTable, base, verdict({ dissent: true, dissenter: 'grind' }), ctx, 3000);
    for (const v of ['exterior', 'interior'] as const) {
      const a = roundTable.paint(base, v, po(3500, true)).hash();
      const b = roundTable.paint(clean, v, po(3500, true)).hash();
      const c = roundTable.paint(split, v, po(3500, true)).hash();
      expect(new Set([a, b, c]).size).toBeGreaterThanOrEqual(v === 'interior' ? 3 : 2);
    }
  });
});
