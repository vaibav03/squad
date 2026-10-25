import { LlmError, validateA2aTrace, type A2aMessage, type VillageEvent } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { createCouncilAgents } from '../../agents/factory';
import { FakeTransport, call, step, submit } from '../../agents/test-kit';
import { makeSkillKit, msg } from '../testkit';
import { runCoursePlanAgents } from './roundtable-agents';
import { createCoursePlanSkill } from './skill';
import { MOCK_COMPLETED, eligibleCourses, loadCatalog, validatePlan } from './index';

const ID = (k: string): string => `council:roundtable-${k}`;
const { catalog, degree } = loadCatalog();
const input = { completed: [...MOCK_COMPLETED], term: 'fall' as const };
const ctx = { catalog, degree, completed: [...MOCK_COMPLETED], term: 'fall' as const };
const elig = eligibleCourses(catalog, degree, ctx.completed, 'fall');
const pickIds = (n: number): string =>
  elig
    .slice(0, n)
    .map((c) => c.id)
    .join(', ');

const KEYED = { GEMINI_API_KEY: 'unit-test-key-not-real' };

function setup(
  real: FakeTransport | undefined,
  o: { env?: Record<string, string>; max?: number } = {},
) {
  const events: VillageEvent[] = [];
  const agents = createCouncilAgents({
    ...(real ? { transport: real } : {}),
    env: o.env ?? (real ? KEYED : {}),
    emit: (e) => void events.push(e),
    ...(o.max ? { budget: { maxRunsPerHour: o.max } } : {}),
  });
  return { events, agents, emit: (e: VillageEvent) => void events.push(e) };
}

const delegateAll = () =>
  step(
    ...['chill', 'grind', 'advisor'].map((k) =>
      call('delegate', { to: k, question: `Plan as ${k}`, why: `ask ${k}` }),
    ),
  );
const plan = () => submit({ summary: 'Asked the planners.', stance: 'waiting' });
const verdict = () =>
  submit({
    summary: 'Here is the checked plan.',
    stance: 'confirm with advisor',
    answer: 'x',
    confidence: 'confident',
  });
const opinion = (n: number, why = 'Reasonable load.') =>
  submit({ summary: why, stance: 'ok', answer: pickIds(n) });
const rank = () => submit({ summary: 'Fits the limits.', stance: 'ranked', order: ['A', 'B'] });

function happy(): FakeTransport {
  return new FakeTransport()
    .script(ID('chairman'), delegateAll(), plan(), verdict())
    .script(ID('chill'), opinion(3), rank())
    .script(ID('grind'), opinion(5), rank())
    .script(ID('advisor'), opinion(4), rank());
}

const stagesOf = (events: VillageEvent[]): string[] =>
  events.flatMap((e) => (e.t === 'council.stage' ? [e.stage] : []));
const msgsOf = (events: VillageEvent[]): A2aMessage[] =>
  events.flatMap((e) => (e.t === 'a2a.message' ? [e.msg] : []));

