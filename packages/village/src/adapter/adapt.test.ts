import { describe, expect, it } from 'vitest';
import { SENTINELS, VILLAGE_EVENT_TYPES, assertNoLeak } from '@squad/core';
import type { VillageEvent, VillageEventType } from '@squad/core';
import { adapt, adaptUnknown } from './adapt';
import { createAdapter } from './module';
import type { SceneCommand } from './commands';

const ctx = { me: 's_ana' };
const tags = (cs: SceneCommand[]) => cs.map((c) => c.type);
const find = <T extends SceneCommand['type']>(cs: SceneCommand[], t: T) =>
  cs.find((c): c is Extract<SceneCommand, { type: T }> => c.type === t);

const SAMPLES = {
  'agent.state': { t: 'agent.state', agent: 'dean', state: 'studying' },
  'agent.message': {
    t: 'agent.message',
    from: 'student:s_ben',
    to: 'student:s_cy',
    taskId: 'trip',
    kind: 'propose',
    shared: ['free evenings'],
  },
  'ledger.entry': {
    t: 'ledger.entry',
    taskId: 'trip',
    student: 's_ana',
    field: 'dates',
    shared: 'Fri',
  },
  'confirm.pending': { t: 'confirm.pending', student: 's_ana', taskId: 'trip', question: 'Share?' },
  'confirm.done': { t: 'confirm.done', student: 's_ana', taskId: 'trip', question: 'Share?' },
  'council.opinion': {
    t: 'council.opinion',
    councilId: 'council:planner',
    member: 'chill',
    text: 'Ch5.',
  },
  'council.rank': {
    t: 'council.rank',
    councilId: 'council:planner',
    member: 'chill',
    order: ['a', 'b'],
  },
  'council.verdict': {
    t: 'council.verdict',
    councilId: 'council:planner',
    member: 'chair',
    text: 'Ch5.',
  },
  'quiz.question': { t: 'quiz.question', quizId: 'q1', chapter: 'ch5', target: 's_ana' },
  'quiz.answer': { t: 'quiz.answer', quizId: 'q1', chapter: 'ch5', student: 's_ana' },
  'quiz.result': { t: 'quiz.result', quizId: 'q1', chapter: 'ch5' },
  'call.start': { t: 'call.start', agent: 'expert:ch5', callId: 'c1', student: 's_ana' },
  'call.caption': { t: 'call.caption', agent: 'expert:ch5', callId: 'c1', text: 'Hello there' },
  'call.end': { t: 'call.end', agent: 'expert:ch5', callId: 'c1' },
  'trip.confirmed': { t: 'trip.confirmed', taskId: 'trip', squadId: 'sq1' },
  'mastery.changed': { t: 'mastery.changed', student: 's_ana', chapter: 'ch5', box: 3 },
} satisfies Record<VillageEventType, VillageEvent>;

describe('adapter exhaustiveness', () => {
  it.each(VILLAGE_EVENT_TYPES)('%s yields commands', (t) => {
    const out = adapt(SAMPLES[t], ctx);
    expect(out.length).toBeGreaterThan(0);
  });
  it('is deterministic', () => {
    for (const t of VILLAGE_EVENT_TYPES) {
      expect(adapt(SAMPLES[t], ctx)).toEqual(adapt(SAMPLES[t], ctx));
    }
  });
});

describe('agent.state', () => {
  it.each(['idle', 'studying', 'in_call', 'waiting_for_student'] as const)('%s', (state) => {
    const out = adapt({ t: 'agent.state', agent: 'student:s_ben', state }, ctx);
    expect(find(out, 'setAgentState')).toMatchObject({ agent: 'student:s_ben', state });
    expect(find(out, 'ring')?.on).toBe(state === 'waiting_for_student');
  });
});

