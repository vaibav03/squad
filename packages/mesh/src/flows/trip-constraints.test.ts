import { describe, expect, it } from 'vitest';
import { SENTINELS, TRIP_OPTIONS, WINDOWS, createTestMesh } from './testkit';

const run = (m: ReturnType<typeof createTestMesh>, taskId = 'trip_x.r1') =>
  m.agents.s_ana!.startTrip({
    taskId,
    members: ['s_ana', 's_ben', 's_chi', 's_dev'],
    window: WINDOWS.trip,
    options: TRIP_OPTIONS,
    squadId: 'sq_demo',
    constraintsOnly: true,
  });

// real PSI + secret sharing across four agents: seconds of CPU, more when the whole suite runs in parallel
const SLOW = 60_000;

describe('trip constraints-only flow (the hub owns the trip)', () => {
  it(
    'reveals only the shared free days and which options survive, never whose limit',
    async () => {
      const m = createTestMesh({ seed: 'c1' });
      const out = await run(m);
      expect(out.flow).toBe('trip');
      if (out.status !== 'constraints') throw new Error(`unexpected ${out.status}`);
      // 20/21 (Ana, Dev) and 27 (Ben) are busy for someone; everyone is free on the rest
      for (const d of ['2026-11-20', '2026-11-21', '2026-11-27'])
        expect(out.common).not.toContain(d);
      expect(out.common).toContain('2026-11-24');
      expect(out.dropped.map((d) => d.optionId).sort()).toEqual(['barcrawl', 'cabo']);
      expect(out.survivors.sort()).toEqual(['flagstaff', 'lake']);
      const text = JSON.stringify(out);
      for (const s of SENTINELS) expect(text.toLowerCase()).not.toContain(s.toLowerCase());
    },
    SLOW,
  );

  it(
    'publishes nothing to the hub trip record and never confirms',
    async () => {
      const m = createTestMesh({ seed: 'c2' });
      await run(m);
      expect(m.hub.trips).toHaveLength(0); // no x.trip.upsert: the hub owns options and ballots
      expect(m.emitter.events.some((e) => e.t === 'trip.confirmed')).toBe(false);
      // each member posts only their own limits, under the run id
      expect(m.hub.tripLimitPosts.length).toBeGreaterThan(0);
      for (const p of m.hub.tripLimitPosts) expect(p.tripId).toBe('trip_x.r1');
      // no calendar title or budget anywhere an observer can look
      const surface = JSON.stringify(m.surface()).toLowerCase();
      for (const s of ['therapy', 'dentist', 'family', 'under 21'])
        expect(surface).not.toContain(s);
    },
    SLOW,
  );

  it(
    'an unreachable member ends the run as a labelled failure, not a hang',
    async () => {
      const m = createTestMesh({
        seed: 'c3',
        offline: ['s_chi'],
        timeouts: { peerMs: 200, confirmMs: 200 },
      });
      const out = await run(m);
      expect(out.status === 'failed' || out.status === 'no_plan').toBe(true);
      expect(out.status).not.toBe('constraints');
    },
    SLOW,
  );
});
