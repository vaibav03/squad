import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step, type SceneBundle, type View } from '../contract';
import type { BaseState } from '../model/base';
import { offPalette, po, runScript, paintShot } from '../testkit';

export const SENTINELS = ['$180', 'therapy'];

/** Events that must never reach a landmark (not ours): they must leave state untouched. */
export const UNRELATED: VillageEvent[] = [
  { t: 'ledger.entry', taskId: 't', student: 's_ana', field: 'budget', shared: '$180' },
  { t: 'ledger.entry', taskId: 't', student: 's_ana', field: 'therapy', withheld: 'hidden' },
  { t: 'confirm.pending', student: 's_ana', taskId: 't', question: 'Book therapy for $180?' },
  { t: 'trip.confirmed', taskId: 't', squadId: 'sq' },
  { t: 'mastery.changed', student: 's_ana', chapter: 'ch1', box: 2 },
  { t: 'agent.state', agent: 'expert:ch1', state: 'studying' },
  { t: 'agent.state', agent: 's_ana', state: 'studying' },
  { t: 'call.start', agent: 'expert:oral', callId: 'x' },
  { t: 'council.opinion', councilId: 'council:quizkey', member: 'solver-a', text: 'B' },
];

const MALFORMED = [
  {},
  { t: 'agent.state' },
  { t: 'council.opinion' },
  { t: 'call.caption', agent: null },
  { t: 'agent.message', from: 5, shared: 'no' },
  null,
] as unknown as VillageEvent[];

const VIEW_LIST: readonly View[] = ['exterior', 'interior'];

/** The checks every landmark must pass (docs/village-scenes.md 'Required tests'). */
export function commonSuite<S extends BaseState>(
  bundle: SceneBundle<S>,
  ours: VillageEvent,
  more: { activeScript: ReadonlyArray<{ at: number; event: VillageEvent }>; defaultAccess: string },
): void {
  const def = bundle.def;
  describe(`${def.id}: contract`, () => {
    it('has a landmark def with sane anchors', () => {
      expect(def.kind).toBe('landmark');
      expect(def.door.y).toBe(def.exterior.h - 1);
      expect(def.entry.x).toBeLessThan(def.interior.w);
      expect(def.entry.y).toBeLessThan(def.interior.h);
      expect(def.init().access).toBe(more.defaultAccess);
    });

    it('init honours the locked/dim/open capture hook', () => {
      expect(def.init({ instance: 'locked' }).access).toBe('locked');
      expect(def.init({ instance: 'open' }).access).toBe('open');
    });

    it('ignores unrelated events', () => {
      const s = def.init();
      for (const e of UNRELATED) {
        expect(def.handles(e, s, DEFAULT_CTX)).toBe(false);
        expect(def.mapEvent(e, s, DEFAULT_CTX)).toEqual([]);
        expect(step(def, s, e, DEFAULT_CTX, 5)).toBe(s);
      }
    });

    it('never throws on malformed events', () => {
      const s = def.init();
      for (const e of MALFORMED) {
        expect(() => {
          def.handles(e, s, DEFAULT_CTX);
          def.mapEvent(e, s, DEFAULT_CTX);
        }).not.toThrow();
      }
    });

    it('the first relevant event unlocks the building first', () => {
      const s = def.init({ instance: 'locked' });
      const cmds = def.mapEvent(ours, s, DEFAULT_CTX);
      expect(cmds[0]).toEqual({ c: 'setAccess', access: 'open' });
      const after = step(def, s, ours, DEFAULT_CTX, 10);
      expect(after.access).toBe('open');
    });
  });

  describe(`${def.id}: painting`, () => {
    it('paints deterministic frames of the declared sizes', () => {
      for (const shot of bundle.shots) {
        const t = shot.sample[0]!;
        const a = paintShot(def, shot, t);
        const b = paintShot(def, shot, t);
        expect(a.hash()).toBe(b.hash());
        const size = shot.view === 'exterior' ? def.exterior : def.interior;
        expect([a.w, a.h]).toEqual([size.w, size.h]);
      }
    });

    it('locked, dim and open frames all differ in both views', () => {
      for (const v of VIEW_LIST) {
        const hashes = new Set(
          (['locked', 'dim', 'open'] as const).map((a) =>
            def.paint({ ...def.init(), access: a }, v, po(0, false)).hash(),
          ),
        );
        expect(hashes.size).toBe(3);
      }
    });

    it('an active scene differs from an idle one in both views', () => {
      for (const v of VIEW_LIST) {
        const idle = def.paint(def.init({ instance: 'open' }), v, po(1000, false));
        const live = def.paint(
          runScript(def, more.activeScript, 1000, { hour: 14 }),
          v,
          po(1000, false),
        );
        expect(live.hash()).not.toBe(idle.hash());
      }
    });

    it('describe is a non-empty sentence in every state', () => {
      for (const a of ['locked', 'dim', 'open'] as const) {
        const d = def.describe({ ...def.init(), access: a });
        expect(d.length).toBeGreaterThan(10);
        expect(d.endsWith('.')).toBe(true);
      }
    });

    it('calm frames are identical at t=0 and t=1000 (ambient loops frozen)', () => {
      for (const v of VIEW_LIST) {
        const s = { ...def.init(), access: 'open' as const };
        const a = def.paint(s, v, po(0, true));
        const b = def.paint(s, v, po(1000, true));
        expect(a.hash()).toBe(b.hash());
      }
    });

    it('calm frames mid-sequence are steady while bubbles are held', () => {
      for (const v of VIEW_LIST) {
        const s = runScript(def, more.activeScript, 3000, { hour: 14 });
        const a = def.paint(s, v, po(3200, true));
        const b = def.paint(s, v, po(3900, true));
        expect(a.hash()).toBe(b.hash());
      }
    });

    it('base art of a dim, unlit building is palette-locked', () => {
      const s = { ...def.init(), access: 'dim' as const, night: false };
      for (const v of VIEW_LIST) {
        expect(offPalette(def.paint(s, v, po(0, true)))).toBe(0);
      }
    });
  });

  describe(`${def.id}: privacy`, () => {
    it('sentinels never reach state, bubbles or describe', () => {
      const s = runScript(def, [
        ...UNRELATED.map((event, i) => ({ at: i, event })),
        { at: 20, event: ours },
      ]);
      const blob = JSON.stringify(s) + def.describe(s);
      for (const sentinel of SENTINELS) expect(blob).not.toContain(sentinel);
    });
  });
}
