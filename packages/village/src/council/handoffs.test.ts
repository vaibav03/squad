import { describe, expect, it } from 'vitest';
import {
  ASK_FIXTURE,
  PUBLIC_TURN_FIELDS,
  REASONING_FOOTER,
  asA2aMessage,
  createCouncilBoardStore,
  groupByStage,
  handoffRows,
  playCouncilFixture,
  providerState,
  reasoningCards,
  sortEnvelopes,
  type A2aMessage,
} from './index';

const base = (o: Partial<A2aMessage> & Pick<A2aMessage, 'id' | 'seq' | 'from' | 'to' | 'kind'>): A2aMessage => ({
  correlationId: 'cn_test',
  stage: 'opinions',
  status: 'done',
  mode: 'live',
  source: 'model',
  redaction: 'public',
  ts: 1000,
  ...o,
});
const fixtureRun = () => {
  const store = createCouncilBoardStore({ now: () => 1000 });
  playCouncilFixture(ASK_FIXTURE, (e) => store.apply(e), { instant: true });
  return store.run()!;
};

describe('handoff ordering', () => {
  it('sorts by seq, then ts, then id regardless of arrival order', () => {
    const msgs = [
      base({ id: 'am_c', seq: 2, ts: 5, from: 'council:ask-chair', to: 'council:ask-skeptic', kind: 'delegate' }),
      base({ id: 'am_b', seq: 1, ts: 9, from: 'council:ask-chair', to: 'council:ask-teacher', kind: 'delegate' }),
      base({ id: 'am_a', seq: 2, ts: 5, from: 'council:ask-skeptic', to: 'council:ask-chair', kind: 'answer' }),
      base({ id: 'am_d', seq: 2, ts: 3, from: 'council:ask-teacher', to: 'council:ask-chair', kind: 'answer' }),
    ];
    expect(sortEnvelopes(msgs).map((m) => m.id)).toEqual(['am_b', 'am_d', 'am_a', 'am_c']);
    expect(handoffRows(msgs).map((r) => r.id)).toEqual(['am_b', 'am_d', 'am_a', 'am_c']);
    expect(handoffRows(msgs).map((r) => r.n)).toEqual([1, 2, 3, 4]);
  });
  it('the board store keeps the same order when envelopes arrive out of order', () => {
    const msgs = [
      base({ id: 'am_z', seq: 3, from: 'council:ask-teacher', to: 'council:ask-chair', kind: 'answer' }),
      base({ id: 'am_y', seq: 1, from: 'council:ask-chair', to: 'council:ask-teacher', kind: 'delegate', stage: 'delegation' }),
      base({ id: 'am_x', seq: 2, from: 'council:ask-chair', to: 'council:ask-skeptic', kind: 'delegate', stage: 'delegation' }),
    ];
    const store = createCouncilBoardStore();
    for (const m of msgs) store.apply({ t: 'a2a.message', msg: m });
    expect(store.run()!.messages.map((m) => m.id)).toEqual(['am_y', 'am_x', 'am_z']);
  });
  it('keeps the whole-run turn number when filtered to one agent', () => {
    const run = fixtureRun();
    const all = handoffRows(run.messages);
    const mine = handoffRows(run.messages, { agent: 'council:ask-skeptic' });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    for (const r of mine) expect(all.find((a) => a.id === r.id)!.n).toBe(r.n);
    expect(mine.every((r) => r.from === 'council:ask-skeptic' || r.to === 'council:ask-skeptic')).toBe(true);
  });
  it('labels are Sender → Recipient display names, never raw ids', () => {
    const rows = handoffRows(fixtureRun().messages);
    expect(rows[0]!.label).toMatch(/→/);
    for (const r of rows) {
      expect(r.label).not.toMatch(/council:|am_/);
      expect(r.fromName).not.toMatch(/:/);
    }
    expect(rows.some((r) => r.label === 'Chair → Skeptic')).toBe(true);
  });
  it('groups consecutive rows by stage in run order', () => {
    const groups = groupByStage(handoffRows(fixtureRun().messages));
    const labels = groups.map((g) => g.label);
    expect(labels[0]).toBe('Question');
    expect(labels.indexOf('Delegation')).toBeLessThan(labels.indexOf('Opinions'));
    expect(labels.indexOf('Opinions')).toBeLessThan(labels.indexOf('Verdict'));
  });
});

