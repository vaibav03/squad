import { describe, expect, it } from 'vitest';
import {
  LlmError,
  agentId,
  validateA2aTrace,
  type A2aMessage,
  type VillageEvent,
} from '@squad/core';
import { createCouncilAgents } from '../../agents/factory';
import { FakeTransport, submit } from '../../agents/test-kit';
import { runDebateV2 } from './debate-agents';

const ID = (k: string) => agentId.council(`debate-${k}`);
const MATERIAL = {
  chapter: 'ch2',
  context:
    '[ch2.pdf p.1] The median is robust to outliers because it only depends on the middle value.\n' +
    '[ch2.pdf p.2] The mean uses every value, so one extreme value can pull it far away.',
};

function setup(real?: FakeTransport) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const agents = createCouncilAgents({ ...(real ? { transport: real } : {}), env: {}, emit });
  const msgs = () =>
    events.filter((e) => e.t === 'a2a.message').map((e) => (e as { msg: A2aMessage }).msg);
  const stages = () =>
    events.filter((e) => e.t === 'council.stage').map((e) => (e as { stage: string }).stage);
  return { agents, events, emit, msgs, stages };
}

const frame = submit({ summary: 'Framed.', answer: 'Use the median', stance: 'Use the mean' });
const arg = (text: string, answer: string, cite?: Record<string, unknown>) =>
  submit({ summary: text, stance: 's', answer, ...(cite ? { citations: [cite] } : {}) });
const verdict = (answer: string) =>
  submit({ summary: 'It answered the outlier problem directly.', stance: 'j', answer });
const input = { question: 'Mean or median for skewed data?', students: [] as never[] };

