import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, type SceneBundle, type SceneDef } from '../contract';
import { LIGHTS } from '../pixel/raster';
import { offPalette, paintShot, po, runScript } from '../testkit';
import type { LbState } from '../art/landmark-b-kit';

const ctx = DEFAULT_CTX;
const open = { c: 'setAccess', access: 'open' } as const;

/** The tests every landmark-b scene must pass (docs/village-scenes.md 'Required tests'). */
export function landmarkSuite(
  name: string,
  def: SceneDef<LbState>,
  bundle: SceneBundle<LbState>,
  agent: string,
  waitingWords: string,
  /** Events that look like the building's quiz but must NOT be handled. */
  decoyQuiz: VillageEvent[],
): void {
  const state = (s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
    t: 'agent.state',
    agent,
    state: s,
  });
  const t = (tt: number) => po(tt, false);

  describe(`${name} mapEvent`, () => {
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
    it('agent.state: idle clears the bubble, waiting rings the door in plain words', () => {
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
        { c: 'bubble', bubble: { who: 'expert', text: waitingWords, style: 'speech' } },
      ]);
    });
    it('call.start / caption / end: portrait, clipped 90 char caption, back to idle', () => {
      const s = { ...def.init(), access: 'open' as const };
      expect(def.mapEvent({ t: 'call.start', agent, callId: 'c' }, s, ctx)).toEqual([
        { c: 'setOccupant', state: 'in_call' },
        { c: 'setWindow', lit: true },
        { c: 'setRing', on: false },
        { c: 'portrait', on: true },
      ]);
      const cap = def.mapEvent(
        { t: 'call.caption', agent, callId: 'c', text: 'y'.repeat(90) },
        s,
        ctx,
      );
      expect(cap[0]).toEqual({ c: 'portrait', on: true });
      const b = cap[1] as { c: 'bubble'; bubble: { text: string; style: string } };
      expect(b.bubble.text.length).toBeLessThanOrEqual(90);
      expect(b.bubble.style).toBe('caption');
      expect(def.mapEvent({ t: 'call.caption', agent, callId: 'c', text: ' ' }, s, ctx)).toEqual([
        { c: 'portrait', on: true },
      ]);
      expect(def.mapEvent({ t: 'call.end', agent, callId: 'c' }, s, ctx)).toEqual([
        { c: 'setOccupant', state: 'idle' },
        { c: 'setWindow', lit: false },
        { c: 'portrait', on: false },
        { c: 'clearBubble', who: 'expert' },
      ]);
    });
    it('agent.message: kind in plain words with shared labels only', () => {
      const s = { ...def.init(), access: 'open' as const };
      const e: VillageEvent = {
        t: 'agent.message',
        from: agent,
        to: 'commons',
        taskId: 't',
        kind: 'option_dropped',
        shared: ['Room 4', 'Tue'],
      };
      expect(def.mapEvent(e, s, ctx)).toEqual([
        {
          c: 'bubble',
          bubble: { who: 'expert', text: 'Option dropped: Room 4, Tue', style: 'speech' },
        },
      ]);
    });
    it('ignores unrelated, decoy quiz and malformed events without throwing', () => {
      const s = def.init();
      const other: VillageEvent[] = [
        { t: 'agent.state', agent: 'dean', state: 'idle' },
        { t: 'agent.state', agent: 'expert:ch5', state: 'studying' },
        { t: 'quiz.answer', quizId: 'q', chapter: 'ch5' },
        { t: 'council.opinion', councilId: 'council:quizkey', member: 'x', text: 'y' },
        { t: 'trip.confirmed', taskId: 't', squadId: 's' },
        { t: 'ledger.entry', taskId: 't', student: 's', field: 'budget', shared: '$180 therapy' },
        ...decoyQuiz,
      ];
      for (const e of other) {
        expect(def.handles(e, s, ctx)).toBe(false);
        expect(def.mapEvent(e, s, ctx)).toEqual([]);
      }
      expect(() =>
        def.mapEvent({ t: 'call.caption', agent, callId: 'c' } as VillageEvent, s, ctx),
      ).not.toThrow();
      expect(() =>
        def.mapEvent({ t: 'agent.message', from: agent } as VillageEvent, s, ctx),
      ).not.toThrow();
    });
  });

  describe(`${name} painting`, () => {
    it('is deterministic and state-sensitive in both views', () => {
      for (const view of ['exterior', 'interior'] as const) {
        const base = def.init();
        expect(def.paint(base, view, t(10)).hash()).toBe(def.paint(base, view, t(10)).hash());
        const dim = { ...base, access: 'dim' as const };
        const idle = { ...base, access: 'open' as const };
        const lit = runScript(def, [{ at: 0, event: state('studying') }]);
        const wait = runScript(def, [{ at: 0, event: state('waiting_for_student') }]);
        const talk = runScript(def, [
          { at: 0, event: { t: 'call.start', agent, callId: 'c' } },
          { at: 0, event: { t: 'call.caption', agent, callId: 'c', text: 'Begin.' } },
        ]);
        const hashes = new Set(
          [base, dim, idle, lit, wait, talk].map((s) => def.paint(s, view, t(500)).hash()),
        );
        expect(hashes.size).toBe(6);
      }
    });
    it('calm mode freezes ambient loops', () => {
      const ringing = def.reduce(def.reduce(def.init(), open, 0), { c: 'setRing', on: true }, 0);
      for (const sc of [def.init(), ringing]) {
        for (const view of ['exterior', 'interior'] as const) {
          expect(def.paint(sc, view, po(0, true)).hash()).toBe(
            def.paint(sc, view, po(1000, true)).hash(),
          );
        }
      }
    });
    it('exterior size matches the SceneDef and the door sits on the bottom row', () => {
      const r = def.paint(def.init(), 'exterior', t(0));
      expect([r.w, r.h]).toEqual([def.exterior.w, def.exterior.h]);
      expect(def.door.y).toBe(def.exterior.h - 1);
      const i = def.paint(def.init(), 'interior', t(0));
      expect([i.w, i.h]).toEqual([def.interior.w, def.interior.h]);
    });
    it('base art is palette locked and describe is a sentence for every shot', () => {
      for (const shot of bundle.shots) {
        for (const at of shot.sample) {
          LIGHTS.on = false;
          const r = paintShot(bundle.def, shot, at);
          LIGHTS.on = true;
          expect(offPalette(r)).toBe(0);
        }
        const s = runScript(bundle.def, shot.script, Infinity, shot.ctx, {
          instance: shot.instance,
        });
        expect(def.describe(s).length).toBeGreaterThan(20);
      }
    });
    it('never paints or describes withheld text (sentinel)', () => {
      const ledger: VillageEvent = {
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'budget',
        shared: '$180 therapy',
      };
      const s = runScript(def, [{ at: 0, event: ledger }]);
      expect(s.bubbles).toEqual([]);
      expect(s.access).toBe('locked');
      expect(def.describe(s)).not.toMatch(/\$180|therapy/);
    });
  });
}
