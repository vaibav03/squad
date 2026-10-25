import { timedFetch } from '../../lib/http';
import { catalogueRowFrom, normalizeLimits } from './model';
import type {
  CatalogueRow,
  CatalogueState,
  ChapterRow,
  Counts,
  CourseDetail,
  CourseList,
  CourseSummary,
  FileRow,
  IngestProgress,
  Visibility,
} from './types';

export class HubError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly extra: { counts?: Counts; fileId?: string; issues?: unknown } = {},
  ) {
    super(code);
    this.name = 'HubError';
  }
}

export interface UploadHandle {
  promise: Promise<{ fileId: string }>;
  abort: () => void;
}

/** Everything the page needs from the library. One implementation talks to the hub, one is local state. */
export interface LibraryApi {
  listCourses(): Promise<CourseList>;
  createCourse(title: string): Promise<CourseSummary>;
  getCourse(id: string): Promise<CourseDetail>;
  patchCourse(id: string, patch: { title?: string; visibility?: Visibility }): Promise<void>;
  /** Without confirm this rejects with HubError('confirm_required') carrying the counts. */
  deleteCourse(id: string, confirm: boolean): Promise<{ deleted: Counts }>;
  uploadFile(
    courseId: string,
    file: File,
    kind: 'material' | 'syllabus',
    onProgress: (pct: number) => void,
  ): UploadHandle;
  getFile(fileId: string): Promise<FileRow>;
  reingest(fileId: string): Promise<void>;
  removeFile(fileId: string): Promise<void>;
  renameChapter(courseId: string, chapterId: string, title: string): Promise<void>;
  splitChapter(
    courseId: string,
    args: { chapter: string; atPage: number; title: string },
  ): Promise<void>;
  mergeChapters(courseId: string, args: { from: string; into: string }): Promise<void>;
  putSyllabus(courseId: string, text: string): Promise<void>;
  getCatalogue(): Promise<CatalogueState | null>;
  putCatalogue(rows: CatalogueRow[], body: string, contentType: string): Promise<CatalogueState>;
  /** x.ingest.progress arrives over the event feed in live mode; the mock pushes it here. */
  onIngest?(cb: (p: IngestProgress) => void): () => void;
  /** Direct link to the original bytes (live mode only). */
  rawUrl?(fileId: string): string;
}

export interface HttpCtx {
  hubUrl: string;
  token?: string;
}

const readCounts = (v: unknown): Counts | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  return { pages: n('pages'), chapters: n('chapters'), files: n('files') };
};

async function readError(res: Response): Promise<HubError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const err = (b.error && typeof b.error === 'object' ? b.error : {}) as Record<string, unknown>;
  const code = typeof err.code === 'string' ? err.code : `http_${res.status}`;
  const fileId =
    typeof err.fileId === 'string'
      ? err.fileId
      : typeof b.fileId === 'string'
        ? b.fileId
        : undefined;
  const counts = readCounts(err.counts ?? b.counts ?? err.deleted ?? b.deleted);
  return new HubError(code, res.status, {
    ...(counts ? { counts } : {}),
    ...(fileId ? { fileId } : {}),
    issues: err.issues ?? b.issues,
  });
}

