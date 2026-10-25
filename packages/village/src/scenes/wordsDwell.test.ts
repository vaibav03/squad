import { describe, expect, it } from 'vitest';
import { assertNoLeak, SENTINELS, type RoomOutcome, type VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step, type BubbleSpec, type SceneDef } from './contract';
import { PLACEMENTS } from './registry';
import { initBase, reduceBase, visibleBubbles, MAX_QUEUED, type BaseState } from './model/base';
import { holdMsFor, createRoomSession } from './roomSession';
import { paintPlanSheet, planSheet, sheetHeight, sheetLines, SHEET_W } from './art/planSheet';
import { Raster } from './pixel/raster';
import { bubbleTrace, rectsOverlap } from './art/bubbleLayout';
import { BUNDLES } from './registry';
import { offPalette, paintShot, po } from './testkit';

const ctx = DEFAULT_CTX;
const defOf = (slot: string): SceneDef<BaseState> =>
  PLACEMENTS.find((p) => p.slotId === slot)!.def as unknown as SceneDef<BaseState>;
const texts = (s: BaseState, t: number, calm = false): string[] =>
  visibleBubbles(s, { t, calm }).map((v) => v.b.text);
const bub = (who: string, text: string): BubbleSpec => ({ who, text, style: 'speech' });

describe('base bubble dwell and queue', () => {
  const at0 = (n: number) => 'x'.repeat(n);
  it('queues a same-speaker bubble until the first one has dwelled, FIFO, deterministic', () => {
    let s = initBase();
    const a = at0(30); // 2400 ms
    s = reduceBase(s, { c: 'bubble', bubble: bub('m', `A${a}`) }, 0);
    s = reduceBase(s, { c: 'bubble', bubble: bub('m', `B${a}`) }, 10);
    s = reduceBase(s, { c: 'bubble', bubble: bub('m', `C${a}`) }, 20);
    expect(s.bubbleQueue).toHaveLength(2);
    const hold = holdMsFor(`A${a}`);
    expect(texts(s, hold - 10)[0]![0]).toBe('A');
    expect(texts(s, hold + 200)[0]![0]).toBe('B');
    expect(texts(s, 2 * hold + 200)[0]![0]).toBe('C');
    // same answer in calm mode
    expect(texts(s, hold + 200, true)[0]![0]).toBe('B');
  });
  it('replaces immediately once the dwell is over, and keeps at most 4 waiting', () => {
    let s = initBase();
    s = reduceBase(s, { c: 'bubble', bubble: bub('m', 'hi') }, 0);
    s = reduceBase(s, { c: 'bubble', bubble: bub('m', 'yo') }, 1300);
    expect(s.bubbleQueue).toHaveLength(0);
    expect(s.bubbles[0]!.text).toBe('yo');
    for (let i = 0; i < 7; i++)
      s = reduceBase(s, { c: 'bubble', bubble: bub('m', `n${i}`) }, 1400 + i);
    expect(s.bubbleQueue.length).toBeLessThanOrEqual(MAX_QUEUED);
    expect(s.bubbleQueue.map((q) => q.bubble.text)).toEqual(['n3', 'n4', 'n5', 'n6']);
  });
  it('a clear inside the dwell lets the bubble finish first', () => {
    let s = initBase();
    s = reduceBase(s, { c: 'bubble', bubble: bub('m', 'hello there') }, 0);
    s = reduceBase(s, { c: 'clearBubbles' }, 300);
    expect(texts(s, 1000)).toEqual(['hello there']);
    expect(texts(s, 1500)).toEqual([]);
  });
});

