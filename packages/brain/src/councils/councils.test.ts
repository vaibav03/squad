import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FakeLlm,
  VillageEventSchema,
  textOf,
  normalizeMessages,
  type LlmJsonRequest,
  type LlmRequest,
  type VillageEvent,
} from '@squad/core';
import { aggregateRankings, pickDissenter, repairOrder } from './pure';
import { createCouncilRun } from './council';
import { createQuizKeyVerifier, SOLVERS } from './quizkey';
import { planCourse } from './planner';

const ask = (r: LlmRequest | LlmJsonRequest<unknown>) =>
  normalizeMessages(r.messages)
    .map((m) => textOf(m.content))
    .join('\n') + (r.system ?? '');

const collect = () => {
  const events: VillageEvent[] = [];
  return { events, emit: (e: VillageEvent) => void events.push(e) };
};

describe('pure council logic', () => {
  const members = ['a', 'b', 'c', 'd'];
  const rankingsArb = fc.array(fc.shuffledSubarray(members, { minLength: 0 }), {
    minLength: 4,
    maxLength: 4,
  });
  const toRankings = (orders: string[][]) =>
    members.map((m, i) => ({ member: m, order: orders[i]!.filter((x) => x !== m) }));

  it('aggregate is invariant to ranking array order and has a max-score winner', () => {
    fc.assert(
      fc.property(rankingsArb, fc.nat(23), (orders, k) => {
        const rs = toRankings(orders);
        const rotated = [...rs.slice(k % 4), ...rs.slice(0, k % 4)];
        const agg = aggregateRankings(rs, members);
        expect(aggregateRankings(rotated, members)).toEqual(agg);
        expect([...agg].sort()).toEqual([...members].sort());
        const score = (m: string) =>
          rs.reduce((s, r) => {
            const o = repairOrder(
              r.order,
              members.filter((x) => x !== r.member),
            );
            const i = o.indexOf(m);
            return i < 0 ? s : s + (o.length - 1 - i);
          }, 0);
        expect(score(agg[0]!)).toBe(Math.max(...members.map(score)));
      }),
    );
  });
  it('ties break by member order', () => {
    expect(aggregateRankings([], members)).toEqual(members);
  });
  it('repairOrder always yields a permutation of others', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', 'c', 'x', 'y')), (order) => {
        const out = repairOrder(order, ['a', 'b', 'c']);
        expect([...out].sort()).toEqual(['a', 'b', 'c']);
      }),
    );
  });
  it('pickDissenter is the first differing member, none when all agree', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('x', 'y', 'z'), { minLength: 3, maxLength: 3 }),
        fc.constantFrom('x', 'y', 'z'),
        (ans, v) => {
          const ms = ['m1', 'm2', 'm3'];
          const d = pickDissenter(
            ms.map((m, i) => ({ member: m, answer: ans[i]! })),
            v,
            ms,
          );
          const first = ms.find((_, i) => ans[i] !== v);
          expect(d).toBe(first);
        },
      ),
    );
    expect(pickDissenter([{ member: 'a', answer: ' Yes! ' }], 'yes', ['a'])).toBeUndefined();
  });
});

describe('council run steps', () => {
  const scripted = (delays: Record<string, number> = {}) =>
    new FakeLlm({
      fallback: async (req) => {
        const s = ask(req);
        const who = /You are (\w+)/.exec(req.system ?? '')?.[1] ?? 'chair';
        await new Promise((r) => setTimeout(r, delays[who] ?? 0));
        if (s.includes('"order"')) return { order: ['zzz', 'b', 'a', 'b'] };
        if (s.includes('verdict as JSON')) return { text: 'go with B', answer: 'B' };
        return { text: `${who} thinks`, answer: who === 'm3' ? 'A' : 'B' };
      },
    });
  const cfg = (llm: FakeLlm, emit: (e: VillageEvent) => void) => ({
    id: 'test',
    members: ['m1', 'm2', 'm3'].map((n) => ({ name: n, system: `You are ${n}` })),
    chair: { name: 'chair', system: 'You are chair' },
    task: 'Which?',
    llm,
    emit,
  });

  it('runs opinion -> rank -> verdict in order with dissenter, events valid', async () => {
    const { events, emit } = collect();
    const run = createCouncilRun(cfg(scripted(), emit));
    expect(run.id).toBe('council:test');
    await expect(run.rankings()).rejects.toThrow(/before opinions/);
    await expect(run.verdict()).rejects.toThrow(/before rankings/);
    const ops = await run.opinions();
    expect(events.filter((e) => e.t === 'council.rank')).toHaveLength(0);
    expect(ops.map((o) => o.member)).toEqual(['m1', 'm2', 'm3']);
    const ranks = await run.rankings();
    expect(ranks[0]!.order).toEqual(['m2', 'm3']); // repaired deterministically
    const v = await run.verdict();
    expect(v).toMatchObject({ dissent: true, dissenter: 'm3', answer: 'B' });
    expect(events.map((e) => e.t)).toEqual([
      'agent.state',
      'council.opinion',
      'council.opinion',
      'council.opinion',
      'council.rank',
      'council.rank',
      'council.rank',
      'council.verdict',
      'agent.state',
    ]);
    for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    const verdictEv = events.find((e) => e.t === 'council.verdict')!;
    expect(verdictEv).toMatchObject({ member: 'chair', dissent: true, dissenter: 'm3' });
  });

  it('memoises steps (no repeat llm calls)', async () => {
    const llm = scripted();
    const run = createCouncilRun(cfg(llm, () => {}));
    await run.opinions();
    const n = llm.calls.length;
    await run.opinions();
    expect(llm.calls.length).toBe(n);
  });

  it('event order is deterministic regardless of completion order', async () => {
    const a = collect();
    const b = collect();
    await runAll(createCouncilRun(cfg(scripted({ m1: 30, m2: 0, m3: 10 }), a.emit)));
    await runAll(createCouncilRun(cfg(scripted({ m1: 0, m2: 20, m3: 5 }), b.emit)));
    expect(a.events).toEqual(b.events);
  });
});