describe('runDebateV2 (live, FakeTransport)', () => {
  it('runs every stage with three distinct agents, verified citation, valid trace', async () => {
    const t = new FakeTransport();
    t.script(ID('judge'), frame, verdict('pro'));
    t.script(ID('pro'), (_i, _o) => ({
      text: '',
      toolCalls: [{ id: 'r1', name: 'retrieve_course', args: { query: 'median' } }],
    }));
    t.script(
      ID('pro'),
      arg('The median ignores outliers.', 'median', {
        file: 'ch2.pdf',
        page: 1,
        quote: 'The median is robust to outliers',
      }),
    );
    t.script(
      ID('con'),
      arg('The mean uses all data.', 'mean', {
        file: 'ch2.pdf',
        page: 2,
        quote: 'invented words not on the page',
      }),
    );
    const s = setup(t);
    const res = await runDebateV2(
      { agents: s.agents, emit: s.emit },
      { ...input, material: MATERIAL },
    );
    expect(res.winner).toBe('pro');
    expect(res.positions).toEqual({ pro: 'Use the median', con: 'Use the mean' });
    expect(res.citations).toEqual([{ file: 'ch2.pdf', page: 1 }]); // the invented quote was struck
    expect(res.opinions.find((o) => o.member === 'con')!.text).not.toContain('[');
    expect(res.usedFallback).toBe(false);
    expect(s.stages()).toEqual([
      'question',
      'delegation',
      'opinions',
      'verdict',
      'actions',
      'done',
    ]);
    expect(validateA2aTrace(s.msgs())).toEqual([]);
    expect(new Set(s.msgs().map((m) => m.from))).toEqual(
      new Set([ID('judge'), ID('pro'), ID('con')]),
    );
    const v = s.msgs().find((m) => m.kind === 'verdict')!;
    expect(v.mode).toBe('live');
    expect(v.source).toBe('model');
    expect(v.dissentRefs?.length).toBe(1); // the losing side is recorded
    // three separate system instructions
    expect(new Set(t.opened.map((o) => o.system)).size).toBe(3);
  });

  it('records the room as dissent when it overrules the judge', async () => {
    const t = new FakeTransport();
    t.script(ID('judge'), frame, verdict('pro'));
    t.script(ID('pro'), arg('A', 'median'));
    t.script(ID('con'), arg('B', 'mean'));
    const s = setup(t);
    const res = await runDebateV2(
      { agents: s.agents, emit: s.emit },
      { ...input, students: ['s_ana', 's_ben'] as never[], askVote: async () => 'con' },
    );
    expect(res.winner).toBe('pro');
    expect(res.outcome.dissent).toMatch(/room voted/);
    expect(res.verdict.dissenter).toBe('con');
    expect(s.stages()).toContain('dissent');
  });

  it('402 while Con argues: partial, labelled degraded, no scripted text', async () => {
    const t = new FakeTransport();
    t.script(ID('judge'), frame);
    t.script(ID('pro'), arg('The median ignores outliers.', 'median'));
    t.script(ID('con'), new LlmError('credits_depleted', 'prepay', 402));
    const s = setup(t);
    const res = await runDebateV2({ agents: s.agents, emit: s.emit }, input);
    expect(res.winner).toBe('draw');
    expect(res.usedFallback).toBe(true);
    expect(res.replyText).toContain('Degraded');
    expect(res.replyText).toContain('Con could not argue');
    expect(res.replyText).not.toContain('Demo');
    expect(s.msgs().every((m) => m.source !== 'script')).toBe(true);
    expect(s.msgs().some((m) => m.mode === 'degraded:credits_depleted')).toBe(true);
    expect(validateA2aTrace(s.msgs())).toEqual([]);
  });

  it('judge failure at the verdict: follows the room, labelled degraded', async () => {
    const t = new FakeTransport();
    t.script(ID('judge'), frame, new LlmError('rate_limited', 'slow', 429));
    t.script(ID('pro'), arg('A', 'median'));
    t.script(ID('con'), arg('B', 'mean'));
    const s = setup(t);
    const res = await runDebateV2(
      { agents: s.agents, emit: s.emit },
      { ...input, students: ['s_ana'] as never[], askVote: async () => 'con' },
    );
    expect(res.winner).toBe('con');
    expect((res.outcome.notes ?? []).join(' ')).toContain('Degraded');
    const v = s.msgs().find((m) => m.kind === 'verdict')!;
    expect(v.source).toBe('code');
    expect(v.mode).toBe('degraded:rate_limited');
  });

  it('judge cannot frame: neutral code labels, never scripted stock', async () => {
    const t = new FakeTransport();
    t.script(ID('judge'), new Error('boom'), verdict('draw'));
    t.script(ID('pro'), arg('A', 'x'));
    t.script(ID('con'), arg('B', 'y'));
    const s = setup(t);
    const res = await runDebateV2({ agents: s.agents, emit: s.emit }, input);
    expect(res.positions).toEqual({ pro: 'In favour', con: 'Against' });
    expect(res.usedFallback).toBe(true);
  });

  it('only submit_turn text is public: stray text and thinking never appear', async () => {
    const t = new FakeTransport();
    t.script(ID('judge'), frame, verdict('pro'));
    t.script(
      ID('pro'),
      { text: 'SENTINEL_THOUGHT_d2 private reasoning', toolCalls: [] },
      arg('The median ignores outliers.', 'median'),
    );
    t.script(ID('con'), arg('The mean uses all data.', 'mean'));
    const s = setup(t);
    const res = await runDebateV2({ agents: s.agents, emit: s.emit }, input);
    const blob = JSON.stringify({ res, events: s.events });
    expect(blob).not.toContain('SENTINEL_THOUGHT_d2');
  });
});

describe('runDebateV2 (demo)', () => {
  it('without a model it is a labelled demo run: every envelope is script + demo', async () => {
    const s = setup();
    const res = await runDebateV2({ agents: s.agents, emit: s.emit }, input);
    expect(res.replyText).toMatch(/^\(Demo, scripted, not Gemini\)/);
    expect((res.outcome.notes ?? []).join(' ')).toContain('Demo');
    const ms = s.msgs();
    expect(ms.length).toBeGreaterThan(3);
    expect(ms.every((m) => m.source === 'script' && m.mode.startsWith('demo'))).toBe(true);
    expect(validateA2aTrace(ms)).toEqual([]);
  });
});
