import { describe, expect, it } from 'vitest';
import {
  FakeLlm,
  LlmError,
  validateA2aTrace,
  type A2aMessage,
  type VillageEvent,
} from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCouncilAgents } from '../agents/factory';
import { FakeTransport, call, step, submit, type Step } from '../agents/test-kit';
import type { ToolResultInput } from '../agents/types';
import { makeSkillKit, grounded } from '../skills/testkit';
import { REFUSE_GRADED } from './ask-run';
import { createCouncilService } from './service';
import type { AskViewerData } from './ask-v2';

const CHAIR = 'council:ask-chair';
const SKEPTIC = 'council:ask-skeptic';
const TEACHER = 'council:ask-teacher';
const PRACT = 'council:ask-practitioner';
const SPECIALISTS = [SKEPTIC, TEACHER, PRACT];
const ANSWERS: Record<string, string> = { [SKEPTIC]: 'B', [TEACHER]: 'B', [PRACT]: 'A' };
const asText = (i: string | ToolResultInput[]): string => (typeof i === 'string' ? i : '');

const many = (fn: Step, n = 8): Step[] => Array.from({ length: n }, () => fn);

/** A specialist that answers by what it is asked (opinion / rank / peer question), so call order never matters. */
const specialist =
  (id: string, o: { answer?: string; extra?: Record<string, unknown>; first?: Step } = {}): Step =>
  (input) => {
    const t = asText(input);
    if (t.includes('A colleague asks'))
      return submit({ summary: 'Yes, if the assumption holds.', stance: 'answered a colleague' });
    if (t.includes('Now judge')) {
      // labels are shuffled per run: rank the responses whose committed answer is B first
      const rows = [...t.matchAll(/Response ([A-Z]):.*?\(answer: ([^)]*)\)/gs)];
      const order = rows
        .sort((a, b) => Number(b[2] === 'B') - Number(a[2] === 'B'))
        .map((r) => r[1]!);
      return submit({ summary: 'Reasoning compared.', stance: 'ranked', order });
    }
    return submit({
      summary: `${id.split('-')[1]} thinks ${o.answer ?? ANSWERS[id]}.`,
      stance: 'committed',
      answer: o.answer ?? ANSWERS[id],
      ...o.extra,
    });
  };

const chairStep =
  (o: { verdict?: Record<string, unknown> | Error; plan?: Error } = {}): Step =>
  (input) => {
    const t = asText(input);
    if (t.includes('Delegate to your specialists')) {
      if (o.plan) throw o.plan;
      return step(
        call('delegate', { to: 'skeptic', question: 'q?', why: 'doubt it' }),
        call('delegate', { to: 'teacher', question: 'q?', why: 'first principles' }),
        call('delegate', { to: 'practitioner', question: 'q?', why: 'what works' }),
      );
    }
    if (t.includes('have answered')) {
      if (o.verdict instanceof Error) throw o.verdict;
      return submit(
        o.verdict ?? {
          summary: 'Go with B.',
          answer: 'B',
          confidence: 'confident',
          stance: 'Try B on a small example.',
          dissent: { member: 'Practitioner', why: 'Their shortcut skips an assumption.' },
        },
      );
    }
    // after the delegate results: the plan turn
    return submit({ summary: 'Asked all three.', stance: 'waiting' });
  };

function fullScript(t: FakeTransport, o: Parameters<typeof chairStep>[0] = {}): FakeTransport {
  t.script(CHAIR, ...many(chairStep(o), 6));
  for (const id of SPECIALISTS) t.script(id, ...many(specialist(id)));
  return t;
}