describe('every family: opinion / caption words are carried whole and held', () => {
  const long = 'Take CS 201 and MATH 220 together, keep Friday light, and drop the elective.';
  const councils: Array<[string, string, string]> = [
    ['council-hall', 'council:quizkey', 'solver-a'],
    ['round-table', 'council:planner', 'chill'],
    ['debate-stage', 'council:debate', 'pro'],
  ];
  it.each(councils)(
    '%s carries opinion text whole and queues the next from the same member',
    (slot, councilId, member) => {
      const def = defOf(slot);
      const op = (text: string): VillageEvent => ({
        t: 'council.opinion',
        councilId,
        member,
        text,
      });
      let s = def.init();
      s = step(def, s, op(long), ctx, 0);
      expect(s.bubbles[0]!.text).toBe(long);
      expect(s.bubbles[0]!.minMs).toBe(holdMsFor(long));
      s = step(def, s, op('Second.'), ctx, 100);
      const hold = holdMsFor(long);
      expect(texts(s, hold - 50)).toEqual([long]);
      expect(texts(s, hold + 300)).toEqual(['Second.']);
    },
  );
  const agents: Array<[string, string]> = [
    ['chapter-1', 'expert:ch1'],
    ['feynman-porch', 'expert:feynman'],
    ['panic-booth', 'expert:stepdiff'],
    ['exam-oracle', 'expert:oracle'],
    ['oral-exam-hut', 'expert:oral'],
    ['rubric-courthouse', 'expert:rubric'],
    ['devils-ta', 'expert:devil'],
  ];
  it.each(agents)('%s holds caption bubbles for holdMsFor and keeps order', (slot, agent) => {
    const def = defOf(slot);
    const cap = (text: string): VillageEvent => ({ t: 'call.caption', agent, callId: 'c', text });
    const first = 'Walk me through why the second step follows from the first.';
    let s = def.init({ instance: slot.startsWith('chapter') ? 'ch1' : slot });
    s = step(def, s, cap(first), ctx, 0);
    s = step(def, s, cap('And the third?'), ctx, 50);
    s = step(def, s, cap('Last one.'), ctx, 60);
    expect(s.bubbles[0]!.text).toBe(first);
    const hold = holdMsFor(first);
    expect(texts(s, hold - 50)).toEqual([first]);
    expect(texts(s, hold + 200)).toEqual(['And the third?']);
    expect(texts(s, hold + holdMsFor('And the third?') + 200)).toEqual(['Last one.']);
  });
  it('a long caption keeps its full text in the transcript', () => {
    const text = 'w'.repeat(10) + ' ' + 'z'.repeat(150);
    const session = createRoomSession();
    session.record(
      'oral-exam-hut',
      { t: 'call.caption', agent: 'expert:oral', callId: 'c', text },
      0,
    );
    expect(session.snapshot().transcripts['oral-exam-hut']![0]!.text).toBe(text);
  });
});

describe('quiz.question text on the board', () => {
  it('chapter house and oracle keep the public prompt; the reducer never invents one', () => {
    const q: VillageEvent = {
      t: 'quiz.question',
      quizId: 'q',
      chapter: 'ch1',
      text: 'What is a stack?',
    };
    const ch = defOf('chapter-1');
    const s = step(ch, ch.init({ instance: 'ch1' }), q, ctx, 0);
    expect(s.chalk.question).toBe('What is a stack?');
    const noText = step(ch, s, { t: 'quiz.question', quizId: 'q2', chapter: 'ch1' }, ctx, 10);
    expect(noText.chalk.question).toBeUndefined();
    const answered = step(
      ch,
      s,
      { t: 'quiz.result', quizId: 'q', chapter: 'ch1', student: 's_bo', correct: true },
      ctx,
      20,
    );
    expect(answered.chalk.mark).toBe('none');
    expect(answered.chalk.question).toBe('What is a stack?');
    const or = defOf('exam-oracle');
    const o = step(or, or.init(), { ...q, quizId: 'oracle:1', chapter: 'oracle:ch1' }, ctx, 0);
    expect(o.chalk.question).toBe('What is a stack?');
  });
});

describe('outcome and the plan sheet', () => {
  const outcome: RoomOutcome = {
    title: 'Spring plan: 15 credits, light Friday and a very long tail that must be cut',
    items: Array.from({ length: 7 }, (_, i) => ({
      label: `Course ${i} with a long name`,
      detail: 'Mon Wed',
    })),
    facts: [
      { label: 'Workload', value: 'steady' },
      { label: 'Credits', value: '15' },
    ],
    why: [],
  };
  const verdict = (councilId: string): VillageEvent => ({
    t: 'council.verdict',
    councilId,
    member: 'chair',
    text: 'Plan agreed',
    outcome,
  });
  it.each([
    ['round-table', 'council:planner'],
    ['council-hall', 'council:quizkey'],
    ['debate-stage', 'council:debate'],
  ])('%s keeps the outcome in state and clears it for a new session', (slot, id) => {
    const def = defOf(slot);
    let s = step(def, def.init(), verdict(id), ctx, 0);
    expect(s.outcome).toEqual(outcome);
    s = step(
      def,
      s,
      { t: 'council.opinion', councilId: id, member: 'chill', text: 'again' },
      ctx,
      10,
    );
    expect(s.outcome).toBeUndefined();
  });
  it('sheet shows title, at most 5 courses and the credits fact, inside its box, on palette', () => {
    const L = sheetLines(outcome);
    expect(L.items).toHaveLength(5);
    expect(L.fact).toBe('Credits: 15');
    for (const line of [L.title, ...L.items, L.fact]) expect(line.length).toBeLessThanOrEqual(38);
    const sheet = planSheet(outcome);
    expect([sheet.w, sheet.h]).toEqual([SHEET_W, sheetHeight(outcome)]);
    expect(offPalette(sheet)).toBe(0);
    for (const [slot] of [['round-table'], ['council-hall']] as const) {
      const def = defOf(slot);
      const id = slot === 'round-table' ? 'council:planner' : 'council:quizkey';
      const s = step(def, def.init(), verdict(id), ctx, 0);
      const before = def.paint(s, 'interior', po(7000)).hash();
      const after = def.paint(s, 'interior', po(9000)).hash();
      expect(after).not.toBe(before); // appears once the chair's bubble is done
      const r = new Raster(224, 128);
      paintPlanSheet(r, { verdict: { since: 0 }, outcome }, 9000, false, 24, 34);
      expect(r.isOpaque(24, 34)).toBe(true);
      expect(r.isOpaque(24 + SHEET_W - 1, 34 + sheetHeight(outcome) - 1)).toBe(true);
      expect(r.isOpaque(24 + SHEET_W, 34)).toBe(false);
    }
  });
});

