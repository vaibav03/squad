import type { Db } from '@squad/core';
import type { EventLog, LoggedEvent } from '../types';
import { ensureHubSchema } from './schema';

/**
 * Event log with monotonic integer seq (starts at 1), bounded by `max`. With `db` the log lives in the
 * shared sqlite (survives restarts, ids never repeat); without it, a ring buffer in memory.
 */
export function createEventLog(opts: { max: number; db?: Db }): EventLog {
  return opts.db ? createSqliteEventLog(opts.db, opts.max) : createMemoryEventLog(opts.max);
}

function createSqliteEventLog(db: Db, maxEvents: number): EventLog {
  ensureHubSchema(db);
  const max = Math.max(1, maxEvents);
  const insert = db.prepare(
    'INSERT INTO hub_events(ts, kind, type, payload_json, squad_id) VALUES(?,?,?,?,?)',
  );
  const prune = db.prepare('DELETE FROM hub_events WHERE seq <= ?');
  const after = db.prepare(
    'SELECT seq, ts, kind, type, payload_json, squad_id FROM hub_events WHERE seq > ? ORDER BY seq',
  );
  const setMeta = db.prepare(
    'INSERT INTO hub_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  );
  const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='hub_events'").get() as
    { seq: number } | undefined;
  const floorRow = db.prepare("SELECT value FROM hub_meta WHERE key='events_floor'").get() as
    { value: string } | undefined;
  let seq = seqRow?.seq ?? 0;
  /** highest seq removed by size pruning; a client resuming below it must resync */
  let floor = floorRow ? Number(floorRow.value) : 0;
  const count = db.prepare('SELECT COUNT(*) AS n FROM hub_events');
  type Row = {
    seq: number;
    ts: number;
    kind: 'village' | 'x';
    type: string;
    payload_json: string;
    squad_id: string | null;
  };

  return {
    append(e) {
      const ts = Date.now();
      const res = insert.run(ts, e.kind, e.type, JSON.stringify(e.payload ?? null), e.squadId);
      seq = Number(res.lastInsertRowid);
      if (seq > max) {
        prune.run(seq - max);
        floor = seq - max;
        setMeta.run('events_floor', String(floor));
      }
      return { ...e, seq, ts };
    },
    since(afterSeq) {
      if (afterSeq > 0 && floor > afterSeq) return 'too_old';
      return (after.all(afterSeq) as Row[]).map((r) => ({
        seq: r.seq,
        ts: r.ts,
        kind: r.kind,
        type: r.type,
        payload: JSON.parse(r.payload_json) as unknown,
        squadId: r.squad_id,
      }));
    },
    lastSeq: () => seq,
    size: () => (count.get() as { n: number }).n,
    clear() {
      db.exec('DELETE FROM hub_events'); // AUTOINCREMENT keeps counting, so ids never repeat
    },
  };
}

function createMemoryEventLog(maxEvents: number): EventLog {
  const max = Math.max(1, maxEvents);
  let buf: LoggedEvent[] = [];
  let head = 0; // index of the oldest element when full
  let seq = 0;
  let evicted = false;
  const ordered = (): LoggedEvent[] =>
    buf.length < max ? buf : [...buf.slice(head), ...buf.slice(0, head)];

  return {
    append(e) {
      const logged: LoggedEvent = { ...e, seq: ++seq, ts: Date.now() };
      if (buf.length < max) buf.push(logged);
      else {
        buf[head] = logged;
        head = (head + 1) % max;
        evicted = true;
      }
      return logged;
    },
    since(afterSeq) {
      const all = ordered();
      const oldest = all[0]?.seq ?? seq + 1;
      if (afterSeq > 0 && evicted && afterSeq < oldest - 1) return 'too_old';
      return all.filter((e) => e.seq > afterSeq);
    },
    lastSeq: () => seq,
    size: () => buf.length,
    clear() {
      buf = [];
      head = 0;
      evicted = false; // seq keeps counting so ids never repeat after a reset
    },
  };
}
