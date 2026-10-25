import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { LIGHTS } from '../../pixel/raster';
import { DEFAULT_CTX } from '../../contract';
import { offPalette, paintShot, po, runScript } from '../../testkit';
import { oralHut as def, oralHutBundle } from './index';

const ctx = DEFAULT_CTX;
const A = 'expert:oral';
const state = (s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: A,
  state: s,
});
const open = { c: 'setAccess', access: 'open' } as const;
const t = (tt: number) => po(tt, false);

describe('oral hut mapEvent', () => {
  it('starts locked and the first relevant event opens it first', () => {
    const s = def.init();
    expect(s.access).toBe('locked');
    expect(def.mapEvent(state('studying'), s, ctx)).toEqual([
      open,
      { c: 'setOccupant', state: 'studying' },
      { c: 'setWindow', lit: true },
      { c: 'setRing', on: false },
    ]);
  });
  it('agent.state: idle clears the bubble, waiting rings the door and says so in plain words', () => {
    const s = { ...def.init(), access: 'open' as const };
    expect(def.mapEvent(state('idle'), s, ctx)).toEqual([
      { c: 'setOccupant', state: 'idle' },
      { c: 'setWindow', lit: false },
      { c: 'setRing', on: false },
      { c: 'clearBubble', who: 'expert' },
    ]);
    expect(def.mapEvent(state('waiting_for_student'), s, ctx)).toEqual([
      { c: 'setOccupant', state: 'waiting' },
      { c: 'setWindow', lit: true },
      { c: 'setRing', on: true },
      { c: 'bubble', bubble: { who: 'expert', text: 'Take the chair.', style: 'speech' } },
    ]);
  });
  it('both agent ids route here (expert:oral and expert:examiner)', () => {
    const s = def.init();
    const e: VillageEvent = { t: 'agent.state', agent: 'expert:examiner', state: 'in_call' };
    expect(def.handles(e, s, ctx)).toBe(true);
  });
  it('call.start / caption / end: portrait, clipped 90 char caption, then back to idle', () => {
    const s = { ...def.init(), access: 'open' as const };
    expect(def.mapEvent({ t: 'call.start', agent: A, callId: 'c' }, s, ctx)).toEqual([
      { c: 'setOccupant', state: 'in_call' },
      { c: 'setWindow', lit: true },
      { c: 'setRing', on: false },
      { c: 'portrait', on: true },
    ]);
    const long = 'x'.repeat(90);
    const cap = def.mapEvent({ t: 'call.caption', agent: A, callId: 'c', text: long }, s, ctx);
    expect(cap[0]).toEqual({ c: 'portrait', on: true });
    const b = cap[1] as { c: 'bubble'; bubble: { text: string; style: string } };
    expect(b.bubble.text.length).toBeLessThanOrEqual(90);
    expect(b.bubble.style).toBe('caption');
    expect(def.mapEvent({ t: 'call.end', agent: A, callId: 'c' }, s, ctx)).toEqual([
      { c: 'setOccupant', state: 'idle' },
      { c: 'setWindow', lit: false },
      { c: 'portrait', on: false },
      { c: 'clearBubble', who: 'expert' },
    ]);
  });
  it('an empty caption shows the portrait but no bubble', () => {
    const s = { ...def.init(), access: 'open' as const };
    expect(def.mapEvent({ t: 'call.caption', agent: A, callId: 'c', text: '  ' }, s, ctx)).toEqual([
      { c: 'portrait', on: true },
    ]);
  });
  it('agent.message: kind in plain words with shared labels only', () => {
    const s = { ...def.init(), access: 'open' as const };
    const e: VillageEvent = {
      t: 'agent.message',
      from: A,
      to: 'commons',
      taskId: 't',
      kind: 'conflict',
      shared: ['Tue 2 PM', 'Room'],
    };
    expect(def.mapEvent(e, s, ctx)).toEqual([
      {
        c: 'bubble',
        bubble: { who: 'expert', text: 'Conflict spotted: Tue 2 PM, Room', style: 'speech' },
      },
    ]);
  });
  it('ignores unrelated and malformed events without throwing', () => {
    const s = def.init();
    const other: VillageEvent[] = [
      { t: 'agent.state', agent: 'dean', state: 'idle' },
      { t: 'agent.state', agent: 'expert:ch5', state: 'studying' },
      { t: 'quiz.question', quizId: 'q', chapter: 'oral' },
      { t: 'quiz.result', quizId: 'oral:1', chapter: 'oral', correct: true },
      { t: 'council.opinion', councilId: 'council:quizkey', member: 'x', text: 'y' },
      { t: 'trip.confirmed', taskId: 't', squadId: 's' },
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'budget',
        shared: '$180 therapy',
      },
    ];
    for (const e of other) {
      expect(def.handles(e, s, ctx)).toBe(false);
      expect(def.mapEvent(e, s, ctx)).toEqual([]);
    }
    const bad = { t: 'call.caption', agent: A, callId: 'c' } as VillageEvent;
    expect(() => def.mapEvent(bad, s, ctx)).not.toThrow();
    expect(() =>
      def.mapEvent({ t: 'agent.message', from: A } as VillageEvent, s, ctx),
    ).not.toThrow();
  });
});