function build(
  o: {
    transport?: FakeTransport | null;
    env?: Record<string, string>;
    brain?: Parameters<typeof createCouncilService>[0]['brain'];
    viewer?: (a: string, v: 'squad' | 'private') => AskViewerData | undefined;
    health?: () => { llm: 'real' | 'fake'; reason?: string } | undefined;
  } = {},
) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent): void => void events.push(e);
  const agents = createCouncilAgents({
    ...(o.transport ? { transport: o.transport } : {}),
    env: o.env ?? {},
    emit,
    ...(o.health ? { health: o.health } : {}),
  });
  const svc = createCouncilService({
    llm: new FakeLlm(),
    db: openMemoryDb(),
    emit,
    agents,
    ...(o.brain ? { brain: o.brain, courseId: () => 'demo' } : {}),
    ...(o.viewer ? { viewer: o.viewer } : {}),
  });
  const ask = (q = 'Is B or A right for problem 3?', extra: { chatId?: string } = {}) =>
    svc.ask({ question: q, askedBy: 's_ana', chatId: 'group:sq', ...extra }).done;
  return { svc, ask, events, agents };
}

const msgsOf = (events: VillageEvent[]): A2aMessage[] =>
  events.flatMap((e) => (e.t === 'a2a.message' ? [e.msg] : []));
const stagesOf = (events: VillageEvent[]): string[] =>
  events.flatMap((e) => (e.t === 'council.stage' ? [e.stage] : []));
const dedupe = (xs: string[]): string[] => xs.filter((x, i) => x !== xs[i - 1]);

describe('Ask council v2: demo run (no key)', () => {
  it('is an honestly labelled scripted run end to end', async () => {
    const { ask, events } = build();
    const r = await ask();
    expect(r.status).toBe('done');
    expect(r.mode).toBe('demo:no_key');
    expect(r.demo).toBe(true);
    const msgs = msgsOf(events);
    expect(msgs.length).toBeGreaterThan(6);
    for (const m of msgs) {
      expect(m.source).toBe('script');
      expect(m.mode).toBe('demo:no_key');
    }
    expect(validateA2aTrace(msgs)).toEqual([]);
    expect(dedupe(stagesOf(events))).toEqual([
      'question',
      'delegation',
      'opinions',
      'critiques',
      'dissent',
      'verdict',
      'actions',
      'done',
    ]);
    type Legacy = { t: string; a2aId?: string; mode?: string };
    const legacy = events.filter((e) =>
      ['council.opinion', 'council.rank', 'council.verdict'].includes(e.t),
    ) as unknown as Legacy[];
    expect(legacy.map((e) => e.t)).toContain('council.verdict');
    expect(legacy.filter((e) => e.t === 'council.opinion')).toHaveLength(3);
    for (const e of legacy) {
      expect(e.a2aId).toMatch(/^am_/);
      expect(e.mode).toMatch(/^demo/);
    }
    expect(r.agents?.map((a) => a.transport)).toEqual(['demo', 'demo', 'demo', 'demo']);
    expect(r.agents?.map((a) => a.id).sort()).toEqual([CHAIR, PRACT, SKEPTIC, TEACHER].sort());
  });

  it('a key that is configured but unhealthy at start is a labelled demo run, never live', async () => {
    const { ask } = build({
      env: { GEMINI_API_KEY: 'x' },
      health: () => ({ llm: 'fake', reason: 'credits_depleted' }),
    });
    const r = await ask();
    expect(r.mode).toBe('demo:credits_depleted');
    expect(r.demo).toBe(true);
  });
});

