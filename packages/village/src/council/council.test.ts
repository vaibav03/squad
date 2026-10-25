import { describe, expect, it } from 'vitest';
import {
  ASK_FIXTURE,
  ROUND_TABLE_FIXTURE,
  createCouncilBoardStore,
  depthOf,
  messageHeadline,
  modeInfo,
  playCouncilFixture,
  stageIndex,
  threadPath,
  worstMode,
} from './index';

const load = (f = ASK_FIXTURE, defaultMode?: string) => {
  let t = 1000;
  const store = createCouncilBoardStore({ now: () => t, ...(defaultMode ? { defaultMode } : {}) });
  playCouncilFixture(f, (e) => store.apply(e), { instant: true });
  return { store, tick: (ms: number) => (t += ms) };
};

describe('council board model', () => {
  it('builds the hierarchy: chair on top, specialists under it', () => {
    const run = load().store.run()!;
    expect(run.councilName).toBe('Ask council');
    expect(run.agents.map((a) => a.name)).toEqual(['Chair', 'Skeptic', 'Teacher', 'Practitioner']);
    expect(run.agents[0]!.role).toBe('chair');
    expect(run.agents.slice(1).every((a) => a.parent === 'council:ask-chair')).toBe(true);
    expect(run.stage).toBe('done');
    expect(stageIndex(run.stage)).toBe(7);
  });
  it('tracks delegations to answered', () => {
    const run = load().store.run()!;
    expect(run.delegations).toHaveLength(3);
    expect(run.delegations.every((d) => d.status === 'answered')).toBe(true);
  });
  it('verdict links the dissent to the dissenting message and lists action items', () => {
    const run = load().store.run()!;
    const v = run.verdict!;
    expect(v.confidence).toBe('fairly_sure');
    expect(v.dissents).toHaveLength(1);
    expect(v.dissents[0]!.who).toBe('Skeptic');
    const msg = run.messages.find((m) => m.id === v.dissents[0]!.messageId)!;
    expect(msg.from).toBe('council:ask-skeptic');
    expect(v.actions).toHaveLength(2);
  });
  it('fixtures are Demo and say so', () => {
    const run = load().store.run()!;
    expect(run.mode).toBe('demo');
    expect(modeInfo(run.mode).word).toBe('Demo');
  });
  it('threads and headlines use display names', () => {
    const run = load().store.run()!;
    const ans = run.messages.find((m) => m.kind === 'answer' && m.parentMessageId)!;
    expect(threadPath(run, ans.id).length).toBeGreaterThan(1);
    expect(depthOf(run, ans.id)).toBeGreaterThan(0);
    for (const m of run.messages) expect(messageHeadline(m)).not.toMatch(/council:|am_/);
  });
  it('hierarchy() describes an agent position and delegations', () => {
    const h = load().store.hierarchy('council:ask-skeptic')!;
    expect(h.parent?.name).toBe('Chair');
    expect(h.position).toBe('Specialist under Chair');
    expect(h.delegationsIn).toHaveLength(1);
    expect(load().store.hierarchy('council:ask-chair')!.delegationsOut).toHaveLength(3);
  });
  it('links are recent messages between agents and expire', () => {
    const { store, tick } = load();
    expect(store.links().length).toBeGreaterThan(5);
    tick(5000);
    expect(store.links()).toHaveLength(0);
  });
  it('round table fixture uses cast roles', () => {
    const run = load(ROUND_TABLE_FIXTURE).store.run()!;
    expect(run.agents.map((a) => a.cast)).toEqual(['chair', 'chill', 'grind', 'advisor']);
  });
});

describe('legacy council events', () => {
  it('map to a Demo run unless work.demo is false', () => {
    const store = createCouncilBoardStore();
    store.apply({
      t: 'council.opinion',
      councilId: 'council:planner',
      member: 'chill',
      text: 'Rest.',
    });
    store.apply({
      t: 'council.opinion',
      councilId: 'council:planner',
      member: 'grind',
      text: 'Work.',
      work: { demo: false },
    });
    store.apply({
      t: 'council.verdict',
      councilId: 'council:planner',
      member: 'advisor',
      text: 'Middle.',
      dissent: true,
      dissenter: 'chill',
    });
    const run = store.run()!;
    expect(run.mode).toBe('demo');
    expect(run.verdict?.dissents[0]?.who).toBe('Chill');
    expect(run.agents[0]!.name).toBe('Chair');
  });
  it('are ignored once the council sends a2a messages', () => {
    const store = createCouncilBoardStore();
    for (const e of ASK_FIXTURE.events) store.apply(e.event);
    const n = store.run()!.messages.length;
    store.apply({ t: 'council.opinion', councilId: 'council:ask', member: 'skeptic', text: 'dup' });
    expect(store.run()!.messages).toHaveLength(n);
  });
});

describe('mode', () => {
  it('words and worst', () => {
    expect(modeInfo('live').word).toBe('Live');
    expect(modeInfo('degraded:credits_depleted').word).toBe('Degraded: credits depleted');
    expect(modeInfo('demo:no_key').word).toBe('Demo');
    expect(modeInfo(undefined).tier).toBe('demo');
    expect(worstMode(['live', 'degraded:timeout'])).toBe('degraded:timeout');
    expect(worstMode(['live', 'demo'])).toBe('demo');
  });
});
