import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import { createCourseStore } from '../ingest';
import { ensureMasterySchema } from '../mastery/schema';
import { ensureQuizSchema } from '../quiz/schema';
import { mergeChaptersIn, renameChapterIn, splitChapterIn } from './chapterstore';
import { deleteCourse, previewCascade } from './cascade';
import { ensureDemoCourse } from './demo';
import { createPipeline, type ProgressEvent } from './pipeline';
import { resolveSource } from './source';
import { createLibraryStore } from './store';
import { buildTextPdf } from './testpdf';
import { withTimeout } from './timeout';
import { LibraryError, DEMO_COURSE_ID } from './types';
import { detail, summarizeCourse } from './views';

const SQUADS: Record<string, string> = { ana: 'sq1', ben: 'sq1', zed: 'sq2' };
function kit() {
  const db = openMemoryDb();
  const courses = createCourseStore(db);
  const lib = createLibraryStore({
    db,
    courses,
    dataDir: mkdtempSync(join(tmpdir(), 'lib-test-')),
    squadOf: (s) => SQUADS[s],
  });
  const events: ProgressEvent[] = [];
  const pipe = createPipeline(lib, (e) => events.push(e));
  return { db, courses, lib, pipe, events };
}
const enc = (s: string) => new TextEncoder().encode(s);
const NOTES = Array.from(
  { length: 100 },
  (_, i) => `Note line ${i + 1}: the central limit theorem matters here.`,
).join('\n');
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof LibraryError ? e.code : 'other';
  }
};