describe('Ask council v2: live happy path', () => {
  it('chair delegates in one step, specialists consult once, rank, verdict with dissent refs', async () => {
    const t = new FakeTransport();
    t.script(CHAIR, ...many(chairStep(), 6));
    // the skeptic consults the teacher before answering
    t.script(
      SKEPTIC,
      step(call('ask_peer', { to: 'teacher', question: 'Does step 2 assume a fixed value?' })),
      ...many(specialist(SKEPTIC)),
    );
    t.script(TEACHER, ...many(specialist(TEACHER)));
    t.script(PRACT, ...many(specialist(PRACT)));
    const { ask, events } = build({ transport: t });
    const r = await ask();

    expect(r.status).toBe('done');
    expect(r.mode).toBe('live');
    expect(r.demo).toBe(false);
    const msgs = msgsOf(events);
    expect(validateA2aTrace(msgs)).toEqual([]);
    for (const m of msgs) {
      expect(m.source).not.toBe('script');
      expect(m.mode).toBe('live');
    }
    for (const e of events) if (e.t === 'council.stage') expect(e.mode).toBe('live');
    expect(dedupe(stagesOf(events))).toEqual([
      'question',
      'delegation',
      'opinions',
      'critiques',
      'dissent',
      'verdict',
      'actions',
      'done',
    ]);
    // three delegations from the chair, one ask (peer), one ask_peer answer
    expect(msgs.filter((m) => m.kind === 'delegate')).toHaveLength(3);
    expect(
      msgs.filter((m) => m.kind === 'ask' && m.from === SKEPTIC && m.to === TEACHER),
    ).toHaveLength(1);
    expect(msgs.filter((m) => m.kind === 'rank')).toHaveLength(3);
    // the chair delegated all three in ONE model step (first chair input is the prompt, second is tool results)
    const chairInputs = t.inputsOf(CHAIR);
    expect(chairInputs.filter((i) => typeof i !== 'string')[0]).toHaveLength(3);
    // the peer answer does not count as the teacher's committed answer
    expect(
      msgs.filter((m) => m.kind === 'answer' && m.from === TEACHER && m.to === CHAIR),
    ).toHaveLength(1);

    const verdict = msgs.find((m) => m.kind === 'verdict')!;
    const practAnswer = msgs.find((m) => m.kind === 'answer' && m.from === PRACT)!;
    expect(verdict.dissentRefs).toEqual([practAnswer.id]);
    expect(verdict.confidence).toBe('fairly_sure'); // chair said confident, capped by the dissent
    expect(r.verdict?.dissent?.member).toBe('Practitioner');
    expect(r.verdict?.answer).toBe('B');
    expect(r.agents).toHaveLength(4);
    expect(r.agents?.every((a) => a.transport === 'stream-text' && a.mode === 'live')).toBe(true);
    expect(r.messages?.length).toBe(msgs.length);
    expect(r.members.map((m) => m.status)).toEqual(['answered', 'answered', 'answered']);
    expect(r.rankings).toHaveLength(3);
    expect(events.filter((e) => e.t === 'council.rank')).toHaveLength(3);
    expect(r.stage).toBe('done');

    // action items: one chair `status` envelope per item at stage `actions`, mirrored in result.actions
    const actionMsgs = msgs.filter((m) => m.stage === 'actions');
    expect(actionMsgs.length).toBeGreaterThanOrEqual(2);
    expect(actionMsgs.length).toBeLessThanOrEqual(4);
    for (const m of actionMsgs) {
      expect(m.from).toBe(CHAIR);
      expect(m.kind).toBe('status');
      expect(m.source).toBe('code');
      expect(m.parentMessageId).toBe(verdict.id);
    }
    expect(r.actions?.map((a) => a.id)).toEqual(actionMsgs.map((m) => m.id));
    expect(r.actions?.[0]?.title).toContain('Try B on a small example');
    expect(r.actions?.some((a) => /Ask your TA about Practitioner/.test(a.title))).toBe(true);
  });
});

describe('Ask council v2: grounding', () => {
  it('keeps a verbatim quote, strips an invented one, and reports course grounding', async () => {
    const kit = await makeSkillKit({
      ask: () => ({ ...grounded('z-scores'), citations: [] }),
    });
    const t = new FakeTransport();
    t.script(CHAIR, ...many(chairStep(), 6));
    t.script(
      SKEPTIC,
      step(call('retrieve_course', { query: 'what is a z-score' })),
      (input) => {
        void input;
        return submit({
          summary: 'A z-score uses standard deviations.',
          stance: 'grounded',
          answer: 'B',
          citations: [
            { file: 'ch6.pdf', page: 1, quote: 'measured in units of the standard deviation' },
            { file: 'ch6.pdf', page: 1, quote: 'a completely invented sentence about unicorns' },
          ],
        });
      },
      ...many(specialist(SKEPTIC)),
    );
    t.script(TEACHER, ...many(specialist(TEACHER)));
    t.script(PRACT, ...many(specialist(PRACT)));
    const { ask } = build({ transport: t, brain: kit.brain });
    const r = await ask();
    expect(r.grounding).toBe('course');
    const sk = r.members.find((m) => m.id === 'skeptic')!;
    expect(sk.citations).toEqual([{ file: 'ch6.pdf', page: 1, label: 'ch6.pdf p.1' }]);
    expect(sk.struck).toBe(1);
  });

  it('no course hit means general reasoning, said plainly', async () => {
    const kit = await makeSkillKit();
    const { ask } = build({ transport: fullScript(new FakeTransport()), brain: kit.brain });
    const r = await ask();
    expect(r.grounding).toBe('none');
    expect(r.notes.join(' ')).toMatch(/general reasoning/);
  });
});

