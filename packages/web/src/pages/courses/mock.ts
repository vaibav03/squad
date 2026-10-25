import { HubError, type LibraryApi, type UploadHandle } from './api';
import { buildCourses, SAMPLE_CATALOGUE } from './fixtures';
import {
  DEFAULT_LIMITS,
  deriveCourseStatus,
  isTerminal,
  mergeChapters,
  precheckFile,
  renameChapter,
  splitChapter,
  summaryOf,
} from './model';
import type {
  CatalogueState,
  CourseDetail,
  FileRow,
  IngestProgress,
  PolicyLine,
  PolicyTopic,
} from './types';

export interface MockOptions {
  /** ms of fake latency per call */
  latency?: number;
  /** run the ingest simulator on a 1 s timer (off in unit tests) */
  timers?: boolean;
  /** seeded fixtures; false starts with an empty library */
  seed?: boolean;
  now?: number;
}

const hash = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const part = (n: number) =>
    (h ^ Math.imul(n, 2654435761)).toString(16).replace('-', '').padStart(8, '0');
  return (part(1) + part(2)).slice(0, 12);
};
let seq = 0;
const rid = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

const TOPIC_RULES: [RegExp, PolicyTopic][] = [
  [/\b(ai|chatgpt|generative|language model)\b/i, 'ai'],
  [/\b(integrity|plagiari|cheat|misconduct)\w*/i, 'integrity'],
  [/\b(group|collaborat|together|peer)\w*/i, 'collaboration'],
  [/\b(homework|assignment|problem set|late work|due)\b/i, 'homework'],
];
export function extractPolicy(text: string): PolicyLine[] {
  const out: PolicyLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.length < 12) return;
    const topic = TOPIC_RULES.find(([re]) => re.test(line))?.[1];
    if (topic) out.push({ n: i + 1, text: raw.replace(/\s+$/, ''), verbatim: true, topic });
  });
  return out;
}

