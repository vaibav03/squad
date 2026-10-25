import type { Db, StudentId } from '@squad/core';
import type { Cite, DevilPlan } from './rules';

export type DevilPhase = 'awaiting' | 'judging' | 'done';

export interface DevilSession {
  id: string;
  chatId: string;
  student: string;
  courseId: string;
  chapter: string;
  plan: DevilPlan;
  demo: boolean;
  tries: number;
  phase: DevilPhase;
  ts: number;
}

const ensured = new WeakSet<object>();

/** Idempotent. The row holds the error location; nothing here is ever sent to the chat or village. */
export function ensureDevilSchema(db: Db): void {
  if (ensured.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS devilta_sessions(
    id TEXT PRIMARY KEY, chatId TEXT NOT NULL, student TEXT NOT NULL, courseId TEXT NOT NULL,
    chapter TEXT NOT NULL, lines_json TEXT NOT NULL, errorLine INTEGER NOT NULL,
    keywords_json TEXT NOT NULL, whatIsWrong TEXT NOT NULL, correct TEXT NOT NULL,
    cite_json TEXT, demo INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL, ts INTEGER NOT NULL)`);
  ensured.add(db);
}

interface Row {
  id: string;
  chatId: string;
  student: string;
  courseId: string;
  chapter: string;
  lines_json: string;
  errorLine: number;
  keywords_json: string;
  whatIsWrong: string;
  correct: string;
  cite_json: string | null;
  demo: number;
  tries: number;
  phase: DevilPhase;
  ts: number;
}

const fromRow = (r: Row): DevilSession => ({
  id: r.id,
  chatId: r.chatId,
  student: r.student,
  courseId: r.courseId,
  chapter: r.chapter,
  plan: {
    lines: JSON.parse(r.lines_json) as string[],
    errorLine: r.errorLine,
    keywords: JSON.parse(r.keywords_json) as string[],
    whatIsWrong: r.whatIsWrong,
    correct: r.correct,
    ...(r.cite_json ? { cite: JSON.parse(r.cite_json) as Cite } : {}),
  },
  demo: r.demo === 1,
  tries: r.tries,
  phase: r.phase,
  ts: r.ts,
});

export function createSession(db: Db, s: Omit<DevilSession, 'phase' | 'tries'>): void {
  ensureDevilSchema(db);
  // A new round replaces any round this student still has open in this chat.
  db.prepare(
    "UPDATE devilta_sessions SET phase='done' WHERE chatId=? AND student=? AND phase!='done'",
  ).run(s.chatId, s.student);
  db.prepare(
    `INSERT INTO devilta_sessions(id, chatId, student, courseId, chapter, lines_json, errorLine,
      keywords_json, whatIsWrong, correct, cite_json, demo, tries, phase, ts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,'awaiting',?)`,
  ).run(
    s.id,
    s.chatId,
    s.student,
    s.courseId,
    s.chapter,
    JSON.stringify(s.plan.lines),
    s.plan.errorLine,
    JSON.stringify(s.plan.keywords),
    s.plan.whatIsWrong,
    s.plan.correct,
    s.plan.cite ? JSON.stringify(s.plan.cite) : null,
    s.demo ? 1 : 0,
    s.ts,
  );
}

/** The open (awaiting) session of this student in this chat, newest first, within the TTL. */
export function activeSession(
  db: Db,
  chatId: string,
  student: StudentId,
  now: number,
  ttlMs: number,
): DevilSession | undefined {
  ensureDevilSchema(db);
  const r = db
    .prepare(
      "SELECT * FROM devilta_sessions WHERE chatId=? AND student=? AND phase='awaiting' AND ts>=? ORDER BY ts DESC, rowid DESC LIMIT 1",
    )
    .get(chatId, student, now - ttlMs) as Row | undefined;
  return r ? fromRow(r) : undefined;
}

export function countSessions(db: Db, student: string): number {
  ensureDevilSchema(db);
  return (
    db.prepare('SELECT COUNT(*) AS n FROM devilta_sessions WHERE student=?').get(student) as {
      n: number;
    }
  ).n;
}

/** awaiting -> judging, atomically; false when someone else already claimed this round. */
export function claim(db: Db, id: string): boolean {
  return (
    db
      .prepare("UPDATE devilta_sessions SET phase='judging' WHERE id=? AND phase='awaiting'")
      .run(id).changes === 1
  );
}

export function reopen(db: Db, id: string, tries: number): void {
  db.prepare("UPDATE devilta_sessions SET phase='awaiting', tries=? WHERE id=?").run(tries, id);
}

export function finish(db: Db, id: string, tries: number): void {
  db.prepare("UPDATE devilta_sessions SET phase='done', tries=? WHERE id=?").run(tries, id);
}

export function getSession(db: Db, id: string): DevilSession | undefined {
  ensureDevilSchema(db);
  const r = db.prepare('SELECT * FROM devilta_sessions WHERE id=?').get(id) as Row | undefined;
  return r ? fromRow(r) : undefined;
}