describe('oral hut painting', () => {
  it('is deterministic and state-sensitive in both views', () => {
    for (const view of ['exterior', 'interior'] as const) {
      const base = def.init();
      expect(def.paint(base, view, t(10)).hash()).toBe(def.paint(base, view, t(10)).hash());
      const dim = { ...base, access: 'dim' as const };
      const openIdle = { ...base, access: 'open' as const };
      const lit = runScript(def, [{ at: 0, event: state('studying') }]);
      const wait = runScript(def, [{ at: 0, event: state('waiting_for_student') }]);
      const talk = runScript(def, [
        { at: 0, event: { t: 'call.start', agent: A, callId: 'c' } },
        { at: 0, event: { t: 'call.caption', agent: A, callId: 'c', text: 'Begin.' } },
      ]);
      const hashes = new Set(
        [base, dim, openIdle, lit, wait, talk].map((s) => def.paint(s, view, t(500)).hash()),
      );
      expect(hashes.size).toBe(6);
    }
  });
  it('loops move: hourglass, smoke, stopwatch', () => {
    const lit = runScript(def, [{ at: 0, event: state('studying') }]);
    expect(def.paint(lit, 'interior', t(0)).hash()).not.toBe(
      def.paint(lit, 'interior', t(5000)).hash(),
    );
    expect(def.paint(lit, 'exterior', t(0)).hash()).not.toBe(
      def.paint(lit, 'exterior', t(1500)).hash(),
    );
  });
  it('calm mode freezes ambient loops', () => {
    const ringing = def.reduce(
      def.reduce(def.init(), { c: 'setAccess', access: 'open' }, 0),
      { c: 'setRing', on: true },
      0,
    );
    for (const sc of [def.init(), ringing]) {
      for (const view of ['exterior', 'interior'] as const) {
        expect(def.paint(sc, view, po(0, true)).hash()).toBe(
          def.paint(sc, view, po(1000, true)).hash(),
        );
      }
    }
  });
  it('base art is palette locked and describe is a sentence for every shot', () => {
    for (const shot of oralHutBundle.shots) {
      for (const at of shot.sample) {
        LIGHTS.on = false;
        const r = paintShot(oralHutBundle.def, shot, at);
        LIGHTS.on = true;
        expect(offPalette(r)).toBe(0);
      }
      const s = runScript(oralHutBundle.def, shot.script, Infinity, shot.ctx, {
        instance: shot.instance,
      });
      expect(def.describe(s).length).toBeGreaterThan(20);
    }
  });
  it('never paints or describes withheld text (sentinel)', () => {
    const e: VillageEvent = {
      t: 'agent.message',
      from: A,
      to: 'commons',
      taskId: 't',
      kind: 'query_denied',
      shared: ['$180', 'therapy'],
    };
    const s = runScript(def, [{ at: 0, event: e }]);
    // labels are shared text, so they are allowed; but raw ledger entries are not ours
    const ledger: VillageEvent = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's',
      field: 'budget',
      shared: '$180 therapy',
    };
    const s2 = runScript(def, [{ at: 0, event: ledger }]);
    expect(s2.bubbles).toEqual([]);
    expect(def.describe(s)).not.toMatch(/\$180|therapy/);
    expect(def.describe(s2)).not.toMatch(/\$180|therapy/);
  });
});