export function createHttpApi(ctx: HttpCtx): LibraryApi {
  const base = `${ctx.hubUrl.replace(/\/+$/, '')}/v1/library`;
  const auth: Record<string, string> = ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {};

  async function call(path: string, init: RequestInit = {}, json = true): Promise<Response> {
    let res: Response;
    try {
      res = await timedFetch(`${base}${path}`, {
        ...init,
        headers: {
          ...auth,
          ...(json && init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new HubError(
        typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'network',
      );
    }
    if (!res.ok) throw await readError(res);
    return res;
  }
  const body = (v: unknown) => JSON.stringify(v);
  const id = encodeURIComponent;

  return {
    async listCourses() {
      const j = (await (await call('/courses')).json()) as {
        courses?: CourseSummary[];
        limits?: unknown;
      };
      return { courses: j.courses ?? [], limits: normalizeLimits(j.limits) };
    },
    async createCourse(title) {
      return (await (
        await call('/courses', { method: 'POST', body: body({ title }) })
      ).json()) as CourseSummary;
    },
    async getCourse(cid) {
      return (await (await call(`/courses/${id(cid)}`)).json()) as CourseDetail;
    },
    async patchCourse(cid, patch) {
      await call(`/courses/${id(cid)}`, { method: 'PATCH', body: body(patch) });
    },
    async deleteCourse(cid, confirm) {
      const res = await call(`/courses/${id(cid)}`, {
        method: 'DELETE',
        ...(confirm ? { body: body({ confirm: true }) } : {}),
      });
      const j = (await res.json().catch(() => ({}))) as { deleted?: unknown };
      return { deleted: readCounts(j.deleted) ?? { pages: 0, chapters: 0, files: 0 } };
    },
    uploadFile(cid, file, kind, onProgress) {
      const xhr = new XMLHttpRequest();
      const promise = new Promise<{ fileId: string }>((resolve, reject) => {
        xhr.open('POST', `${base}/courses/${id(cid)}/files`);
        if (ctx.token) xhr.setRequestHeader('Authorization', `Bearer ${ctx.token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let j: Record<string, unknown> = {};
          try {
            j = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(100);
            resolve({ fileId: String(j.fileId ?? '') });
            return;
          }
          const err = (j.error && typeof j.error === 'object' ? j.error : {}) as Record<
            string,
            unknown
          >;
          const fileId =
            typeof err.fileId === 'string'
              ? err.fileId
              : typeof j.fileId === 'string'
                ? j.fileId
                : undefined;
          reject(
            new HubError(
              typeof err.code === 'string' ? err.code : `http_${xhr.status}`,
              xhr.status,
              {
                ...(fileId ? { fileId } : {}),
              },
            ),
          );
        };
        xhr.onerror = () =>
          reject(
            new HubError(
              typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'network',
            ),
          );
        xhr.onabort = () => reject(new HubError('aborted'));
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('file', file, file.name);
        xhr.send(fd);
      });
      return { promise, abort: () => xhr.abort() };
    },
    async getFile(fid) {
      return (await (await call(`/files/${id(fid)}`)).json()) as FileRow;
    },
    async reingest(fid) {
      await call(`/files/${id(fid)}/reingest`, { method: 'POST' });
    },
    async removeFile(fid) {
      await call(`/files/${id(fid)}`, { method: 'DELETE' });
    },
    async renameChapter(cid, chId, title) {
      await call(`/courses/${id(cid)}/chapters/${id(chId)}`, {
        method: 'PATCH',
        body: body({ title }),
      });
    },
    async splitChapter(cid, args) {
      await call(`/courses/${id(cid)}/chapters/split`, { method: 'POST', body: body(args) });
    },
    async mergeChapters(cid, args) {
      await call(`/courses/${id(cid)}/chapters/merge`, { method: 'POST', body: body(args) });
    },
    async putSyllabus(cid, text) {
      await call(`/courses/${id(cid)}/syllabus`, { method: 'PUT', body: body({ text }) });
    },
    async getCatalogue() {
      try {
        return readCatalogue(await (await call('/catalogue')).json());
      } catch (e) {
        if (e instanceof HubError && e.status === 404) return null;
        throw e;
      }
    },
    async putCatalogue(rows, text, contentType) {
      const res = await call(
        '/catalogue',
        { method: 'PUT', body: text, headers: { 'Content-Type': contentType } },
        false,
      );
      const parsed = readCatalogue(await res.json().catch(() => ({})));
      return parsed ?? { sample: false, rows };
    },
    rawUrl: (fid) => `${base}/files/${id(fid)}/raw`,
  };
}

function readCatalogue(raw: unknown): CatalogueState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const inner = (o.catalogue && typeof o.catalogue === 'object' ? o.catalogue : o) as Record<
    string,
    unknown
  >;
  const rows = (
    Array.isArray(inner.rows) ? inner.rows : Array.isArray(inner.courses) ? inner.courses : []
  ).map(catalogueRowFrom);
  return { sample: inner.sample === true, rows };
}

export type { ChapterRow };
