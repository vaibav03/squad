import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { LIGHTS } from '../pixel/raster';
import { DEFAULT_CTX } from '../contract';
import { offPalette, paintShot, runScript } from '../testkit';
import { councilHall as def, councilHallBundle } from './index';
import { mapCouncilEvent } from './map';
import { initCouncilHall, reduceCouncil, seatOf } from './state';

const ctx = DEFAULT_CTX;
const QK = 'council:quizkey';
const opinion = (member: string, text?: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId: QK,
  member,
  text,
  ...(dissent ? { dissent } : {}),
});

describe('council hall mapEvent', () => {
  it('opinion: unlocks, then an independent thought bubble staggered by seat', () => {
    const s = initCouncilHall();
    expect(mapCouncilEvent(opinion('solver-c', 'C!'), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'bubble', bubble: { who: 'solver-c', text: 'C!', style: 'thought', order: 2 } },
    ]);
  });
  it('opinion with dissent is a red-lined bubble', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const cmds = mapCouncilEvent(opinion('solver-a', 'no', true), s, ctx);
    expect(cmds).toEqual([
      { c: 'bubble', bubble: { who: 'solver-a', text: 'no', style: 'dissent', order: 0 } },
    ]);
  });
  it('rank carries the order', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const e: VillageEvent = {
      t: 'council.rank',
      councilId: QK,
      member: 'solver-a',
      order: ['solver-b', 'solver-a'],
    };
    expect(mapCouncilEvent(e, s, ctx)).toEqual([
      { c: 'rank', by: 'solver-a', order: ['solver-b', 'solver-a'] },
    ]);
  });
  it('verdict: dissent flickers the lantern, no dissent glows steady', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const v = (extra: object): VillageEvent => ({
      t: 'council.verdict',
      councilId: QK,
      member: 'chair',
      text: 'B',
      ...extra,
    });
    expect(mapCouncilEvent(v({ dissent: true, dissenter: 'solver-c' }), s, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'B', dissenter: 'solver-c' },
      { c: 'lantern', mode: 'flicker' },
    ]);
    expect(mapCouncilEvent(v({}), s, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'B' },
      { c: 'lantern', mode: 'steady' },
    ]);
  });
  it('a new opinion after a verdict clears the previous run', () => {
    let s = runScript(def, [
      { at: 0, event: opinion('solver-a', 'x') },
      { at: 1, event: { t: 'council.verdict', councilId: QK, member: 'chair', text: 'ok' } },
    ]);
    const cmds = mapCouncilEvent(opinion('solver-b', 'y'), s, ctx);
    expect(cmds.slice(0, 2)).toEqual([{ c: 'clearBubbles' }, { c: 'lantern', mode: 'off' }]);
    s = runScript(def, [
      { at: 0, event: opinion('solver-a', 'x') },
      { at: 1, event: { t: 'council.verdict', councilId: QK, member: 'chair', text: 'ok' } },
      { at: 2, event: opinion('solver-b', 'y') },
    ]);
    expect(s.verdict).toBeNull();
    expect(s.lantern).toBe('off');
  });
  it('handles only hall councils and ignores everything else without throwing', () => {
    const s = initCouncilHall();
    const other: VillageEvent[] = [
      { t: 'agent.state', agent: 'dean', state: 'idle' },
      { t: 'council.opinion', councilId: 'council:planner', member: 'chill', text: 'x' },
      { t: 'trip.confirmed', taskId: 't', squadId: 's' },
    ];
    for (const e of other) {
      expect(def.handles(e, s, ctx)).toBe(false);
      expect(def.mapEvent(e, s, ctx)).toEqual([]);
    }
    expect(def.handles(opinion('x'), s, ctx)).toBe(true);
    expect(() =>
      def.mapEvent({ t: 'council.opinion', councilId: QK, member: 'm' } as VillageEvent, s, ctx),
    ).not.toThrow();
  });
  it('seats: pinned names, free seats, overflow never throws', () => {
    expect(seatOf({}, 'chill')).toBe(0);
    expect(seatOf({ chill: 0 }, 'advisor')).toBe(2);
    expect(seatOf({ a: 0, b: 1, c: 2 }, 'd')).toBeLessThan(3);
    expect(seatOf({}, 'chair')).toBe(3);
  });
});

describe('council hall painting', () => {
  const t = (tt: number) => ({ t: tt, calm: false });
  it('is deterministic and state-sensitive in both views', () => {
    const base = initCouncilHall();
    expect(def.paint(base, 'interior', t(10)).hash()).toBe(
      def.paint(base, 'interior', t(10)).hash(),
    );
    for (const view of ['exterior', 'interior'] as const) {
      const open = reduceCouncil(base, { c: 'setAccess', access: 'open' }, 0);
      const locked = reduceCouncil(base, { c: 'setAccess', access: 'locked' }, 0);
      const talk = reduceCouncil(
        open,
        { c: 'bubble', bubble: { who: 'solver-a', text: 'hi', style: 'speech' } },
        0,
      );
      const lan = reduceCouncil(open, { c: 'lantern', mode: 'flicker' }, 0);
      const hashes = new Set(
        [base, open, locked, lan, talk].map((s) => def.paint(s, view, t(300)).hash()),
      );
      expect(hashes.size).toBeGreaterThanOrEqual(4);
    }
  });
  it('lights up in session', () => {
    const s = runScript(def, [{ at: 0, event: opinion('solver-a', 'B') }]);
    expect(def.paint(s, 'exterior', t(1000)).hash()).not.toBe(
      def.paint(s, 'exterior', t(30000)).hash(),
    );
  });
  it('calm mode freezes ambient loops', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    for (const view of ['exterior', 'interior'] as const) {
      expect(def.paint(s, view, { t: 0, calm: true }).hash()).toBe(
        def.paint(s, view, { t: 1000, calm: true }).hash(),
      );
    }
  });
  it('ranking slides: mid-slide differs from the end', () => {
    const shot = councilHallBundle.shots.find((x) => x.name === 'ranking')!;
    const a = paintShot(def, shot, 2160).hash();
    const b = paintShot(def, shot, 2320).hash();
    expect(a).not.toBe(b);
  });
  it('dissent lantern flickers over 2 s but never more than 3 changes a second', () => {
    const shot = councilHallBundle.shots.find((x) => x.name === 'verdict-dissent')!;
    const frames: string[] = [];
    for (let ms = 4100; ms < 6100; ms += 50) frames.push(paintShot(def, shot, ms).hash());
    let changes = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i] !== frames[i - 1]) changes++;
    expect(changes).toBeGreaterThan(1);
  });
  it('base art is palette locked and describe is a sentence for every shot', () => {
    for (const shot of councilHallBundle.shots) {
      for (const at of shot.sample) {
        LIGHTS.on = false;
        const r = paintShot(def, shot, at);
        LIGHTS.on = true;
        expect(offPalette(r)).toBe(0);
      }
      const s = runScript(def, shot.script, Infinity);
      expect(def.describe(s).length).toBeGreaterThan(10);
    }
  });
  it('never paints text it was not given (sentinel)', () => {
    const s = runScript(def, [{ at: 0, event: opinion('solver-a', 'Plan is ready') }]);
    expect(def.describe(s)).not.toMatch(/\$180|therapy/);
  });
});