describe('Ask council v2: failures stay honest', () => {
  it('402 on the 2nd specialist: degraded:credits_depleted, partial verdict, never demo text', async () => {
    const t = new FakeTransport();
    t.script(CHAIR, ...many(chairStep(), 6));
    t.script(SKEPTIC, ...many(specialist(SKEPTIC)));
    t.script(TEACHER, new LlmError('credits_depleted', 'prepayment depleted', 402));
    t.script(PRACT, ...many(specialist(PRACT)));
    const { ask, events } = build({ transport: t });
    const r = await ask();
    expect(r.mode).toBe('degraded:credits_depleted');
    expect(r.demo).toBe(false);
    expect(r.members.find((m) => m.id === 'teacher')?.status).toBe('failed');
    for (const m of msgsOf(events)) {
      expect(m.source).not.toBe('script');
      expect(m.mode === 'live' || m.mode === 'degraded:credits_depleted').toBe(true);
    }
    expect(JSON.stringify(events)).not.toMatch(/Scripted|demo/i);
    // either a partial verdict from the two that answered, or an honest failure; never a scripted one
    if (r.status === 'done') expect(r.verdict).toBeDefined();
    else expect(r.message).toMatch(/credits|quorum/i);
    const failedCard = r.agents?.find((a) => a.id === TEACHER);
    expect(failedCard?.status).toBe('failed');
    expect(failedCard?.mode).toBe('degraded:credits_depleted');
  });

  it('quorum failure: two specialists down ends failed with the honest halt message', async () => {
    const t = new FakeTransport();
    t.script(CHAIR, ...many(chairStep(), 6));
    t.script(SKEPTIC, new LlmError('credits_depleted', 'depleted', 402));
    t.script(TEACHER, new LlmError('credits_depleted', 'depleted', 402));
    t.script(PRACT, ...many(specialist(PRACT)));
    const { ask } = build({ transport: t });
    const r = await ask();
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/credits are depleted/);
    expect(r.mode?.startsWith('degraded')).toBe(true);
    expect(r.verdict).toBeUndefined();
  });

  it('chair fails at the plan: code delegates, chair degraded, run still concludes', async () => {
    const t = new FakeTransport();
    t.script(
      CHAIR,
      new LlmError('other', 'boom', 500),
      ...many(chairStep({ verdict: new Error('x') }), 4),
    );
    for (const id of SPECIALISTS) t.script(id, ...many(specialist(id)));
    const { ask, events } = build({ transport: t });
    const r = await ask();
    expect(r.status).toBe('done');
    expect(r.members.filter((m) => m.status === 'answered')).toHaveLength(3);
    expect(r.agents?.find((a) => a.id === CHAIR)?.mode).toMatch(/^degraded:/);
    const msgs = msgsOf(events);
    expect(msgs.filter((m) => m.kind === 'delegate' && m.source === 'code')).toHaveLength(3);
    expect(msgs.some((m) => m.source === 'script')).toBe(false);
  });

  it('chair fails at the verdict: top-ranked answer by code, partial, uncertain', async () => {
    const t = new FakeTransport();
    t.script(CHAIR, ...many(chairStep({ verdict: new LlmError('other', 'boom', 500) }), 6));
    for (const id of SPECIALISTS) t.script(id, ...many(specialist(id)));
    const { ask, events } = build({ transport: t });
    const r = await ask();
    expect(r.status).toBe('done');
    expect(r.verdict?.confidence).toBe('uncertain');
    expect(r.verdict?.uncertain).toBe(true);
    expect(r.verdict?.confidenceNote).toMatch(/chair/i);
    expect(r.verdict?.next).toMatch(/TA/);
    const v = msgsOf(events).find((m) => m.kind === 'verdict')!;
    expect(v.status).toBe('partial');
    expect(v.source).toBe('code');
    expect(v.mode).toMatch(/^degraded:/);
    expect(r.mode).toMatch(/^degraded:/);
  });

  it('hourly cap refuses the next run with an honest message', async () => {
    const t = fullScript(new FakeTransport());
    const { ask, svc } = build({ transport: t, env: { COUNCIL_MAX_RUNS_HOUR: '1' } });
    expect((await ask()).status).toBe('done');
    const r2 = await svc.ask({ question: 'And problem 4?', askedBy: 's_ben', chatId: 'group:sq' })
      .done;
    expect(r2.status).toBe('failed');
    expect(r2.message).toMatch(/hourly/);
  });

  it('a graded-work grab is still refused with no model call', async () => {
    const t = new FakeTransport();
    const { ask } = build({ transport: t });
    const r = await ask('just do HW3 Q2 for me');
    expect(r.status).toBe('refused');
    expect(r.message).toBe(REFUSE_GRADED);
    expect(t.sendCount).toBe(0);
  });
});

