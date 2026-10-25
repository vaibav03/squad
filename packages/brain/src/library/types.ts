// Public types of the course library (contract: docs/library.md).

export const LIBRARY_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxPagesPerFile: 400,
  maxPagesPerCourse: 2000,
  maxFilesPerCourse: 40,
  parseTimeoutMs: 30_000,
  maxTitleChars: 120,
  maxSyllabusChars: 200_000,
  maxCatalogueBytes: 1024 * 1024,
  maxCatalogueRows: 500,
  textPageLines: 40,
  accept: ['pdf', 'txt', 'md'],
} as const;

export type LibraryLimits = typeof LIBRARY_LIMITS;

export type IngestStatus = 'queued' | 'parsing' | 'embedding' | 'ready' | 'failed';
export type Visibility = 'private' | 'squad' | 'public';
export type Role = 'owner' | 'squad' | 'public';
export type FileKind = 'material' | 'syllabus';
export type PolicyTopic = 'homework' | 'ai' | 'collaboration' | 'integrity' | 'other';

export interface MasteryWord {
  word: 'new' | 'learning' | 'steady' | 'strong';
  box: number;
}

export interface ChapterRow {
  id: string;
  title: string;
  summary: string;
  file: string;
  pageStart: number;
  pageEnd: number;
  pageCount: number;
  mastery: MasteryWord | null;
}

export interface FileRow {
  fileId: string;
  name: string;
  kind: FileKind;
  mime: string;
  size: number;
  pages: number | null;
  /** First 12 hex chars of the sha256. */
  sha256: string;
  status: IngestStatus;
  pct: number;
  error?: { code: string; message: string };
  uploadedAt: number;
}

export interface CourseSummary {
  id: string;
  title: string;
  role: Role;
  visibility: Visibility;
  sample: boolean;
  attribution?: string;
  fileCount: number;
  chapterCount: number;
  pageCount: number;
  status: 'empty' | 'ingesting' | 'ready' | 'failed';
  updatedAt: number;
  chapters: ChapterRow[];
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

export interface ExcerptLine {
  n: number;
  text: string;
  hit: boolean;
}
export type SourceExcerpt =
  | {
      ok: true;
      courseId: string;
      fileId: string;
      file: string;
      page: number;
      pageCount: number;
      lines: ExcerptLine[];
      quote: string | null;
      quoteVerified: boolean;
      imageUrl: string | null;
      openUrl: string;
    }
  | { ok: false; reason: 'removed' | 'page_missing' | 'not_found' };

/** Rows that go with a course; also what a delete reports. */
export interface Counts {
  courses: number;
  files: number;
  storedFiles: number;
  chapters: number;
  pages: number;
  syllabus: number;
  quizRounds: number;
  quizItems: number;
  quizAnswers: number;
  mastery: number;
  diffSessions: number;
  feynmanSessions: number;
}

export const DEMO_COURSE_ID = 'demo';
export const DEMO_OWNER = 'system';
export const DEMO_ATTRIBUTION = 'Introductory Statistics 2e, OpenStax, CC BY 4.0 (openstax.org)';

/** A failure with a stable code; the message never contains user content. */
export class LibraryError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'LibraryError';
  }
}

export const ERROR_MESSAGES: Record<string, string> = {
  unsupported_type: 'Only PDF, plain text and Markdown files are supported.',
  unsafe_pdf: 'This PDF contains active content (scripts or launch actions) and was rejected.',
  unreadable_pdf: 'This PDF could not be read. It may be corrupt or password protected.',
  unreadable_text: 'This file is not valid UTF-8 text.',
  too_large: 'This file is larger than the upload limit.',
  too_many_pages: 'This file has more pages than the limit allows.',
  course_page_limit: 'This course would exceed its page limit.',
  file_limit: 'This course already has the maximum number of files.',
  empty_file: 'This file has no readable text.',
  no_text: 'No text could be extracted. Scanned PDFs are not supported yet.',
  timeout: 'Reading this file took too long.',
  interrupted: 'The upload was interrupted. Re-ingest to retry.',
  internal: 'Something went wrong while reading this file.',
};
export const libErrorMessage = (code: string): string =>
  ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal!;
