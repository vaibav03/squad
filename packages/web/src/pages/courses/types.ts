/** Wire types for the course library. Pinned in docs/library.md; keep in step with it. */
export type IngestStatus = 'queued' | 'parsing' | 'embedding' | 'ready' | 'failed';
export type CourseRole = 'owner' | 'squad' | 'public';
export type Visibility = 'private' | 'squad' | 'public';
export type CourseStatus = 'empty' | 'ingesting' | 'ready' | 'failed';
export type MasteryWord = 'new' | 'learning' | 'steady' | 'strong';
export type PolicyTopic = 'homework' | 'ai' | 'collaboration' | 'integrity' | 'other';

export interface ChapterRow {
  id: string;
  title: string;
  summary: string;
  file: string;
  pageStart: number;
  pageEnd: number;
  pageCount: number;
  mastery: { word: MasteryWord; box: number } | null;
}

export interface CourseSummary {
  id: string;
  title: string;
  role: CourseRole;
  visibility: Visibility;
  sample: boolean;
  attribution?: string;
  fileCount: number;
  chapterCount: number;
  pageCount: number;
  status: CourseStatus;
  updatedAt: number;
  chapters: ChapterRow[];
}

export interface FileError {
  code: string;
  message: string;
}
export interface FileRow {
  fileId: string;
  name: string;
  kind: 'material' | 'syllabus';
  mime: string;
  size: number;
  pages: number | null;
  /** first 12 hex of the sha256 */
  sha256: string;
  status: IngestStatus;
  pct: number;
  error?: FileError;
  uploadedAt: number;
}

export interface PolicyLine {
  n: number;
  text: string;
  verbatim: true;
  topic: PolicyTopic;
}
export interface PolicyPanel {
  sourceFile: string | null;
  lines: PolicyLine[];
}

export interface CourseDetail extends CourseSummary {
  files: FileRow[];
  policy: PolicyPanel | null;
  canEdit: boolean;
}

export interface Limits {
  maxFileBytes: number;
  maxPagesPerFile: number;
  maxPagesPerCourse: number;
  maxFilesPerCourse: number;
  parseTimeoutMs: number;
  /** lowercase extensions without the dot */
  accept: string[];
}

export interface Counts {
  pages: number;
  chapters: number;
  files: number;
}

export interface CourseList {
  courses: CourseSummary[];
  limits: Limits;
}

export interface CatalogueState {
  sample: boolean;
  rows: CatalogueRow[];
}
export interface CatalogueRow {
  code: string;
  title: string;
  credits: number;
  days: string;
  start: string;
  end: string;
  location: string;
  /** Prerequisite course codes (hub catalogues). */
  prereqs?: string[];
  /** Terms the course is offered, e.g. 'fall, spring' (hub catalogues). */
  term?: string;
}
export interface RowIssue {
  /** 1-based, counting the first data row as row 1 */
  row: number;
  message: string;
}

export interface IngestProgress {
  fileId: string;
  pct: number;
  status: IngestStatus;
}

export interface Citation {
  file: string;
  page: number;
  courseId: string;
  quote?: string;
}
