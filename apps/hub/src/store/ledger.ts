import type { LedgerEntry } from '@squad/core';
import type { Directory, LedgerStore, Viewer } from '../types';

interface Row {
  taskId: string;
  student: string;
  field: string;
  shared: string;
  /** Public marker: a value was withheld (the literal 'hidden'), never the raw text. */
  hasWithheld: boolean;
  ts: number;
}

export function createLedgerStore(): LedgerStore {
  const rows: Row[] = [];
  /** PRIVATE raw values by `${taskId}|${student}|${field}`; never leave except to the owner. */
  const priv = new Map<string, string>();
  const key = (t: string, s: string, f: string) => `${t}|${s}|${f}`;

  const upsert = (row: Row) => {
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
      if (e.withheld !== undefined) priv.set(key(e.taskId, e.student, e.field), e.withheld);
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
    },
  };
}
