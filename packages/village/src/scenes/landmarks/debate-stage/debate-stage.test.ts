import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step } from '../../contract';
import { paintShot, po, runScript } from '../../testkit';
import { commonSuite } from '../a-suite';
import { debateStage, debateStageBundle } from './index';
import { lecternOf, votesOf } from './state';

const DB = 'council:debate';
const op = (member: string, text?: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId: DB,
  member,
  ...(text === undefined ? {} : { text }),
  ...(dissent ? { dissent } : {}),
});
const rank = (member: string, order?: string[]): VillageEvent => ({
  t: 'council.rank',
  councilId: DB,
  member,
  ...(order ? { order } : {}),
});
const ctx = DEFAULT_CTX;

const active = [
  { at: 0, event: op('pro', 'Short reviews win.') },
  { at: 0, event: op('con', 'Cram the night before.') },
  { at: 500, event: rank('pro', ['a', 'b', 'c']) },
];

commonSuite(debateStageBundle, op('pro', 'x'), { activeScript: active, defaultAccess: 'dim' });

describe('debate-stage mapEvent', () => {
  const s = debateStage.init();
  it('opinion unlocks, then the debater speaks from their lectern', () => {
    expect(debateStage.mapEvent(op('pro', ' Hello '), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'bubble', bubble: { who: 'pro', text: 'Hello', style: 'speech', order: 0 } },
    ]);
  });
  it('the second debater takes the right lectern', () => {
    const one = step(debateStage, s, op('pro', 'a'), ctx, 1);
    expect(one.debaters).toEqual(['pro']);
    expect(debateStage.mapEvent(op('con', 'b'), one, ctx)).toEqual([
      { c: 'bubble', bubble: { who: 'con', text: 'b', style: 'speech', order: 1 } },
    ]);
    expect(lecternOf(['pro', 'con'], 'con')).toBe(1);
    expect(lecternOf(['pro', 'con'], 'third')).toBeGreaterThanOrEqual(0);
  });
  it('dissent opinion is red-lined; missing text becomes an ellipsis', () => {
    const o = step(debateStage, s, op('pro', 'x'), ctx, 1);
    expect(debateStage.mapEvent(op('con', undefined, true), o, ctx)).toEqual([
      { c: 'bubble', bubble: { who: 'con', text: '...', style: 'dissent', order: 1 } },
    ]);
  });
  it('rank lights one lantern per ranked option', () => {
    const o = step(debateStage, s, op('pro', 'x'), ctx, 1);
    expect(debateStage.mapEvent(rank('pro', ['a', 'b']), o, ctx)).toEqual([
      { c: 'rank', by: 'pro', order: ['a', 'b'] },
    ]);
    const ranked = step(debateStage, o, rank('pro', ['a', 'b', 'c']), ctx, 2);
    expect(votesOf(ranked)).toBe(3);
    expect(
      votesOf(step(debateStage, o, rank('pro', Array(12).fill('x') as string[]), ctx, 2)),
    ).toBe(8);
    expect(votesOf(step(debateStage, o, rank('pro'), ctx, 2))).toBe(0);
  });
  it('verdict announces; a dissenter flickers the lanterns and keeps a red-lined bubble', () => {
    const v: VillageEvent = {
      t: 'council.verdict',
      councilId: DB,
      member: 'chair',
      text: 'Plan A',
    };
    let o = step(debateStage, s, op('con', 'x'), ctx, 1);
    expect(debateStage.mapEvent(v, o, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'Plan A' },
      { c: 'lantern', mode: 'steady' },
    ]);
    const split: VillageEvent = { ...v, dissent: true, dissenter: 'con' };
    expect(debateStage.mapEvent(split, o, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'Plan A', dissenter: 'con' },
      { c: 'lantern', mode: 'flicker' },
    ]);
    o = step(debateStage, o, split, ctx, 5);
    expect(o.bubbles.find((b) => b.who === 'con')?.style).toBe('dissent');
    expect(o.lantern).toBe('flicker');
  });
  it('a new run after a verdict starts clean', () => {
    const v = runScript(debateStage, [
      { at: 0, event: op('pro', 'x') },
      { at: 1, event: { t: 'council.verdict', councilId: DB, member: 'chair', text: 'done' } },
    ]);
    expect(debateStage.mapEvent(op('pro', 'again'), v, ctx).slice(0, 2)).toEqual([
      { c: 'clearBubbles' },
      { c: 'lantern', mode: 'off' },
    ]);
  });
  it('agent.state / call / message follow the landmark conventions', () => {
    const st: VillageEvent = { t: 'agent.state', agent: DB, state: 'waiting_for_student' };
    expect(debateStage.mapEvent(st, s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'setOccupant', state: 'waiting' },
      { c: 'setRing', on: true },
    ]);
    const cap: VillageEvent = { t: 'call.caption', agent: DB, callId: 'c', text: 'x'.repeat(100) };
    const cmds = debateStage.mapEvent(cap, s, ctx);
    const b = cmds.find((c) => c.c === 'bubble');
    expect(b && b.c === 'bubble' && b.bubble.text.length).toBe(90);
    expect(b && b.c === 'bubble' && b.bubble.style).toBe('caption');
    const msg: VillageEvent = {
      t: 'agent.message',
      from: DB,
      to: 'commons',
      taskId: 't',
      kind: 'option_dropped',
      shared: ['hotel'],
    };
    expect(debateStage.mapEvent(msg, s, ctx)).toContainEqual({
      c: 'bubble',
      bubble: { who: 'expert', text: 'Option dropped: hotel', style: 'speech' },
    });
  });
  it('another council does not belong here', () => {
    expect(
      debateStage.handles(
        { ...op('pro', 'x'), councilId: 'council:planner' } as VillageEvent,
        s,
        ctx,
      ),
    ).toBe(false);
  });
});

describe('debate-stage motion', () => {
  it('lanterns light with an 80 ms stagger (calm: all at once)', () => {
    const shot = { ...debateStageBundle.shots.find((x) => x.name === 'interior-vote')! };
    const a = paintShot(debateStage, shot, 2040).hash();
    const b = paintShot(debateStage, shot, 2400).hash();
    expect(a).not.toBe(b);
    const calmA = paintShot(debateStage, { ...shot, calm: true }, 2040).hash();
    const calmB = paintShot(debateStage, { ...shot, calm: true }, 2400).hash();
    expect(calmA).toBe(calmB);
  });
  it('more lanterns lit changes the frame in both views', () => {
    const base = runScript(debateStage, [{ at: 0, event: op('pro', 'x') }], 10);
    const one = step(debateStage, base, rank('pro', ['a']), ctx, 100);
    const four = step(debateStage, base, rank('pro', ['a', 'b', 'c', 'd']), ctx, 100);
    for (const v of ['exterior', 'interior'] as const) {
      expect(debateStage.paint(one, v, po(900, true)).hash()).not.toBe(
        debateStage.paint(four, v, po(900, true)).hash(),
      );
    }
  });
});