describe('agent.message', () => {
  it('to an agent: envelope carried to commons, bubble lists only shared labels', () => {
    const out = adapt(SAMPLES['agent.message'] as VillageEvent, ctx);
    expect(tags(out)).toContain('spawnEnvelope');
    expect(find(out, 'walkTo')).toMatchObject({ agent: 'student:s_ben', to: { kind: 'commons' } });
    const b = find(out, 'showBubble')!;
    expect(b.lines).toEqual(['free evenings']);
    expect(b.at).toEqual({ kind: 'commons' });
  });
  it('to commons pins an envelope at the fire', () => {
    const out = adapt(
      {
        t: 'agent.message',
        from: 'student:s_ben',
        to: 'commons',
        taskId: 't',
        kind: 'post',
        shared: [],
      },
      ctx,
    );
    expect(find(out, 'spawnEnvelope')?.to).toBe('commons');
    expect(find(out, 'showBubble')?.text).toBe('Post');
  });
  it.each([
    ['conflict', 'Conflict found'],
    ['option_dropped', 'An option was dropped'],
    ['query_denied', 'A request was denied'],
  ])('%s from mediator: red marker at commons, never names the vetoer', (kind, words) => {
    const out = adapt(
      { t: 'agent.message', from: 'mediator', to: 'commons', taskId: 't1', kind, shared: [] },
      ctx,
    );
    expect(find(out, 'marker')).toMatchObject({ at: { kind: 'commons' }, reason: kind });
    expect(find(out, 'showBubble')?.text).toBe(words);
    expect(tags(out)).not.toContain('spawnEnvelope');
    expect(tags(out).includes('ledgerCard')).toBe(kind === 'query_denied');
    expect(JSON.stringify(out).toLowerCase()).not.toContain('student:');
  });
  it('unknown kinds are humanized and capped', () => {
    const out = adapt(
      {
        t: 'agent.message',
        from: 'dean',
        to: 'commons',
        taskId: 't',
        kind: 'x'.repeat(200) + '$180',
        shared: [],
      },
      ctx,
    );
    expect(find(out, 'showBubble')!.text.length).toBeLessThanOrEqual(28);
  });
});

describe('ledger.entry', () => {
  it('shared card', () => {
    expect(find(adapt(SAMPLES['ledger.entry'], ctx), 'ledgerCard')?.card).toEqual({
      kind: 'shared',
      field: 'dates',
      shared: 'Fri',
    });
  });
  it('hidden card has the label only', () => {
    const out = adapt(
      { t: 'ledger.entry', taskId: 't', student: 's_b', field: 'budget', withheld: 'hidden' },
      ctx,
    );
    expect(find(out, 'ledgerCard')?.card).toEqual({ kind: 'hidden', field: 'budget' });
  });
  it('blocked card plus red marker over the sender door', () => {
    const out = adapt(
      { t: 'ledger.entry', taskId: 't', student: 's_b', field: 'budget', blocked: true },
      ctx,
    );
    expect(find(out, 'ledgerCard')?.card).toEqual({ kind: 'blocked', field: 'budget' });
    expect(find(out, 'marker')).toMatchObject({
      at: { kind: 'door', agent: 'student:s_b' },
      reason: 'blocked',
    });
  });
});

describe('confirm', () => {
  it('pending: ring on, overlay only for me', () => {
    const mine = adapt(SAMPLES['confirm.pending'], ctx);
    expect(find(mine, 'ring')).toMatchObject({ agent: 'student:s_ana', on: true });
    expect(find(mine, 'openOverlay')?.request).toMatchObject({ overlay: 'openConfirm' });
    const other = adapt({ ...SAMPLES['confirm.pending'], student: 's_ben' } as VillageEvent, ctx);
    expect(other).toEqual([]);
  });
  it('done for another student yields nothing (no announce, no ring)', () => {
    const other = adapt({ ...SAMPLES['confirm.done'], student: 's_ben' } as VillageEvent, ctx);
    expect(other).toEqual([]);
  });
  it('done: ring off, tick, overlay closed for me', () => {
    const out = adapt(SAMPLES['confirm.done'], ctx);
    expect(find(out, 'ring')?.on).toBe(false);
    expect(tags(out)).toContain('tick');
    expect(find(out, 'openOverlay')?.request).toMatchObject({ overlay: 'close', which: 'confirm' });
  });
});

