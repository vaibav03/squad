import { describe, expect, it } from 'vitest';
import { findLeak, type VillageEvent } from '@squad/core';
import { TEST_SENTINELS, createTestMesh } from '../../src/flows';

type Msg = Extract<VillageEvent, { t: 'agent.message' }>;
const msgs = (evs: VillageEvent[]) => evs.filter((e): e is Msg => e.t === 'agent.message');

describe('query / query.denied', () => {
  it("Ben asking for Ana's budget is denied, ledger shows blocked:true, from 'mediator'", async () => {
    const m = createTestMesh({ seed: 'q' });
    await m.agents.s_ben!.askPeer('budget', 's_ana', 't_q');
    const mm = msgs(m.emitter.events).filter(
      (e) => e.kind === 'query' || e.kind === 'query_denied',
    );
    expect(mm).toEqual([
      {
        t: 'agent.message',
        from: 'student:s_ben',
        to: 'student:s_ana',
        taskId: 't_q',
        kind: 'query',
        shared: ['asks: budget'],
      },
      {
        t: 'agent.message',
        from: 'mediator',
        to: 'student:s_ben',
        taskId: 't_q',
        kind: 'query_denied',
        shared: ['request denied: budget'],
      },
    ]);
    const blocked = m.emitter.events.filter((e) => e.t === 'ledger.entry' && e.blocked);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      student: 's_ana',
      field: 'budget',
      shared: 'nothing',
      withheld: 'hidden',
      blocked: true,
    });
    expect(findLeak(m.surface(), [...TEST_SENTINELS])).toBeUndefined();
  });

  it('a probing agent hits the per-task query budget: refused, still query_denied, no leak', async () => {
    const m = createTestMesh({ seed: 'q', queryBudget: 3 });
    for (const about of [
      'budget',
      'calendar',
      'hardNo',
      'weakTopic',
      'budget',
      'calendar',
    ] as const) {
      await expect(m.agents.s_ben!.askPeer(about, 's_ana', 't_probe')).resolves.toBe('denied');
    }
    const denied = msgs(m.emitter.events).filter((e) => e.kind === 'query_denied');
    expect(denied.length).toBe(6);
    expect(findLeak(m.surface(), [...TEST_SENTINELS])).toBeUndefined();
  });

  it('replays and malformed queries are rejected at the door', async () => {
    const m = createTestMesh({ seed: 'q' });
    await m.agents.s_ben!.askPeer('budget', 's_ana', 't_r');
    const sent = m.wire.find((w) => (w.msg as { kind: string }).kind === 'query')!;
    const replay = await m.agents.s_ana!.handle(sent.msg);
    expect(replay.state).toBe('failed');
    const extra = await m.agents.s_ana!.handle({
      ...(sent.msg as object),
      payload: { about: 'budget', target: 's_ana', reason: 'because' },
    });
    expect(extra.state).toBe('failed');
    const stranger = await m.agents.s_ana!.handle({
      from: 's_zed',
      to: 's_ana',
      taskId: 't_r',
      kind: 'query',
      payload: { about: 'budget', target: 's_ana' },
    });
    expect(stranger.state).toBe('failed');
    expect(findLeak(m.surface(), [...TEST_SENTINELS])).toBeUndefined();
  });
});
