import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Db } from '@squad/core';
import type { CourseStore } from '../ingest/types';
import { newCourseId } from './ids';
import { ensureLibrarySchema } from './schema';
import type { FileKind, FileRow, IngestStatus, PolicyLine, Role, Visibility } from './types';
import { DEMO_OWNER, libErrorMessage } from './types';

export interface LibCourseRow {
  courseId: string;
  owner: string;
  visibility: Visibility;
  sample: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FileRec {
  fileId: string;
  courseId: string;
  owner: string;
  name: string;
  kind: FileKind;
  mime: string;
  size: number;
  sha256: string; // full hex
  pages: number | null;
  status: IngestStatus;
  pct: number;
  errorCode: string | null;
  errorMessage: string | null;
  storedPath: string | null;
  uploadedAt: number;
}

export interface SyllabusRec {
  courseId: string;
  sourceFile: string | null;
  text: string;
  lines: PolicyLine[];
}

export interface LibraryStoreDeps {
  db: Db;
  courses: CourseStore;
  /** Where raw uploads live (created on demand). Files are named by their unguessable id only. */
  dataDir: string;
  now?: () => number;
  /** Squad of a student (hub directory). */
  squadOf: (student: string) => string | undefined;
}

interface CourseRowSql {
  course_id: string;
  owner: string;
  visibility: string;
  sample: number;
  created_at: number;
  updated_at: number;
}
interface FileRowSql {
  file_id: string;
  course_id: string;
  owner: string;
  name: string;
  kind: string;
  mime: string;
  size: number;
  sha256: string;
  pages: number | null;
  status: string;
  pct: number;
  error_code: string | null;
  error_message: string | null;
  stored_path: string | null;
  uploaded_at: number;
}

const toCourse = (r: CourseRowSql): LibCourseRow => ({
  courseId: r.course_id,
  owner: r.owner,
  visibility: r.visibility as Visibility,
  sample: r.sample === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toFile = (r: FileRowSql): FileRec => ({
  fileId: r.file_id,
  courseId: r.course_id,
  owner: r.owner,
  name: r.name,
  kind: r.kind as FileKind,
  mime: r.mime,
  size: r.size,
  sha256: r.sha256,
  pages: r.pages,
  status: r.status as IngestStatus,
  pct: r.pct,
  errorCode: r.error_code,
  errorMessage: r.error_message,
  storedPath: r.stored_path,
  uploadedAt: r.uploaded_at,
});

export const toFileRow = (f: FileRec): FileRow => ({
  fileId: f.fileId,
  name: f.name,
  kind: f.kind,
  mime: f.mime,
  size: f.size,
  pages: f.pages,
  sha256: f.sha256.slice(0, 12),
  status: f.status,
  pct: f.pct,
  ...(f.errorCode
    ? { error: { code: f.errorCode, message: f.errorMessage ?? libErrorMessage(f.errorCode) } }
    : {}),
  uploadedAt: f.uploadedAt,
});

export interface LibraryStore {
  readonly db: Db;
  readonly courses: CourseStore;
  readonly dataDir: string;
  now(): number;
  roleOf(courseId: string, viewer: string): Role | null;
  course(courseId: string): LibCourseRow | undefined;
  readable(viewer: string): { row: LibCourseRow; role: Role }[];
  createCourse(owner: string, title: string): LibCourseRow;
  registerCourse(row: {
    courseId: string;
    owner: string;
    visibility: Visibility;
    sample: boolean;
  }): void;
  patchCourse(courseId: string, patch: { title?: string; visibility?: Visibility }): void;
  touch(courseId: string): void;
  addFile(f: FileRec): void;
  file(fileId: string): FileRec | undefined;
  files(courseId: string): FileRec[];
  fileByName(courseId: string, name: string): FileRec | undefined;
  findBySha(courseId: string, sha: string): FileRec | undefined;
  setProgress(
    fileId: string,
    patch: {
      status: IngestStatus;
      pct: number;
      pages?: number;
      error?: { code: string; message?: string };
    },
  ): void;
  /** Writes bytes to `dataDir/<fileId>` (mode 600) and returns the path. */
  saveBytes(fileId: string, bytes: Uint8Array): string;
  /** Deletes the file only when it is inside `dataDir` (fixtures and foreign paths are never unlinked). */
  unlinkStored(path: string | null): boolean;
  /** Row, stored bytes and chapter/page rows of one file; leaves a tombstone so citations say "removed". */
  removeFile(fileId: string): void;
  tombstone(courseId: string, name: string): boolean;
  clearTombstone(courseId: string, name: string): void;
  recoverInterrupted(): number;
  getSyllabus(courseId: string): SyllabusRec | undefined;
  setSyllabus(
    courseId: string,
    sourceFile: string | null,
    text: string,
    lines: PolicyLine[],
    policy: string,
  ): void;
  clearSyllabus(courseId: string): void;
  getCatalogue(student: string): unknown | undefined;
  setCatalogue(student: string, json: unknown): void;
}

export function createLibraryStore(deps: LibraryStoreDeps): LibraryStore {
  const { db, courses, squadOf } = deps;
  const now = deps.now ?? Date.now;
  const dataDir = resolve(deps.dataDir);
  ensureLibrarySchema(db);

  const q = {
    course: db.prepare('SELECT * FROM lib_courses WHERE course_id=?'),
    all: db.prepare('SELECT * FROM lib_courses'),
    insertCourse: db.prepare(
      `INSERT INTO lib_courses(course_id,owner,visibility,sample,created_at,updated_at)
       VALUES(@courseId,@owner,@visibility,@sample,@t,@t)
       ON CONFLICT(course_id) DO UPDATE SET owner=excluded.owner, visibility=excluded.visibility, sample=excluded.sample`,
    ),
    touch: db.prepare('UPDATE lib_courses SET updated_at=? WHERE course_id=?'),
    setVisibility: db.prepare(
      'UPDATE lib_courses SET visibility=?, updated_at=? WHERE course_id=?',
    ),
    addFile: db.prepare(
      `INSERT INTO lib_files(file_id,course_id,owner,name,kind,mime,size,sha256,pages,status,pct,error_code,error_message,stored_path,uploaded_at)
       VALUES(@fileId,@courseId,@owner,@name,@kind,@mime,@size,@sha256,@pages,@status,@pct,@errorCode,@errorMessage,@storedPath,@uploadedAt)`,
    ),
    file: db.prepare('SELECT * FROM lib_files WHERE file_id=?'),
    files: db.prepare('SELECT * FROM lib_files WHERE course_id=? ORDER BY uploaded_at, file_id'),
    byName: db.prepare('SELECT * FROM lib_files WHERE course_id=? AND name=?'),
    bySha: db.prepare(
      "SELECT * FROM lib_files WHERE course_id=? AND sha256=? AND status<>'failed'",
    ),
    progress: db.prepare(
      `UPDATE lib_files SET status=@status, pct=@pct, pages=COALESCE(@pages,pages),
         error_code=@errorCode, error_message=@errorMessage WHERE file_id=@fileId`,
    ),
    delFile: db.prepare('DELETE FROM lib_files WHERE file_id=?'),
    delFilePages: db.prepare('DELETE FROM pages WHERE course_id=? AND file=?'),
    delFileChapters: db.prepare('DELETE FROM chapters WHERE course_id=? AND file=?'),
    tomb: db.prepare('INSERT OR REPLACE INTO lib_removed(course_id,name,removed_at) VALUES(?,?,?)'),
    hasTomb: db.prepare('SELECT 1 FROM lib_removed WHERE course_id=? AND name=?'),
    delTomb: db.prepare('DELETE FROM lib_removed WHERE course_id=? AND name=?'),
    interrupted: db.prepare(
      `UPDATE lib_files SET status='failed', error_code='interrupted', error_message=?
       WHERE status IN ('queued','parsing','embedding')`,
    ),
    getSyl: db.prepare('SELECT * FROM lib_syllabus WHERE course_id=?'),
    setSyl: db.prepare(
      `INSERT INTO lib_syllabus(course_id,source_file,text,policy_json,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(course_id) DO UPDATE SET source_file=excluded.source_file, text=excluded.text,
         policy_json=excluded.policy_json, updated_at=excluded.updated_at`,
    ),
    delSyl: db.prepare('DELETE FROM lib_syllabus WHERE course_id=?'),
    setPolicy: db.prepare('UPDATE courses SET policy=? WHERE id=?'),
    getCat: db.prepare('SELECT json FROM lib_catalogue WHERE student=?'),
    setCat: db.prepare(
      `INSERT INTO lib_catalogue(student,json,updated_at) VALUES(?,?,?)
       ON CONFLICT(student) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
    ),
  };

  const roleFor = (row: LibCourseRow, viewer: string): Role | null => {
    if (row.owner === viewer && row.owner !== DEMO_OWNER) return 'owner';
    if (row.visibility === 'public') return 'public';
    if (row.visibility === 'squad') {
      const a = squadOf(row.owner);
      if (a !== undefined && a === squadOf(viewer)) return 'squad';
    }
    return null;
  };

  const store: LibraryStore = {
    db,
    courses,
    dataDir,
    now,
    roleOf(courseId, viewer) {
      const r = q.course.get(courseId) as CourseRowSql | undefined;
      return r ? roleFor(toCourse(r), viewer) : null;
    },
    course(courseId) {
      const r = q.course.get(courseId) as CourseRowSql | undefined;
      return r ? toCourse(r) : undefined;
    },
    readable(viewer) {
      const out: { row: LibCourseRow; role: Role }[] = [];
      for (const r of q.all.all() as CourseRowSql[]) {
        const row = toCourse(r);
        const role = roleFor(row, viewer);
        if (role) out.push({ row, role });
      }
      const rank = { owner: 0, squad: 1, public: 2 } as const;
      return out.sort((a, b) => rank[a.role] - rank[b.role] || b.row.updatedAt - a.row.updatedAt);
    },
    createCourse(owner, title) {
      const courseId = newCourseId();
      courses.saveCourse({ id: courseId, title });
      q.insertCourse.run({ courseId, owner, visibility: 'private', sample: 0, t: now() });
      return store.course(courseId)!;
    },
    registerCourse(r) {
      q.insertCourse.run({ ...r, sample: r.sample ? 1 : 0, t: now() });
    },
    patchCourse(courseId, patch) {
      if (patch.title !== undefined) {
        const c = courses.getCourse(courseId);
        courses.saveCourse({
          id: courseId,
          title: patch.title,
          ...(c?.policy ? { policy: c.policy } : {}),
        });
      }
      if (patch.visibility !== undefined) q.setVisibility.run(patch.visibility, now(), courseId);
      else store.touch(courseId);
    },
    touch(courseId) {
      q.touch.run(now(), courseId);
    },
    addFile(f) {
      q.addFile.run(f);
    },
    file(fileId) {
      const r = q.file.get(fileId) as FileRowSql | undefined;
      return r ? toFile(r) : undefined;
    },
    files: (courseId) => (q.files.all(courseId) as FileRowSql[]).map(toFile),
    fileByName(courseId, name) {
      const r = q.byName.get(courseId, name) as FileRowSql | undefined;
      return r ? toFile(r) : undefined;
    },
    findBySha(courseId, sha) {
      const r = q.bySha.get(courseId, sha) as FileRowSql | undefined;
      return r ? toFile(r) : undefined;
    },
    setProgress(fileId, p) {
      q.progress.run({
        fileId,
        status: p.status,
        pct: Math.max(0, Math.min(100, Math.round(p.pct))),
        pages: p.pages ?? null,
        errorCode: p.error?.code ?? null,
        errorMessage: p.error ? (p.error.message ?? libErrorMessage(p.error.code)) : null,
      });
      const f = store.file(fileId);
      if (f) store.touch(f.courseId);
    },
    saveBytes(fileId, bytes) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const path = join(dataDir, fileId);
      writeFileSync(path, bytes, { mode: 0o600 });
      return path;
    },
    unlinkStored(path) {
      if (!path) return false;
      const p = resolve(path);
      if (!p.startsWith(dataDir + sep)) return false;
      try {
        rmSync(p, { force: true });
        return true;
      } catch {
        return false;
      }
    },
    removeFile(fileId) {
      const f = store.file(fileId);
      if (!f) return;
      db.transaction(() => {
        q.delFilePages.run(f.courseId, f.name);
        q.delFileChapters.run(f.courseId, f.name);
        q.delFile.run(fileId);
        q.tomb.run(f.courseId, f.name, now());
        if (f.kind === 'syllabus') store.clearSyllabus(f.courseId);
      })();
      store.unlinkStored(f.storedPath);
      store.touch(f.courseId);
    },
    tombstone: (courseId, name) => q.hasTomb.get(courseId, name) !== undefined,
    clearTombstone(courseId, name) {
      q.delTomb.run(courseId, name);
    },
    recoverInterrupted() {
      return q.interrupted.run(libErrorMessage('interrupted')).changes;
    },
    getSyllabus(courseId) {
      const r = q.getSyl.get(courseId) as
        | { course_id: string; source_file: string | null; text: string; policy_json: string }
        | undefined;
      if (!r) return undefined;
      return {
        courseId,
        sourceFile: r.source_file,
        text: r.text,
        lines: JSON.parse(r.policy_json) as PolicyLine[],
      };
    },
    setSyllabus(courseId, sourceFile, text, lines, policy) {
      db.transaction(() => {
        q.setSyl.run(courseId, sourceFile, text, JSON.stringify(lines), now());
        q.setPolicy.run(policy, courseId); // keeps hwpolicy quoting the same text
      })();
      store.touch(courseId);
    },
    clearSyllabus(courseId) {
      q.delSyl.run(courseId);
      q.setPolicy.run(null, courseId);
    },
    getCatalogue(student) {
      const r = q.getCat.get(student) as { json: string } | undefined;
      return r ? (JSON.parse(r.json) as unknown) : undefined;
    },
    setCatalogue(student, json) {
      q.setCat.run(student, JSON.stringify(json), now());
    },
  };
  return store;
}