describe('sentinels: withheld values never reach bubbles, transcript, outcome or describe', () => {
  const SLOTS: Array<[string, string, string]> = [
    ['chapter-1', 'expert:ch1', ''],
    ['council-hall', 'council:quizkey', 'council:quizkey'],
    ['debate-stage', 'council:debate', 'council:debate'],
    ['round-table', 'council:planner', 'council:planner'],
    ['feynman-porch', 'expert:feynman', ''],
    ['panic-booth', 'expert:stepdiff', ''],
    ['exam-oracle', 'expert:oracle', ''],
    ['oral-exam-hut', 'expert:oral', ''],
    ['rubric-courthouse', 'expert:rubric', ''],
    ['devils-ta', 'expert:devil', ''],
  ];
  it.each(SLOTS)('%s', (slot, agent, council) => {
    const def = defOf(slot);
    const session = createRoomSession();
    const script: VillageEvent[] = [
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's_bo',
        field: 'budget',
        withheld: 'hidden',
        shared: SENTINELS.join(' '),
      },
      { t: 'agent.message', from: agent, to: 'commons', taskId: 't', kind: 'conflict', shared: [] },
      { t: 'agent.state', agent, state: 'studying' },
      ...(council
        ? ([
            { t: 'council.opinion', councilId: council, member: 'chill', text: 'Keep it light.' },
            {
              t: 'council.verdict',
              councilId: council,
              member: 'chair',
              text: 'Agreed',
              outcome: {
                title: 'Plan',
                items: [{ label: 'CS 201' }],
                facts: [{ label: 'Credits', value: '12' }],
                why: [],
              },
            },
          ] as VillageEvent[])
        : ([{ t: 'call.caption', agent, callId: 'c', text: 'Tell me more.' }] as VillageEvent[])),
    ];
    let s = def.init({ instance: slot.startsWith('chapter') ? 'ch1' : undefined });
    let t = 0;
    for (const e of script) {
      if (def.handles(e, s, ctx)) session.record(slot, e, t);
      s = step(def, s, e, ctx, t);
      t += 100;
    }
    const snap = session.snapshot();
    assertNoLeak(snap, SENTINELS, 'RoomSession');
    assertNoLeak(s.bubbles, SENTINELS, 'bubbles');
    assertNoLeak(s.bubbleQueue, SENTINELS, 'queue');
    assertNoLeak(s.outcome ?? {}, SENTINELS, 'outcome');
    assertNoLeak(def.describe(s), SENTINELS, 'describe');
    // ledger.entry and agent.message never became transcript entries
    const kinds = (snap.transcripts[slot] ?? []).map((x) => x.kind);
    expect(kinds.every((k) => k !== 'note')).toBe(true);
    expect((snap.transcripts[slot] ?? []).length).toBe(council ? 2 : 1);
    for (const tt of [100, 3000, 12000]) {
      for (const view of ['interior', 'exterior'] as const) def.paint(s, view, po(tt));
    }
  });
});

describe('bubble layout: no two bubbles ever overlap in the council rooms', () => {
  it.each(['round-table', 'council-hall', 'debate-stage'])('%s shots', (id) => {
    const b = BUNDLES.find((x) => x.def.id === id)!;
    let checked = 0;
    for (const shot of b.shots.filter((x) => x.view === 'interior')) {
      for (const t of shot.sample) {
        bubbleTrace.on = true;
        bubbleTrace.rects = [];
        try {
          paintShot(b.def, shot, t);
        } finally {
          bubbleTrace.on = false;
        }
        const rs = bubbleTrace.rects;
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++)
            expect(
              rectsOverlap(rs[i]!, rs[j]!),
              `${id}/${shot.name}@${t}: ${rs[i]!.key} vs ${rs[j]!.key}`,
            ).toBe(false);
        checked += rs.length;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
  it('the plan sheet height follows the content and keeps the chair clear', () => {
    const one: RoomOutcome = { title: 'T', items: [{ label: 'A' }], facts: [], why: [] };
    const five: RoomOutcome = { ...one, items: Array.from({ length: 5 }, () => ({ label: 'A' })) };
    expect(sheetHeight(one)).toBeLessThan(sheetHeight(five));
    expect(14 + SHEET_W).toBeLessThan(185); // round-table: armchair starts at x 185
  });
});
