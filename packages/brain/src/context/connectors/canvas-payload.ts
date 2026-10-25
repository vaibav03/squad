/**
 * Turns Nook's Canvas payload ({courses, assignments, files}) into Squad connector items, and wraps it as
 * connectors: one for data pushed by the browser extension (`session` variant, Nook's route) and one that reads a
 * real Canvas with a student-generated token (`token` variant, same REST client and shapes).
 */
import {
  canvasFileMatchesType,
  createCanvasClient,
  isExactHttpsOrigin,
  type CanvasSyncPayload,
} from './canvas-rest';
import {
  ConnectorAuthError,
  type CanvasAuth,
  type CanvasConnector,
  type ConnectorCourse,
  type ConnectorItem,
  type ConnectorStatusInfo,
  type FetchedContent,
} from './types';

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

const kb = (n: number | null): string | null =>
  n === null ? null : `${Math.max(1, Math.round(n / 1024))} KB`;

export interface PayloadItems {
  courses: ConnectorCourse[];
  items: ConnectorItem[];
  content: Map<string, FetchedContent>;
}

/** Normalises one payload. Stable external ids: `assignment:<id>` and `file:<id>` (Canvas ids are per origin). */
export function payloadToItems(payload: CanvasSyncPayload): PayloadItems {
  const courseName = new Map(payload.courses.map((c) => [c.id, c.name || c.course_code || c.id]));
  const base = payload.origin.replace(/\/+$/, '');
  const items: ConnectorItem[] = [];
  const content = new Map<string, FetchedContent>();
  for (const a of payload.assignments) {
    const externalId = `assignment:${a.id}`;
    items.push({
      externalId,
      kind: 'canvas_assignment',
      title: a.name || '(untitled)',
      courseId: a.course_id,
      url: a.html_url ?? `${base}/courses/${a.course_id}/assignments/${a.id}`,
      modifiedAt: ms(a.updated_at ?? null),
      dueAt: ms(a.due_at),
    });
    content.set(externalId, {
      text: [`Course: ${courseName.get(a.course_id) ?? a.course_id}`, a.description ?? '']
        .filter(Boolean)
        .join('\n\n'),
    });
  }
  for (const f of payload.files) {
    const externalId = `file:${f.id}`;
    items.push({
      externalId,
      kind: 'canvas_file',
      title: f.display_name || 'file',
      courseId: f.course_id,
      url: f.url,
      modifiedAt: ms(f.updated_at),
    });
    const type = canvasFileMatchesType(f, 'ppt')
      ? 'slides'
      : canvasFileMatchesType(f, 'pdf')
        ? 'PDF'
        : 'file';
    // Nook never extracts file text: a file is its name, course, type and link. That is all we can cite.
    content.set(externalId, {
      text: [
        `Course: ${courseName.get(f.course_id) ?? f.course_id}`,
        `Type: ${type}${f['content-type'] ? ` (${f['content-type']})` : ''}`,
        kb(f.size) ? `Size: ${kb(f.size)}` : '',
        f.folder ? `Folder: ${f.folder}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  for (const m of payload.modules ?? []) {
    const externalId = `module:${m.id}`;
    items.push({
      externalId,
      kind: 'canvas_event',
      title: m.title,
      courseId: m.course_id,
      url: m.html_url,
      modifiedAt: null,
    });
    content.set(externalId, {
      text: `Course: ${courseName.get(m.course_id) ?? m.course_id}\nModule: ${m.module}\nItem type: ${m.type ?? 'item'}`,
    });
  }
  return {
    courses: payload.courses.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.course_code ? { code: c.course_code } : {}),
    })),
    items,
    content,
  };
}

const LIVE: ConnectorStatusInfo = { state: 'live' };

/** Connector over data the extension pushed. The hub builds one per sync from the validated payload. */
export function createPushedCanvasConnector(payload: CanvasSyncPayload): CanvasConnector {
  const { courses, items, content } = payloadToItems(payload);
  return {
    provider: 'canvas',
    mode: 'live',
    async accountId(auth) {
      return auth.variant === 'session'
        ? `${auth.origin.replace(/\/+$/, '')}#${auth.canvasUserId}`
        : `${payload.origin.replace(/\/+$/, '')}#${payload.canvas_user_id}`;
    },
    async listCourses() {
      return courses;
    },
    async listItems() {
      return items;
    },
    async fetchContent(_auth, item) {
      return content.get(item.externalId) ?? { text: '' };
    },
    async revoke() {
      /* The extension holds the only credential (the browser session); nothing upstream to revoke. */
    },
    async status() {
      return LIVE;
    },
  };
}

/** Real Canvas via a student token: the same endpoints and normalisation as the extension route. */
export function createLiveCanvasConnector(opts: { fetch?: typeof fetch } = {}): CanvasConnector {
  let cache: PayloadItems | undefined;
  const client = (auth: Extract<CanvasAuth, { variant: 'token' }>) =>
    createCanvasClient({
      credential: { kind: 'token', token: auth.token },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  const tokenOnly = (a: CanvasAuth): Extract<CanvasAuth, { variant: 'token' }> => {
    if (a.variant !== 'token' || !isExactHttpsOrigin(a.baseUrl))
      throw new ConnectorAuthError(401, 'unsupported credential');
    return a;
  };
  return {
    provider: 'canvas',
    mode: 'live',
    async accountId(auth) {
      const a = tokenOnly(auth);
      const me = await client(a).whoami(a.baseUrl);
      return `${a.baseUrl}#${me.canvasUserId}`;
    },
    async listCourses(auth) {
      const a = tokenOnly(auth);
      const me = await client(a).whoami(a.baseUrl);
      const payload = await client(a).collect({ origin: a.baseUrl, canvasUserId: me.canvasUserId });
      return payloadToItems(payload).courses;
    },
    async listItems(auth, _courseId, o) {
      const a = tokenOnly(auth);
      const c = client(a);
      const me = await c.whoami(a.baseUrl);
      // Upcoming only on incremental passes; the full pass takes everything Canvas will list (past work too).
      const payload = await c.collect(
        { origin: a.baseUrl, canvasUserId: me.canvasUserId },
        {
          since: o?.full === false ? o.since : null,
          bucket: o?.full === false ? 'upcoming' : 'all',
        },
      );
      cache = payloadToItems(payload);
      return cache.items;
    },
    async fetchContent(_auth, item) {
      return cache?.content.get(item.externalId) ?? { text: '' };
    },
    async revoke() {
      /* Canvas tokens are revoked by the student in Canvas Settings; we only delete our copy. */
    },
    async status(auth) {
      const a = tokenOnly(auth);
      try {
        await client(a).whoami(a.baseUrl);
        return LIVE;
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          return {
            state: 'error',
            degraded: true,
            note: `Canvas rejected the token (${e.httpStatus}). Generate a new one in Canvas Settings.`,
          };
        throw e;
      }
    },
  };
}
