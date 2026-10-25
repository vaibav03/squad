import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step, type SceneCtx } from '../contract';
import { offPalette, paintShot, runScript } from '../testkit';
import { paintChapterExterior } from '../art/chapter-house-exterior';
import { paintChapterInterior } from '../art/chapter-house-interior';
import { styleFor } from '../art/chapter-house-kit';
import { bundles, chapterHouse as def, chapterHouseBundle } from './index';
import { clampLevel } from './map';

const ctx = (o: Partial<SceneCtx> = {}): SceneCtx => ({ ...DEFAULT_CTX, ...o });
const init = (instance = 'ch5', title = 'Chapter 5') => def.init({ instance, title });
const st = (
  state: 'idle' | 'studying' | 'in_call' | 'waiting_for_student',
  ch = 'ch5',
): VillageEvent => ({
  t: 'agent.state',
  agent: `expert:${ch}`,
  state,
});
const OPEN = { c: 'setAccess', access: 'open' } as const;

describe('chapter house mapEvent', () => {
  const s0 = init();
  it('agent.state', () => {
    expect(def.mapEvent(st('studying'), s0, ctx())).toEqual([
      OPEN,
      { c: 'setOccupant', state: 'studying' },
      { c: 'setWindow', lit: true },
      { c: 'setRing', on: false },
      { c: 'portrait', on: false },
    ]);
    expect(def.mapEvent(st('idle'), s0, ctx())).toEqual([
      OPEN,
      { c: 'setOccupant', state: 'idle' },
      { c: 'setWindow', lit: false },
      { c: 'setRing', on: false },
      { c: 'portrait', on: false },
    ]);
    expect(def.mapEvent(st('in_call'), s0, ctx())).toContainEqual({ c: 'portrait', on: true });
    const w = def.mapEvent(st('waiting_for_student'), s0, ctx());
    expect(w).toContainEqual({ c: 'setRing', on: true });
    expect(w).toContainEqual({ c: 'setOccupant', state: 'waiting' });
  });
  it('setAccess open only until open', () => {
    const o = step(def, s0, st('studying'), ctx(), 0);
    expect(def.mapEvent(st('idle'), o, ctx())[0]).toEqual({ c: 'setOccupant', state: 'idle' });
  });
  it('call.start / caption / end', () => {
    const text = 'x'.repeat(100);
    expect(def.mapEvent({ t: 'call.start', agent: 'expert:ch5', callId: 'c' }, s0, ctx())).toEqual([
      OPEN,
      { c: 'setOccupant', state: 'in_call' },
      { c: 'setWindow', lit: true },
      { c: 'setRing', on: false },
    ]);
    const cap = def.mapEvent(
      { t: 'call.caption', agent: 'expert:ch5', callId: 'c', text },
      s0,
      ctx(),
    );
    const b = cap.find((c) => c.c === 'bubble');
    expect(b).toMatchObject({ bubble: { who: 'expert', style: 'caption' } });
    expect((b as { bubble: { text: string } }).bubble.text.length).toBeLessThanOrEqual(60);
    expect(cap).toContainEqual({ c: 'portrait', on: true });
    expect(def.mapEvent({ t: 'call.end', agent: 'expert:ch5', callId: 'c' }, s0, ctx())).toEqual([
      OPEN,
      { c: 'clearBubble', who: 'expert' },
      { c: 'portrait', on: false },
      { c: 'setOccupant', state: 'idle' },
    ]);
  });
  const q = (
    t: 'quiz.question' | 'quiz.answer' | 'quiz.result',
    correct?: boolean,
  ): VillageEvent => ({
    t,
    quizId: 'q',
    chapter: 'ch5',
    ...(correct === undefined ? {} : { correct }),
  });
  it('quiz.*', () => {
    expect(def.mapEvent(q('quiz.question'), s0, ctx())).toEqual([
      OPEN,
      { c: 'chalk', text: 'Chapter 5', mark: 'none' },
      { c: 'setOccupant', state: 'studying' },
    ]);
    expect(def.mapEvent(q('quiz.answer'), s0, ctx())).toEqual([
      OPEN,
      { c: 'chalk', text: 'Chapter 5', mark: 'none' },
    ]);
    const mark = (c?: boolean) =>
      (
        def.mapEvent(q('quiz.result', c), s0, ctx()).find((x) => x.c === 'chalk') as {
          mark: string;
        }
      ).mark;
    expect(mark(true)).toBe('tick');
    expect(mark(false)).toBe('cross');
    expect(mark(undefined)).toBe('none');
  });
  it('mastery.changed is owner only and clamps', () => {
    const m = (student: string, box: number): VillageEvent => ({
      t: 'mastery.changed',
      student,
      chapter: 'ch5',
      box,
    });
    expect(def.mapEvent(m('s_ana', 3), s0, ctx())).toEqual([OPEN, { c: 'setGlow', level: 0.6 }]);
    expect(def.mapEvent(m('s_bo', 3), s0, ctx())).toEqual([]);
    expect(def.mapEvent(m('s_ana', 9), s0, ctx())).toContainEqual({ c: 'setGlow', level: 1 });
    expect(def.mapEvent(m('s_ana', -2), s0, ctx())).toContainEqual({ c: 'setGlow', level: 0 });
    expect(def.mapEvent(m('s_ana', 4), s0, ctx({ squadSize: 2 }))).toContainEqual({
      c: 'setGlow',
      level: 0.8,
    });
    expect(clampLevel(Number.NaN)).toBe(0);
  });
  it('agent.message from the expert shows plain words, never shared', () => {
    const e: VillageEvent = {
      t: 'agent.message',
      from: 'expert:ch5',
      to: 'commons',
      taskId: 't',
      kind: 'conflict',
      shared: ['$180', 'therapy'],
    };
    const cmds = def.mapEvent(e, s0, ctx());
    expect(cmds).toContainEqual({
      c: 'bubble',
      bubble: { who: 'expert', text: 'Two views disagree', style: 'speech' },
    });
    expect(JSON.stringify(cmds)).not.toMatch(/180|therapy/);
  });
  it('handles only this chapter instance', () => {
    expect(def.handles(st('idle', 'ch5'), s0, ctx())).toBe(true);
    expect(def.handles(st('idle', 'ch6'), s0, ctx())).toBe(false);
    expect(
      def.handles(
        { t: 'agent.state', agent: 'expert:feynman', state: 'idle' },
        init('feynman'),
        ctx(),
      ),
    ).toBe(false);
    expect(
      def.handles({ t: 'agent.state', agent: 'council:planner', state: 'idle' }, s0, ctx()),
    ).toBe(false);
    expect(
      def.handles({ t: 'mastery.changed', student: 's_ana', chapter: 'ch6', box: 1 }, s0, ctx()),
    ).toBe(false);
    expect(def.handles({ t: 'quiz.result', quizId: 'q', chapter: 'ch5' }, s0, ctx())).toBe(true);
    expect(def.handles({ t: 'ledger.entry' } as unknown as VillageEvent, s0, ctx())).toBe(false);
  });
  it('ignores unrelated and malformed events without throwing', () => {
    expect(def.mapEvent({ t: 'trip.confirmed' } as unknown as VillageEvent, s0, ctx())).toEqual([]);
    expect(def.mapEvent({} as unknown as VillageEvent, s0, ctx())).toEqual([]);
    expect(def.mapEvent(null as unknown as VillageEvent, s0, ctx())).toEqual([]);
    expect(
      def.mapEvent({ t: 'call.caption', agent: 'expert:ch5', callId: 'c' }, s0, ctx()),
    ).toEqual([OPEN, { c: 'portrait', on: true }]);
  });
});

