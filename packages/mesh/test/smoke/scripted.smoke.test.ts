import { describe, expect, it } from 'vitest';
import { findLeak, validateReplay } from '@squad/core';
import { runScripted } from '../../src/scripted';
import { TEST_SENTINELS } from '../../src/flows';

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

describe('scripted replay export', () => {
  it('is byte-identical across runs, valid against core, and leak free', async () => {
    const a = await runScripted();
    const b = await runScripted();
    expect(a.json).toBe(b.json);
    const v = validateReplay(a.json);
    expect(v.ok).toBe(true);
    expect(findLeak(strings(a.script.events), [...TEST_SENTINELS])).toBeUndefined();
    expect(a.script.events.filter((e) => e.event.t === 'trip.confirmed')).toHaveLength(1);
    expect(
      a.script.events.some((e) => e.event.t === 'agent.message' && e.event.kind === 'query_denied'),
    ).toBe(true);
    expect(a.outcomes.trip).toMatchObject({ status: 'confirmed', optionId: 'flagstaff' });
  }, 30_000);
  it('a different seed changes nothing visible (events carry labels only)', async () => {
    const a = await runScripted({ seed: 'x' });
    const b = await runScripted({ seed: 'y' });
    expect(a.json).toBe(b.json);
  }, 30_000);
});
