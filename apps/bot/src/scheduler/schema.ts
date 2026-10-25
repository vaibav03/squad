import type { Db } from '@squad/core';

/** Scheduler tables in the shared sqlite. Idempotent; every table is prefixed `sched_`. */
export const SCHED_SCHEMA = `
CREATE TABLE IF NOT EXISTS sched_jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT 'null', student TEXT, chat_id TEXT,
  scope TEXT NOT NULL DEFAULT 'dm', cron TEXT, tz TEXT,
  run_at INTEGER NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  missed TEXT NOT NULL DEFAULT 'run_once', grace_ms INTEGER NOT NULL DEFAULT 21600000,
  requires_opt_in INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_run_at INTEGER,
  lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sched_jobs_due ON sched_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS sched_jobs_student ON sched_jobs(student, kind);
CREATE TABLE IF NOT EXISTS sched_prefs(
  subject TEXT PRIMARY KEY, opt_in INTEGER NOT NULL DEFAULT 0, opted_out INTEGER NOT NULL DEFAULT 0,
  snooze_until INTEGER, tz TEXT, quiet_start TEXT, quiet_end TEXT,
  ignored INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sched_sends(
  id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_key TEXT UNIQUE, student TEXT, chat_id TEXT,
  scope TEXT NOT NULL, kind TEXT, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sched_sends_student ON sched_sends(student, ts);
CREATE INDEX IF NOT EXISTS sched_sends_ts ON sched_sends(ts);
`;

export function ensureSchedSchema(db: Db): void {
  db.exec(SCHED_SCHEMA);
}
