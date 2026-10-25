import Database from 'better-sqlite3';
import type { Db } from './types';

/** Core schema from docs/specs/02. Other packages add their own tables in their own packages. */
export const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS students(
  id TEXT PRIMARY KEY, name TEXT, handle TEXT UNIQUE, persona_id TEXT, voice_id TEXT,
  avatar_url TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS chats(
  id TEXT PRIMARY KEY, is_group INTEGER, name TEXT, transport TEXT, settings_json TEXT);
CREATE TABLE IF NOT EXISTS chat_members(
  chat_id TEXT, student_id TEXT, PRIMARY KEY(chat_id, student_id));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, chat_id TEXT, from_id TEXT, text TEXT, attachments_json TEXT,
  mentions_bot INTEGER, persona_id TEXT, decision_json TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS memory(
  id INTEGER PRIMARY KEY, scope TEXT, scope_id TEXT, key TEXT, value_json TEXT, ts INTEGER,
  UNIQUE(scope, scope_id, key));
CREATE TABLE IF NOT EXISTS pending_confirms(
  id INTEGER PRIMARY KEY, student_id TEXT, question TEXT, options_json TEXT, answer TEXT,
  expires_at INTEGER);
`;

export function migrate(db: Db): Db {
  db.exec(CORE_SCHEMA);
  return db;
}

/** Open (or create) a file db with core schema applied. `:memory:` for tests. */
export function openDb(path = ':memory:'): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return migrate(db);
}

/** Fresh in-memory sqlite with the core schema: the test helper. */
export function openMemoryDb(): Db {
  return openDb(':memory:');
}