const script = (events: VillageEvent[]) => events.map((event, i) => ({ at: i * 10, event }));
const run = (events: VillageEvent[], init_ = { instance: 'ch5', title: 'Chapter 5' }) =>
  runScript(def, script(events), Infinity, {}, init_);
const mast = (box: number): VillageEvent => ({
  t: 'mastery.changed',
  student: 's_ana',
  chapter: 'ch5',
  box,
});

describe('chapter house paint', () => {
  const o = { t: 2000, calm: false };
  it('is deterministic and state-sensitive in both views', () => {
    const dim = init();
    const lit = run([st('studying')]);
    const low = run([st('studying'), mast(1)]);
    const high = run([st('studying'), mast(5)]);
    const lockedS = { ...dim, access: 'locked' as const };
    for (const view of ['exterior', 'interior'] as const) {
      const h = (s: typeof dim) => def.paint(s, view, o).hash();
      expect(h(lit)).toBe(h(lit));
      expect(h(dim)).not.toBe(h(lit));
      expect(h(low)).not.toBe(h(high));
      expect(h(lockedS)).not.toBe(h(dim));
    }
    const withBubble = run([
      st('in_call'),
      { t: 'call.caption', agent: 'expert:ch5', callId: 'c', text: 'hello there' },
    ]);
    const noBubble = run([st('in_call')]);
    for (const view of ['exterior', 'interior'] as const) void view;
    expect(def.paint(withBubble, 'interior', { t: 600, calm: false }).hash()).not.toBe(
      def.paint(noBubble, 'interior', { t: 600, calm: false }).hash(),
    );
    const tick = run([{ t: 'quiz.result', quizId: 'q', chapter: 'ch5', correct: true }]);
    const cross = run([{ t: 'quiz.result', quizId: 'q', chapter: 'ch5', correct: false }]);
    expect(def.paint(tick, 'interior', o).hash()).not.toBe(def.paint(cross, 'interior', o).hash());
  });
  it('exterior window flickers only when awake; typing animates at 8 fps', () => {
    const idle = run([st('idle')]);
    const study = run([st('studying')]);
    expect(def.paint(study, 'exterior', { t: 0, calm: false }).hash()).not.toBe(
      def.paint(study, 'exterior', { t: 2000, calm: false }).hash(),
    );
    expect(def.paint(study, 'interior', { t: 0, calm: false }).hash()).not.toBe(
      def.paint(study, 'interior', { t: 130, calm: false }).hash(),
    );
    expect(def.paint(idle, 'interior', { t: 0, calm: false }).hash()).not.toBe(
      def.paint(idle, 'interior', { t: 500, calm: false }).hash(),
    );
  });
  it('base art is palette-locked in every state', () => {
    const states = [
      init(),
      { ...init(), access: 'locked' as const },
      run([st('studying'), mast(4)]),
      run([st('waiting_for_student')]),
      run([st('in_call')]),
    ];
    for (const s of states) {
      expect(offPalette(paintChapterExterior(s, o, false))).toBe(0);
      expect(offPalette(paintChapterInterior(s, o, false))).toBe(0);
    }
  });
  it('sizes and distinct chapters', () => {
    expect(def.paint(init(), 'exterior', o).w).toBe(def.exterior.w);
    expect(def.paint(init(), 'interior', o).h).toBe(def.interior.h);
    const hashes = new Set(
      ['ch1', 'ch2', 'ch3', 'ch4'].map((c) =>
        def.paint(def.init({ instance: c, title: 'Chapter' }), 'exterior', o).hash(),
      ),
    );
    expect(hashes.size).toBe(4);
    expect(
      new Set(['ch1', 'ch2', 'ch3', 'ch4'].map((c) => JSON.stringify(styleFor(c).npc))).size,
    ).toBe(4);
  });
  it('never leaks a withheld sentinel into paint or describe', () => {
    const s = run([
      st('studying'),
      {
        t: 'agent.message',
        from: 'expert:ch5',
        to: 'commons',
        taskId: 't',
        kind: 'query_denied',
        shared: ['$180', 'therapy'],
      },
      { t: 'ledger.entry', taskId: 't', note: '$180 therapy' } as unknown as VillageEvent,
    ]);
    expect(JSON.stringify(s)).not.toMatch(/180|therapy/);
    expect(def.describe(s)).not.toMatch(/180|therapy/);
    const same = run([
      st('studying'),
      {
        t: 'agent.message',
        from: 'expert:ch5',
        to: 'commons',
        taskId: 't',
        kind: 'query_denied',
        shared: ['zzz'],
      },
    ]);
    expect(def.paint(s, 'interior', { t: 300, calm: false }).hash()).toBe(
      def.paint(same, 'interior', { t: 300, calm: false }).hash(),
    );
  });
  it('describe is a plain sentence per state and never a number', () => {
    const texts = [
      init(),
      { ...init(), access: 'locked' as const },
      run([st('studying'), mast(3)]),
      run([st('in_call'), mast(5)]),
      run([st('waiting_for_student')]),
      run([st('idle')]),
    ].map((s) => def.describe(s));
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(10);
      expect(t).toMatch(/Chapter 5 house/);
    }
    expect(def.describe(run([st('studying'), mast(3)]))).toBe(
      'Chapter 5 house, expert is studying, mastery growing.',
    );
    expect(new Set(texts).size).toBeGreaterThan(4);
  });
  it('calm paint is steady for ambient loops', () => {
    const s = run([
      st('studying'),
      mast(5),
      { t: 'agent.state', agent: 'expert:ch5', state: 'waiting_for_student' },
    ]);
    for (const view of ['exterior', 'interior'] as const) {
      expect(def.paint(s, view, { t: 0, calm: true }).hash()).toBe(
        def.paint(s, view, { t: 1000, calm: true }).hash(),
      );
    }
  });
  it('glow tweens over 600 ms', () => {
    const s = run([st('studying'), mast(5)]);
    const mid = def.paint(s, 'exterior', { t: 10 + 100, calm: false }).hash();
    const end = def.paint(s, 'exterior', { t: 10 + 700, calm: false }).hash();
    expect(mid).not.toBe(end);
  });
  it('bundles paint every shot', () => {
    expect(chapterHouseBundle.shots.length).toBeGreaterThan(8);
    for (const b of bundles) {
      for (const shot of b.shots) {
        for (const t of shot.sample) expect(paintShot(b.def, shot, t).w).toBeGreaterThan(0);
      }
    }
  });
});