describe('council', () => {
  it('opinion keeps text as given', () => {
    expect(find(adapt(SAMPLES['council.opinion'], ctx), 'councilOpinion')?.text).toBe('Ch5.');
  });
  it('rank carries the order', () => {
    expect(find(adapt(SAMPLES['council.rank'], ctx), 'councilRank')?.order).toEqual(['a', 'b']);
  });
  it('verdict without dissent has no lantern', () => {
    expect(tags(adapt(SAMPLES['council.verdict'], ctx))).not.toContain('lantern');
  });
  it('dissent flickers the lantern and names the dissenter', () => {
    const out = adapt(
      {
        t: 'council.verdict',
        councilId: 'council:q',
        member: 'chair',
        text: 'Go',
        dissent: true,
        dissenter: 'grind',
      },
      ctx,
    );
    expect(find(out, 'councilVerdict')?.dissenter).toBe('grind');
    expect(find(out, 'lantern')?.flicker).toBe(true);
    expect(find(out, 'announce')?.politeness).toBe('assertive');
  });
});

describe('quiz', () => {
  it('question: chalkboard, overlay only for the target', () => {
    const mine = adapt(SAMPLES['quiz.question'], ctx);
    expect(find(mine, 'chalkboard')).toMatchObject({ chapter: 'ch5', mark: 'question' });
    expect(find(mine, 'openOverlay')?.request).toMatchObject({ overlay: 'openQuiz', quizId: 'q1' });
    const other = adapt({ ...SAMPLES['quiz.question'], target: 's_ben' } as VillageEvent, ctx);
    expect(tags(other)).not.toContain('openOverlay');
  });
  it('answer and result: tick/cross only when correct is given, never a grade', () => {
    expect(
      find(adapt({ ...SAMPLES['quiz.answer'], correct: true } as VillageEvent, ctx), 'chalkboard')
        ?.mark,
    ).toBe('tick');
    expect(
      find(
        adapt({ ...SAMPLES['quiz.result'], student: 's_ana', correct: false } as VillageEvent, ctx),
        'chalkboard',
      )?.mark,
    ).toBe('cross');
    expect(find(adapt(SAMPLES['quiz.answer'], ctx), 'chalkboard')?.mark).toBe('none');
  });
  it("another student's answer is never ticked or crossed on my board", () => {
    for (const t of ['quiz.answer', 'quiz.result'] as const) {
      const ev = { ...SAMPLES[t], student: 's_ben', correct: false } as VillageEvent;
      expect(find(adapt(ev, ctx), 'chalkboard')).toMatchObject({ mark: 'none', mine: false });
      const mine = { ...SAMPLES[t], student: 's_ana', correct: false } as VillageEvent;
      expect(find(adapt(mine, ctx), 'chalkboard')).toMatchObject({ mark: 'cross', mine: true });
    }
  });
  it('my quiz result closes my quiz card; other results and answers do not', () => {
    const closes = (ev: VillageEvent) =>
      adapt(ev, ctx).some(
        (c) =>
          c.type === 'openOverlay' &&
          c.request.overlay === 'close' &&
          (c.request as { which?: string }).which === 'quiz',
      );
    expect(closes({ ...SAMPLES['quiz.result'], student: 's_ana' } as VillageEvent)).toBe(true);
    expect(closes({ ...SAMPLES['quiz.result'], student: 's_ben' } as VillageEvent)).toBe(false);
    expect(closes({ ...SAMPLES['quiz.answer'], student: 's_ana' } as VillageEvent)).toBe(false);
  });
  it('question carries mine when I am the target', () => {
    expect(find(adapt(SAMPLES['quiz.question'], ctx), 'chalkboard')?.mine).toBe(true);
    const other = adapt({ ...SAMPLES['quiz.question'], target: 's_ben' } as VillageEvent, ctx);
    expect(find(other, 'chalkboard')?.mine).toBe(false);
  });
});

