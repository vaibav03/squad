import { readFile } from 'node:fs/promises';
import { getDocumentProxy } from 'unpdf';
import { detectSections, extractiveSummary, titleFromText } from '../ingest/chapters';
import { extractPages } from '../ingest/pdf';
import type { Chapter, Page } from '../ingest/types';
import { uniqueChapterId } from './chapterops';
import { newFileId } from './ids';
import { extractPolicyLines, policyColumn } from './policy';
import {
  MIME,
  assertSize,
  decodeText,
  safeName,
  scanUnsafePdf,
  sha256Hex,
  sniffType,
  type SniffedType,
} from './sniff';
import type { FileRec, LibraryStore } from './store';
import { hasText, splitTextPages } from './textpages';
import { withTimeout } from './timeout';
import { LIBRARY_LIMITS, LibraryError, type FileKind, type IngestStatus } from './types';

export interface ProgressEvent {
  owner: string;
  courseId: string;
  fileId: string;
  file: string;
  status: IngestStatus;
  pct: number;
}
export type ProgressSink = (e: ProgressEvent) => void;

export interface PipelineOptions {
  parseTimeoutMs?: number;
}

export interface UploadInput {
  owner: string;
  courseId: string;
  name: string;
  bytes: Uint8Array;
  kind: FileKind;
}

/** Runs jobs with bounded concurrency, in order. `idle()` resolves when nothing is queued or running. */
export function createJobQueue(concurrency = 2) {
  const waiting: (() => Promise<void>)[] = [];
  let running = 0;
  let idleWaiters: (() => void)[] = [];
  const pump = () => {
    while (running < concurrency && waiting.length > 0) {
      const job = waiting.shift()!;
      running++;
      void job().finally(() => {
        running--;
        pump();
        if (running === 0 && waiting.length === 0) idleWaiters.splice(0).forEach((r) => r());
      });
    }
  };
  return {
    push(job: () => Promise<void>) {
      waiting.push(job);
      queueMicrotask(pump);
    },
    idle: () =>
      running === 0 && waiting.length === 0
        ? Promise.resolve()
        : new Promise<void>((r) => idleWaiters.push(r)),
    pending: () => running + waiting.length,
    clear() {
      waiting.length = 0;
      idleWaiters = [];
    },
  };
}
export type JobQueue = ReturnType<typeof createJobQueue>;

async function pdfPageCount(bytes: Uint8Array, ms: number): Promise<number> {
  try {
    const doc = await withTimeout(getDocumentProxy(bytes.slice()), ms);
    return doc.numPages;
  } catch (e) {
    if (e instanceof LibraryError) throw e;
    throw new LibraryError('unreadable_pdf');
  }
}

/** Splits parsed pages into chapters (headings when present, otherwise one per file). */
function chaptersFor(
  courseId: string,
  file: string,
  texts: string[],
  taken: Set<string>,
): { chapters: Chapter[]; pages: Page[] } {
  const found = detectSections(texts);
  const parts: { seed: string; title: string; from: number; to: number }[] = [];
  if (found.length > 0) {
    found.forEach((s, i) =>
      parts.push({
        seed: s.id,
        title: s.title,
        from: i === 0 ? 0 : s.startIndex,
        to: (found[i + 1]?.startIndex ?? texts.length) - 1,
      }),
    );
  } else {
    const stem = file.replace(/\.[A-Za-z0-9]+$/, '');
    parts.push({ seed: stem, title: titleFromText(texts, stem), from: 0, to: texts.length - 1 });
  }
  const chapters: Chapter[] = [];
  const pages: Page[] = [];
  for (const part of parts) {
    const id = uniqueChapterId(part.seed, taken);
    taken.add(id);
    const slice = texts.slice(part.from, part.to + 1);
    slice.forEach((text, k) =>
      pages.push({ courseId, chapter: id, file, page: part.from + k + 1, text }),
    );
    chapters.push({
      courseId,
      id,
      title: part.title,
      summary: extractiveSummary(slice),
      file,
      pageStart: part.from + 1,
      pageEnd: part.from + slice.length,
    });
  }
  return { chapters, pages };
}

