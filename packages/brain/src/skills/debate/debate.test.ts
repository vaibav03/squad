import { describe, expect, it } from 'vitest';
import { FakeLlm, VillageEventSchema, type Ctx, type VillageEvent } from '@squad/core';
import { makeSkillKit, msg } from '../testkit';
import { createDebateSkill, parseDebate, recentTopic } from './skill';
import { parseVoteAnswer, roomPick, runDebate, tallyVotes } from './debate';

const MATERIAL = {
  chapter: 'ch2',
  context:
    '[ch2.pdf p.1] The median is robust to outliers because it only depends on the middle value.\n' +
    '[ch2.pdf p.2] The mean uses every value, so one extreme value can pull it far away.',
};

interface Script {
  winner?: 'pro' | 'con' | 'draw';
  cite?: Record<'pro' | 'con', { file: string; page: number; quote: string } | null>;
  proText?: string;
  fail?: Error;
}

/** FakeLlm that answers by role (positions, pro, con, ranking, chair). */
function debateLlm(s: Script = {}) {
  return new FakeLlm({
    fallback: (req) => {
      if (s.fail) throw s.fail;
      const sys = (req as { system?: string }).system ?? '';
      const text = JSON.stringify((req as { messages?: unknown }).messages ?? '');
      if (sys.includes('frame a classroom debate'))
        return { pro: 'Use the median', con: 'Use the mean' };
      if (text.includes('Rank the other members')) return { order: [] };
      if (sys.includes('You are the chair'))
        return { winner: s.winner ?? 'pro', text: 'Pro answered the outlier problem directly.' };
      const side = sys.includes('You are Pro') ? 'pro' : 'con';
      return {
        text:
          side === 'pro'
            ? (s.proText ?? 'The median ignores outliers.')
            : 'The mean uses all the data.',
        answer: side === 'pro' ? 'median' : 'mean',
        cite: s.cite?.[side] ?? null,
      };
    },
  });
}

const collect = () => {
  const events: VillageEvent[] = [];
  return { events, emit: (e: VillageEvent) => void events.push(e) };
};
const vote = (m: Record<string, 'pro' | 'con' | 'none'>) => async (s: string) => m[s] ?? 'none';

describe('parseDebate', () => {
  it('parses questions and "debate this"', () => {
    expect(parseDebate('@cubbie debate should exams be open book?')).toEqual({
      kind: 'question',
      question: 'should exams be open book?',
    });
    expect(parseDebate('@cubbie debate: mean or median')).toMatchObject({ kind: 'question' });
    expect(parseDebate('@cubbie debate this')).toEqual({ kind: 'this' });
    expect(parseDebate('debate that!')).toEqual({ kind: 'this' });
  });
  it('ignores banter that merely contains the word', () => {
    for (const t of [
      'lol',
      'we should debate that later',
      'debate club is at 5',
      'I do not want to debate',
      'the debate was loud',
      '@cubbie debate',
      'debate me',
      'who won the debate last night',
    ])
      expect(parseDebate(t), t).toBeUndefined();
  });
});

describe('vote helpers', () => {
  it('parses confirm answers and tallies', () => {
    const o: [string, string] = ['For: Use the median', 'Against: Use the mean'];
    expect(parseVoteAnswer('For: Use the median', o)).toBe('pro');
    expect(parseVoteAnswer('2', o)).toBe('con');
    expect(parseVoteAnswer('timeout', o)).toBe('none');
    expect(parseVoteAnswer('banana', o)).toBe('none');
    expect(
      tallyVotes([
        { student: 'a', side: 'pro' },
        { student: 'b', side: 'none' },
      ]),
    ).toEqual({ pro: 1, con: 0, none: 1 });
    expect(roomPick({ pro: 1, con: 1 })).toBeNull();
    expect(roomPick({ pro: 0, con: 2 })).toBe('con');
  });
});