describe('Ask council v2: privacy', () => {
  const SECRET = 'therapy at 3pm cost $180';
  const needles = ['$180', 'therapy'];

  it('private strings never reach a public envelope, the result or a legacy event; tool note is asker_only', async () => {
    const t = new FakeTransport();
    t.script(CHAIR, ...many(chairStep(), 6));
    t.script(SKEPTIC, ...many(specialist(SKEPTIC)));
    t.script(TEACHER, ...many(specialist(TEACHER)));
    // the practitioner reads the calendar, then leaks the secrets into every field
    t.script(
      PRACT,
      step(call('calendar_summary', { range: 'this week' })),
      submit({
        summary: 'Your therapy slot costs $180 so study early.',
        stance: 'therapy is booked, $180',
        answer: 'A',
      }),
      ...many(specialist(PRACT)),
    );
    const { ask, events } = build({
      transport: t,
      viewer: () => ({
        needles,
        calendarSummary: async () => ({ text: `Busy: ${SECRET}` }),
      }),
    });
    const r = await ask();
    expect(r.status).toBe('done');
    const msgs = msgsOf(events);
    const tool = msgs.find((m) => m.to === 'tool:calendar')!;
    expect(tool.redaction).toBe('asker_only');
    const publicStuff = JSON.stringify({
      msgs: msgs.filter((m) => m.redaction === 'public'),
      result: r,
      legacy: events.filter((e) => e.t.startsWith('council.') && e.t !== 'council.stage'),
    });
    expect(publicStuff).not.toContain('$180');
    expect(publicStuff).not.toContain('therapy');
    expect(publicStuff).toContain('[private]');
    // the model did get the (scrubbed-for-public) data it asked for; the specialists see it
    const practInputs = JSON.stringify(t.inputsOf(PRACT));
    expect(practInputs).toContain('Busy');
  });

  it('a DM (private) run emits legacy opinion/verdict events without any text', async () => {
    const { ask, events } = build({ transport: fullScript(new FakeTransport()) });
    const r = await ask('Is B or A right?', { chatId: 'dm:s_ana' });
    expect(r.visibility).toBe('private');
    expect(r.status).toBe('done');
    const legacy = events.filter((e) => ['council.opinion', 'council.verdict'].includes(e.t)) as {
      text?: string;
      outcome?: unknown;
    }[];
    expect(legacy.length).toBe(4);
    for (const e of legacy) {
      expect(e.text).toBeUndefined();
      expect(e.outcome).toBeUndefined();
    }
  });
});

describe('service.ownerOf', () => {
  it('reports the asker and privacy of a run (used by the hub per-viewer filter)', async () => {
    const { svc } = build({ transport: fullScript(new FakeTransport()) });
    const h = svc.ask({ question: 'B or A?', askedBy: 's_ana', chatId: 'dm:s_ana' });
    expect(svc.ownerOf?.(h.id)).toEqual({ askedBy: 's_ana', private: true });
    expect(svc.ownerOf?.('cn_zzzzzzzzzzzz')).toBeUndefined();
    await h.done;
  });
});
