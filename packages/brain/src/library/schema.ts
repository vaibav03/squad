import type { Db } from '@squad/core';

/** Library tables. Course, chapter and page rows live in the brain's own tables (createCourseStore). */
export const LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS lib_courses(
  course_id TEXT PRIMARY KEY, owner TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private',
  sample INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lib_courses_owner ON lib_courses(owner);
CREATE TABLE IF NOT EXISTS lib_files(
  file_id TEXT PRIMARY KEY, course_id TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  pages INTEGER, status TEXT NOT NULL, pct INTEGER NOT NULL DEFAULT 0,
  error_code TEXT, error_message TEXT, stored_path TEXT, uploaded_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lib_files_course ON lib_files(course_id);
CREATE TABLE IF NOT EXISTS lib_syllabus(
  course_id TEXT PRIMARY KEY, source_file TEXT, text TEXT NOT NULL, policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lib_removed(
  course_id TEXT NOT NULL, name TEXT NOT NULL, removed_at INTEGER NOT NULL,
  PRIMARY KEY(course_id, name));
CREATE TABLE IF NOT EXISTS lib_catalogue(
  student TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
`;

export function ensureLibrarySchema(db: Db): void {
  db.exec(LIBRARY_SCHEMA);
}

export const tableExists = (db: Db, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