describe('round table on the agent runtime', () => {
  it('live happy path: distinct agents, all stages, valid trace, checked plan', async () => {
    const { agents, emit, events } = setup(happy());
    const res = await runCoursePlanAgents({ emit, agents }, input);
    expect(res.mode).toBe('live');
    expect(stagesOf(events)).toEqual(
      [
        'question',
        'delegation',
        'opinions',
        'critiques',
        'dissent',
        'verdict',
        'actions',
        'done',
      ].filter((s) => stagesOf(events).includes(s)),
    );
    for (const s of ['delegation', 'opinions', 'critiques', 'verdict', 'actions'])
      expect(stagesOf(events)).toContain(s);
    const m = msgsOf(events);
    expect(validateA2aTrace(m)).toEqual([]);
    expect(new Set(m.map((x) => x.from)).size).toBeGreaterThanOrEqual(4);
    expect(m.every((x) => x.mode === 'live' && x.source !== 'script')).toBe(true);
    expect(m.some((x) => x.kind === 'verdict')).toBe(true);
    expect(res.opinions.map((o) => o.member).sort()).toEqual(['advisor', 'chill', 'grind']);
    expect(res.rankings).toHaveLength(3);
    expect(
      validatePlan(res.plan.courses, { ...ctx, limits: { maxCredits: 18, minCredits: 12 } }),
    ).toEqual([]);
    expect(res.usedFallback).toBe(false);
    expect(res.replyText).not.toMatch(/Demo|Degraded/);
    expect(events.some((e) => e.t === 'council.verdict' && e.outcome)).toBe(true);
  });

  it('each agent has its own system instruction and the chairman owns delegate', async () => {
    const real = happy();
    const { agents, emit } = setup(real);
    await runCoursePlanAgents({ emit, agents }, input);
    const sys = new Map(real.opened.map((o) => [o.spec.key, o.system]));
    expect(sys.get('chill')).toContain('You are Chill');
    expect(sys.get('grind')).toContain('You are Grind');
    expect(sys.get('advisor')).toContain('You are Advisor');
    expect(sys.get('chairman')).toContain('Chairman');
    const tools = (k: string) =>
      real.opened.find((o) => o.spec.key === k)!.tools.map((t) => t.name);
    expect(tools('chairman')).toContain('delegate');
    expect(tools('chill')).not.toContain('delegate');
    expect(tools('chill')).toContain('submit_turn');
  });

  it('demo run is scripted, branded and never live', async () => {
    const { agents, emit, events } = setup(undefined);
    const res = await runCoursePlanAgents({ emit, agents }, input);
    expect(res.mode).toBe('demo:no_key');
    const m = msgsOf(events);
    expect(m.length).toBeGreaterThan(5);
    expect(m.every((x) => x.mode.startsWith('demo') && x.source === 'script')).toBe(true);
    expect(validateA2aTrace(m)).toEqual([]);
    expect(res.replyText).toMatch(/Demo, scripted, not Gemini/);
    expect(res.plan.courses.length).toBeGreaterThan(0);
    expect(
      validatePlan(res.plan.courses, { ...ctx, limits: { maxCredits: 18, minCredits: 12 } }),
    ).toEqual([]);
  });

  it('402 mid-run: that planner is degraded, no scripted text, the plan is still checked', async () => {
    const real = new FakeTransport()
      .script(ID('chairman'), delegateAll(), plan(), verdict())
      .script(ID('chill'), opinion(3), rank())
      .script(ID('grind'), new LlmError('credits_depleted', 'prepay', 402))
      .script(ID('advisor'), opinion(4), rank());
    const { agents, emit, events } = setup(real);
    const res = await runCoursePlanAgents({ emit, agents }, input);
    expect(res.mode).toBe('degraded:credits_depleted');
    expect(res.opinions.map((o) => o.member)).not.toContain('grind');
    expect(res.usedFallback).toBe(true);
    expect(res.replyText).toMatch(/Degraded: credits depleted/);
    const m = msgsOf(events);
    expect(m.some((x) => x.source === 'script' || x.mode.startsWith('demo'))).toBe(false);
    expect(m.some((x) => x.mode === 'degraded:credits_depleted')).toBe(true);
    expect(
      validatePlan(res.plan.courses, { ...ctx, limits: { maxCredits: 18, minCredits: 12 } }),
    ).toEqual([]);
  });

  it('every planner failing yields a rules plan labelled degraded, not scripted', async () => {
    const e = new LlmError('credits_depleted', 'prepay', 402);
    const real = new FakeTransport()
      .script(ID('chairman'), delegateAll(), plan(), verdict())
      .script(ID('chill'), e)
      .script(ID('grind'), e)
      .script(ID('advisor'), e);
    const { agents, emit, events } = setup(real);
    const res = await runCoursePlanAgents({ emit, agents }, input);
    expect(res.mode!.startsWith('degraded')).toBe(true);
    expect(res.opinions).toHaveLength(0);
    expect(res.replyText).toMatch(/built-in rules/);
    expect(msgsOf(events).some((x) => x.source === 'script')).toBe(false);
  });

  it('chair failure: code delegates, the checked plan still ships, chair is degraded', async () => {
    const t = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const real = new FakeTransport()
      .script(ID('chairman'), t, t, t, t)
      .script(ID('chill'), opinion(3), rank())
      .script(ID('grind'), opinion(5), rank())
      .script(ID('advisor'), opinion(4), rank());
    const { agents, emit, events } = setup(real);
    const res = await runCoursePlanAgents({ emit, agents }, input);
    expect(res.mode).toBe('degraded:timeout');
    expect(res.opinions).toHaveLength(3);
    expect(res.outcome.notes!.join(' ')).toMatch(/chairman did not respond/);
    const v = msgsOf(events).find((x) => x.kind === 'verdict')!;
    expect(v.source).toBe('code');
    expect(v.status).toBe('partial');
  });

  it('delegation caps: duplicate and unknown targets are refused by code', async () => {
    const real = new FakeTransport()
      .script(
        ID('chairman'),
        step(
          call('delegate', { to: 'chill', question: 'q', why: 'w' }),
          call('delegate', { to: 'chill', question: 'q2', why: 'w' }),
          call('delegate', { to: 'nobody', question: 'q', why: 'w' }),
        ),
        plan(),
        verdict(),
      )
      .script(ID('chill'), opinion(3))
      .script(ID('grind'), opinion(5))
      .script(ID('advisor'), opinion(4));
    const { agents, emit } = setup(real);
    await runCoursePlanAgents({ emit, agents }, input);
    const results = JSON.stringify(real.inputsOf(ID('chairman'))[1]);
    expect(results).toMatch(/already delegated to chill/);
    expect(results).toMatch(/unknown specialist/);
    // chill answered once only
    expect(real.queues.get(ID('chill'))).toHaveLength(0);
  });

  it('privacy sentinels never reach any public text or envelope', async () => {
    const real = new FakeTransport()
      .script(ID('chairman'), delegateAll(), plan(), verdict())
      .script(
        ID('chill'),
        step(call('mastery_summary', {})),
        submit({
          summary: 'Skip therapy at $180 and keep it light.',
          stance: 'therapy $180',
          answer: pickIds(3),
        }),
        rank(),
      )
      .script(ID('grind'), opinion(5), rank())
      .script(ID('advisor'), opinion(4), rank());
    const { agents, emit, events } = setup(real);
    const res = await runCoursePlanAgents(
      {
        emit,
        agents,
        viewer: {
          masterySummary: async () => ({ text: 'weak: therapy $180 budgeting' }),
          needles: ['$180', 'therapy'],
        },
      },
      input,
    );
    const everything = JSON.stringify([events, res]);
    expect(everything).not.toContain('$180');
    expect(everything).not.toContain('therapy');
    const tool = msgsOf(events).find((x) => x.to === 'tool:mastery');
    expect(tool?.redaction).toBe('asker_only');
  });

  it('hub-wide hourly cap: a refused run is a labelled rules plan, no model call', async () => {
    const real = happy();
    const { agents, emit } = setup(real, { max: 1 });
    await runCoursePlanAgents({ emit, agents }, input);
    const sent = real.sendCount;
    const res = await runCoursePlanAgents({ emit, agents }, input);
    expect(res.mode).toBe('degraded:hourly_cap');
    expect(real.sendCount).toBe(sent);
    expect(res.plan.courses.length).toBeGreaterThan(0);
  });
});

describe('coursePlan skill with agents', () => {
  it('uses the runtime when agents are given and labels a demo run', async () => {
    const kit = await makeSkillKit();
    const { agents, emit } = setup(undefined);
    const skill = createCoursePlanSkill({ emit, agents });
    const out = await skill.handle(msg('@cubbie plan my fall courses'), kit.ctx);
    expect(out[0]!.text).toMatch(/Round table plan for Fall/);
    expect(out[0]!.text).toMatch(/Demo, scripted, not Gemini/);
  });
  it('COUNCIL_AGENTS=v1 keeps the legacy path', async () => {
    const kit = await makeSkillKit();
    const { agents, emit } = setup(undefined, { env: { COUNCIL_AGENTS: 'v1' } });
    const skill = createCoursePlanSkill({ emit, agents });
    const out = await skill.handle(msg('@cubbie plan my fall courses'), kit.ctx);
    expect(out[0]!.text).toMatch(/Round table plan for Fall/);
    expect(out[0]!.text).not.toMatch(/scripted, not Gemini/);
  });
});
