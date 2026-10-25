import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { VillageEventSchema, type Ctx, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createMasteryStore } from '../mastery/store';
import { msg } from '../quiz/testkit';
import { createStudyPlanSkill } from '../skills/studyplan/studyPlanSkill';
import { assignChapters, loadOf } from './assign';
import { runStudyPlan } from './plan';
import { createStubScheduler } from './scheduler';

const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
const boxesArb = (S: string[], C: string[]) =>
  fc
    .array(fc.integer({ min: 1, max: 5 }), {
      minLength: S.length * C.length,
      maxLength: S.length * C.length,
    })
    .map((v) => new Map(S.map((s, i) => [s, new Map(C.map((c, j) => [c, v[i * C.length + j]!]))])));

describe('assignChapters', () => {
  it('assigns every chapter once with loads within 1, for any sizes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 10 }),
        fc.nat(1000),
        (ns, nc, seed) => {
          const S = ids(ns, 's');
          const C = ids(nc, 'ch');
          const rnd = fc.sample(boxesArb(S, C), { seed, numRuns: 1 })[0]!;
          const a = assignChapters({ students: S, chapters: C, mastery: rnd });
          expect([...a.keys()].sort()).toEqual([...C].sort());
          const loads = [...loadOf(a, S).values()];
          expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
  it('is invariant to input order', () => {
    const S = ['s_c', 's_a', 's_b'];
    const C = ['ch1', 'ch2', 'ch3', 'ch4'];
    fc.assert(
      fc.property(boxesArb(S, C), fc.nat(5), (m, k) => {
        const base = assignChapters({ students: S, chapters: C, mastery: m });
        const shuffled = assignChapters({
          students: [...S.slice(k % 3), ...S.slice(0, k % 3)],
          chapters: [...C.slice(k % 4), ...C.slice(0, k % 4)],
          mastery: m,
        });
        expect([...shuffled].sort()).toEqual([...base].sort());
      }),
    );
  });
  it('gives people chapters they are strong in', () => {
    const m = new Map([
      [
        'a',
        new Map([
          ['c1', 5],
          ['c2', 1],
        ]),
      ],
      [
        'b',
        new Map([
          ['c1', 1],
          ['c2', 5],
        ]),
      ],
    ]);
    expect(
      Object.fromEntries(
        assignChapters({ students: ['a', 'b'], chapters: ['c1', 'c2'], mastery: m }),
      ),
    ).toEqual({ c1: 'a', c2: 'b' });
  });
  it('handles no students', () => {
    expect(assignChapters({ students: [], chapters: ['c'], mastery: new Map() }).size).toBe(0);
  });
});

function setup(answers: Record<string, string> = {}) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const db = openMemoryDb();
  const mastery = createMasteryStore({ db, emit, now: () => 1_000_000 });
  const asked: string[] = [];
  const askConfirm = async (s: string, q: string) => {
    asked.push(q);
    return answers[s] ?? 'Yes';
  };
  return { events, emit, db, mastery, asked, askConfirm };
}

describe('runStudyPlan', () => {
  const input = {
    courseId: 'c',
    chapters: ['ch1', 'ch2', 'ch3', 'ch4'],
    students: ['s_a', 's_b', 's_c'],
    taskId: 't1',
  };

  it('3 students: every chapter once, load within 1, stub slots appear, events valid', async () => {
    const t = setup();
    const r = await runStudyPlan(
      {
        mastery: t.mastery,
        scheduler: createStubScheduler({ now: () => 0 }),
        askConfirm: t.askConfirm,
        emit: t.emit,
      },
      input,
    );
    expect(Object.keys(r.assignments).sort()).toEqual(input.chapters);
    const loads = [...loadOf(new Map(Object.entries(r.assignments)), input.students).values()];
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    expect(r.slots).toHaveLength(3);
    expect(r.confirmed).toEqual(input.students);
    expect(t.events.map((e) => e.t)).toEqual([
      'agent.message',
      'confirm.pending',
      'confirm.done',
      'confirm.pending',
      'confirm.done',
      'confirm.pending',
      'confirm.done',
    ]);
    for (const e of t.events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
  });

  it('timeout counts as no', async () => {
    const t = setup({ s_b: 'timeout' });
    const r = await runStudyPlan(
      {
        mastery: t.mastery,
        scheduler: createStubScheduler(),
        askConfirm: t.askConfirm,
        emit: t.emit,
      },
      input,
    );
    expect(r.declined).toEqual(['s_b']);
    expect(r.confirmed).toEqual(['s_a', 's_c']);
  });

  it('never leaks mastery or weak areas into group text, events or other students questions', async () => {
    const t = setup();
    await t.mastery.record('s_a', 'c', 'ch1', true); // box 2
    await t.mastery.record('s_b', 'c', 'ch1', false);
    t.events.length = 0;
    const r = await runStudyPlan(
      {
        mastery: t.mastery,
        scheduler: createStubScheduler(),
        askConfirm: t.askConfirm,
        emit: t.emit,
      },
      { ...input, names: { s_a: 'Ana', s_b: 'Bo', s_c: 'Cy' } },
    );
    const group = r.groupText + JSON.stringify(t.events) + t.asked.join('\n');
    expect(group).not.toMatch(/weak|strong|box|mastery|behind|score/i);
    expect(JSON.stringify(t.events)).not.toMatch(/"box"|mastery\.changed/);
    expect(r.dms.s_a).toMatch(/weakest chapter/);
    expect(r.groupText).toContain('Ana:');
  });
});

describe('study plan skill', () => {
  it('runs from chat members, DMs details, replies in group', async () => {
    const t = setup({ s_c: 'timeout' });
    t.db
      .prepare(
        "INSERT INTO chat_members(chat_id, student_id) VALUES('chat1','s_a'),('chat1','s_b'),('chat1','s_c')",
      )
      .run();
    const dms: { to: string; text: string }[] = [];
    const ctx = {
      db: t.db,
      askConfirm: t.askConfirm,
      dm: async (to: string, text: string) => void dms.push({ to, text }),
    } as unknown as Ctx;
    const skill = createStudyPlanSkill({
      mastery: t.mastery,
      scheduler: createStubScheduler(),
      emit: t.emit,
      chaptersFor: () => ['ch1', 'ch2', 'ch3'],
      courseIdFor: () => 'c',
      newTaskId: () => 'tk',
    });
    expect(await skill.match(msg({ text: '@cubbie plan midterm' }), ctx)).toBeGreaterThan(0.8);
    expect(await skill.match(msg({ text: 'hello' }), ctx)).toBe(0);
    const [out] = await skill.handle(msg({ text: '@cubbie plan midterm' }), ctx);
    expect(out!.text).toContain('Study plan');
    expect(out!.text).toContain('Not confirmed yet: s_c');
    expect(dms).toHaveLength(3);
  });
});