/** The whole library in memory: fixtures, uploads with progress, ingest, chapter edits. Fully demoable offline. */
export function createMockApi(opts: MockOptions = {}): LibraryApi & { dispose: () => void } {
  const latency = opts.latency ?? 160;
  const now = opts.now ?? Date.now();
  const store = new Map<string, CourseDetail>();
  if (opts.seed !== false) for (const c of buildCourses(now)) store.set(c.id, c);
  let catalogue: CatalogueState | null = { sample: true, rows: SAMPLE_CATALOGUE };
  const listeners = new Set<(p: IngestProgress) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const wait = <T>(v: () => T): Promise<T> =>
    new Promise((res, rej) =>
      setTimeout(() => {
        try {
          res(v());
        } catch (e) {
          rej(e);
        }
      }, latency),
    );
  const copy = <T>(v: T): T => structuredClone(v);
  const course = (id: string): CourseDetail => {
    const c = store.get(id);
    if (!c) throw new HubError('not_found', 404);
    return c;
  };
  const findFile = (fid: string): { c: CourseDetail; f: FileRow } => {
    for (const c of store.values()) {
      const f = c.files.find((x) => x.fileId === fid);
      if (f) return { c, f };
    }
    throw new HubError('not_found', 404);
  };
  const refresh = (c: CourseDetail): void => {
    c.fileCount = c.files.length;
    c.pageCount = c.files.reduce((a, f) => a + (f.status === 'ready' ? (f.pages ?? 0) : 0), 0);
    c.status = deriveCourseStatus(c.files);
    c.chapterCount = c.chapters.length;
    c.updatedAt = Date.now();
  };
  const emit = (f: FileRow) =>
    listeners.forEach((l) => l({ fileId: f.fileId, pct: f.pct, status: f.status }));

  const tick = () => {
    let active = false;
    for (const c of store.values()) {
      for (const f of c.files) {
        if (isTerminal(f.status)) continue;
        active = true;
        const fails = /broken|corrupt/i.test(f.name);
        f.pct = Math.min(100, f.pct + (f.status === 'queued' ? 4 : 2 + (f.fileId.length % 3)));
        f.status = f.pct < 8 ? 'queued' : f.pct < 50 ? 'parsing' : 'embedding';
        if (fails && f.pct >= 55) {
          f.status = 'failed';
          f.error = { code: 'parse_failed', message: 'Could not parse this file.' };
        } else if (f.pct >= 100) {
          f.status = 'ready';
          f.pct = 100;
          f.pages ??= Math.max(1, Math.round(f.size / 60_000));
          if (
            f.kind === 'material' &&
            !c.chapters.some((ch) => ch.file === f.name || ch.file === f.fileId)
          ) {
            const stem = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
            c.chapters.push({
              id: rid('ch'),
              title: stem.charAt(0).toUpperCase() + stem.slice(1),
              summary: '',
              file: f.fileId,
              pageStart: 1,
              pageEnd: f.pages,
              pageCount: f.pages,
              mastery: null,
            });
          }
        }
        refresh(c);
        emit(f);
      }
    }
    if (!active && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const ensureTimer = () => {
    if (opts.timers === false || timer) return;
    timer = setInterval(tick, 1000);
  };
  if (opts.seed !== false) ensureTimer();

  return {
    listCourses: () =>
      wait(() => ({
        courses: [...store.values()].map((c) => copy(summaryOf(c))),
        limits: DEFAULT_LIMITS,
      })),
    createCourse: (title) =>
      wait(() => {
        const t = title.trim();
        if (!t) throw new HubError('invalid_title', 400);
        const c: CourseDetail = {
          id: rid('c'),
          title: t,
          role: 'owner',
          visibility: 'private',
          sample: false,
          fileCount: 0,
          chapterCount: 0,
          pageCount: 0,
          status: 'empty',
          updatedAt: Date.now(),
          chapters: [],
          files: [],
          policy: null,
          canEdit: true,
        };
        store.set(c.id, c);
        return copy(summaryOf(c));
      }),
    getCourse: (id) => wait(() => copy(course(id))),
    patchCourse: (id, patch) =>
      wait(() => {
        const c = course(id);
        if (!c.canEdit) throw new HubError('not_found', 404);
        if (patch.title !== undefined && patch.title.trim()) c.title = patch.title.trim();
        if (patch.visibility && patch.visibility !== 'public') c.visibility = patch.visibility;
        c.updatedAt = Date.now();
      }),
    deleteCourse: (id, confirm) =>
      wait(() => {
        const c = course(id);
        if (c.sample || !c.canEdit) throw new HubError('not_found', 404);
        const counts = { pages: c.pageCount, chapters: c.chapters.length, files: c.files.length };
        if (!confirm) throw new HubError('confirm_required', 409, { counts });
        store.delete(id);
        return { deleted: counts };
      }),
    uploadFile(cid, file, kind, onProgress): UploadHandle {
      let cancelled = false;
      let iv: ReturnType<typeof setInterval> | undefined;
      let rejectFn: (e: unknown) => void = () => {};
      const promise = new Promise<{ fileId: string }>((resolve, reject) => {
        rejectFn = reject;
        let pct = 0;
        const steps = Math.max(4, Math.min(14, Math.round(file.size / 400_000)));
        iv = setInterval(
          () => {
            if (cancelled) return;
            pct = Math.min(100, pct + Math.ceil(100 / steps));
            onProgress(pct);
            if (pct < 100) return;
            clearInterval(iv);
            try {
              const c = course(cid);
              const pre = precheckFile(file, DEFAULT_LIMITS, { fileCount: c.files.length });
              if (pre) throw new HubError(pre.code, 422);
              if (/unsafe|virus/i.test(file.name)) throw new HubError('unsafe_pdf', 422);
              const sha = hash(`${file.name}:${file.size}`);
              const dup = c.files.find((f) => f.sha256 === sha);
              if (dup) throw new HubError('duplicate', 409, { fileId: dup.fileId });
              const f: FileRow = {
                fileId: rid('f'),
                name: file.name,
                kind,
                mime: file.type || 'application/pdf',
                size: file.size,
                pages: null,
                sha256: sha,
                status: 'queued',
                pct: 0,
                uploadedAt: Date.now(),
              };
              c.files.push(f);
              refresh(c);
              ensureTimer();
              resolve({ fileId: f.fileId });
            } catch (e) {
              reject(e);
            }
          },
          opts.timers === false ? 0 : 140,
        );
      });
      return {
        promise,
        abort: () => {
          cancelled = true;
          if (iv) clearInterval(iv);
          rejectFn(new HubError('aborted'));
        },
      };
    },
    getFile: (fid) => wait(() => copy(findFile(fid).f)),
    reingest: (fid) =>
      wait(() => {
        const { c, f } = findFile(fid);
        f.status = 'queued';
        f.pct = 0;
        delete f.error;
        refresh(c);
        ensureTimer();
      }),
    removeFile: (fid) =>
      wait(() => {
        const { c, f } = findFile(fid);
        c.files = c.files.filter((x) => x.fileId !== f.fileId);
        c.chapters = c.chapters.filter((ch) => ch.file !== f.fileId);
        refresh(c);
      }),
    renameChapter: (cid, chId, title) =>
      wait(() => {
        const c = course(cid);
        c.chapters = renameChapter(c.chapters, chId, title);
      }),
    splitChapter: (cid, args) =>
      wait(() => {
        const c = course(cid);
        c.chapters = splitChapter(c.chapters, args, rid('ch'));
        refresh(c);
      }),
    mergeChapters: (cid, args) =>
      wait(() => {
        const c = course(cid);
        c.chapters = mergeChapters(c.chapters, args);
        refresh(c);
      }),
    putSyllabus: (cid, text) =>
      wait(() => {
        const c = course(cid);
        c.policy = { sourceFile: null, lines: extractPolicy(text) };
      }),
    getCatalogue: () => wait(() => (catalogue ? copy(catalogue) : null)),
    putCatalogue: (rows) =>
      wait(() => {
        catalogue = { sample: false, rows };
        return copy(catalogue);
      }),
    onIngest: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose: () => {
      if (timer) clearInterval(timer);
      timer = null;
      listeners.clear();
    },
  };
}
