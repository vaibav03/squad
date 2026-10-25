import { describe, expect, it } from 'vitest';
import { parseReplay, validateReplay } from './index';
import sample from '../fixtures/sample-replay.json';

describe('replay schema', () => {
  it('validates the sample replay (object and JSON string)', () => {
    expect(validateReplay(sample).ok).toBe(true);
    expect(validateReplay(JSON.stringify(sample)).ok).toBe(true);
    expect(parseReplay(sample).events.length).toBeGreaterThan(10);
  });

  it('reports readable errors', () => {
    const bad = structuredClone(sample) as any;
    bad.events[2].event.state = 'x';
    bad.events[2].event.t = 'agent.state';
    const r = validateReplay(bad);
    expect(r.ok).toBe(false);
    expect(validateReplay('{nope').ok).toBe(false);
    expect(() => parseReplay({})).toThrow(/invalid replay script/);
  });

  it('requires ordered events and in-range checkpoints', () => {
    const unordered = structuredClone(sample) as any;
    unordered.events[3].at = 0;
    const r1 = validateReplay(unordered);
    expect(!r1.ok && r1.errors.join()).toMatch(/ordered/);
    const far = structuredClone(sample) as any;
    far.checkpoints.late = 999999;
    const r2 = validateReplay(far);
    expect(!r2.ok && r2.errors.join()).toMatch(/checkpoint "late"/);
  });

  it('rejects wrong version and event key "e"', () => {
    expect(validateReplay({ ...sample, version: 2 }).ok).toBe(false);
    const e = structuredClone(sample) as any;
    e.events[0] = { at: 0, e: e.events[0].event };
    expect(validateReplay(e).ok).toBe(false);
  });
});
