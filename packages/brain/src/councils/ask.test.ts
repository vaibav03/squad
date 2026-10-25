import { describe, expect, it } from 'vitest';
import {
  FakeLlm,
  SENTINELS,
  VillageEventSchema,
  assertNoLeak,
  type LlmJsonRequest,
  type LlmRequest,
  type VillageEvent,
} from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { BrainUnavailableError, grounded, makeSkillKit, msg } from '../skills/testkit';
import { createCouncilSkill, councilQuestion, formatCouncilReply } from '../skills/council';
import { CouncilBusyError } from './ask-types';
import { anonymise, REFUSE_GRADED, REFUSE_OFF_TOPIC } from './ask-run';
import { createDemoCouncilLlm } from './demo';
import { createCouncilService } from './service';

type Member = 'Skeptic' | 'Teacher' | 'Practitioner';
interface Spec {
  answers?: Partial<Record<Member, string | Error | 'hang'>>;
  positions?: Partial<Record<Member, string>>;
  claims?: Partial<Record<Member, { text: string; file: string; page: number; quote: string }[]>>;
  /** Rank by member name, best first (mapped to the anonymous labels the ranker sees). */
  rank?: Partial<Record<Member, Member[]>>;
  chair?: Record<string, unknown> | Error;
  study?: boolean;
  delay?: Partial<Record<Member, number>>;
}

const NAMES: Member[] = ['Skeptic', 'Teacher', 'Practitioner'];
const who = (system: string): Member | undefined =>
  NAMES.find((n) => system.includes(`You are the ${n}`));

