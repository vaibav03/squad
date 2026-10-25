/**
 * Canvas REST client (pure; fetch injected). Runs in the service worker with the student's own Canvas cookies
 * (`credentials: "include"` + host permission): no OAuth, no developer key. Shape ported from the Nook extension.
 */
export interface CanvasSession {
  origin: string;
  canvasUserId: string;
  name: string | null;
  primary_email: string | null;
}
export interface SyncCourse {
  id: string;
  name: string;
  course_code: string | null;
}
export interface SyncAssignment {
  id: string;
  course_id: string;
  name: string;
  due_at: string | null;
  html_url: string | null;
  description?: string | null;
}
export interface SyncFile {
  id: string;
  course_id: string;
  display_name: string;
  'content-type': string | null;
  size: number | null;
  url: string | null;
  updated_at: string | null;
}
export interface CanvasSyncPayload {
  origin: string;
  canvas_user_id: string;
  courses: SyncCourse[];
  assignments: SyncAssignment[];
  files: SyncFile[];
}

export const MAX_PAGES = 3;

/** Canvas rejected the session (401/403 on a non-files route) or is throttling us (429). */
export class CanvasAccessError extends Error {
  constructor(
    public readonly kind: 'expired' | 'rate_limited',
    public readonly httpStatus: number,
  ) {
    super(kind);
    this.name = 'CanvasAccessError';
  }
}

/** Canvas prefixes cookie-authenticated JSON with `while(1);`. */
export function parseCanvasJson(text: string): unknown {
  return JSON.parse(text.replace(/^\s*while\s*\(1\)\s*;?/, ''));
}

export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m) return m[1]!;
  }
  return null;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const id = (v: unknown): string | null =>
  typeof v === 'number' || (typeof v === 'string' && v) ? String(v) : null;

export function createCanvasClient(fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const get = (url: string) =>
    fetchImpl(url, {
      credentials: 'include',
      headers: { Accept: 'application/json+canvas-string-ids, application/json' },
    });

  /** Follows rel="next" up to MAX_PAGES (same origin only). */
  async function pages(origin: string, path: string): Promise<{ status: number; items: Obj[] }> {
    let url: string | null = `${origin}${path}`;
    const items: Obj[] = [];
    for (let i = 0; url && i < MAX_PAGES; i++) {
      const res = await get(url);
      if (!res.ok) return { status: res.status, items: i === 0 ? [] : items };
      const body = parseCanvasJson(await res.text());
      if (Array.isArray(body)) items.push(...(body as Obj[]));
      const next = nextLink(res.headers.get('Link'));
      url = next && new URL(next, origin).origin === origin ? next : null;
    }
    return { status: 200, items };
  }
  const guard = (status: number) => {
    if (status === 429) throw new CanvasAccessError('rate_limited', status);
    if (status === 401 || status === 403) throw new CanvasAccessError('expired', status);
  };

  return {
    /** The signed-in Canvas user for this origin, or null (not signed in / not Canvas / network). */
    async probe(origin: string): Promise<CanvasSession | null> {
      try {
        const res = await get(`${origin}/api/v1/users/self`);
        if (!res.ok) return null;
        const u = parseCanvasJson(await res.text()) as Obj;
        const uid = id(u?.id);
        if (!uid) return null;
        return {
          origin,
          canvasUserId: uid,
          name: str(u.name),
          primary_email: str(u.primary_email) ?? str(u.email) ?? null,
        };
      } catch {
        return null;
      }
    },

    /** Throws CanvasAccessError on 401/403 (courses/assignments) or 429 anywhere. */
    async collect(
      session: Pick<CanvasSession, 'origin' | 'canvasUserId'>,
    ): Promise<CanvasSyncPayload> {
      const { origin } = session;
      const cr = await pages(origin, '/api/v1/courses?enrollment_state=active&per_page=50');
      guard(cr.status);
      const courses: SyncCourse[] = cr.items
        .filter((c) => id(c.id))
        .map((c) => ({ id: id(c.id)!, name: str(c.name) ?? '', course_code: str(c.course_code) }));
      const assignments: SyncAssignment[] = [];
      const files: SyncFile[] = [];
      for (const course of courses) {
        const cid = encodeURIComponent(course.id);
        const [as, fs] = await Promise.all([
          pages(origin, `/api/v1/courses/${cid}/assignments?bucket=upcoming&per_page=50`),
          pages(origin, `/api/v1/courses/${cid}/files?per_page=100`),
        ]);
        guard(as.status);
        if (fs.status === 429) throw new CanvasAccessError('rate_limited', 429);
        // 401/403/404 on files = Files tab disabled for this course: just no files.
        for (const a of as.items) {
          const aid = id(a.id);
          if (aid)
            assignments.push({
              id: aid,
              course_id: course.id,
              name: str(a.name) ?? '(untitled)',
              due_at: str(a.due_at),
              html_url: str(a.html_url),
              description: str(a.description),
            });
        }
        for (const f of fs.items) {
          const fid = id(f.id);
          if (fid)
            files.push({
              id: fid,
              course_id: course.id,
              display_name: str(f.display_name) ?? str(f.filename) ?? 'file',
              'content-type': str(f['content-type']),
              size: typeof f.size === 'number' ? f.size : null,
              url: str(f.url),
              updated_at: str(f.updated_at),
            });
        }
      }
      return { origin, canvas_user_id: session.canvasUserId, courses, assignments, files };
    },
  };
}
export type CanvasClient = ReturnType<typeof createCanvasClient>;
