/**
 * Fake Canvas and Google servers, shaped like the real APIs (paths, query parameters, `while(1);` prefix, `Link`
 * pagination, error bodies, Retry-After). All content is original and synthetic. Used by the Nook parity tests;
 * no network, no real account, and the only "credentials" are the sentinel strings the tests pass in.
 */
export const CANVAS_ORIGIN = 'https://canvas.fixture.invalid';

const json = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string>; prefix?: boolean } = {},
) =>
  new Response(`${init.prefix === false ? '' : 'while(1);'}${JSON.stringify(body)}`, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

export interface FakeCanvasOpts {
  /** Required Authorization bearer (token route). Cookie sessions send none and `credentials: include`. */
  token?: string;
  /** Session cookie mode: requests must carry `credentials: 'include'` or they are 401. */
  session?: boolean;
  userId?: number;
  /** 429 on every request, with this Retry-After (seconds). */
  rateLimitSeconds?: number;
  /** Courses whose Files tab is disabled (403). */
  filesDisabled?: string[];
  /** Mutable: what Canvas currently holds. */
  data?: {
    courses: { id: number; name: string; course_code: string }[];
    assignments: Record<
      string,
      {
        id: number;
        name: string;
        due_at: string | null;
        html_url: string;
        description?: string;
        updated_at?: string;
      }[]
    >;
    files: Record<
      string,
      {
        id: number;
        display_name: string;
        'content-type': string;
        size: number;
        url: string;
        updated_at: string;
      }[]
    >;
  };
  /** Records every requested URL (no headers, so no credential can leak into assertions). */
  log?: string[];
  /** Size of the courses page; a rel=next Link is sent while more remain. */
  coursesPageSize?: number;
}

export function defaultCanvasData(): NonNullable<FakeCanvasOpts['data']> {
  return {
    courses: [
      { id: 101, name: 'Intro to Marine Ecology', course_code: 'ECO 101' },
      { id: 102, name: 'Statistics for Field Work', course_code: 'STA 210' },
      { id: 103, name: 'Archive Seminar', course_code: 'ARC 300' },
    ],
    assignments: {
      '101': [
        {
          id: 5001,
          name: 'Tide pool survey report',
          due_at: '2026-11-03T06:59:00Z',
          html_url: `${CANVAS_ORIGIN}/courses/101/assignments/5001`,
          description: '<p>Write up the <b>tide pool</b> survey. Cite two readings.</p>',
          updated_at: '2026-10-20T12:00:00Z',
        },
        {
          id: 5002,
          name: 'Reading reflection',
          due_at: null,
          html_url: `${CANVAS_ORIGIN}/courses/101/assignments/5002`,
          updated_at: '2026-10-01T12:00:00Z',
        },
      ],
      '102': [
        {
          id: 5003,
          name: 'Problem set 6',
          due_at: '2026-10-30T06:59:00Z',
          html_url: `${CANVAS_ORIGIN}/courses/102/assignments/5003`,
          description: '<p>Confidence intervals for transect counts.</p>',
          updated_at: '2026-10-22T12:00:00Z',
        },
      ],
      '103': [],
    },
    files: {
      '101': [
        {
          id: 9001,
          display_name: 'Lecture 4 - Kelp forests.pptx',
          'content-type':
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          size: 2_400_000,
          url: `${CANVAS_ORIGIN}/files/9001/download`,
          updated_at: '2026-10-18T09:00:00Z',
        },
        {
          id: 9002,
          display_name: 'Syllabus.pdf',
          'content-type': 'application/pdf',
          size: 90_000,
          url: `${CANVAS_ORIGIN}/files/9002/download`,
          updated_at: '2026-08-20T09:00:00Z',
        },
      ],
      '102': [
        {
          id: 9003,
          display_name: 'Lecture 5 notes.pdf',
          'content-type': 'application/pdf',
          size: 150_000,
          url: `${CANVAS_ORIGIN}/files/9003/download`,
          updated_at: '2026-10-21T09:00:00Z',
        },
      ],
      '103': [],
    },
  };
}

export function fakeCanvas(opts: FakeCanvasOpts = {}): typeof fetch {
  const data = (opts.data ??= defaultCanvasData());
  const pageSize = opts.coursesPageSize ?? 50;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    opts.log?.push(`${url.pathname}${url.search}`);
    if (url.origin !== CANVAS_ORIGIN) return new Response('wrong origin', { status: 599 });
    if (opts.rateLimitSeconds !== undefined)
      return new Response('slow down', {
        status: 429,
        headers: { 'Retry-After': String(opts.rateLimitSeconds) },
      });
    const headers = new Headers(init?.headers);
    const authed = opts.token
      ? headers.get('authorization') === `Bearer ${opts.token}`
      : opts.session
        ? init?.credentials === 'include'
        : true;
    const prefix = opts.session === true;
    if (!authed)
      return json(
        { errors: [{ message: 'user authorisation required' }] },
        { status: 401, prefix },
      );
    if (url.pathname === '/api/v1/users/self')
      return json(
        {
          id: opts.userId ?? 1001,
          name: 'Sample Student',
          primary_email: 'sample@fixture.invalid',
        },
        { prefix },
      );
    if (url.pathname === '/api/v1/courses') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const slice = data.courses.slice((page - 1) * pageSize, page * pageSize);
      const more = page * pageSize < data.courses.length;
      return json(slice, {
        prefix,
        headers: more
          ? {
              Link: `<${CANVAS_ORIGIN}/api/v1/courses?enrollment_state=active&per_page=50&page=${page + 1}>; rel="next"`,
            }
          : {},
      });
    }
    const m = /^\/api\/v1\/courses\/(\d+)\/(assignments|files)$/.exec(url.pathname);
    if (m) {
      const [, cid, kind] = m as unknown as [string, string, string];
      if (kind === 'files' && opts.filesDisabled?.includes(cid))
        return json({ errors: [{ message: 'disabled for this course' }] }, { status: 403, prefix });
      const rows = (kind === 'assignments' ? data.assignments[cid] : data.files[cid]) ?? [];
      // An evil off-origin rel=next must never be followed.
      return json(rows, {
        prefix,
        headers: { Link: '<https://evil.invalid/api/v1/x?page=2>; rel="next"' },
      });
    }
    return json({ errors: [{ message: 'not found' }] }, { status: 404, prefix });
  }) as typeof fetch;
}

