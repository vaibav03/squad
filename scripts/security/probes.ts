/**
 * Attack probes against a booted hub. Each probe returns findings (empty = pass). Used by
 * `pnpm security:scan` and by apps/hub/test/security. Pure fetch; never prints secrets.
 */
import { SENTINELS, findLeak } from '../../packages/core/src/sentinel';

export interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detail: string;
}
export interface Ctx {
  url: string;
  /** INTERNAL_EVENTS_SECRET of the hub under test */
  secret: string;
  /** squad A (has withheld sentinels), squad A peer, and a student of a different squad */
  tokens: { ana: string; ben: string; zed: string };
  /** a task id of squad A that squad B must not read */
  taskA: string;
  tripA: string;
  /** replay directory contains a file, for traversal probes (optional) */
  corsOrigin?: string;
}
export type Probe = (c: Ctx) => Promise<Finding[]>;

const H = (t?: string, extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  ...(t ? { authorization: `Bearer ${t}` } : {}),
  ...extra,
});
const f = (id: string, severity: Finding['severity'], detail: string): Finding => ({
  id,
  severity,
  detail,
});
const j = async (r: Response) => {
  const t = await r.text();
  try {
    return { status: r.status, text: t, body: JSON.parse(t) as unknown };
  } catch {
    return { status: r.status, text: t, body: undefined };
  }
};
const req = (c: Ctx, path: string, init: RequestInit = {}) => fetch(c.url + path, init);

/** Routes that require a viewer; each must answer 401 without a token. */
const PROTECTED: [string, string][] = [
  ['GET', '/v1/me'],
  ['GET', '/v1/squad/state'],
  ['GET', '/v1/squad/stream'],
  ['GET', '/v1/stream'],
  ['GET', '/v1/tasks'],
  ['GET', '/v1/ledger/task_study_ch6'],
  ['GET', '/v1/trips/trip_cabo'],
  ['POST', '/v1/trips/trip_cabo/vote'],
  ['POST', '/v1/trips/trip_cabo/confirm'],
  ['POST', '/v1/confirms/task_trip_cabo'],
  ['GET', '/v1/mastery/stats101'],
  ['GET', '/v1/squad/courses'],
  ['POST', '/v1/squad/courses'],
  ['POST', '/v1/squad/calendar'],
  ['GET', '/v1/quiz/q1'],
  ['POST', '/v1/quiz/q1/answer'],
  ['POST', '/v1/call/start'],
  ['GET', '/v1/personas'],
  ['PUT', '/v1/personas/persona_pip'],
  ['GET', '/v1/voices'],
  ['POST', '/v1/voices/preview'],
  ['POST', '/v1/squad/stream-token'],
  ['POST', '/v1/session/projector'],
];

export const authRequired: Probe = async (c) => {
  const out: Finding[] = [];
  for (const [m, p] of PROTECTED) {
    for (const hdr of [
      {},
      { authorization: 'Bearer garbage.token' },
      { authorization: 'Basic eDp5' },
    ]) {
      const r = await req(c, p, {
        method: m,
        headers: { 'content-type': 'application/json', ...(hdr as Record<string, string>) },
        body: m === 'GET' ? undefined : '{}',
      });
      if (r.status !== 401 && r.status !== 415)
        out.push(
          f('AUTH-1', 'critical', `${m} ${p} answered ${r.status} without valid credentials`),
        );
      await r.body?.cancel();
    }
  }
  return out;
};