async function runAll(run: ReturnType<typeof createCouncilRun>) {
  await run.opinions();
  await run.rankings();
  return run.verdict();
}

describe('council:quizkey', () => {
  const KEY = 'SECRETKEY-77';
  const solverLlm = (answers: Record<string, string>) =>
    new FakeLlm({
      fallback: (req) => {
        const s = ask(req);
        const who = /You are (solver-\w)/.exec(req.system ?? '')?.[1] ?? '';
        if (s.includes('"order"')) return { order: SOLVERS.filter((x) => x !== who) };
        if (s.includes('"equivalent"')) return { equivalent: [true, true, true] };
        return { text: 'reasoned', answer: answers[who] ?? '1' };
      },
    });
  const draft = { kind: 'choice' as const, question: 'q?', choices: ['a', 'b', 'c'], key: 1 };
  const ctx = { courseId: 'c', chapter: 'ch1', chapterContext: '[f p.1] text' };

  it('passes a correct key', async () => {
    const { events, emit } = collect();
    const r = await createQuizKeyVerifier({ llm: solverLlm({}), emit }).verify(draft, ctx);
    expect(r).toEqual({ ok: true, dissent: false });
    expect(events.at(-2)).toMatchObject({
      t: 'council.verdict',
      councilId: 'council:quizkey',
      dissent: false,
    });
  });

  it('drops a deliberately wrong key; dissenter is the first differing solver', async () => {
    const { events, emit } = collect();
    const r = await createQuizKeyVerifier({
      llm: solverLlm({ 'solver-b': '2', 'solver-c': '0' }),
      emit,
    }).verify(draft, ctx);
    expect(r).toEqual({ ok: false, dissent: true, dissenter: 'solver-b' });
    const v = events.find((e) => e.t === 'council.verdict')!;
    expect(v).toMatchObject({ dissent: true, dissenter: 'solver-b' });
    expect((v as { text: string }).text).toMatch(/uncertain/i);
  });

  it('keeps the key out of every solver request and every event', async () => {
    const { events, emit } = collect();
    const llm = solverLlm({});
    await createQuizKeyVerifier({ llm, emit }).verify(
      { kind: 'free', question: 'name it', key: KEY },
      ctx,
    );
    for (const c of llm.calls) {
      const isChairCheck = String((c as LlmJsonRequest<unknown>).system).includes('judge');
      if (!isChairCheck) expect(ask(c)).not.toContain(KEY);
    }
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('free text uses chair equivalence when normalised match fails', async () => {
    const llm = new FakeLlm({
      fallback: (req) => {
        const s = ask(req);
        if (s.includes('"equivalent"')) return { equivalent: [true, true, true] };
        if (s.includes('"order"')) return { order: ['solver-b', 'solver-c'] };
        return { text: 't', answer: 'mean squared error' };
      },
    });
    const r = await createQuizKeyVerifier({ llm, emit: () => {} }).verify(
      { kind: 'free', question: 'q', key: 'MSE' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('council:planner', () => {
  it('runs chill/grind/advisor and a chair verdict', async () => {
    const { events, emit } = collect();
    const llm = new FakeLlm({
      fallback: (req) => {
        const s = ask(req);
        if (s.includes('"order"')) return { order: ['grind', 'advisor', 'chill'] };
        if (s.includes('verdict as JSON')) return { text: 'plan', answer: 'balanced' };
        return { text: 'opinion', answer: 'balanced' };
      },
    });
    const out = await planCourse({ llm, emit, input: { summary: 'ch1, ch2' } });
    expect(out.opinions.map((o) => o.member)).toEqual(['chill', 'grind', 'advisor']);
    expect(out.verdict.dissent).toBe(false);
    expect(events.every((e) => VillageEventSchema.safeParse(e).success)).toBe(true);
  });
});