describe('runDebate', () => {
  it('emits council:debate events with opinion text, rank, verdict, outcome (schema valid)', async () => {
    const { events, emit } = collect();
    const res = await runDebate(
      { llm: debateLlm(), emit },
      {
        question: 'mean or median for skewed data?',
        students: ['s_a', 's_b'],
        askVote: vote({ s_a: 'pro', s_b: 'pro' }),
      },
    );
    const council = events.filter((e) => 'councilId' in e);
    expect(council.map((e) => e.t)).toEqual([
      'council.opinion',
      'council.opinion',
      'council.rank',
      'council.rank',
      'council.verdict',
    ]);
    for (const e of events)
      expect(VillageEventSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
    for (const e of council) expect((e as { councilId: string }).councilId).toBe('council:debate');
    const ops = council.filter((e) => e.t === 'council.opinion') as {
      member: string;
      text: string;
    }[];
    expect(ops.map((o) => o.member)).toEqual(['pro', 'con']);
    for (const o of ops) expect(o.text.length).toBeGreaterThan(5);
    const verdict = council.find((e) => e.t === 'council.verdict') as VillageEvent & {
      outcome?: {
        title: string;
        why: { who: string }[];
        facts: { label: string; value: string }[];
      };
      dissent?: boolean;
    };
    expect(verdict.outcome?.title).toContain('Use the median');
    expect(verdict.outcome?.why.map((w) => w.who)).toEqual(['pro', 'con']);
    expect(verdict.outcome?.facts.find((f) => f.label === 'Room vote')?.value).toBe(
      '2 for, 0 against',
    );
    expect(verdict.dissent).toBe(false);
    expect(res.winner).toBe('pro');
    expect(res.grounded).toBe(false);
    expect(res.outcome.notes?.join(' ')).toMatch(/not from your course materials/);
    // chair explanation is in the closing chat text
    expect(res.closingText).toContain('Pro answered the outlier problem');
  });

  it('records dissent when the room votes against the chair', async () => {
    const { events, emit } = collect();
    const res = await runDebate(
      { llm: debateLlm({ winner: 'pro' }), emit },
      {
        question: 'mean or median?',
        students: ['a', 'b', 'c'],
        askVote: vote({ a: 'con', b: 'con', c: 'pro' }),
      },
    );
    expect(res.verdict.dissent).toBe(true);
    expect(res.verdict.dissenter).toBe('con');
    const v = events.find((e) => e.t === 'council.verdict') as {
      dissent?: boolean;
      dissenter?: string;
      outcome?: { dissent?: string };
    };
    expect(v.dissent).toBe(true);
    expect(v.dissenter).toBe('con');
    expect(v.outcome?.dissent).toMatch(/room voted/);
  });

  it('a draw with no votes has no dissent', async () => {
    const { emit } = collect();
    const res = await runDebate(
      { llm: debateLlm({ winner: 'draw' }), emit },
      { question: 'tabs or spaces really?', students: [] },
    );
    expect(res.winner).toBe('draw');
    expect(res.verdict.dissent).toBe(false);
    expect(res.outcome.title).toMatch(/too close/i);
    expect(res.tally).toEqual({ pro: 0, con: 0, none: 0 });
  });

  it('keeps only verified citations and strips invented markers', async () => {
    const { events, emit } = collect();
    const res = await runDebate(
      {
        llm: debateLlm({
          proText: 'Robust to outliers [fake.pdf p.9] (invented p.4).',
          cite: {
            pro: { file: 'ch2.pdf', page: 1, quote: 'only depends on the middle value' },
            con: { file: 'ch2.pdf', page: 1, quote: 'the mean is always best' }, // not on the page
          },
        }),
        emit,
      },
      { question: 'mean or median for skewed data?', material: MATERIAL, students: [] },
    );
    const ops = events.filter((e) => e.t === 'council.opinion') as {
      member: string;
      text: string;
    }[];
    const pro = ops.find((o) => o.member === 'pro')!.text;
    const con = ops.find((o) => o.member === 'con')!.text;
    expect(pro).toContain('[ch2.pdf p.1]');
    expect(pro).not.toContain('fake.pdf');
    expect(pro).not.toContain('invented');
    expect(con).not.toMatch(/p\.\d/);
    expect(res.citations).toEqual([{ file: 'ch2.pdf', page: 1 }]);
    expect(res.grounded).toBe(true);
    expect(res.outcome.notes?.join(' ')).toContain('ch2.pdf p.1');
    expect(res.outcome.facts.find((f) => f.label === 'Grounding')?.value).toMatch(/course/);
  });

  it('right words on the wrong page are not verified', async () => {
    const { events, emit } = collect();
    await runDebate(
      {
        llm: debateLlm({
          cite: {
            pro: { file: 'ch2.pdf', page: 2, quote: 'only depends on the middle value' },
            con: null,
          },
        }),
        emit,
      },
      { question: 'mean or median for skewed data?', material: MATERIAL, students: [] },
    );
    const pro = (events.find((e) => e.t === 'council.opinion') as { text: string }).text;
    expect(pro).not.toMatch(/p\.\d/);
  });

  it('degrades to demo mode when the model has no credits (no retry loop)', async () => {
    const { events, emit } = collect();
    const llm = debateLlm({ fail: new Error('HTTP 402: credits depleted') });
    const res = await runDebate(
      { llm, emit },
      { question: 'is tea better than coffee?', students: ['a'], askVote: vote({ a: 'pro' }) },
    );
    expect(res.usedFallback).toBe(true);
    expect(res.outcome.notes?.join(' ')).toMatch(/no credits.*demo/i);
    expect(events.filter((e) => e.t === 'council.opinion')).toHaveLength(2);
    expect(events.some((e) => e.t === 'council.verdict')).toBe(true);
    // positions (1) + 2 opinions + 2 rankings + chair (1), no retries
    expect(llm.calls.length).toBeLessThanOrEqual(6);
    for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
  });

  it('never sends scores or points wording', async () => {
    const { emit } = collect();
    const res = await runDebate(
      { llm: debateLlm(), emit },
      { question: 'mean or median?', students: ['a'], askVote: vote({ a: 'pro' }) },
    );
    expect(res.replyText).not.toMatch(/\bscore|points?\b|xp\b|streak/i);
  });
});

describe('debate skill', () => {
  const ctxOf = (kit: Awaited<ReturnType<typeof makeSkillKit>>, ask: Ctx['askConfirm']): Ctx => ({
    ...kit.ctx,
    askConfirm: ask,
  });

  it('matches only when addressed, 0 otherwise', async () => {
    const skill = createDebateSkill({ emit: () => {} });
    const ctx = {} as Ctx;
    for (const t of ['@cubbie debate is the median better than the mean?', '@cubbie debate this'])
      expect(await skill.match(msg(t), ctx), t).toBe(0.95);
    expect(await skill.match(msg('debate this', { mentionsBot: false }), ctx)).toBe(0);
    expect(await skill.match(msg('debate this', { mentionsBot: false, isGroup: false }), ctx)).toBe(
      0.95,
    );
    for (const t of ['lol', 'we should debate that', 'ok', 'debate club'])
      expect(await skill.match(msg(t), ctx), t).toBe(0);
  });

  it('runs a debate: arguments to chat, DM vote through askConfirm, verdict reply', async () => {
    const kit = await makeSkillKit();
    kit.db
      .prepare('INSERT INTO chat_members(chat_id, student_id) VALUES(?,?)')
      .run('group:t', 's_ana');
    kit.db
      .prepare('INSERT INTO chat_members(chat_id, student_id) VALUES(?,?)')
      .run('group:t', 's_bo');
    const asked: { s: string; opts: string[] }[] = [];
    const ctx = ctxOf(kit, async (s, _q, opts) => {
      asked.push({ s, opts });
      return s === 's_ana' ? opts[0]! : 'timeout';
    });
    const { events, emit } = collect();
    const skill = createDebateSkill({
      emit,
      llm: debateLlm(),
      materialFor: async () => MATERIAL,
    });
    const out = await skill.handle(msg('@cubbie debate mean or median for skewed data?'), ctx);
    expect(asked.map((a) => a.s).sort()).toEqual(['s_ana', 's_bo']);
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.text).toMatch(/For \(Use the median\)/);
    expect(out[0]!.text).toMatch(/1 for, 0 against, 1 did not vote/);
    expect(out[0]!.text).toContain('Chair:');
    expect(events.some((e) => e.t === 'council.verdict')).toBe(true);
  });

  it('a vote that never arrives times out as no vote', async () => {
    const kit = await makeSkillKit();
    const ctx = ctxOf(kit, () => new Promise(() => {}));
    const skill = createDebateSkill({ emit: () => {}, llm: debateLlm(), voteTimeoutMs: 5 });
    const out = await skill.handle(
      msg('@cubbie debate mean or median for skewed data?', { isGroup: false }),
      ctx,
    );
    expect(out[0]!.text).toMatch(/No votes were cast/);
  });

  it('"debate this" takes the previous real message of the chat', async () => {
    const kit = await makeSkillKit();
    const ins = kit.db.prepare(
      'INSERT INTO messages(chat_id, from_id, text, mentions_bot, ts) VALUES(?,?,?,?,?)',
    );
    ins.run('group:t', 's_bo', 'honestly the median is better than the mean for income data', 0, 1);
    ins.run('group:t', 's_ana', 'ok', 0, 2);
    ins.run('group:t', 's_ana', '@cubbie debate this', 1, 3);
    expect(recentTopic(kit.ctx, msg('@cubbie debate this', { ts: 3 }))).toBe(
      'honestly the median is better than the mean for income data',
    );
    const skill = createDebateSkill({ emit: () => {}, llm: debateLlm() });
    const out = await skill.handle(msg('@cubbie debate this', { ts: 3, isGroup: false }), {
      ...kit.ctx,
      askConfirm: async () => 'timeout',
    });
    expect(out[0]!.text).toMatch(/Chair:/);
  });

  it('asks for a topic when "debate this" has nothing to refer to', async () => {
    const kit = await makeSkillKit();
    const skill = createDebateSkill({ emit: () => {}, llm: debateLlm() });
    const out = await skill.handle(msg('@cubbie debate this', { ts: 1 }), kit.ctx);
    expect(out[0]!.text).toMatch(/Debate what/);
  });

  it('materialFor failure falls back to a labelled general debate', async () => {
    const kit = await makeSkillKit();
    const skill = createDebateSkill({
      emit: () => {},
      llm: debateLlm(),
      materialFor: async () => {
        throw new Error('db down');
      },
    });
    const out = await skill.handle(
      msg('@cubbie debate is tea better than coffee?', { isGroup: false }),
      { ...kit.ctx, askConfirm: async () => 'timeout' },
    );
    expect(out[0]!.text).toMatch(/not from your course materials/);
  });
});