export const tokenKinds: Probe = async (c) => {
  const out: Finding[] = [];
  const st = await j(
    await req(c, '/v1/squad/stream-token', {
      method: 'POST',
      headers: H(c.tokens.ana),
      body: '{}',
    }),
  );
  const stream = (st.body as { st?: string })?.st;
  if (!stream) return [f('AUTH-2', 'medium', 'could not mint a stream token')];
  // a stream token must not work as a bearer
  const me = await req(c, '/v1/me', { headers: H(stream) });
  if (me.status !== 401)
    out.push(f('AUTH-2', 'high', `stream token accepted as bearer on /v1/me (${me.status})`));
  // a stream token must not open other REST routes via ?st=
  const q = await req(c, `/v1/squad/state?st=${stream}`);
  if (q.status !== 401)
    out.push(f('AUTH-3', 'high', 'stream token accepted by a non-stream route via ?st='));
  // the long-lived bearer should not be accepted in a URL (logged by proxies, leaks via Referer)
  const url = await req(c, `/v1/squad/stream?st=${c.tokens.ana}`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  if (url && url.status === 200)
    out.push(
      f(
        'AUTH-4',
        'medium',
        'long-lived bearer token accepted in the query string of /v1/squad/stream',
      ),
    );
  void url?.body?.cancel().catch(() => undefined);
  const mux = await req(c, `/v1/stream?st=${c.tokens.ana}`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  if (mux && mux.status === 200)
    out.push(
      f('AUTH-4', 'medium', 'long-lived bearer token accepted in the query string of /v1/stream'),
    );
  void mux?.body?.cancel().catch(() => undefined);
  // a tampered signature and a none-style token
  const [body] = c.tokens.ana.split('.');
  for (const t of [`${body}.AAAA`, `${body}.`, `${body}`, `${body}.${'A'.repeat(43)}`]) {
    const r = await req(c, '/v1/me', { headers: H(t) });
    if (r.status !== 401) out.push(f('AUTH-5', 'critical', 'tampered token accepted'));
  }
  // forged claims re-using the signature of another body
  const forged = Buffer.from(
    JSON.stringify({ k: 'bearer', sub: 's_ben', exp: Date.now() + 1e9, n: 'x' }),
  ).toString('base64url');
  const r = await req(c, '/v1/me', { headers: H(`${forged}.${c.tokens.ana.split('.')[1] ?? ''}`) });
  if (r.status !== 401) out.push(f('AUTH-5', 'critical', 'token with swapped claims accepted'));
  return out;
};

export const internalAuth: Probe = async (c) => {
  const out: Finding[] = [];
  const ev = JSON.stringify({ t: 'agent.state', agent: 'expert:ch6', state: 'idle' });
  for (const s of [undefined, '', 'wrong', 'change-me', c.secret + 'x', c.secret.slice(0, -1)]) {
    if (s === c.secret) continue;
    if (s === 'change-me' && c.secret === 'change-me') continue;
    const r = await req(c, '/internal/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(s !== undefined ? { 'x-nook-internal': s } : {}),
      },
      body: ev,
    });
    if (r.status !== 401)
      out.push(f('AUTH-6', 'critical', `/internal/events accepted a wrong secret (${r.status})`));
  }
  const big = await req(c, '/internal/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nook-internal': c.secret },
    body: JSON.stringify({ pad: 'x'.repeat(200_000) }),
  });
  if (big.status !== 413)
    out.push(f('INPUT-1', 'medium', `/internal/events accepted a 200 KB body (${big.status})`));
  if (c.secret === 'change-me')
    out.push(f('AUTH-7', 'high', 'hub is running with the default internal secret'));
  return out;
};

/** Squad B (zed) must never read or write squad A's data by guessing ids. */
export const idor: Probe = async (c) => {
  const out: Finding[] = [];
  const zed = c.tokens.zed;
  const led = await j(
    await req(c, `/v1/ledger/${encodeURIComponent(c.taskA)}`, { headers: H(zed) }),
  );
  const entries = (led.body as { entries?: unknown[] })?.entries ?? [];
  if (led.status === 200 && entries.length > 0)
    out.push(
      f(
        'IDOR-1',
        'high',
        `GET /v1/ledger/:taskId returned ${entries.length} entries of another squad`,
      ),
    );
  const tasks = await j(await req(c, '/v1/tasks', { headers: H(zed) }));
  if (JSON.stringify(tasks.body).includes(c.taskA))
    out.push(f('IDOR-2', 'high', '/v1/tasks lists another squad task'));
  const trip = await req(c, `/v1/trips/${c.tripA}`, { headers: H(zed) });
  if (trip.status !== 404)
    out.push(f('IDOR-3', 'high', `GET trip of another squad answered ${trip.status}`));
  for (const [p, b] of [
    [`/v1/trips/${c.tripA}/vote`, { ranking: ['cabo'] }],
    [`/v1/trips/${c.tripA}/confirm`, { optionId: 'cabo', yes: true }],
    [`/v1/confirms/${c.taskA}`, { yes: true, optionId: 'cabo' }],
  ] as const) {
    const r = await req(c, p, { method: 'POST', headers: H(zed), body: JSON.stringify(b) });
    if (r.status === 200) out.push(f('IDOR-4', 'critical', `POST ${p} succeeded across squads`));
  }
  const st = await j(await req(c, '/v1/squad/state', { headers: H(zed) }));
  const leak = findLeak(st.body, [...SENTINELS, 'Ana', 'task_trip', 'trip_cabo']);
  if (leak)
    out.push(
      f(
        'IDOR-5',
        'high',
        `squad snapshot for another squad contains ${leak === 'Ana' ? 'a foreign member name' : 'foreign ids/sentinels'}`,
      ),
    );
  // ids that are not ours with traversal-ish shapes
  for (const id of [
    '..%2f..%2fetc%2fpasswd',
    '%00',
    'a'.repeat(5000),
    "'; DROP TABLE hub_trips;--",
  ]) {
    const r = await req(c, `/v1/ledger/${id}`, { headers: H(zed) });
    if (r.status >= 500)
      out.push(f('INPUT-2', 'medium', `ledger id ${id.slice(0, 12)} caused ${r.status}`));
    await r.body?.cancel();
  }
  return out;
};

