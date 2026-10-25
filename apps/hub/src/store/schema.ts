import type { Db } from '@squad/core';

/** Hub tables in the shared sqlite (core's Db). Idempotent; every table is prefixed `hub_`. */
export const HUB_SCHEMA = `
CREATE TABLE IF NOT EXISTS hub_events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  type TEXT NOT NULL, payload_json TEXT NOT NULL, squad_id TEXT);
CREATE TABLE IF NOT EXISTS hub_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_students(id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_squads(id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_squad_settings(squad_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_trips(trip_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_ledger_rows(
  task_id TEXT NOT NULL, student TEXT NOT NULL, field TEXT NOT NULL, ts INTEGER NOT NULL,
  shared TEXT NOT NULL, has_withheld INTEGER NOT NULL, PRIMARY KEY(task_id, student, field, ts));
CREATE TABLE IF NOT EXISTS hub_ledger_private(
  task_id TEXT NOT NULL, student TEXT NOT NULL, field TEXT NOT NULL, raw TEXT NOT NULL,
  PRIMARY KEY(task_id, student, field));
CREATE TABLE IF NOT EXISTS hub_busy_blocks(
  student TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, title TEXT NOT NULL,
  PRIMARY KEY(student, start, end));
CREATE TABLE IF NOT EXISTS hub_confirmed_tasks(task_id TEXT PRIMARY KEY);
`;

export function ensureHubSchema(db: Db): void {
  db.exec(HUB_SCHEMA);
}