describe('library pipeline', () => {
  it('ingests text into 3 pseudo-pages, walks queued->parsing->embedding->ready and persists status', async () => {
    const k = kit();
    const c = k.lib.createCourse('ana', 'Stats');
    const f = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'notes.txt',
      bytes: enc(NOTES),
      kind: 'material',
    });
    expect(f.status).toBe('queued');
    expect(f.pages).toBe(3);
    await k.pipe.idle();
    const row = k.lib.file(f.fileId)!;
    expect(row).toMatchObject({ status: 'ready', pct: 100, pages: 3 });
    expect(k.events.map((e) => e.status)).toEqual([
      'queued',
      'parsing',
      'parsing',
      'embedding',
      'ready',
    ]);
    expect(k.events.every((e) => e.owner === 'ana' && e.courseId === c.courseId)).toBe(true);
    expect(k.courses.getPages(c.courseId)).toHaveLength(3);
    expect(k.courses.listChapters(c.courseId)).toHaveLength(1);
    const s = summarizeCourse(k.lib, k.lib.course(c.courseId)!, 'owner', 'ana');
    expect(s).toMatchObject({
      status: 'ready',
      fileCount: 1,
      chapterCount: 1,
      pageCount: 3,
      role: 'owner',
    });
  });

  it('ingests a PDF with extractPages and rejects unsafe, duplicate, oversize and wrong types', async () => {
    const k = kit();
    const c = k.lib.createCourse('ana', 'Stats');
    const pdf = buildTextPdf([
      'The normal distribution is symmetric about the mean.',
      'Z scores standardise values across datasets.',
    ]);
    const f = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'ch6.pdf',
      bytes: pdf,
      kind: 'material',
    });
    await k.pipe.idle();
    expect(k.lib.file(f.fileId)).toMatchObject({
      status: 'ready',
      pages: 2,
      mime: 'application/pdf',
    });
    expect(k.courses.getPage(c.courseId, 'ch6.pdf', 2)!.text).toContain('Z scores');
    const dup = await k.pipe
      .submit({
        owner: 'ana',
        courseId: c.courseId,
        name: 'again.pdf',
        bytes: pdf,
        kind: 'material',
      })
      .catch((e: LibraryError) => e);
    expect(dup).toBeInstanceOf(LibraryError);
    expect((dup as LibraryError).code).toBe('duplicate');
    expect((dup as LibraryError).data).toEqual({ fileId: f.fileId });
    const evil = buildTextPdf(['hello hello'], '/OpenAction << /S /JavaScript /JS (x) >>');
    expect(
      await code(
        k.pipe.submit({
          owner: 'ana',
          courseId: c.courseId,
          name: 'e.pdf',
          bytes: evil,
          kind: 'material',
        }),
      ),
    ).toBe('unsafe_pdf');
    expect(
      await code(
        k.pipe.submit({
          owner: 'ana',
          courseId: c.courseId,
          name: 'x.pdf',
          bytes: enc('%PDF-1.4 garbage'),
          kind: 'material',
        }),
      ),
    ).toBe('unreadable_pdf');
    expect(
      await code(
        k.pipe.submit({
          owner: 'ana',
          courseId: c.courseId,
          name: 'big.txt',
          bytes: new Uint8Array(26 * 1024 * 1024).fill(97),
          kind: 'material',
        }),
      ),
    ).toBe('too_large');
    expect(
      await code(
        k.pipe.submit({
          owner: 'ana',
          courseId: c.courseId,
          name: 'deck.pptx',
          bytes: new Uint8Array([0x50, 0x4b, 3, 4, 1]),
          kind: 'material',
        }),
      ),
    ).toBe('unsupported_type');
    const lots = Array.from({ length: 401 * 40 }, (_, i) => `line ${i}`).join('\n');
    expect(
      await code(
        k.pipe.submit({
          owner: 'ana',
          courseId: c.courseId,
          name: 'lots.txt',
          bytes: enc(lots),
          kind: 'material',
        }),
      ),
    ).toBe('too_many_pages');
    expect(k.lib.files(c.courseId)).toHaveLength(1); // rejected uploads leave no row and no bytes
  });

  it('same name, different bytes gets a suffix; failed files are retryable', async () => {
    const k = kit();
    const c = k.lib.createCourse('ana', 'Stats');
    const a = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'n.txt',
      bytes: enc('first note text'),
      kind: 'material',
    });
    const b = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'n.txt',
      bytes: enc('second note text'),
      kind: 'material',
    });
    await k.pipe.idle();
    expect([a.name, b.name]).toEqual(['n.txt', 'n (2).txt']);
    expect(k.courses.listChapters(c.courseId).map((x) => x.id)).toEqual(['n', 'n-2']);
    // whitespace-only text has no readable content
    const w = await k.pipe
      .submit({
        owner: 'ana',
        courseId: c.courseId,
        name: 'w.txt',
        bytes: enc(' \n \n'),
        kind: 'material',
      })
      .catch((e: LibraryError) => e);
    expect((w as LibraryError).code).toBe('empty_file');
  });

  it('a syllabus upload stores verbatim policy lines and keeps courses.policy in sync', async () => {
    const k = kit();
    const c = k.lib.createCourse('ana', 'Stats');
    const text =
      'Welcome to class.\n  Homework is graded.  \nUsing an AI assistant for graded homework is not allowed.\nOffice hours Thursday.';
    const f = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'syllabus.txt',
      bytes: enc(text),
      kind: 'syllabus',
    });
    await k.pipe.idle();
    expect(k.lib.file(f.fileId)!.status).toBe('ready');
    const d = detail(k.lib, k.lib.course(c.courseId)!, 'owner', 'ana');
    expect(d.policy!.sourceFile).toBe('syllabus.txt');
    expect(d.policy!.lines.map((l) => l.text)).toEqual([
      'Homework is graded.',
      'Using an AI assistant for graded homework is not allowed.',
    ]);
    expect(k.courses.getCourse(c.courseId)!.policy).toBe(
      'Homework is graded.\nUsing an AI assistant for graded homework is not allowed.',
    );
    expect(k.courses.listChapters(c.courseId)).toHaveLength(0); // not a chapter
    k.lib.removeFile(f.fileId);
    expect(k.courses.getCourse(c.courseId)!.policy).toBeUndefined();
    expect(k.lib.getSyllabus(c.courseId)).toBeUndefined();
  });

  it('timeouts become a failed file with a stable code', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('recovers files left mid-ingest by a crash', async () => {
    const k = kit();
    const c = k.lib.createCourse('ana', 'S');
    const f = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'a.txt',
      bytes: enc('some text here'),
      kind: 'material',
    });
    k.lib.setProgress(f.fileId, { status: 'parsing', pct: 10 });
    expect(k.lib.recoverInterrupted()).toBe(1);
    expect(k.lib.file(f.fileId)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(k.pipe.reingest(f.fileId)?.fileId).toBe(f.fileId);
    await k.pipe.idle();
    expect(k.lib.file(f.fileId)!.status).toBe('ready');
  });
});

