import { openMemoryDb } from '@squad/core/node';
import { describe, expect, it } from 'vitest';
import { createDirectory } from './directory';
import { createEventLog } from './eventlog';
import { createLedgerStore } from './ledger';
import { createTripStore } from './trips';

const ev = (i: number) => ({
  kind: 'village' as const,
  type: 'agent.state',
  payload: { i },
  squadId: 'sq_demo',
});

describe('sqlite-backed stores survive a restart', () => {
  it('event log keeps ids, order, payloads, and only resyncs when the id is too old', () => {
    const db = openMemoryDb();
    const a = createEventLog({ max: 3, db });
    for (let i = 0; i < 5; i++) a.append(ev(i));
    const b = createEventLog({ max: 3, db }); // "restart"
    expect(b.lastSeq()).toBe(5);
    expect(b.size()).toBe(3);
    expect((b.since(2) as { seq: number }[]).map((e) => e.seq)).toEqual([3, 4, 5]); // 2 is the floor: still resumable
    expect((b.since(3) as { seq: number; payload: unknown }[]).map((e) => e.seq)).toEqual([4, 5]);
    expect(b.since(1)).toBe('too_old');
    expect(b.append(ev(9)).seq).toBe(6);
    b.clear();
    expect(createEventLog({ max: 3, db }).append(ev(1)).seq).toBe(7);
  });

  it('directory, trips and the ledger (including owner-only raw values) persist', () => {
    const db = openMemoryDb();
    const d = createDirectory(db);
    d.upsertStudent({ id: 's_a', name: 'A', handle: 'a@x' });
    d.upsertSquad({ id: 'sq', name: 'S', members: ['s_a'] });
    d.setSettings('sq', { revealQuizCorrectness: true });
    const t = createTripStore(db);
    t.upsert({
      tripId: 't1',
      taskId: 'task1',
      squadId: 'sq',
      status: 'planning',
      options: [{ id: 'o', label: 'O' }],
      dates: null,
      votes: [],
      vetoed: [],
      confirmations: [{ student: 's_a', confirmed: false }],
      limits: { s_a: { budget: '$1' } },
    });
    t.confirm('t1', 's_a', 'o', true);
    const l = createLedgerStore(db);
    l.addPrivate({
      taskId: 'task1',
      student: 's_a',
      field: 'budget',
      shared: '',
      withheld: 'X',
      ts: 1,
    });

    const d2 = createDirectory(db);
    expect(d2.squadOf('s_a')).toBe('sq');
    expect(d2.settings('sq').revealQuizCorrectness).toBe(true);
    const t2 = createTripStore(db);
    expect(t2.get('t1')?.status).toBe('confirmed');
    expect(t2.allConfirmed('t1')).toBe(true);
    const owner = createLedgerStore(db).entries('task1', {
      studentId: 's_a',
      squadId: 'sq',
      projector: false,
    });
    expect(owner[0]?.withheld).toBe('X');
    const other = createLedgerStore(db).entries('task1', {
      studentId: 's_b',
      squadId: 'sq',
      projector: false,
    });
    expect(other[0]?.withheld).toBe('hidden');
  });
});