export function createPipeline(lib: LibraryStore, emit: ProgressSink, opts: PipelineOptions = {}) {
  const timeoutMs = opts.parseTimeoutMs ?? LIBRARY_LIMITS.parseTimeoutMs;
  const queue = createJobQueue(2);

  const report = (
    f: FileRec,
    status: IngestStatus,
    pct: number,
    extra: { pages?: number; error?: string } = {},
  ) => {
    lib.setProgress(f.fileId, {
      status,
      pct,
      ...(extra.pages !== undefined ? { pages: extra.pages } : {}),
      ...(extra.error ? { error: { code: extra.error } } : {}),
    });
    emit({ owner: f.owner, courseId: f.courseId, fileId: f.fileId, file: f.name, status, pct });
  };

  const parse = async (
    f: FileRec,
    bytes: Uint8Array,
  ): Promise<{ texts: string[]; raw?: string }> => {
    if (f.mime === MIME.pdf) return { texts: await withTimeout(extractPages(bytes), timeoutMs) };
    const raw = decodeText(bytes);
    if (raw === null) throw new LibraryError('unreadable_text');
    return { texts: splitTextPages(raw), raw };
  };

  async function run(fileId: string): Promise<void> {
    const f = lib.file(fileId);
    if (!f) return;
    try {
      if (!f.storedPath) throw new LibraryError('internal');
      report(f, 'parsing', 10);
      const bytes = new Uint8Array(await readFile(f.storedPath));
      const { texts, raw } = await parse(f, bytes);
      if (texts.length === 0) throw new LibraryError('empty_file');
      if (texts.length > LIBRARY_LIMITS.maxPagesPerFile) throw new LibraryError('too_many_pages');
      if (!hasText(texts)) throw new LibraryError('no_text');
      const others = lib
        .files(f.courseId)
        .filter((o) => o.fileId !== f.fileId && o.status !== 'failed')
        .reduce((n, o) => n + (o.pages ?? 0), 0);
      if (others + texts.length > LIBRARY_LIMITS.maxPagesPerCourse)
        throw new LibraryError('course_page_limit');
      report(f, 'parsing', 55, { pages: texts.length });

      report(f, 'embedding', 70, { pages: texts.length });
      if (f.kind === 'syllabus') {
        const text = raw ?? texts.join('\n');
        const lines = extractPolicyLines(text);
        lib.setSyllabus(f.courseId, f.name, text, lines, policyColumn(text, lines));
      } else {
        const gone = lib.courses.listChapters(f.courseId).filter((c) => c.file === f.name);
        const taken = new Set(
          lib.courses
            .listChapters(f.courseId)
            .filter((c) => c.file !== f.name)
            .map((c) => c.id),
        );
        const { chapters, pages } = chaptersFor(f.courseId, f.name, texts, taken);
        lib.db.transaction(() => {
          lib.db.prepare('DELETE FROM pages WHERE course_id=? AND file=?').run(f.courseId, f.name);
          for (const c of gone)
            lib.db.prepare('DELETE FROM chapters WHERE course_id=? AND id=?').run(f.courseId, c.id);
          lib.courses.savePages(pages);
          for (const c of chapters) lib.courses.saveChapter(c);
        })();
        // Embedding stage: the repo has no vector table, so this is a deterministic read-back of
        // the stored pages. It keeps the status honest for the UI and fails loudly on a bad write.
        const stored = lib.courses.getPages(f.courseId).filter((p) => p.file === f.name).length;
        if (stored !== texts.length) throw new LibraryError('internal');
      }
      report(f, 'ready', 100, { pages: texts.length });
    } catch (e) {
      const code = e instanceof LibraryError ? e.code : 'internal';
      report(f, 'failed', 100, { error: code });
    }
  }

  async function submit(input: UploadInput): Promise<FileRec> {
    assertSize(input.bytes.length);
    const name = safeName(input.name);
    const type: SniffedType = sniffType(input.bytes, name);
    if (type === 'pdf' && scanUnsafePdf(input.bytes)) throw new LibraryError('unsafe_pdf');
    const sha = sha256Hex(input.bytes);
    const dup = lib.findBySha(input.courseId, sha);
    if (dup) throw new LibraryError('duplicate', 'duplicate', { fileId: dup.fileId });
    const existing = lib.files(input.courseId);
    if (existing.length >= LIBRARY_LIMITS.maxFilesPerCourse) throw new LibraryError('file_limit');
    const pages =
      type === 'pdf'
        ? await pdfPageCount(input.bytes, timeoutMs)
        : splitTextPages(decodeText(input.bytes) ?? '').length;
    if (pages === 0) throw new LibraryError('empty_file');
    if (pages > LIBRARY_LIMITS.maxPagesPerFile) throw new LibraryError('too_many_pages');
    const used = existing
      .filter((o) => o.status !== 'failed')
      .reduce((n, o) => n + (o.pages ?? 0), 0);
    if (used + pages > LIBRARY_LIMITS.maxPagesPerCourse)
      throw new LibraryError('course_page_limit');

    // A failed upload with the same bytes is replaced; a different file with the same name is renamed.
    for (const o of existing)
      if (o.sha256 === sha && o.status === 'failed') lib.removeFile(o.fileId);
    const finalName = uniqueName(lib, input.courseId, name);
    lib.clearTombstone(input.courseId, finalName);
    const fileId = newFileId();
    const rec: FileRec = {
      fileId,
      courseId: input.courseId,
      owner: input.owner,
      name: finalName,
      kind: input.kind,
      mime: MIME[type],
      size: input.bytes.length,
      sha256: sha,
      pages,
      status: 'queued',
      pct: 0,
      errorCode: null,
      errorMessage: null,
      storedPath: lib.saveBytes(fileId, input.bytes),
      uploadedAt: lib.now(),
    };
    lib.addFile(rec);
    lib.touch(input.courseId);
    emit({
      owner: rec.owner,
      courseId: rec.courseId,
      fileId,
      file: rec.name,
      status: 'queued',
      pct: 0,
    });
    queue.push(() => run(fileId));
    return rec;
  }

  /** Re-runs ingest from the stored bytes (owner action). */
  function reingest(fileId: string): FileRec | undefined {
    const f = lib.file(fileId);
    if (
      !f?.storedPath ||
      f.status === 'queued' ||
      f.status === 'parsing' ||
      f.status === 'embedding'
    )
      return undefined;
    report(f, 'queued', 0);
    queue.push(() => run(fileId));
    return lib.file(fileId);
  }

  return { submit, reingest, idle: () => queue.idle(), queue };
}

function uniqueName(lib: LibraryStore, courseId: string, name: string): string {
  if (!lib.fileByName(courseId, name)) return name;
  const m = /^(.*?)(\.[A-Za-z0-9]+)?$/.exec(name);
  const stem = m?.[1] ?? name;
  const ext = m?.[2] ?? '';
  for (let i = 2; ; i++) {
    const cand = `${stem} (${i})${ext}`;
    if (!lib.fileByName(courseId, cand)) return cand;
  }
}