describe('access, source and delete', () => {
  async function seeded() {
    const k = kit();
    const c = k.lib.createCourse('ana', 'Private stats');
    const f = await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'secret.txt',
      bytes: enc(
        'Opening words here.\nThe moonlit heron eats quietly at dawn.\nClosing words there.',
      ),
      kind: 'material',
    });
    await k.pipe.idle();
    return { ...k, c, f };
  }
  const q = { file: 'secret.txt', page: 1, quote: 'moonlit heron eats quietly' };

  it('private: only the owner reads; squad opt-in opens it to the same squad only', async () => {
    const { lib, c } = await seeded();
    expect(lib.roleOf(c.courseId, 'ana')).toBe('owner');
    expect(lib.roleOf(c.courseId, 'ben')).toBeNull();
    expect(lib.roleOf(c.courseId, 'zed')).toBeNull();
    expect(lib.readable('ben').map((r) => r.row.courseId)).toEqual([]);
    lib.patchCourse(c.courseId, { visibility: 'squad' });
    expect(lib.roleOf(c.courseId, 'ben')).toBe('squad');
    expect(lib.roleOf(c.courseId, 'zed')).toBeNull();
    lib.patchCourse(c.courseId, { visibility: 'private' });
    expect(lib.roleOf(c.courseId, 'ben')).toBeNull();
  });

  it('source: verified quote with hit flags for the owner; identical not_found for everyone else', async () => {
    const { lib, c, f } = await seeded();
    const own = resolveSource(lib, 'ana', q);
    expect(own).toMatchObject({
      ok: true,
      courseId: c.courseId,
      fileId: f.fileId,
      quoteVerified: true,
      imageUrl: null,
      openUrl: `/v1/library/files/${f.fileId}/raw#page=1`,
    });
    if (own.ok)
      expect(own.lines.filter((l) => l.hit).map((l) => l.text)).toEqual([
        'The moonlit heron eats quietly at dawn.',
      ]);
    const nf = { ok: false, reason: 'not_found' };
    expect(resolveSource(lib, 'ben', q)).toEqual(nf);
    expect(resolveSource(lib, 'ben', { ...q, courseId: c.courseId })).toEqual(nf);
    expect(resolveSource(lib, 'zed', { ...q, courseId: c.courseId })).toEqual(nf);
    expect(resolveSource(lib, 'ana', { ...q, courseId: 'c_does_not_exist' })).toEqual(nf);
    expect(resolveSource(lib, 'ben', { ...q, courseId: 'c_does_not_exist' })).toEqual(nf); // same as unreadable
    expect(resolveSource(lib, 'ana', { ...q, page: 9 })).toEqual({
      ok: false,
      reason: 'page_missing',
    });
    lib.patchCourse(c.courseId, { visibility: 'squad' });
    expect(resolveSource(lib, 'ben', q)).toMatchObject({ ok: true });
    expect(resolveSource(lib, 'zed', q)).toEqual(nf);
    // an unverified quote is reported as such
    expect(
      resolveSource(lib, 'ana', { ...q, quote: 'never said anything like this' }),
    ).toMatchObject({ ok: true, quoteVerified: false });
    lib.removeFile(f.fileId);
    expect(resolveSource(lib, 'ana', { ...q, courseId: c.courseId })).toEqual({
      ok: false,
      reason: 'removed',
    });
    expect(resolveSource(lib, 'zed', { ...q, courseId: c.courseId })).toEqual(nf);
  });

  it('delete cascades pages, chapters, files on disk and guarded quiz/mastery/session rows', async () => {
    const { db, lib, courses, c, f } = await seeded();
    ensureQuizSchema(db);
    ensureMasterySchema(db);
    db.exec(`CREATE TABLE IF NOT EXISTS diff_sessions(id TEXT PRIMARY KEY, chatId TEXT, courseId TEXT, chapter TEXT, mode TEXT, phase TEXT, work_json TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS feynman_sessions(id TEXT PRIMARY KEY, chatId TEXT, student TEXT, courseId TEXT, chapter TEXT, concept TEXT, turns_json TEXT, followups INTEGER, phase TEXT, ts INTEGER);`);
    const id = c.courseId;
    db.prepare("INSERT INTO quiz_rounds VALUES('q1',?,'secret','x',NULL,'[]','done',0,1,0)").run(
      id,
    );
    db.prepare(
      "INSERT INTO quiz_rounds VALUES('q2','other','ch','x',NULL,'[]','done',0,1,0)",
    ).run();
    db.prepare("INSERT INTO quiz_items VALUES('q1',0,'mc','Q?',NULL,'{}',NULL,NULL)").run();
    db.prepare("INSERT INTO quiz_items VALUES('q2',0,'mc','Q?',NULL,'{}',NULL,NULL)").run();
    db.prepare("INSERT INTO quiz_answers VALUES('q1',0,'ana','{}',1,'ok',0)").run();
    db.prepare("INSERT INTO mastery VALUES('ana',?,'secret',3,0,0)").run(id);
    db.prepare("INSERT INTO mastery VALUES('ana','other','ch',3,0,0)").run();
    db.prepare("INSERT INTO diff_sessions VALUES('d1','c',?,NULL,'m','p','{}',0)").run(id);
    db.prepare("INSERT INTO feynman_sessions VALUES('f1','c','ana',?,'ch','x','[]',0,'p',0)").run(
      id,
    );
    courses.saveCourse({ id: 'other', title: 'Other' });
    const stored = lib.file(f.fileId)!.storedPath!;
    expect(existsSync(stored)).toBe(true);
    const preview = previewCascade(lib, id);
    expect(preview).toMatchObject({
      courses: 1,
      files: 1,
      storedFiles: 1,
      chapters: 1,
      pages: 1,
      quizRounds: 1,
      quizItems: 1,
      quizAnswers: 1,
      mastery: 1,
      diffSessions: 1,
      feynmanSessions: 1,
    });
    const counts = deleteCourse(lib, id);
    expect(counts).toEqual(preview);
    expect(existsSync(stored)).toBe(false);
    for (const [t, col] of [
      ['pages', 'course_id'],
      ['chapters', 'course_id'],
      ['lib_files', 'course_id'],
      ['lib_courses', 'course_id'],
      ['courses', 'id'],
      ['mastery', 'courseId'],
      ['diff_sessions', 'courseId'],
      ['feynman_sessions', 'courseId'],
      ['quiz_rounds', 'courseId'],
    ] as const)
      expect(
        (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col}=?`).get(id) as { n: number }).n,
      ).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM quiz_items').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM mastery').get() as { n: number }).n).toBe(1);
  });

  it('works when the optional quiz/mastery tables do not exist', async () => {
    const { lib, c } = await seeded();
    expect(deleteCourse(lib, c.courseId)).toMatchObject({ courses: 1, quizRounds: 0, mastery: 0 });
  });
});

describe('chapter editor against the store', () => {
  it('split, rename and merge keep pages, order and ids', async () => {
    const k = kit();
    const c = k.lib.createCourse('ana', 'S');
    await k.pipe.submit({
      owner: 'ana',
      courseId: c.courseId,
      name: 'book.txt',
      bytes: enc(NOTES),
      kind: 'material',
    });
    await k.pipe.idle();
    const id = splitChapterIn(k.lib, c.courseId, 'book', 2, 'Part two');
    expect(id).toBe('part-two');
    renameChapterIn(k.lib, c.courseId, 'book', 'Part one');
    expect(
      k.courses.listChapters(c.courseId).map((x) => [x.id, x.title, x.pageStart, x.pageEnd]),
    ).toEqual([
      ['book', 'Part one', 1, 1],
      ['part-two', 'Part two', 2, 3],
    ]);
    expect(k.courses.getPages(c.courseId, 'part-two').map((p) => p.page)).toEqual([2, 3]);
    ensureMasterySchema(k.db);
    k.db.prepare("INSERT INTO mastery VALUES('ana',?,'part-two',2,0,0)").run(c.courseId);
    mergeChaptersIn(k.lib, c.courseId, 'part-two', 'book');
    expect(k.courses.listChapters(c.courseId).map((x) => [x.id, x.pageStart, x.pageEnd])).toEqual([
      ['book', 1, 3],
    ]);
    expect(k.courses.getPages(c.courseId)).toHaveLength(3);
    expect(k.courses.getPages(c.courseId, 'book')).toHaveLength(3);
    expect((k.db.prepare('SELECT COUNT(*) n FROM mastery').get() as { n: number }).n).toBe(0);
    expect(() => mergeChaptersIn(k.lib, c.courseId, 'book', 'nope')).toThrow(LibraryError);
  });
});

describe('sample course', () => {
  it('is public, read-only, attributed and readable by everyone; ingested lazily offline', async () => {
    const k = kit();
    expect(k.lib.course(DEMO_COURSE_ID)).toBeUndefined();
    await ensureDemoCourse(k.lib);
    await ensureDemoCourse(k.lib); // idempotent
    const row = k.lib.course(DEMO_COURSE_ID)!;
    expect(row).toMatchObject({ visibility: 'public', sample: true });
    expect(k.lib.roleOf(DEMO_COURSE_ID, 'zed')).toBe('public');
    expect(k.lib.roleOf(DEMO_COURSE_ID, 'system')).toBe('public');
    const d = detail(k.lib, row, 'public', 'zed');
    expect(d).toMatchObject({
      sample: true,
      canEdit: false,
      role: 'public',
      attribution: 'Introductory Statistics 2e, OpenStax, CC BY 4.0 (openstax.org)',
      chapterCount: 4,
      status: 'ready',
    });
    expect(d.files).toHaveLength(4);
    expect(d.policy?.lines.length).toBeGreaterThan(2);
    const ex = resolveSource(k.lib, 'zed', { file: 'ch6-the-normal-distribution.pdf', page: 1 });
    expect(ex).toMatchObject({ ok: true });
    expect(
      k.lib
        .files(DEMO_COURSE_ID)
        .every((f) => f.storedPath === null || !f.storedPath.startsWith(k.lib.dataDir)),
    ).toBe(true);
    expect(deleteCourse(k.lib, 'c_other')).toMatchObject({ courses: 0 });
  }, 30_000);
});