/** Everything a non-owner or other-squad student can fetch must be free of the planted sentinels. */
export const sentinels: Probe = async (c) => {
  const out: Finding[] = [];
  const paths = [
    '/v1/me',
    '/v1/tasks',
    `/v1/ledger/${c.taskA}`,
    `/v1/trips/${c.tripA}`,
    '/v1/squad/state',
    '/v1/squad/replays',
    '/v1/squad/replay/sample',
    '/v1/status',
    '/health',
    '/v1/auth/students',
    '/v1/personas',
    '/v1/mastery/stats101',
  ];
  for (const who of ['ben', 'zed'] as const)
    for (const p of paths) {
      const r = await j(await req(c, p, { headers: H(c.tokens[who]) }));
      const hit = findLeak(r.text);
      if (hit) out.push(f('LEAK-1', 'critical', `sentinel appeared in ${p} for ${who}`));
    }
  return out;
};

export const headers: Probe = async (c) => {
  const out: Finding[] = [];
  const r = await req(c, '/v1/me', { headers: H(c.tokens.ana) });
  const need: [string, RegExp][] = [
    ['x-content-type-options', /nosniff/],
    ['referrer-policy', /no-referrer|same-origin/],
    ['content-security-policy', /frame-ancestors 'none'/],
    ['x-frame-options', /DENY/],
    ['permissions-policy', /microphone=\(\)/],
    ['cache-control', /no-store/],
    ['x-request-id', /^[\w-]{8,64}$/],
  ];
  for (const [h, re] of need)
    if (!re.test(r.headers.get(h) ?? '')) out.push(f('HDR-1', 'medium', `missing or weak ${h}`));
  const bad = await req(c, '/v1/me', {
    headers: { origin: 'https://evil.example', authorization: `Bearer ${c.tokens.ana}` },
  });
  const acao = bad.headers.get('access-control-allow-origin');
  if (acao === '*' || acao === 'https://evil.example')
    out.push(f('CORS-1', 'high', 'hub reflects a foreign Origin'));
  const pre = await req(c, '/v1/me', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
  });
  const pa = pre.headers.get('access-control-allow-origin');
  if (pa === '*' || pa === 'https://evil.example')
    out.push(f('CORS-1', 'high', 'preflight allows a foreign Origin'));
  // Cookie sessions (product/accounts) need `allow-credentials` for the allow-listed web origin (hono sends the header
  // on every response, but a browser ignores it without a matching allow-origin). Only a wildcard origin with
  // credentials is a finding.
  if (
    r.headers.get('access-control-allow-credentials') === 'true' &&
    r.headers.get('access-control-allow-origin') === '*'
  )
    out.push(f('CORS-2', 'medium', 'credentials allowed with a wildcard Origin'));
  return out;
};

