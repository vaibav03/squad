/**
 * Canvas REST client, adapted from Nook's extension client (cubbie-re apps/extension/src/canvas.ts).
 *
 * Two ways to authenticate, one shape of requests:
 *  - `session`: the student's own browser cookies (`credentials: "include"`), used inside the extension;
 *  - `token`: a student-generated personal access token (`Authorization: Bearer`), used by the hub.
 * Nothing here logs or returns a credential. Canvas links are never followed off the origin.
 */
import { ConnectorAuthError, ConnectorRateLimitError } from './types';

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
  /** Plain text of the assignment description (HTML stripped), when Canvas returned one. */
  description?: string | null;
  updated_at?: string | null;
}
export interface SyncFile {
  id: string;
  course_id: string;
  display_name: string;
  'content-type': string | null;
  size: number | null;
  url: string | null;
  updated_at: string | null;
  /** Folder / module name when known (lecture grouping). */
  folder?: string | null;
}
export interface SyncModuleItem {
  id: string;
  course_id: string;
  module: string;
  title: string;
  type: string | null;
  html_url: string | null;
}
export interface CanvasSyncPayload {
  origin: string;
  canvas_user_id: string;
  courses: SyncCourse[];
  assignments: SyncAssignment[];
  files: SyncFile[];
  modules?: SyncModuleItem[];
}

/** Nook follows `rel="next"` at most this many pages per collection. */
export const MAX_PAGES = 3;

/** Canvas prefixes cookie-authenticated JSON with `while(1);`. */
export function parseCanvasJson(text: string): unknown {
  return JSON.parse(text.replace(/^\s*while\s*\(1\)\s*;?/, ''));
}

export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Exact https origin only (`https://school.instructure.com`), as Nook requires. */
export function isExactHttpsOrigin(o: unknown): o is string {
  if (typeof o !== 'string') return false;
  try {
    return new URL(o).origin === o && o.startsWith('https://');
  } catch {
    return false;
  }
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const id = (v: unknown): string | null =>
  typeof v === 'number' || (typeof v === 'string' && v) ? String(v) : null;

/** Canvas descriptions are HTML; keep the words, drop tags and entities. */
export function htmlToText(html: string | null): string | null {
  if (!html) return null;
  const t = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return t || null;
}

export type CanvasCredential = { kind: 'session' } | { kind: 'token'; token: string };

export interface CanvasClientOptions {
  fetch?: typeof fetch;
  credential: CanvasCredential;
}

/** Retry-After in seconds or an HTTP date, default 60 s. */
function retryAfterMs(res: Response, now = Date.now()): number {
  const h = res.headers.get('Retry-After');
  if (!h) return 60_000;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(1, secs) * 1000;
  const at = Date.parse(h);
  return Number.isNaN(at) ? 60_000 : Math.max(1_000, at - now);
}

export function createCanvasClient(opts: CanvasClientOptions) {
  const fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const get = (url: string) =>
    fetchImpl(url, {
      ...(opts.credential.kind === 'session' ? { credentials: 'include' as const } : {}),
      headers: {
        Accept: 'application/json+canvas-string-ids, application/json',
        ...(opts.credential.kind === 'token'
          ? { Authorization: `Bearer ${opts.credential.token}` }
          : {}),
      },
    });

  /**
   * Follows rel="next" up to MAX_PAGES (same origin only). A non-OK first page reports its status with no items
   * (callers decide what 401/403/404 mean); a 429 anywhere raises the rate-limit error so a sync can back off.
   */
  async function pages(origin: string, path: string): Promise<{ status: number; items: Obj[] }> {
    let url: string | null = `${origin}${path}`;
    const items: Obj[] = [];
    for (let i = 0; url && i < MAX_PAGES; i++) {
      const res = await get(url);
      if (res.status === 429) throw new ConnectorRateLimitError(retryAfterMs(res));
      if (!res.ok) return { status: res.status, items: i === 0 ? [] : items };
      const body = parseCanvasJson(await res.text());
      if (Array.isArray(body)) items.push(...(body as Obj[]));
      const next = nextLink(res.headers.get('Link'));
      url = next && new URL(next, origin).origin === origin ? next : null;
    }
    return { status: 200, items };
  }

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

    /** Credential check that distinguishes the failure: 401/403 raise `ConnectorAuthError`, 429 rate limit. */
    async whoami(origin: string): Promise<CanvasSession> {
      const res = await get(`${origin}/api/v1/users/self`);
      if (res.status === 429) throw new ConnectorRateLimitError(retryAfterMs(res));
      if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(res.status);
      if (!res.ok) throw new Error(`canvas_http_${res.status}`);
      const u = parseCanvasJson(await res.text()) as Obj;
      const uid = id(u?.id);
      if (!uid) throw new Error('canvas_not_canvas');
      return {
        origin,
        canvasUserId: uid,
        name: str(u.name),
        primary_email: str(u.primary_email) ?? str(u.email) ?? null,
      };
    },

    /**
     * Nook's collection: active courses, per course upcoming assignments and files. 401/403/404 on a course's
     * files (Files tab disabled) means "no files" for that course, not a failure. A 401 on the course list is an
     * auth failure (expired session / revoked token). `since` narrows assignments to those updated since.
     */
    async collect(
      session: Pick<CanvasSession, 'origin' | 'canvasUserId'>,
      o: { since?: number | null; bucket?: 'upcoming' | 'all' } = {},
    ): Promise<CanvasSyncPayload> {
      const { origin } = session;
      const list = await pages(origin, '/api/v1/courses?enrollment_state=active&per_page=50');
      if (list.status === 401 || list.status === 403) throw new ConnectorAuthError(list.status);
      const rawCourses = list.items.filter((c) => id(c.id));
      const courses: SyncCourse[] = rawCourses.map((c) => ({
        id: id(c.id)!,
        name: str(c.name) ?? '',
        course_code: str(c.course_code),
      }));
      const assignments: SyncAssignment[] = [];
      const files: SyncFile[] = [];
      const bucket = o.bucket ?? 'upcoming';
      for (const course of courses) {
        const cid = encodeURIComponent(course.id);
        const [as, fs] = await Promise.all([
          pages(origin, `/api/v1/courses/${cid}/assignments?bucket=${bucket}&per_page=50`),
          pages(origin, `/api/v1/courses/${cid}/files?per_page=100`),
        ]);
        for (const a of as.items) {
          const aid = id(a.id);
          if (!aid) continue;
          const updated = str(a.updated_at);
          if (o.since && updated && Date.parse(updated) < o.since) continue;
          assignments.push({
            id: aid,
            course_id: course.id,
            name: str(a.name) ?? '(untitled)',
            due_at: str(a.due_at),
            html_url: str(a.html_url),
            description: htmlToText(str(a.description)),
            updated_at: updated,
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

export const CANVAS_FILE_TYPES = ['ppt', 'pdf'] as const;

/** Nook's `canvasFileMatchesType` (contracts/src/canvas.ts): `.ppt/.pptx` or `.pdf` by name or content-type. */
export function canvasFileMatchesType(
  f: { display_name: string; 'content-type'?: string | null },
  type: 'ppt' | 'pdf',
): boolean {
  const name = f.display_name.toLowerCase();
  const ct = (f['content-type'] ?? '').toLowerCase();
  return type === 'pdf'
    ? name.endsWith('.pdf') || ct === 'application/pdf'
    : /\.pptx?$/.test(name) || ct.includes('powerpoint') || ct.includes('presentationml');
}
