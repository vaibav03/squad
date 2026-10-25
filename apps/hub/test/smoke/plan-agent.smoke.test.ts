// The study-plan planner agent (FakeLlm as the "real" model): the proposal is written by the agent, checked in code
// (quotes verified, private words stripped, busy days avoided), labelled Live/Degraded with its sources; a failing agent
// and a missing key fall back to the deterministic generator, labelled "Fallback sample plan", never as agent output.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm, ChatMessageSchema, planBadge, type ChatMessage, type PlanView } from '@squad/core';
import { createCourseStore } from '@squad/brain';
import { attachChatEngine } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { auth, boot, login } from '../helpers';

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const PAGE =
  'The empirical rule says about 68 percent of values lie within one standard deviation of the mean.';

function seed(hub: RunningHub) {
  const cs = createCourseStore(hub.deps.db);
  cs.saveCourse({ id: 'demo', title: 'Statistics' });
  for (const [i, id] of ['ch1', 'ch2', 'ch3', 'ch4'].entries()) {
    cs.saveChapter({
      courseId: 'demo',
      id,
      title: `Topic ${i + 1}`,
      summary: 's',
      file: `${id}-slides.pdf`,
      pageStart: 1,
      pageEnd: 20,
    });
    cs.savePages([{ courseId: 'demo', chapter: id, file: `${id}-slides.pdf`, page: 1, text: PAGE }]);
  }
}

const agentJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    rationale: 'Each chapter gets a review before the exam, with a short group practice on the last day.',
    items: [
      ...['ch1', 'ch2', 'ch3', 'ch4'].map((c, i) => ({
        chapter: c,
        ownerId: ['s_ana', 's_ben', 's_chi', 's_dev'][i],
        kind: 'review',
        title: `${c} review`,
        topic: `Topic ${i + 1}`,
        date: day(2 + i),
        durationMin: 60,
        why: `Covers the ${c} slides before the exam.`,
        page: 1,
        quote: i === 3 ? 'a quote the page never says anywhere' : 'about 68 percent of values lie within one standard deviation',
      })),
      {
        chapter: 'all',
        ownerId: 's_ana',
        kind: 'practice',
        title: 'Group practice quiz',
        date: day(8),
        durationMin: 45,
        why: 'Ana is weakest in ch2, so she goes last.',
      },
    ],
    ...over,
  });

let hub: RunningHub;
let url: string;
let tok: Record<string, string>;
let fake: FakeLlm;

async function boot2(real: FakeLlm | null, ports: 'real' | 'stub' = 'stub') {
  hub = await boot();
  url = hub.url;
  seed(hub);
  await attachChatEngine(hub, { real, env: {}, envFile: false, noProbe: true });
  if (ports === 'real') {
    const rt = hub.deps.runtime!;
    hub.deps.runtime = { ...rt, ports: () => 'real' };
  }
  tok = { s_ana: await login(url, 's_ana'), s_ben: await login(url, 's_ben') };
}
const propose = async () => {
  const r = await fetch(`${url}/v1/plans`, {
    method: 'POST',
    headers: auth(tok.s_ana!),
    body: JSON.stringify({ examDate: day(10) }),
  });
  return { status: r.status, body: (await r.json()) as { plan?: PlanView } };
};
const groupBot = (): ChatMessage[] =>
  hub.deps.chat.store
    .since(0, ['group:sq_demo'])
    .map((m) => ChatMessageSchema.parse(m))
    .filter((m) => m.sender.kind === 'persona' && m.card?.type === 'plan');

afterEach(async () => {
  await hub.stop();
});