export const inputHandling: Probe = async (c) => {
  const out: Finding[] = [];
  const t = c.tokens.ana;
  const ct = await req(c, '/v1/session/projector', {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'text/plain' },
    body: '{"on":true}',
  });
  if (ct.status !== 415)
    out.push(f('INPUT-3', 'low', `text/plain JSON body accepted (${ct.status})`));
  const huge = await req(c, '/v1/session/projector', {
    method: 'POST',
    headers: H(t),
    body: JSON.stringify({ on: true, pad: 'x'.repeat(400_000) }),
  });
  if (huge.status !== 413)
    out.push(f('INPUT-4', 'medium', `400 KB JSON body not rejected (${huge.status})`));
  const chunked = await req(c, '/v1/session/projector', {
    method: 'POST',
    headers: H(t),
    body: new ReadableStream({
      start(ctl) {
        for (let i = 0; i < 8; i++) ctl.enqueue(new TextEncoder().encode('x'.repeat(64 * 1024)));
        ctl.close();
      },
    }),
    duplex: 'half',
  } as RequestInit).catch(() => null);
  if (chunked && chunked.status !== 413 && chunked.status !== 400)
    out.push(
      f('INPUT-4', 'medium', `chunked 512 KB body without length not rejected (${chunked.status})`),
    );
  for (const body of ['{', '[]', 'null', '{"on":"yes"}', '{"__proto__":{"x":1},"on":true}']) {
    const r = await req(c, '/v1/session/projector', { method: 'POST', headers: H(t), body });
    if (r.status >= 500)
      out.push(f('INPUT-5', 'medium', `malformed JSON ${body} caused ${r.status}`));
  }
  const up = async (name: string, bytes: string | Uint8Array, path = '/v1/squad/courses') => {
    const fd = new FormData();
    fd.append('file', new File([bytes], name, { type: 'application/pdf' }));
    return req(c, path, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: fd });
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  if ((await up('evil.pdf', png)).status === 202)
    out.push(f('UPLOAD-1', 'high', 'PNG bytes named .pdf accepted as a PDF'));
  if (
    (await up('x.pdf', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
      .status === 202
  )
    out.push(f('UPLOAD-1', 'high', 'SVG with script accepted as PDF'));
  if ((await up('empty.pdf', new Uint8Array(0))).status === 202)
    out.push(f('UPLOAD-2', 'low', 'empty file accepted'));
  const ics = async (txt: string) => up('c.ics', txt, '/v1/squad/calendar');
  if ((await ics('<html><script>alert(1)</script></html>')).status === 200)
    out.push(f('UPLOAD-3', 'medium', 'HTML accepted as .ics'));
  if ((await ics('BEGIN:VCALENDAR\n' + 'X'.repeat(200_000) + '\nEND:VCALENDAR')).status === 200)
    out.push(f('UPLOAD-3', 'medium', 'ics with a 200 KB line accepted'));
  const many = 'BEGIN:VCALENDAR\n' + 'BEGIN:VEVENT\nEND:VEVENT\n'.repeat(30_000) + 'END:VCALENDAR';
  if ((await ics(many)).status === 200)
    out.push(f('UPLOAD-3', 'medium', 'ics with 30k events accepted'));
  const trav = await up('../../../etc/passwd.pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF'));
  if (trav.status === 202) {
    const b = (await j(trav)).body as { file?: string };
    if (b.file && /[\\/]|\.\./.test(b.file))
      out.push(f('UPLOAD-4', 'medium', 'upload file name echoed with path components'));
  }
  // path traversal in replay names
  for (const n of ['..%2f..%2fpackage', '%2e%2e%2fsecret', 'a%00b', '....//', 'sample.json%00']) {
    const r = await req(c, `/v1/squad/replay/${n}`, { headers: H(t) });
    if (r.status !== 404) out.push(f('PATH-1', 'high', `replay name ${n} answered ${r.status}`));
    await r.body?.cancel();
  }
  return out;
};

export const abuse: Probe = async (c) => {
  const out: Finding[] = [];
  const spam = async (path: string, init: RequestInit, n: number) => {
    let limited = 0;
    for (let i = 0; i < n; i++) {
      const r = await req(c, path, init);
      if (r.status === 429) limited++;
      await r.body?.cancel();
    }
    return limited;
  };
  if (
    (await spam(
      '/v1/voices/preview',
      {
        method: 'POST',
        headers: H(c.tokens.ben),
        body: JSON.stringify({ voiceId: 'voice_calm', text: 'hello there' }),
      },
      80,
    )) === 0
  )
    out.push(f('ABUSE-1', 'medium', 'TTS preview is not rate limited (cost exhaustion)'));
  // SSE connection cap
  const ctrl = new AbortController();
  const stTok = await j(
    await req(c, '/v1/squad/stream-token', {
      method: 'POST',
      headers: H(c.tokens.ben),
      body: '{}',
    }),
  );
  const st = (stTok.body as { st: string }).st;
  let refused = false;
  const open: Response[] = [];
  for (let i = 0; i < 40 && !refused; i++) {
    const r = await req(c, `/v1/squad/stream?st=${st}`, { signal: ctrl.signal });
    if (r.status === 429) refused = true;
    else open.push(r);
  }
  ctrl.abort();
  if (!refused)
    out.push(f('ABUSE-2', 'medium', '40 concurrent SSE streams for one student were all accepted'));
  return out;
};

export const ALL: Record<string, Probe> = {
  authRequired,
  tokenKinds,
  internalAuth,
  idor,
  sentinels,
  headers,
  inputHandling,
  abuse,
};

export async function runProbes(c: Ctx, only?: string[]): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [name, p] of Object.entries(ALL)) {
    if (only && !only.includes(name)) continue;
    try {
      out.push(...(await p(c)));
    } catch (e) {
      out.push(f('PROBE-ERR', 'medium', `${name} crashed: ${(e as Error).message}`));
    }
  }
  return out;
}
