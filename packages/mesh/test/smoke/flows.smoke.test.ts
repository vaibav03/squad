import { describe, expect, it } from 'vitest';
import { findLeak, VillageEventSchema, type VillageEvent } from '@squad/core';
import {
  TRIP_OPTIONS,
  WINDOWS,
  createTestMesh,
  demoProfiles,
  TEST_SENTINELS,
} from '../../src/flows';

const members = ['s_ana', 's_ben', 's_cam', 's_dev'];
const study = (m: ReturnType<typeof createTestMesh>, ids = members) =>
  m.agents.s_ana!.startStudy({
    taskId: 't_study',
    members: ids,
    window: WINDOWS.study,
    topics: ['dynamic-programming', 'graphs'],
    squadId: 'sq1',
  });
const trip = (m: ReturnType<typeof createTestMesh>, ids = members) =>
  m.agents.s_ana!.startTrip({
    taskId: 't_trip',
    members: ids,
    window: WINDOWS.trip,
    options: TRIP_OPTIONS,
    squadId: 'sq1',
  });

const of = (m: ReturnType<typeof createTestMesh>, t: string) =>
  m.emitter.events.filter((e) => e.t === t);
const noLeak = (m: ReturnType<typeof createTestMesh>) => {
  expect(findLeak(m.surface(), [...TEST_SENTINELS])).toBeUndefined();
  for (const e of m.emitter.events) {
    VillageEventSchema.parse(e);
    if (e.t === 'ledger.entry')
      expect(e.withheld === undefined || e.withheld === 'hidden').toBe(true);
  }
};

describe('study flow', () => {
  it('picks one common slot and confirms by DM', async () => {
    const m = createTestMesh({ seed: 'a' });
    const out = await study(m);
    expect(out.status).toBe('scheduled');
    // all four students were asked, door ring order holds
    const pend = of(m, 'confirm.pending');
    expect(pend).toHaveLength(4);
    const kinds = m.emitter.events.map((e) => e.t);
    expect(kinds.indexOf('confirm.pending')).toBeLessThan(kinds.indexOf('confirm.done'));
    expect(of(m, 'trip.confirmed')).toHaveLength(0);
    noLeak(m);
  });
  it('one no moves to the next slot; two nos give no slot', async () => {
    const m = createTestMesh({ seed: 'a', answers: { s_cam: 'no' } });
    const out = await study(m);
    expect(out.status).toBe('no_slot');
    expect(of(m, 'confirm.pending').length).toBeGreaterThanOrEqual(2);
    noLeak(m);
  });
  it('small squads reveal no counts', async () => {
    const m = createTestMesh({ seed: 'a' });
    const out = await study(m, ['s_ana', 's_ben']);
    expect(out.status).toBe('scheduled');
    const dump = JSON.stringify(m.emitter.events);
    expect(dump).not.toMatch(/shaky/);
  });
  it('an offline agent fails the task and emits no confirm', async () => {
    const m = createTestMesh({ seed: 'a', offline: ['s_dev'] });
    const out = await study(m);
    expect(out.status).toBe('failed');
    expect(of(m, 'confirm.pending')).toHaveLength(0);
    noLeak(m);
  });
});

describe('trip flow', () => {
  it('drops Cabo (budget) and bar crawl (veto), Flagstaff wins, 4 confirms, venmo, one trip.confirmed', async () => {
    const m = createTestMesh({ seed: 'b' });
    const out = await trip(m);
    expect(out.status).toBe('confirmed');
    if (out.status !== 'confirmed') return;
    expect(out.optionId).toBe('flagstaff');
    expect(out.venmo).toHaveLength(3);
    expect(out.venmo[0]).toMatch(/^https:\/\/venmo\.com\/ana-s\?txn=charge&amount=142\.00&note=/);
    const dropped = m.emitter.events.filter(
      (e): e is Extract<VillageEvent, { t: 'agent.message' }> =>
        e.t === 'agent.message' && e.kind === 'option_dropped',
    );
    expect(dropped.map((d) => d.shared[0]).sort()).toEqual([
      'dropped: veto',
      'option dropped: budget',
    ]);
    expect(dropped.every((d) => d.from === 'mediator')).toBe(true);
    expect(of(m, 'confirm.pending')).toHaveLength(4);
    expect(of(m, 'trip.confirmed')).toHaveLength(1);
    // trip.confirmed comes after every confirm.done
    const idx = m.emitter.events.map((e) => e.t);
    expect(idx.lastIndexOf('confirm.done')).toBeLessThan(idx.indexOf('trip.confirmed'));
    noLeak(m);
  });
  it('a no declines the candidate, never emits trip.confirmed when all rounds fail', async () => {
    const m = createTestMesh({ seed: 'b', answers: { s_ben: 'no' } });
    const out = await trip(m);
    expect(out.status).toBe('no_plan');
    expect(of(m, 'trip.confirmed')).toHaveLength(0);
    noLeak(m);
  });
  it('a confirm timeout counts as no', async () => {
    const m = createTestMesh({ seed: 'b', answers: { s_cam: 'timeout' } });
    const out = await trip(m);
    expect(out.status).toBe('no_plan');
    expect(of(m, 'trip.confirmed')).toHaveLength(0);
  });
  it('an offline agent means no plan and no trip.confirmed', async () => {
    const m = createTestMesh({ seed: 'b', offline: ['s_cam'] });
    const out = await trip(m);
    expect(out.status).toBe('no_plan');
    expect(of(m, 'trip.confirmed')).toHaveLength(0);
  });
  it('a hanging agent hits the peer timeout', async () => {
    const m = createTestMesh({ seed: 'b', hang: ['s_cam'], timeouts: { peerMs: 40 } });
    const out = await trip(m);
    expect(out.status).toBe('no_plan');
    expect(of(m, 'trip.confirmed')).toHaveLength(0);
  });
  it('2 members: no counts in any event or result payload', async () => {
    const m = createTestMesh({ seed: 'b' });
    const out = await trip(m, ['s_ana', 's_ben']);
    expect(out.status).toBe('confirmed');
    for (const w of m.wire) {
      const p = w.msg as { kind: string; payload: { counts?: unknown } };
      if (p.kind === 'result') expect(p.payload.counts).toBeNull();
    }
    noLeak(m);
  });
  it('chosen option is always affordable and never vetoed (seeds)', async () => {
    for (const seed of ['1', '2', '3', '4', '5']) {
      const m = createTestMesh({ seed, profiles: demoProfiles() });
      const out = await trip(m);
      if (out.status !== 'confirmed') continue;
      const o = TRIP_OPTIONS.find((x) => x.id === out.optionId)!;
      for (const p of m.profiles) {
        expect(o.perPerson + (p.tripExtrasPerDay ?? 0) * o.days).toBeLessThanOrEqual(p.budget);
        expect(p.hardNos.some((h) => h.optionId === o.id)).toBe(false);
      }
    }
  });
});
