import type { Db } from '@squad/core';
import { buildNeedles, findPrivateLeak, type Needle } from '../gate/scan';

export interface LedgerRow {
  taskId: string;
  student: string;
  field: string;
  shared: string;
  /** A LABEL such as 'budget cap'. Never the value. */
  withheld: string;
  blocked?: true;
  ts: number;
}

export interface Ledger {
  record(r: Omit<LedgerRow, 'ts'>): LedgerRow;
  list(taskId?: string): LedgerRow[];
  /** Register private values; any later row whose text contains one is refused. */
  guard(values: readonly (string | number)[]): void;
}

export class LedgerLeakError extends Error {
  constructor(public readonly category: string) {
    super(`ledger row refused: contains a registered private value (${category})`);
    this.name = 'LedgerLeakError';
  }
}

abstract class BaseLedger implements Ledger {
  private needles: Needle[] = [];
  constructor(protected readonly now: () => number) {}
  guard(values: readonly (string | number)[]): void {
    this.needles.push(...buildNeedles({ secrets: [...values] }));
  }
  record(r: Omit<LedgerRow, 'ts'>): LedgerRow {
    const hit = findPrivateLeak(r, this.needles);
    if (hit) throw new LedgerLeakError(hit);
    const row: LedgerRow = { ...r, ts: this.now() };
    if (!r.blocked) delete row.blocked;
    this.store(row);
    return row;
  }
  protected abstract store(row: LedgerRow): void;
  abstract list(taskId?: string): LedgerRow[];
}

class MemoryLedger extends BaseLedger {
  private rows: LedgerRow[] = [];
  protected store(row: LedgerRow): void {
    this.rows.push(row);
  }
  list(taskId?: string): LedgerRow[] {
    return this.rows.filter((r) => taskId === undefined || r.taskId === taskId).map((r) => ({ ...r }));
  }
}

class SqliteLedger extends BaseLedger {
  constructor(
    private readonly db: Db,
    now: () => number,
  ) {
    super(now);
    db.exec(`CREATE TABLE IF NOT EXISTS mesh_ledger(
      id INTEGER PRIMARY KEY, task_id TEXT, student TEXT, field TEXT, shared TEXT, withheld TEXT,
      blocked INTEGER, ts INTEGER)`);
  }
  protected store(r: LedgerRow): void {
    this.db
      .prepare('INSERT INTO mesh_ledger(task_id,student,field,shared,withheld,blocked,ts) VALUES (?,?,?,?,?,?,?)')
      .run(r.taskId, r.student, r.field, r.shared, r.withheld, r.blocked ? 1 : 0, r.ts);
  }
  list(taskId?: string): LedgerRow[] {
    const rows = (
      taskId === undefined
        ? this.db.prepare('SELECT * FROM mesh_ledger ORDER BY id').all()
        : this.db.prepare('SELECT * FROM mesh_ledger WHERE task_id=? ORDER BY id').all(taskId)
    ) as { task_id: string; student: string; field: string; shared: string; withheld: string; blocked: number; ts: number }[];
    return rows.map((x) => ({
      taskId: x.task_id,
      student: x.student,
      field: x.field,
      shared: x.shared,
      withheld: x.withheld,
      ...(x.blocked ? { blocked: true as const } : {}),
      ts: x.ts,
    }));
  }
}

export const createMemoryLedger = (now: () => number = () => 0): Ledger => new MemoryLedger(now);
export const createSqliteLedger = (db: Db, now: () => number = () => 0): Ledger => new SqliteLedger(db, now);
