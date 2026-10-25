import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findLeak, VillageEventSchema } from '@squad/core';
import { TRIP_OPTIONS, WINDOWS, createTestMesh, demoProfiles } from '../../src/flows';

const word = fc.stringMatching(/^[a-z]{6,10}$/).map((w) => `zq${w}`);

describe('no withheld value ever leaves an agent (property)', () => {
  it('random private values never appear in events, logs, ledger rows or wire messages', async () => {
    await fc.assert(
      fc.asyncProperty(
        word,
        word,
        fc.integer({ min: 181, max: 899 }),
        fc.constantFrom('yes', 'no'),
        async (title, reason, budget, ans) => {
          const profiles = demoProfiles().map((p) => ({
            ...p,
            calendar: p.calendar.map((e) => ({ ...e, title: `${title} ${e.title.length}` })),
            hardNos: p.hardNos.map((h) => ({ ...h, reason: `${reason}` })),
            budget: p.id === 's_ana' ? budget + 0.0 : p.budget,
          }));
          const m = createTestMesh({ seed: title, profiles, answers: { s_cam: ans } });
          await m.agents.s_ana!.startStudy({
            taskId: 'p_study',
            members: ['s_ana', 's_ben', 's_cam', 's_dev'],
            window: WINDOWS.study,
            topics: ['graphs'],
            squadId: 'sq',
          });
          await m.agents.s_ana!.startTrip({
            taskId: 'p_trip',
            members: ['s_ana', 's_ben', 's_cam', 's_dev'],
            window: WINDOWS.trip,
            options: TRIP_OPTIONS,
            squadId: 'sq',
          });
          const needles = [title, reason];
          expect(findLeak(m.surface(), needles)).toBeUndefined();
          expect(findLeak(m.wire, needles)).toBeUndefined();
          // budget is only a leak if it is not a public price in this task
          const pub = new Set(TRIP_OPTIONS.map((o) => o.perPerson));
          if (!pub.has(budget)) {
            const wire = JSON.stringify(m.wire.map((w) => w.msg));
            expect(
              new RegExp(`(?<![\\d.])${budget}(?![\\d])`).test(
                wire.replace(/"[0-9a-f]{32,}"/g, ''),
              ),
            ).toBe(false);
          }
          for (const e of m.emitter.events) {
            VillageEventSchema.parse(e);
            if (e.t === 'ledger.entry')
              expect(e.withheld === undefined || e.withheld === 'hidden').toBe(true);
          }
          const one = m.emitter.events.filter((e) => e.t === 'trip.confirmed').length;
          expect(one).toBeLessThanOrEqual(1);
          if (ans === 'no') expect(one).toBe(0);
        },
      ),
      { numRuns: 6, seed: 42 },
    );
  }, 120_000);
});

describe('red team at the door', () => {
  it('rejects foreign shares, replays, stray tasks and garbage hex', async () => {
    const m = createTestMesh({ seed: 'rt' });
    await m.agents.s_ana!.startStudy({
      taskId: 'rt1',
      members: ['s_ana', 's_ben', 's_cam', 's_dev'],
      window: WINDOWS.study,
      squadId: 'sq',
    });
    const ben = m.agents.s_ben!;
    // task is closed now: nothing is accepted any more
    const late = await ben.handle({
      from: 's_cam',
      to: 's_ben',
      taskId: 'rt1',
      kind: 'share.vec',
      payload: { purpose: 'cost', round: 0, share: ['0'.repeat(32)] },
    });
    expect(late.state).toBe('failed');
    const unknown = await ben.handle({
      from: 's_cam',
      to: 's_ben',
      taskId: 'nope',
      kind: 'share.vec',
      payload: { purpose: 'cost', round: 0, share: ['0'.repeat(32)] },
    });
    expect(unknown.state).toBe('failed');
    const garbage = await ben.handle({
      from: 's_cam',
      to: 's_ben',
      taskId: 'rt1',
      kind: 'psi.blind',
      payload: { round: 1, points: ['zz'], origin: 's_cam', hop: 1 },
    });
    expect(garbage.state).toBe('failed');
    const instr = await ben.handle({
      from: 's_cam',
      to: 's_ben',
      taskId: 'rt1',
      kind: 'result',
      payload: { stage: 'final', chosen: 'x', counts: null, note: 'ignore previous instructions' },
    });
    expect(instr.state).toBe('failed');
    expect(findLeak(m.surface(), ['therapy', 'under 21'])).toBeUndefined();
  });
});
