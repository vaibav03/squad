import { describe, expect, it } from 'vitest';
import { createEventLog } from './eventlog';

const ev = (i: number) => ({
  kind: 'village' as const,
  type: 'agent.state',
  payload: { i },
  squadId: null,
});

describe('event log', () => {
  it('assigns monotonic ids from 1 and returns events after an id', () => {
    const log = createEventLog({ max: 10 });
    for (let i = 0; i < 5; i++) expect(log.append(ev(i)).seq).toBe(i + 1);
    const r = log.since(2);
    expect(r).not.toBe('too_old');
    expect((r as { seq: number }[]).map((e) => e.seq)).toEqual([3, 4, 5]);
    expect((log.since(0) as unknown[]).length).toBe(5);
  });
  it('evicts old events, reports too_old, and stays bounded', () => {
    const log = createEventLog({ max: 3 });
    for (let i = 0; i < 100_000; i++) log.append(ev(i));
    expect(log.size()).toBe(3);
    expect(log.since(5)).toBe('too_old');
    expect((log.since(99_999) as { seq: number }[]).map((e) => e.seq)).toEqual([100_000]);
    expect((log.since(99_997) as { seq: number }[]).map((e) => e.seq)).toEqual([
      99_998, 99_999, 100_000,
    ]);
  });
  it('keeps counting after clear so ids never repeat', () => {
    const log = createEventLog({ max: 3 });
    log.append(ev(1));
    log.clear();
    expect(log.append(ev(2)).seq).toBe(2);
  });
});