describe('call', () => {
  it('start for me opens the overlay; for others only the portrait', () => {
    const mine = adapt(SAMPLES['call.start'], ctx);
    expect(find(mine, 'openOverlay')?.request).toEqual({
      overlay: 'openCall',
      agent: 'expert:ch5',
      callId: 'c1',
    });
    expect(find(mine, 'callPortrait')?.on).toBe(true);
    const other = adapt({ ...SAMPLES['call.start'], student: 's_ben' } as VillageEvent, ctx);
    expect(tags(other)).not.toContain('openOverlay');
    expect(find(other, 'callPortrait')?.student).toBe('s_ben');
  });
  it('caption: short bubble of the first 60 chars on a word boundary', () => {
    const text =
      'Photosynthesis converts light energy into chemical energy stored in glucose molecules';
    const b = find(
      adapt({ t: 'call.caption', agent: 'expert:ch5', callId: 'c1', text }, ctx),
      'showBubble',
    )!;
    expect(b.text.length).toBeLessThanOrEqual(61);
    expect(b.text.endsWith('…')).toBe(true);
    expect(text.startsWith(b.text.slice(0, -1))).toBe(true);
    expect(b.minMs).toBeGreaterThanOrEqual(1200);
  });
  it('end closes everything and returns the agent to idle', () => {
    const out = adapt(SAMPLES['call.end'], ctx);
    expect(find(out, 'callPortrait')?.on).toBe(false);
    expect(find(out, 'setAgentState')?.state).toBe('idle');
    expect(find(out, 'openOverlay')?.request).toMatchObject({ overlay: 'close', which: 'call' });
  });
});

describe('trip and mastery', () => {
  it('trip.confirmed plays the cutscene', () => {
    expect(find(adapt(SAMPLES['trip.confirmed'], ctx), 'playTrip')).toMatchObject({
      squadId: 'sq1',
    });
  });
  it('mastery glow only for the viewer', () => {
    expect(find(adapt(SAMPLES['mastery.changed'], ctx), 'setGlow')).toMatchObject({
      chapter: 'ch5',
      box: 3,
    });
    expect(adapt({ ...SAMPLES['mastery.changed'], student: 's_ben' } as VillageEvent, ctx)).toEqual(
      [],
    );
  });
});

describe('bubble dwell', () => {
  it('is at least 1.2 s per 20 chars and capped', () => {
    const long = 'x '.repeat(400);
    const b = find(
      adapt({ t: 'council.opinion', councilId: 'council:p', member: 'm', text: long }, ctx),
      'councilOpinion',
    );
    expect(b).toBeDefined();
    const msg = find(
      adapt(
        { t: 'agent.message', from: 'dean', to: 'commons', taskId: 't', kind: 'k', shared: [long] },
        ctx,
      ),
      'showBubble',
    )!;
    expect(msg.minMs).toBe(9000);
  });
});

describe('adaptUnknown', () => {
  it('drops malformed and unknown events without throwing', () => {
    const rejected: string[] = [];
    for (const bad of [null, 42, {}, { t: 'nope' }, { t: 'agent.state', agent: 'dean' }, 'x']) {
      expect(adaptUnknown(bad, ctx, (r) => rejected.push(r.reason))).toEqual([]);
    }
    expect(rejected).toHaveLength(6);
  });
});