describe('handoff status', () => {
  const chair = 'council:ask-chair';
  const sk = 'council:ask-skeptic';
  it('a delegation is working until the recipient replies, then done', () => {
    const d = base({ id: 'am_1', seq: 1, from: chair, to: sk, kind: 'delegate', stage: 'delegation' });
    expect(handoffRows([d])[0]!.status).toBe('working');
    const a = base({ id: 'am_2', seq: 2, from: sk, to: chair, kind: 'answer', parentMessageId: 'am_1' });
    expect(handoffRows([d, a])[0]!.status).toBe('done');
    expect(handoffRows([d], { runDone: true })[0]!.status).toBe('done');
  });
  it('queued, failed and degraded modes', () => {
    expect(handoffRows([base({ id: 'am_1', seq: 1, from: chair, to: sk, kind: 'status', status: 'queued' })])[0]!.status).toBe('queued');
    expect(handoffRows([base({ id: 'am_1', seq: 1, from: sk, to: chair, kind: 'answer', status: 'failed' })])[0]!.status).toBe('degraded');
    const r = handoffRows([base({ id: 'am_1', seq: 1, from: sk, to: chair, kind: 'answer', mode: 'degraded:rate_limited' })])[0]!;
    expect(r.status).toBe('degraded');
    expect(r.statusNote).toMatch(/rate limited/i);
  });
  it('a degraded reply degrades the delegation that asked for it', () => {
    const d = base({ id: 'am_1', seq: 1, from: chair, to: sk, kind: 'ask' });
    const a = base({ id: 'am_2', seq: 2, from: sk, to: chair, kind: 'answer', parentMessageId: 'am_1', mode: 'degraded:rate_limited' });
    expect(handoffRows([d, a])[0]!.status).toBe('degraded');
  });
  it('skeleton envelopes without text are hidden, not invented', () => {
    const r = handoffRows([base({ id: 'am_1', seq: 1, from: chair, to: sk, kind: 'delegate' })])[0]!;
    expect(r.hidden).toBe(true);
    expect(r.summary).toBe('');
  });
});

describe('reasoning summary cards', () => {
  it('has goal from the delegation, evidence, decision and next action', () => {
    const run = fixtureRun();
    const cards = reasoningCards(run.messages, { agent: 'council:ask-skeptic', question: run.question });
    expect(cards.length).toBeGreaterThan(0);
    const c = cards[0]!;
    expect(c.goal).toMatch(/^Chair asked:/);
    expect(c.decision.text.length).toBeGreaterThan(0);
    expect(c.scripted).toBe(true);
    expect(typeof c.next).toBe('string');
    expect(Object.keys(c).sort()).toEqual(
      ['decision', 'evidence', 'goal', 'id', 'kind', 'mode', 'next', 'scripted', 'stage', 'ts'].sort(),
    );
    expect(REASONING_FOOTER).toBe('Summary shared by the agent. Private reasoning is never shown.');
  });
  it('the chair verdict card lists the action items as the next action', () => {
    const run = fixtureRun();
    const v = reasoningCards(run.messages, { agent: 'council:ask-chair' }).find((c) => c.kind === 'verdict')!;
    expect(v.next).toMatch(/^Action items:/);
    expect(v.evidence.length).toBeGreaterThan(0);
  });
  it('privacy guard: non-public fields on an envelope never reach a card or a row', () => {
    const hostile = {
      ...base({ id: 'am_1', seq: 1, from: 'council:ask-skeptic', to: 'council:ask-chair', kind: 'answer', summary: 'Public words.' }),
      thought: 'SECRET-THOUGHT',
      thinking: 'SECRET-THINKING',
      reasoning: 'SECRET-REASONING',
      systemPrompt: 'SECRET-PROMPT',
      scratch: 'SECRET-SCRATCH',
    };
    const viaGuard = asA2aMessage(hostile)!;
    const direct = hostile as unknown as A2aMessage;
    for (const m of [viaGuard, direct]) {
      const out = JSON.stringify([
        reasoningCards([m], { agent: 'council:ask-skeptic' }),
        handoffRows([m]),
      ]);
      expect(out).not.toMatch(/SECRET/);
      expect(out).toContain('Public words.');
    }
    expect(PUBLIC_TURN_FIELDS).not.toContain('thought' as never);
    expect(PUBLIC_TURN_FIELDS.join(' ')).not.toMatch(/thought|reason|scratch|prompt|signature/i);
  });
});

describe('provider state', () => {
  it('live, degraded and fixture are told apart, with transport', () => {
    expect(providerState(undefined)).toBeUndefined();
    const live = providerState({ mode: 'live', agents: [{ mode: 'live' }] }, { transport: { kind: 'live-audio' } })!;
    expect(live).toMatchObject({ tier: 'live', text: 'LIVE: Gemini', transport: 'Gemini Live (audio + transcript)' });
    expect(providerState({ mode: 'live' }, { transport: { kind: 'stream' } })!.transport).toBe('Gemini streaming');
    const deg = providerState({ mode: 'live', agents: [{ mode: 'degraded:rate_limited' }] }, { transport: { kind: 'stream' } })!;
    expect(deg).toMatchObject({ tier: 'degraded', text: 'DEGRADED: rate limited' });
    const fx = providerState({ mode: 'demo' }, { fixture: true })!;
    expect(fx).toMatchObject({ tier: 'fixture', text: 'FIXTURE: scripted, not Gemini', transport: 'Scripted (not Gemini)' });
    expect(providerState({ mode: 'demo' })!.text).toBe('DEMO: scripted, not Gemini');
    expect(providerState({ mode: 'live', agents: [{ mode: 'demo' }] })!.tier).toBe('fixture');
  });
});
