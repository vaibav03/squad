// Merge-batch-2 village-room check: for each of the 13 placed rooms, replay the events its REAL skill
// recorded (docs/design/shots/merge2/events/<slot>.json: quiz engine, council:quizkey, course-planning
// round table, debate, Devil's TA, Feynman, step-diff, Exam Oracle, Rubric Courthouse, Oral Exam Hut)
// and assert the room routes them, paints them (differs from the idle building, interior and exterior)
// and, where the skill speaks, that the room's transcript and outcome render in the room session.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VillageEventSchema, type VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step, type SceneDef } from './contract';
import { eventChapter, eventScene } from './model/events';
import { routeAgent, routeCouncil } from './routing';
import { PLACEMENTS } from './registry';
import { createRoomSession, wordsOf } from './roomSession';
import { opaqueCount, po } from './testkit';

const dir = resolve(import.meta.dirname, '../../../../docs/design/shots/merge2/events');
/** The skill scripts name their dumps by skill, not by slot. */
const FILE: Record<string, string> = {
  'debate-stage': 'debate',
  'devils-ta': 'devil',
  'feynman-porch': 'feynman',
  'panic-booth': 'stepdiff',
};
const load = (slot: string): VillageEvent[] =>
  JSON.parse(readFileSync(resolve(dir, `${FILE[slot] ?? slot}.json`), 'utf8')) as VillageEvent[];

/** Rooms whose skill emits spoken words (transcript expected). Feynman/step-diff emit animation only. */
const SILENT = new Set(['feynman-porch', 'panic-booth']);
/** Rooms whose recorded events must carry a RoomOutcome in a council verdict. */
const OUTCOME = new Set(['exam-oracle', 'rubric-courthouse', 'debate-stage', 'round-table']);

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe('merged routing keeps both rooms branches', () => {
  it.each([
    ['council:debate', 'debate-stage'],
    ['council:oracle', 'exam-oracle'],
    ['council:rubric', 'rubric-courthouse'],
    ['council:planner', 'round-table'],
    ['council:quizkey', 'council-hall'],
  ])('%s routes to %s', (id, scene) => expect(routeCouncil(id)).toBe(scene));
  it.each([
    ['expert:devil', 'devils-ta'],
    ['expert:feynman', 'feynman-porch'],
    ['expert:stepdiff', 'panic-booth'],
    ['expert:oracle', 'exam-oracle'],
    ['expert:rubric', 'rubric-courthouse'],
    ['expert:oral', 'oral-hut'],
    ['expert:ch2', 'chapter-house'],
  ])('%s routes to %s', (id, scene) => expect(routeAgent(id)).toBe(scene));
});

describe('13 rooms render their own skill events', () => {
  it('covers all 13 placements', () => {
    expect(PLACEMENTS).toHaveLength(13);
  });

  for (const p of PLACEMENTS) {
    describe(p.slotId, () => {
      const events = load(p.slotId);
      const def = p.def as unknown as SceneDef<unknown>;
      const instance = p.chapter ? `ch${p.slotId.split('-')[1]}` : undefined;

      it('recorded events are valid VillageEvents', () => {
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
      });

      it('routes its events to this scene (landmark-namespaced quiz events never bind a chapter house)', () => {
        let routed = 0;
        for (const e of events) {
          const scene = eventScene(e);
          if (scene === null) continue;
          if (scene === 'chapter-house' && def.id !== 'chapter-house') {
            // quiz.* / mastery.* carry a landmark token (oracle:, rubric:, devil:) instead of a chapter id
            expect(eventChapter(e), `${e.t} must not bind a chapter house`).toBeNull();
            routed++;
            continue;
          }
          if (scene === 'council-hall' && def.id === 'chapter-house') continue; // the quiz-key council sits in the hall
          expect(scene).toBe(def.id);
          routed++;
        }
        expect(routed).toBeGreaterThan(0);
      });

      for (const view of ['interior', 'exterior'] as const) {
        it(`paints differently from idle (${view}) and is not blank`, () => {
          let s = def.init(instance ? { instance } : undefined);
          const idle = def.paint(s, view, po(0));
          expect(opaqueCount(idle)).toBeGreaterThan(200);
          let differed = false;
          events.forEach((e, i) => {
            const at = i * 80;
            s = step(def, s, e, DEFAULT_CTX, at);
            const frame = def.paint(s, view, po(at + 50));
            if (!same(frame.data, idle.data) || frame.w !== idle.w) differed = true;
          });
          expect(differed).toBe(true);
        });
      }

      it(
        SILENT.has(p.slotId)
          ? 'animation only: no words, no outcome (by design)'
          : 'transcript renders in the room session' +
              (OUTCOME.has(p.slotId) ? ' with an outcome card' : ''),
        () => {
          const session = createRoomSession();
          session.enter(p.slotId);
          events.forEach((e, i) => session.record(p.slotId, e, 1000 + i));
          const snap = session.snapshot();
          const words = events.filter((e) => wordsOf(e) !== null);
          if (SILENT.has(p.slotId)) {
            expect(words).toHaveLength(0);
            expect(snap.transcripts[p.slotId] ?? []).toHaveLength(0);
            return;
          }
          const t = snap.transcripts[p.slotId] ?? [];
          expect(t.length).toBe(words.length);
          expect(t.length).toBeGreaterThan(0);
          for (const entry of t) expect(entry.text.trim().length).toBeGreaterThan(0);
          if (OUTCOME.has(p.slotId)) {
            const o = snap.outcomes[p.slotId];
            expect(o, 'outcome card').toBeDefined();
            expect(o!.title.length).toBeGreaterThan(0);
          }
        },
      );
    });
  }
});