describe('sentinel: no withheld value reaches any bubble or label', () => {
  const [S1, S2] = SENTINELS;
  const smuggled: unknown[] = [
    {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      withheld: 'hidden',
      value: S1,
    },
    { t: 'ledger.entry', taskId: 't', student: 's_b', field: 'budget', withheld: S1 },
    {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      blocked: true,
      withheldValue: S2,
    },
    {
      t: 'agent.message',
      from: 'mediator',
      to: 'commons',
      taskId: 't',
      kind: 'conflict',
      shared: [],
      payload: S1,
    },
    { t: 'council.opinion', councilId: 'c', member: 'm', raw: S2 },
  ];
  it('strict schema rejects extra keys, so nothing reaches the commands', () => {
    for (const ev of smuggled) {
      const out = adaptUnknown(ev, ctx);
      expect(out).toEqual([]);
      assertNoLeak(out, SENTINELS, 'commands');
    }
  });
  it('a hidden entry that also carries `shared` shows the label only', () => {
    const ev: VillageEvent = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      withheld: 'hidden',
      shared: S1,
    };
    const out = adapt(ev, ctx);
    expect(find(out, 'ledgerCard')?.card).toEqual({ kind: 'hidden', field: 'budget' });
    assertNoLeak(out, SENTINELS, 'commands');
  });
  it('a blocked entry that carries `shared` shows the label only', () => {
    const ev: VillageEvent = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      blocked: true,
      shared: S2,
    };
    assertNoLeak(adapt(ev, ctx), SENTINELS, 'commands');
  });
  it('seeded sweep: withheld/blocked entries never leak under any field/student combination', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const fields = ['budget', 'therapy-free', 'dates', 'notes'];
    for (let i = 0; i < 200; i++) {
      const ev: VillageEvent = {
        t: 'ledger.entry',
        taskId: `t${i}`,
        student: `s_${i % 4}`,
        field: fields[Math.floor(rnd() * fields.length)]!.replace('therapy-free', 'mood'),
        ...(rnd() < 0.5 ? { withheld: 'hidden' as const } : { blocked: true as const }),
        ...(rnd() < 0.7 ? { shared: rnd() < 0.5 ? S1 : S2 } : {}),
      };
      assertNoLeak(adapt(ev, ctx), SENTINELS, `sweep ${i}`);
    }
  });
});

describe('review fixes', () => {
  it('envelope id includes the shared labels', () => {
    const mk = (shared: string[]) =>
      find(
        adapt(
          {
            t: 'agent.message',
            from: 'student:s_ben',
            to: 'commons',
            taskId: 't',
            kind: 'propose',
            shared,
          },
          ctx,
        ),
        'spawnEnvelope',
      )?.id;
    expect(mk(['a'])).not.toBe(mk(['b']));
    expect(mk(['a', 'b'])).toContain('a|b');
  });
  it('query_denied ledger card names a student sender, else mediator', () => {
    const card = (from: string) =>
      find(
        adapt(
          {
            t: 'agent.message',
            from,
            to: 'commons',
            taskId: 't',
            kind: 'query_denied',
            shared: [],
          },
          ctx,
        ),
        'ledgerCard',
      )?.student;
    expect(card('student:s_ben')).toBe('s_ben');
    expect(card('expert:ch5')).toBe('mediator');
    expect(card('dean')).toBe('mediator');
    expect(card('mediator')).toBe('mediator');
  });
  it("createAdapter drops captions of someone else's call and forgets on call.end", () => {
    const a = createAdapter({ me: 's_ana' });
    const cap = (callId: string) =>
      a.adapt({ t: 'call.caption', agent: 'dean', callId, text: 'hello' } as VillageEvent);
    a.adapt({ t: 'call.start', agent: 'dean', callId: 'c1', student: 's_ben' } as VillageEvent);
    a.adapt({ t: 'call.start', agent: 'dean', callId: 'c2', student: 's_ana' } as VillageEvent);
    a.adapt({ t: 'call.start', agent: 'dean', callId: 'c3' } as VillageEvent);
    expect(cap('c1')).toEqual([]);
    expect(cap('c2')).toHaveLength(1);
    expect(cap('c3')).toHaveLength(1);
    a.adapt({ t: 'call.end', agent: 'dean', callId: 'c1' } as VillageEvent);
    expect(cap('c1')).toHaveLength(1); // forgotten
  });
});