/** Scripts every call by what it is (triage, member opinion, ranking, chair), so order never matters. */
function scripted(spec: Spec = {}) {
  const seen: { kind: string; messages: string; system: string }[] = [];
  const llm = new FakeLlm({
    fallback: async (req: LlmRequest | LlmJsonRequest<unknown>) => {
      const system = req.system ?? '';
      const messages =
        typeof req.messages === 'string' ? req.messages : JSON.stringify(req.messages);
      if (system.includes(':triage]')) {
        seen.push({ kind: 'triage', messages, system });
        return { study: spec.study ?? true, reason: '' };
      }
      if (system.includes(':chair]')) {
        seen.push({ kind: 'chair', messages, system });
        if (spec.chair instanceof Error) throw spec.chair;
        return (
          spec.chair ?? {
            verdict: 'Pick B.',
            answer: 'B',
            agreeing: NAMES,
            dissentWhy: '',
            confidence: 'confident',
            next: 'Try B on a small example.',
          }
        );
      }
      const m = who(system);
      if (m && /Rank the responses/.test(messages)) {
        seen.push({ kind: 'rank', messages, system });
        const labelled = [...messages.matchAll(/Response ([A-Z]): (.*?)\\n\(answer/g)];
        const want = spec.rank?.[m];
        if (want) {
          // labels shown to this ranker, mapped back to names through the same anonymise() the code used
          return { order: want.map((n) => labelFor(messages, n)) };
        }
        return { order: labelled.map((x) => x[1]!) };
      }
      if (m) {
        seen.push({ kind: `member:${m}`, messages, system });
        const delay = spec.delay?.[m];
        if (delay) await new Promise((r) => setTimeout(r, delay));
        const a = spec.answers?.[m] ?? 'B';
        if (a instanceof Error) throw a;
        if (a === 'hang') return new Promise(() => undefined);
        return {
          answer: a,
          position: spec.positions?.[m] ?? `${m} reasons it is ${a}.`,
          claims: spec.claims?.[m] ?? [],
        };
      }
      throw new Error('unexpected call');
    },
  });
  return { llm, seen };
}

/** Which label does this ranker's prompt use for the member whose text starts with "<name> reasons"? */
function labelFor(messages: string, name: string): string {
  const re = new RegExp(`Response ([A-Z]): ${name} reasons`);
  const hit = re.exec(messages);
  if (!hit) throw new Error(`no label for ${name}`);
  return hit[1]!;
}

function collect() {
  const events: VillageEvent[] = [];
  return { events, emit: (e: VillageEvent) => void events.push(e) };
}
let n = 0;
const nextId = () => `cn_${String(++n).padStart(12, '0')}`;

function service(
  spec: Spec = {},
  extra: Parameters<typeof createCouncilService>[0] extends infer D ? Partial<D> : never = {},
) {
  const s = scripted(spec);
  const c = collect();
  const svc = createCouncilService({
    llm: s.llm,
    db: openMemoryDb(),
    emit: c.emit,
    newId: nextId,
    limits: { callTimeoutMs: 400, runTimeoutMs: 5000 },
    ...extra,
  });
  return { svc, ...s, ...c };
}
const ask = (q = 'B or C?', o: { chatId?: string; askedBy?: string } = {}) => ({
  question: q,
  askedBy: o.askedBy ?? 's_ana',
  ...(o.chatId ? { chatId: o.chatId } : {}),
});

describe('council run', () => {
  it('consensus: three independent answers, anonymous ranking, confident verdict, events in member order', async () => {
    const t = service({ delay: { Skeptic: 60 } }); // the Skeptic is slowest, yet speaks first
    const r = await t.svc.ask(ask()).done;
    expect(r.status).toBe('done');
    expect(r.members.map((m) => m.name)).toEqual(['Skeptic', 'Teacher', 'Practitioner']);
    expect(r.members.every((m) => m.status === 'answered')).toBe(true);
    expect(r.rankings).toHaveLength(3);
    expect(r.verdict?.confidence).toBe('confident');
    expect(r.verdict?.dissent).toBeUndefined();
    expect(r.verdict?.uncertain).toBe(false);
    const seq = t.events.map((e) =>
      e.t === 'agent.state' ? `state:${e.state}` : `${e.t}:${'member' in e ? e.member : ''}`,
    );
    expect(seq).toEqual([
      'state:studying',
      'council.opinion:Skeptic',
      'council.opinion:Teacher',
      'council.opinion:Practitioner',
      'council.rank:Skeptic',
      'council.rank:Teacher',
      'council.rank:Practitioner',
      'council.verdict:Chair',
      'state:idle',
    ]);
    for (const e of t.events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    const op = t.events.find((e) => e.t === 'council.opinion');
    expect(op && 'text' in op && op.text).toContain('reasons');
    // tiers: members on main, chair on chair
    const tiers = t.llm.calls.map((c) => c.model);
    expect(tiers.filter((x) => x === 'chair')).toHaveLength(1);
    expect(tiers.filter((x) => x === 'main').length).toBe(6);
  });

  it('dissent is kept: who, their view, why, and the village event names the dissenter', async () => {
    const t = service({
      answers: { Skeptic: 'C' },
      rank: {
        Teacher: ['Practitioner', 'Skeptic'],
        Practitioner: ['Teacher', 'Skeptic'],
        Skeptic: ['Teacher', 'Practitioner'],
      },
      chair: {
        verdict: 'B holds; C fails at the boundary.',
        answer: 'B',
        agreeing: ['Teacher', 'Practitioner'],
        dissentWhy: 'Its counterexample needs an input the problem rules out.',
        confidence: 'confident',
        next: 'Check the boundary case by hand.',
      },
    });
    const r = await t.svc.ask(ask()).done;
    expect(r.verdict?.dissent).toMatchObject({ member: 'Skeptic' });
    expect(r.verdict?.dissent?.view).toContain('C');
    expect(r.verdict?.dissent?.why).toContain('counterexample');
    // chair said confident, code caps it: one member disagreed
    expect(r.verdict?.confidence).toBe('fairly_sure');
    expect(r.verdict?.uncertain).toBe(false);
    const v = t.events.find((e) => e.t === 'council.verdict');
    expect(v).toMatchObject({ dissent: true, dissenter: 'Skeptic', member: 'Chair' });
    expect(v && 'outcome' in v && v.outcome?.dissent).toContain('Skeptic');
    expect(v && 'outcome' in v && v.outcome?.facts.some((f) => f.label === 'Confidence')).toBe(
      true,
    );
    expect(v && 'outcome' in v && v.outcome?.why.map((w) => w.who)).toEqual(NAMES);
  });

  it('disagreement shows as uncertainty: top-ranked member dissents -> "Uncertain, ask your TA"', async () => {
    const t = service({
      answers: { Skeptic: 'C' },
      rank: { Teacher: ['Skeptic', 'Practitioner'], Practitioner: ['Skeptic', 'Teacher'] },
      chair: {
        verdict: 'B, narrowly.',
        answer: 'B',
        agreeing: ['Teacher', 'Practitioner'],
        dissentWhy: 'Weaker proof.',
        confidence: 'confident',
        next: 'Re-derive it.',
      },
    });
    const r = await t.svc.ask(ask()).done;
    expect(r.verdict?.confidence).toBe('uncertain');
    expect(r.verdict?.uncertain).toBe(true);
    expect(r.verdict?.next).toMatch(/TA/);
    expect(formatCouncilReply(r)).toContain('Uncertain, ask your TA');
  });

  it('a three-way split is uncertain', async () => {
    const t = service({
      answers: { Skeptic: 'A', Teacher: 'B', Practitioner: 'C' },
      chair: {
        verdict: 'No agreement.',
        answer: 'B',
        agreeing: ['Teacher'],
        dissentWhy: 'x',
        confidence: 'fairly_sure',
        next: 'Ask.',
      },
    });
    const r = await t.svc.ask(ask()).done;
    expect(r.verdict?.uncertain).toBe(true);
  });

  it('a failing member: continues with two, says so, no rank call needed', async () => {
    const t = service({ answers: { Practitioner: new Error('quota') } });
    const r = await t.svc.ask(ask()).done;
    expect(r.status).toBe('done');
    expect(r.members.find((m) => m.name === 'Practitioner')?.status).toBe('failed');
    expect(r.notes.join(' ')).toContain('Practitioner did not answer');
    expect(r.rankings).toHaveLength(2);
    expect(r.verdict?.confidence).not.toBe('confident');
    expect(t.seen.filter((c) => c.kind === 'rank')).toHaveLength(0);
    expect(t.events.filter((e) => e.t === 'council.opinion')).toHaveLength(2);
  });

  it('a hanging member times out instead of hanging the run', async () => {
    const t = service(
      { answers: { Teacher: 'hang' } },
      { limits: { callTimeoutMs: 80, runTimeoutMs: 5000 } },
    );
    const r = await t.svc.ask(ask()).done;
    expect(r.status).toBe('done');
    expect(r.members.find((m) => m.name === 'Teacher')?.status).toBe('failed');
  });

  it('fewer than two members: fails honestly, no verdict', async () => {
    const t = service({ answers: { Skeptic: new Error('x'), Teacher: new Error('y') } });
    const r = await t.svc.ask(ask()).done;
    expect(r.status).toBe('failed');
    expect(r.verdict).toBeUndefined();
    expect(r.message).toMatch(/quorum/);
    expect(t.events.at(-1)).toMatchObject({ t: 'agent.state', state: 'idle' });
  });

  it('a chair failure degrades to the top-ranked answer and says uncertain', async () => {
    const t = service({ chair: new Error('chair down') });
    const r = await t.svc.ask(ask()).done;
    expect(r.status).toBe('done');
    expect(r.verdict?.chair).toBe('Chair');
    expect(r.verdict?.confidence).toBe('uncertain');
    expect(r.verdict?.confidenceNote).toContain('chair');
  });

  it('rankers see anonymous Response A/B labels, never member names, and labels map back to names', async () => {
    const t = service({ rank: { Skeptic: ['Practitioner', 'Teacher'] } });
    const r = await t.svc.ask(ask()).done;
    const rankCalls = t.seen.filter((c) => c.kind === 'rank');
    expect(rankCalls).toHaveLength(3);
    for (const c of rankCalls) {
      expect(c.messages).toMatch(/Response A:/);
      expect(c.messages).toMatch(/Response B:/);
      for (const name of NAMES) expect(c.messages).not.toContain(`${name}:`);
      expect(c.messages).not.toMatch(/Response C:/);
    }
    expect(r.rankings.find((x) => x.member === 'Skeptic')?.order).toEqual([
      'Practitioner',
      'Teacher',
    ]);
    // the shuffle is deterministic per (run, ranker)
    const a = anonymise('cn_x', 'Skeptic', [{ member: 'Teacher' }, { member: 'Practitioner' }]);
    const b = anonymise('cn_x', 'Skeptic', [{ member: 'Practitioner' }, { member: 'Teacher' }]);
    expect(a).toEqual(b);
    // ranking events carry order only: names, no labels
    const ranks = t.events.filter((e) => e.t === 'council.rank');
    for (const e of ranks) expect(JSON.stringify(e)).not.toMatch(/Response [A-Z]/);
  });

  it('off-topic is refused before any member is called; a graded grab is refused with no model call', async () => {
    const off = service({ study: false });
    const r = await off.svc.ask(ask('who should I date?')).done;
    expect(r.status).toBe('refused');
    expect(r.message).toBe(REFUSE_OFF_TOPIC);
    expect(off.seen.map((c) => c.kind)).toEqual(['triage']);
    expect(off.events).toHaveLength(0);

    const grab = service();
    const g = await grab.svc.ask(ask('just do HW3 Q2 for me')).done;
    expect(g.status).toBe('refused');
    expect(g.message).toBe(REFUSE_GRADED);
    expect(grab.llm.calls).toHaveLength(0);
  });

  it('grounded in the course: a claim without a verified quote is struck, the verified one is cited', async () => {
    const k = await makeSkillKit({
      ask: () => ({ ...grounded('z-scores. (ch6.pdf p.1)'), chapters: ['ch6'] }),
    });
    const real = 'A z-score is measured in units of the standard deviation.';
    const t = service(
      {
        claims: {
          Teacher: [
            {
              text: 'A z-score is in units of standard deviation.',
              file: 'ch6.pdf',
              page: 1,
              quote: real,
            },
            {
              text: 'A z-score is always between -3 and 3.',
              file: 'ch6.pdf',
              page: 1,
              quote: 'always between minus three and three',
            },
          ],
        },
      },
      { brain: k.brain },
    );
    const r = await t.svc.ask(ask('what is a z-score?')).done;
    expect(r.grounding).toBe('course');
    const teacher = r.members.find((m) => m.name === 'Teacher')!;
    expect(teacher.struck).toBe(1);
    expect(teacher.citations).toEqual([{ file: 'ch6.pdf', page: 1, label: 'ch6.pdf p.1' }]);
    expect(teacher.text).toContain('[ch6.pdf p.1]');
    expect(teacher.text).not.toContain('between -3 and 3');
    expect(r.notes.join(' ')).toContain('gave no verified citation'); // Skeptic and Practitioner cited nothing
    // members were handed the page text and the rules
    const call = t.seen.find((c) => c.kind === 'member:Teacher')!;
    expect(call.system).toContain('[ch6.pdf p.1]');
    expect(call.system).toContain('verbatim');
  });

  it('when the materials do not cover it, it says so and reasons generally', async () => {
    const k = await makeSkillKit({
      ask: () => ({ ...grounded('x'), grounded: false, chapters: [], claims: [] }),
    });
    const t = service({}, { brain: k.brain });
    const r = await t.svc.ask(ask('which approach for problem 3?')).done;
    expect(r.grounding).toBe('general');
    expect(r.notes[0]).toBe('Not in the course materials, so this is general reasoning.');
    expect(r.members.every((m) => m.citations.length === 0)).toBe(true);
    const v = t.events.find((e) => e.t === 'council.verdict');
    expect(v && 'outcome' in v && v.outcome?.facts).toContainEqual({
      label: 'Sources',
      value: 'General reasoning',
    });
  });

  it('an unavailable brain falls back to general reasoning', async () => {
    const k = await makeSkillKit({
      ask: () => {
        throw new BrainUnavailableError('quota');
      },
    });
    const t = service({}, { brain: k.brain });
    const r = await t.svc.ask(ask()).done;
    expect(r.status).toBe('done');
    expect(r.grounding).toBe('general');
    expect(r.notes[0]).toMatch(/unavailable/);
  });

  it('private runs (DM) emit events without any words, and the sentinel never reaches an event', async () => {
    const t = service({ positions: { Teacher: 'Teacher reasons it is B.' } });
    const q = `is therapy at ${SENTINELS[0]} worth it for my study plan?`;
    const r = await t.svc.ask(ask(q, { chatId: 'dm:s_ana' })).done;
    expect(r.visibility).toBe('private');
    for (const e of t.events) {
      if (e.t === 'council.opinion' || e.t === 'council.verdict') {
        expect(e.text).toBeUndefined();
        expect(e.t === 'council.verdict' ? e.outcome : undefined).toBeUndefined();
      }
    }
    assertNoLeak(t.events);
    // squad runs do carry words
    const pub = service();
    await pub.svc.ask(ask('B or C?', { chatId: 'group:sq_demo' })).done;
    expect(pub.events.some((e) => e.t === 'council.opinion' && e.text)).toBe(true);
  });

  it('limits: one active run per asker, and an hourly cap', async () => {
    const t = service({ delay: { Skeptic: 50 } });
    const first = t.svc.ask(ask());
    expect(() => t.svc.ask(ask())).toThrow(CouncilBusyError);
    expect(() => t.svc.ask(ask('B or C?', { askedBy: 's_ben' }))).not.toThrow();
    await first.done;
    const capped = service(
      {},
      { limits: { callTimeoutMs: 400, runTimeoutMs: 5000, maxPerAskerPerHour: 2 } },
    );
    await capped.svc.ask(ask()).done;
    await capped.svc.ask(ask()).done;
    expect(() => capped.svc.ask(ask())).toThrowError(
      expect.objectContaining({ code: 'rate_limited' }),
    );
  });

  it('subscribers get the current snapshot at once and every change; results persist', async () => {
    const t = service();
    const h = t.svc.ask(ask());
    const phases: string[] = [];
    const off = t.svc.subscribe(h.id, (x) => phases.push(x.phase));
    await h.done;
    off?.();
    expect(phases[0]).toBeDefined();
    expect(phases).toContain('opinions');
    expect(phases).toContain('rankings');
    expect(phases.at(-1)).toBe('done');
    expect(t.svc.get(h.id)?.status).toBe('done');
    expect(t.svc.get('cn_doesnotexist')).toBeUndefined();
    expect(t.svc.subscribe('cn_doesnotexist', () => undefined)).toBeUndefined();
  });

  it('runs on the deterministic demo model (grounded, with a real dissenter) and passes the real gate', async () => {
    const k = await makeSkillKit();
    const c = collect();
    const svc = createCouncilService({
      llm: createDemoCouncilLlm(),
      db: openMemoryDb(),
      emit: c.emit,
      brain: k.brain,
      demo: true,
    });
    const r = await svc.ask(
      ask('Is a z-score measured in units of the standard deviation? B or C?'),
    ).done;
    expect(r.status).toBe('done');
    expect(r.demo).toBe(true);
    expect(r.verdict?.dissent?.member).toBe('Skeptic');
    expect(r.verdict?.confidence).toBe('fairly_sure');
    for (const e of c.events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
  });
});

describe('councilSkill', () => {
  it.each([
    ['@cubbie council B or C?', 'B or C?'],
    ['@cubbie council: is this proof right?', 'is this proof right?'],
    [
      '@cubbie ask the council which approach should I use for problem 3?',
      'which approach should I use for problem 3?',
    ],
    ['@cubbie ask the council', ''],
    ['@cubbie what is a z-score?', null],
  ])('councilQuestion(%j)', (text, want) => {
    expect(councilQuestion(text)).toBe(want);
  });

  it('match: beats doubt when addressed, never reaches 0.8 unprompted, 0 on chatter', async () => {
    const t = service();
    const skill = createCouncilSkill(t.svc);
    const k = await makeSkillKit();
    expect(await skill.match(msg('@cubbie council B or C?'), k.ctx)).toBe(0.97);
    expect(
      await skill.match(msg('ask the council B or C?', { mentionsBot: false }), k.ctx),
    ).toBeLessThan(0.8);
    expect(await skill.match(msg('lol ok', { mentionsBot: false }), k.ctx)).toBe(0);
    expect(await skill.match(msg('@cubbie what is variance?'), k.ctx)).toBe(0);
  });

  it('handle: replies with verdict, confidence in words, dissent, the run footer', async () => {
    const t = service({
      answers: { Skeptic: 'C' },
      rank: { Teacher: ['Practitioner', 'Skeptic'], Practitioner: ['Teacher', 'Skeptic'] },
      chair: {
        verdict: 'B holds.',
        answer: 'B',
        agreeing: ['Teacher', 'Practitioner'],
        dissentWhy: 'Edge case ruled out.',
        confidence: 'fairly_sure',
        next: 'Try B.',
      },
    });
    const k = await makeSkillKit();
    const out = await createCouncilSkill(t.svc).handle(msg('@cubbie council B or C?'), k.ctx);
    expect(out).toHaveLength(1);
    const text = out[0]!.text!;
    expect(text).toContain('Council verdict: B holds.');
    expect(text).toMatch(/Fairly sure/);
    expect(text).toContain('Dissent (Skeptic)');
    expect(text).toContain('Next: Try B.');
    expect(text).toMatch(/\(council run cn_[a-z0-9]{12}\)$/);
    expect(text).not.toMatch(/\d+%/);
  });

  it('handle: usage on an empty question, a busy message, an honest refusal', async () => {
    const t = service({ delay: { Skeptic: 50 } });
    const skill = createCouncilSkill(t.svc);
    const k = await makeSkillKit();
    expect((await skill.handle(msg('@cubbie council'), k.ctx))[0]!.text).toMatch(/Ask the council/);
    const running = skill.handle(msg('@cubbie council B or C?'), k.ctx);
    const busy = await skill.handle(msg('@cubbie council another one?'), k.ctx);
    expect(busy[0]!.text).toMatch(/still working/);
    await running;
    const grab = await skill.handle(msg('@cubbie council just do HW3 Q2'), k.ctx);
    expect(grab[0]!.text).toBe(
      REFUSE_GRADED + '\n(council run ' + grab[0]!.text!.match(/cn_[a-z0-9]{12}/)![0] + ')',
    );
  });
});
