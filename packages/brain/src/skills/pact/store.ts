import type { Db } from '@squad/core';

export type PactStatus = 'pending_confirm' | 'active' | 'kept' | 'missed' | 'cancelled' | 'dropped';

export interface Pact {
  id: string;
  student: string;
  chat_id: string;
  text: string;
  deadline: number;
  status: PactStatus;
  created_at: number;
  updated_at: number;
  extended: number;
  confirm_task: string | null;
}

export function ensurePactSchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS pacts(
    id TEXT PRIMARY KEY, student TEXT NOT NULL, chat_id TEXT NOT NULL, text TEXT NOT NULL,
    deadline INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, extended INTEGER NOT NULL DEFAULT 0, confirm_task TEXT)`);
}

export const getPact = (db: Db, id: string): Pact | undefined =>
  db.prepare('SELECT * FROM pacts WHERE id=?').get(id) as Pact | undefined;

/** Only ever the asker's own rows. */
export const ownPacts = (db: Db, student: string, statuses: PactStatus[]): Pact[] =>
  (
    db.prepare('SELECT * FROM pacts WHERE student=? ORDER BY created_at, id').all(student) as Pact[]
  ).filter((p) => statuses.includes(p.status));

export function setStatus(db: Db, id: string, status: PactStatus, now: number): void {
  db.prepare('UPDATE pacts SET status=?, updated_at=? WHERE id=?').run(status, now, id);
}

export function setDeadline(db: Db, id: string, deadline: number, now: number): void {
  db.prepare('UPDATE pacts SET deadline=?, updated_at=? WHERE id=?').run(deadline, now, id);
}

const AWAIT = 'pact.awaiting';
export function awaitingOf(db: Db, student: string): string | undefined {
  const r = db
    .prepare("SELECT value_json FROM memory WHERE scope='student' AND scope_id=? AND key=?")
    .get(student, AWAIT) as { value_json: string } | undefined;
  return r ? (JSON.parse(r.value_json) as string | null) || undefined : undefined;
}
export function setAwaiting(db: Db, student: string, id: string | null, now: number): void {
  db.prepare(
    `INSERT INTO memory(scope, scope_id, key, value_json, ts) VALUES('student', ?, ?, ?, ?)
     ON CONFLICT(scope, scope_id, key) DO UPDATE SET value_json=excluded.value_json, ts=excluded.ts`,
  ).run(student, AWAIT, JSON.stringify(id), now);
}