describe('study plan written by the planner agent', () => {
  beforeEach(async () => {
    fake = new FakeLlm({ responses: [agentJson()] });
    await boot2(fake, 'real');
  });

  it('is produced by the agent, labelled Live, with verified sources and a rationale', async () => {
    const { status, body } = await propose();
    expect(status).toBe(200);
    const p = body.plan!;
    expect(p.generator).toMatchObject({ kind: 'agent', mode: 'live', source: 'planner' });
    expect(planBadge(p.generator)).toMatchObject({ label: 'Live', kindLabel: 'Planner agent' });
    expect(p.rationale).toMatch(/review before the exam/);
    expect(fake.calls).toHaveLength(1);
    // verbatim quotes became sources; the invented quote did not
    const ch1 = p.items.find((i) => i.chapter === 'ch1')!;
    expect(ch1.sources[0]).toMatchObject({ kind: 'material', file: 'ch1-slides.pdf', page: 1 });
    expect(p.items.find((i) => i.chapter === 'ch4')!.sources).toEqual([]);
    expect(p.citations.some((c) => c.label === 'ch4-slides.pdf p.1')).toBe(false);
    // a private-sounding "why" is removed, a plain one is kept
    expect(p.items.find((i) => i.kind === 'practice')!.why).toBeUndefined();
    expect(ch1.why).toMatch(/slides/);
  });

  it('the plan message carries chips for the verified pages and no fallback label', async () => {
    await propose();
    const m = groupBot().at(-1)!;
    expect(m.provenance?.kind).toBe('grounded');
    expect(m.citations.map((c) => c.file)).toContain('ch1-slides.pdf');
    expect(m.text).toMatch(/Planner agent \(Live\)/);
  });

  it('the prompt carries private hints only as ids and never leaves the model prompt in the group text', async () => {
    await propose();
    const prompt = JSON.stringify(fake.calls[0]);
    expect(prompt).toMatch(/PRIVATE hints/);
    for (const m of groupBot()) expect(m.text).not.toMatch(/weakest|box \d|busy/i);
  });

  it('a stubbed port stack is Degraded but still agent output', async () => {
    await hub.stop();
    fake = new FakeLlm({ responses: [agentJson()] });
    await boot2(fake, 'stub');
    const p = (await propose()).body.plan!;
    expect(p.generator).toMatchObject({ kind: 'agent', mode: 'degraded' });
    expect(planBadge(p.generator).label).toMatch(/^Degraded: /);
  });
});

describe('study plan fallback', () => {
  it('an agent that fails (bad JSON) falls back, labelled Fallback sample plan, Degraded with the reason', async () => {
    fake = new FakeLlm({ responses: ['I cannot do that'] });
    await boot2(fake, 'real');
    const p = (await propose()).body.plan!;
    expect(p.generator.kind).toBe('fallback');
    expect(p.generator.mode).toBe('degraded');
    expect(p.generator.reason).toMatch(/planner/);
    expect(planBadge(p.generator).kindLabel).toBe('Fallback sample plan');
    expect(p.rationale).toBeUndefined();
    const m = groupBot().at(-1)!;
    expect(m.provenance).toMatchObject({ kind: 'sample' });
    expect(m.provenance!.label).toMatch(/Fallback sample plan/);
    expect(m.provenance!.label).toMatch(/not written by an agent/);
  });

  it('no Gemini key: Demo, scripted, never presented as agent output', async () => {
    await boot2(null);
    const p = (await propose()).body.plan!;
    expect(p.generator).toMatchObject({ kind: 'fallback', mode: 'demo' });
    expect(planBadge(p.generator)).toMatchObject({
      label: 'Demo: sample data, scripted',
      kindLabel: 'Fallback sample plan',
      fallback: true,
    });
    expect(p.generator.note).toMatch(/not written by an agent/);
    const m = groupBot().at(-1)!;
    expect(m.provenance?.kind).toBe('sample');
    expect(m.demo).toBe(true);
  });

  it('persists: the saved block, the posted message and the sync state come back on a fresh read', async () => {
    await boot2(null);
    await propose();
    const r = await fetch(`${url}/v1/plans/current`, { headers: auth(tok.s_ben!) });
    const view = ((await r.json()) as { plan: PlanView }).plan;
    expect(view.saved).toMatchObject({ rev: 1, lastEditedBy: 'Ana' });
    expect(view.saved.lastEditedAt).toBeGreaterThan(0);
    expect(view.sync.posted?.text).toMatch(/proposed a study plan/);
    expect(view.sync.imessage).toBe('off');
  });
});
