import type { Db, LedgerEntry } from '@squad/core';
import type { Directory, LedgerStore, Viewer } from '../types';
import { ensureHubSchema } from './schema';

interface Row {
  taskId: string;
  student: string;
  field: string;
  shared: string;
  /** Public marker: a value was withheld (the literal 'hidden'), never the raw text. */
  hasWithheld: boolean;
  ts: number;
}

/** Rows plus the owner-only raw values, written through to the shared sqlite when `db` is given. */
export function createLedgerStore(db?: Db): LedgerStore {
  const rows: Row[] = [];
  /** PRIVATE raw values by `${taskId}|${student}|${field}`; never leave except to the owner. */
  const priv = new Map<string, string>();
  const key = (t: string, s: string, f: string) => `${t}|${s}|${f}`;
  const putRow = db?.prepare(
    `INSERT OR REPLACE INTO hub_ledger_rows(task_id, student, field, ts, shared, has_withheld) VALUES(?,?,?,?,?,?)`,
  );
  const putPriv = db?.prepare(
    `INSERT OR REPLACE INTO hub_ledger_private(task_id, student, field, raw) VALUES(?,?,?,?)`,
  );
  if (db) {
    ensureHubSchema(db);
    for (const r of db
      .prepare('SELECT task_id, student, field, ts, shared, has_withheld FROM hub_ledger_rows')
      .all() as {
      task_id: string;
      student: string;
      field: string;
      ts: number;
      shared: string;
      has_withheld: number;
    }[])
      rows.push({
        taskId: r.task_id,
        student: r.student,
        field: r.field,
        shared: r.shared,
        hasWithheld: r.has_withheld === 1,
        ts: r.ts,
      });
    for (const r of db
      .prepare('SELECT task_id, student, field, raw FROM hub_ledger_private')
      .all() as { task_id: string; student: string; field: string; raw: string }[])
      priv.set(key(r.task_id, r.student, r.field), r.raw);
  }

  const upsert = (row: Row) => {
    putRow?.run(row.taskId, row.student, row.field, row.ts, row.shared, row.hasWithheld ? 1 : 0);
    const i = rows.findIndex(
      (r) =>
        r.taskId === row.taskId &&
        r.student === row.student &&
        r.field === row.field &&
        r.ts === row.ts,
    );
    if (i >= 0) rows[i] = row;
    else rows.push(row);
  };

  return {
    forget(student) {
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i]?.student === student) rows.splice(i, 1);
      for (const k of [...priv.keys()]) if (k.split('|')[1] === student) priv.delete(k);
      db?.prepare('DELETE FROM hub_ledger_rows WHERE student=?').run(student);
      db?.prepare('DELETE FROM hub_ledger_private WHERE student=?').run(student);
    },
    recordPublic(e, ts) {
      upsert({
        taskId: e.taskId,
        student: e.student,
        field: e.field,
        shared: e.shared ?? '',
        hasWithheld: e.withheld === 'hidden',
        ts,
      });
    },
    addPrivate(e: LedgerEntry) {
      if (e.withheld !== undefined) {
        priv.set(key(e.taskId, e.student, e.field), e.withheld);
        putPriv?.run(e.taskId, e.student, e.field, e.withheld);
      }
      upsert({
        taskId: e.taskId,
        student: e.student,
        field: e.field,
        shared: e.shared,
        hasWithheld: e.withheld !== undefined,
        ts: e.ts,
      });
    },
    entries(taskId, viewer: Viewer) {
      return rows
        .filter((r) => r.taskId === taskId)
        .sort((a, b) => a.ts - b.ts)
        .map((r): LedgerEntry => {
          const out: LedgerEntry = {
            taskId: r.taskId,
            student: r.student,
            field: r.field,
            shared: r.shared,
            ts: r.ts,
          };
          if (!r.hasWithheld) return out;
          const raw = priv.get(key(r.taskId, r.student, r.field));
          const owner = r.student === viewer.studentId && !viewer.projector;
          out.withheld = owner && raw !== undefined ? raw : 'hidden';
          return out;
        });
    },
    taskIds(squadId: string, directory: Directory) {
      const members = new Set(directory.squad(squadId)?.members ?? []);
      return [...new Set(rows.filter((r) => members.has(r.student)).map((r) => r.taskId))];
    },
    clear() {
      rows.length = 0;
      priv.clear();
      db?.exec('DELETE FROM hub_ledger_rows; DELETE FROM hub_ledger_private;');
    },
  };
}
