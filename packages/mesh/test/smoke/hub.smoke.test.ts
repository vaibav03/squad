import { describe, expect, it } from 'vitest';
import { findLeak } from '@squad/core';
import { TRIP_OPTIONS, WINDOWS, createTestMesh } from '../../src/flows';

const members = ['s_ana', 's_ben', 's_cam', 's_dev'];
const run = (m: ReturnType<typeof createTestMesh>) =>
  m.agents.s_ana!.startTrip({
    taskId: 'hub_trip',
    members,
    window: WINDOWS.trip,
    options: TRIP_OPTIONS,
    squadId: 'sq_demo',
  });

describe('hub private channel', () => {
  it('raw withheld values go only to the owner channel, never into events', async () => {
    const m = createTestMesh({ seed: 'hub' });
    await run(m);
    const raw = m.hub.ledger.filter((r) => r.student === 's_ana' && r.field === 'budget');
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.every((r) => r.withheld === '$187 cap')).toBe(true);
    // each agent only ever posts its own student's rows
    for (const r of m.hub.ledger) expect(members).toContain(r.student);
    expect(findLeak(m.emitter.events, ['$187', 'therapy', 'under 21'])).toBeUndefined();
    expect(
      m.emitter.events
        .filter((e) => e.t === 'ledger.entry')
        .every((e) => e.t === 'ledger.entry' && (e.withheld ?? 'hidden') === 'hidden'),
    ).toBe(true);
  });

  it('trip record: public parts only, secret ballot, all confirmations true before trip.confirmed', async () => {
    const m = createTestMesh({ seed: 'hub' });
    await run(m);
    const tl = m.emitter.timeline;
    const confirmedAt = tl.findIndex((x) => x.ch === 'event' && x.event.t === 'trip.confirmed');
    expect(confirmedAt).toBeGreaterThan(0);
    const lastUpsertBefore = [...tl.slice(0, confirmedAt)]
      .reverse()
      .find((x) => x.ch === 'hub' && x.kind === 'trip.upsert');
    const rec = (lastUpsertBefore as { data: (typeof m.hub.trips)[number] }).data;
    expect(rec.confirmations.every((c) => c.confirmed)).toBe(true);
    expect(rec.squadId).toBe('sq_demo');
    expect(rec.votes).toEqual([]);
    expect(Object.keys(rec.limits)).toEqual(['s_ana']); // the coordinator knows only its own limits
    expect(rec.vetoed.map((v) => v.reason).sort()).toEqual([
      'dropped: veto',
      'option dropped: budget',
    ]);
    expect(rec.vetoed.every((v) => v.by === 'mediator')).toBe(true);
    expect(JSON.stringify(rec)).not.toMatch(/under 21|therapy/);
  });

  it('each student agent posts x.trip.limits for its own student only, and never raw peers', async () => {
    const m = createTestMesh({ seed: 'hub' });
    await run(m);
    const posts = m.hub.tripLimitPosts;
    const studentsPosted = new Set(posts.map((p) => p.student));
    // every NON-coordinating member posts its own limits (the coordinator's go in the upsert)
    for (const s of ['s_ben', 's_cam', 's_dev']) expect(studentsPosted.has(s)).toBe(true);
    for (const p of posts) {
      expect(p.tripId).toBe('hub_trip');
      expect(members).toContain(p.student);
      expect(Object.keys(p.limits).length).toBeGreaterThan(0);
    }
    // the values posted for a student come from that student's own profile (budget sentinel for s_ana is not in s_ben's post)
    expect(JSON.stringify(posts.filter((p) => p.student === 's_ben'))).not.toContain('$187');
  });

  it('no upsert ever marks confirmed on a no', async () => {
    const m = createTestMesh({ seed: 'hub', answers: { s_ben: 'no' } });
    await run(m);
    expect(m.hub.trips.some((t) => t.status === 'confirmed')).toBe(false);
    expect(m.emitter.events.some((e) => e.t === 'trip.confirmed')).toBe(false);
  });
});
