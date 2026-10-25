import { classifyTopic } from './policy';
import { tableExists } from './schema';
import { toFileRow, type FileRec, type LibCourseRow, type LibraryStore } from './store';
import type {
  ChapterRow,
  CourseDetail,
  CourseSummary,
  MasteryWord,
  PolicyPanel,
  Role,
} from './types';
import { DEMO_ATTRIBUTION } from './types';

/** Mastery words, never grades: 0 new, 1-2 learning, 3-4 steady, 5 strong. */
export function masteryWord(box: number): MasteryWord {
  const word = box <= 0 ? 'new' : box <= 2 ? 'learning' : box <= 4 ? 'steady' : 'strong';
  return { word, box };
}

export function courseStatus(files: FileRec[]): CourseSummary['status'] {
  if (files.length === 0) return 'empty';
  if (
    files.some((f) => f.status === 'queued' || f.status === 'parsing' || f.status === 'embedding')
  )
    return 'ingesting';
  return files.some((f) => f.status === 'ready') ? 'ready' : 'failed';
}

/** The viewer's OWN mastery for each chapter; squadmates' rows are never read. */
function chapterRows(lib: LibraryStore, courseId: string, viewer: string): ChapterRow[] {
  const have = tableExists(lib.db, 'mastery');
  const get = have
    ? lib.db.prepare('SELECT box FROM mastery WHERE student=? AND courseId=? AND chapter=?')
    : null;
  return lib.courses.listChapters(courseId).map((c) => {
    const r = get?.get(viewer, courseId, c.id) as { box: number } | undefined;
    return {
      id: c.id,
      title: c.title,
      summary: c.summary,
      file: c.file,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      pageCount: c.pageEnd - c.pageStart + 1,
      mastery: have ? masteryWord(r?.box ?? 0) : null,
    };
  });
}

export function summarizeCourse(
  lib: LibraryStore,
  row: LibCourseRow,
  role: Role,
  viewer: string,
): CourseSummary {
  const files = lib.files(row.courseId);
  const course = lib.courses.getCourse(row.courseId);
  const chapters = chapterRows(lib, row.courseId, viewer);
  const pageCount = (
    lib.db.prepare('SELECT COUNT(*) AS n FROM pages WHERE course_id=?').get(row.courseId) as {
      n: number;
    }
  ).n;
  return {
    id: row.courseId,
    title: course?.title ?? row.courseId,
    role,
    visibility: row.visibility,
    sample: row.sample,
    ...(row.sample ? { attribution: DEMO_ATTRIBUTION } : {}),
    fileCount: files.length,
    chapterCount: chapters.length,
    pageCount,
    status: courseStatus(files),
    updatedAt: row.updatedAt,
    chapters,
  };
}

export function policyPanel(lib: LibraryStore, courseId: string): PolicyPanel | null {
  const s = lib.getSyllabus(courseId);
  if (s) return { sourceFile: s.sourceFile, lines: s.lines };
  // The sample syllabus ingested by loadFixtureCourse only sets courses.policy.
  const c = lib.courses.getCourse(courseId);
  if (c?.policy)
    return {
      sourceFile: null,
      lines: c.policy
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((t, i) => ({ n: i + 1, text: t, verbatim: true as const, topic: classifyTopic(t) })),
    };
  return null;
}

export function detail(
  lib: LibraryStore,
  row: LibCourseRow,
  role: Role,
  viewer: string,
): CourseDetail {
  return {
    ...summarizeCourse(lib, row, role, viewer),
    files: lib.files(row.courseId).map(toFileRow),
    policy: policyPanel(lib, row.courseId),
    canEdit: role === 'owner',
  };
}