// ------------------------------------------------------------------ Google

export interface FakeGoogleOpts {
  /** The access token currently valid; any other bearer is 401. */
  accessToken: string;
  refreshToken?: string;
  /** What the token endpoint hands out. */
  issue?: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  /** `invalid_grant` on refresh. */
  refreshInvalidGrant?: boolean;
  /** 429 with Retry-After on API calls. */
  rateLimitSeconds?: number;
  /** 403 rateLimitExceeded body on Calendar. */
  calendarQuota?: boolean;
  sub?: string;
  log?: string[];
  revoked?: string[];
  /** Mutable calendar and drive content. */
  calendar?: {
    id: string;
    summary: string;
    description?: string;
    start: string;
    end: string;
    updated: string;
    status?: string;
  }[];
  drive?: Record<string, { name: string; mimeType: string; text?: string; modifiedTime: string }>;
  classroom?: {
    courses: { id: string; name: string }[];
    work: Record<string, { id: string; title: string; due?: string; description?: string }[]>;
  };
}

export function fakeGoogle(opts: FakeGoogleOpts): typeof fetch {
  const cal =
    opts.calendar ??
    (opts.calendar = [
      {
        id: 'e1',
        summary: 'Seminar: kelp forests',
        description: 'Bring field notes.',
        start: '2026-11-02T17:00:00Z',
        end: '2026-11-02T18:00:00Z',
        updated: '2026-10-20T10:00:00Z',
      },
      {
        id: 'e2',
        summary: 'Lab shift',
        start: '2026-11-03T20:00:00Z',
        end: '2026-11-03T22:00:00Z',
        updated: '2026-10-21T10:00:00Z',
      },
    ]);
  const drive =
    opts.drive ??
    (opts.drive = {
      d1: {
        name: 'Field notes - week 7',
        mimeType: 'application/vnd.google-apps.document',
        text: 'Observed urchin density rose near the north reef. Next sample is on Friday.',
        modifiedTime: '2026-10-19T10:00:00Z',
      },
      d2: { name: 'Slides.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-19T11:00:00Z' },
    });
  const cr = opts.classroom ?? {
    courses: [{ id: 'c9', name: 'Coastal Policy' }],
    work: {
      c9: [
        {
          id: 'w1',
          title: 'Policy memo draft',
          due: '2026-11-05',
          description: 'Two page memo on harbor access.',
        },
      ],
    },
  };
  const jsonRes = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    opts.log?.push(`${url.host}${url.pathname}${url.search}`);
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('grant_type') === 'refresh_token') {
        if (opts.refreshInvalidGrant || body.get('refresh_token') !== opts.refreshToken)
          return jsonRes({ error: 'invalid_grant' }, 400);
        return jsonRes({
          access_token: opts.issue?.access_token ?? 'refreshed-access',
          expires_in: 3600,
        });
      }
      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') !== 'good-code' || !body.get('code_verifier'))
          return jsonRes({ error: 'invalid_grant' }, 400);
        return jsonRes({
          access_token: opts.issue?.access_token ?? opts.accessToken,
          ...(opts.issue?.refresh_token ? { refresh_token: opts.issue.refresh_token } : {}),
          expires_in: opts.issue?.expires_in ?? 3600,
          scope: opts.issue?.scope ?? '',
          token_type: 'Bearer',
        });
      }
      return jsonRes({ error: 'unsupported_grant_type' }, 400);
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      opts.revoked?.push(
        new URLSearchParams(String(init?.body ?? '')).get('token') ? 'revoked' : 'empty',
      );
      return jsonRes({}, 200);
    }
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${opts.accessToken}`)
      return jsonRes({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401);
    if (opts.rateLimitSeconds !== undefined)
      return jsonRes({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429, {
        'Retry-After': String(opts.rateLimitSeconds),
      });
    if (url.host === 'openidconnect.googleapis.com')
      return jsonRes({ sub: opts.sub ?? 'g-sub-1', email: 'student@fixture.invalid' });
    if (url.pathname === '/calendar/v3/calendars/primary/events') {
      if (opts.calendarQuota)
        return jsonRes({ error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } }, 403);
      const since = url.searchParams.get('updatedMin');
      const items = cal.filter((e) => !since || Date.parse(e.updated) >= Date.parse(since));
      return jsonRes({ items });
    }
    const f = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(url.pathname);
    if (f) {
      const file = drive[f[1] ?? ''];
      if (!file) return jsonRes({ error: { code: 404 } }, 404);
      if (f[2] || url.searchParams.get('alt') === 'media')
        return new Response(file.text ?? '', { status: 200 });
      return jsonRes({
        id: f[1],
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        webViewLink: `https://docs.google.com/document/d/${f[1]}/edit`,
      });
    }
    if (url.pathname === '/v1/courses') return jsonRes({ courses: cr.courses });
    const w = /^\/v1\/courses\/([^/]+)\/courseWork$/.exec(url.pathname);
    if (w) {
      const rows = cr.work[w[1] ?? ''] ?? [];
      return jsonRes({
        courseWork: rows.map((r) => {
          const [y, mo, d] = (r.due ?? '').split('-').map(Number);
          return {
            id: r.id,
            title: r.title,
            description: r.description,
            alternateLink: `https://classroom.google.com/c/${w[1]}/a/${r.id}`,
            updateTime: '2026-10-22T10:00:00Z',
            ...(r.due ? { dueDate: { year: y, month: mo, day: d } } : {}),
          };
        }),
      });
    }
    return jsonRes({ error: { code: 404 } }, 404);
  }) as typeof fetch;
}
