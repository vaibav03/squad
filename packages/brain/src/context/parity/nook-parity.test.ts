import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import {
  MAX_PAGES,
  buildGoogleAuthorizationUrl,
  canvasFileMatchesType,
  createCanvasClient,
  createLiveCanvasConnector,
  createLiveGoogleConnector,
  createPushedCanvasConnector,
  exchangeGoogleCode,
  isExactHttpsOrigin,
  nextLink,
  parseCanvasJson,
  pkceChallenge,
  GOOGLE_SCOPES,
  ConnectorAuthError,
  ConnectorExpiredError,
  ConnectorRevokedError,
  ConnectorRateLimitError,
  type CanvasAuth,
  type GoogleAuth,
} from '../connectors';
import { createContextStore } from '../store';
import { syncConnection } from '../sync';
import { connectionState, type ContextConnection } from '../types';
import { CANVAS_ORIGIN, fakeCanvas, fakeGoogle, defaultCanvasData } from './fake-servers';

const TOKEN = 'CANVAS-TOKEN-SENTINEL-41ac';

describe('Nook parity: Canvas REST client (cubbie-re apps/extension/src/canvas.ts)', () => {
  it('P1 strips the while(1); prefix Canvas puts on cookie-authenticated JSON', () => {
    expect(parseCanvasJson('while(1);[{"id":1}]')).toEqual([{ id: 1 }]);
    expect(parseCanvasJson(' while (1) ; {"a":2}')).toEqual({ a: 2 });
    expect(parseCanvasJson('[3]')).toEqual([3]);
  });

  it('P2 follows rel=next up to MAX_PAGES, same origin only', async () => {
    expect(MAX_PAGES).toBe(3);
    expect(
      nextLink('<https://a.test/x?page=2>; rel="next", <https://a.test/x?page=9>; rel="last"'),
    ).toBe('https://a.test/x?page=2');
    expect(nextLink(null)).toBeNull();
    const log: string[] = [];
    const data = defaultCanvasData();
    data.courses = Array.from({ length: 7 }, (_, i) => ({
      id: 200 + i,
      name: `C${i}`,
      course_code: `C${i}`,
    }));
    const client = createCanvasClient({
      credential: { kind: 'session' },
      fetch: fakeCanvas({ session: true, data, log, coursesPageSize: 2 }),
    });
    const p = await client.collect({ origin: CANVAS_ORIGIN, canvasUserId: '1001' });
    // 3 pages x 2 courses: the 4th page is never requested.
    expect(p.courses).toHaveLength(6);
    expect(log.filter((l) => l.startsWith('/api/v1/courses?')).length).toBe(3);
    // The off-origin rel=next on assignments/files was never followed.
    expect(log.every((l) => !l.includes('evil'))).toBe(true);
  });

  it('P3 files 401/403/404 means no files for that course, not a failure', async () => {
    const client = createCanvasClient({
      credential: { kind: 'session' },
      fetch: fakeCanvas({ session: true, filesDisabled: ['101'] }),
    });
    const p = await client.collect({ origin: CANVAS_ORIGIN, canvasUserId: '1001' });
    expect(p.files.filter((f) => f.course_id === '101')).toHaveLength(0);
    expect(p.files.filter((f) => f.course_id === '102')).toHaveLength(1);
    expect(p.assignments.filter((a) => a.course_id === '101')).toHaveLength(2);
  });

  it('P4/P5 collect payload has Nook shape, string ids and Nook defaults', async () => {
    const data = defaultCanvasData();
    data.courses.push({
      id: 104,
      name: null as unknown as string,
      course_code: null as unknown as string,
    });
    data.assignments['104'] = [
      { id: 7, name: null as unknown as string, due_at: null, html_url: '' },
    ];
    data.files['104'] = [
      {
        id: 8,
        display_name: null as unknown as string,
        'content-type': 'x/y',
        size: 1,
        url: 'u',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    const client = createCanvasClient({
      credential: { kind: 'session' },
      fetch: fakeCanvas({ session: true, data }),
    });
    const p = await client.collect({ origin: CANVAS_ORIGIN, canvasUserId: '1001' });
    expect(Object.keys(p).sort()).toEqual([
      'assignments',
      'canvas_user_id',
      'courses',
      'files',
      'origin',
    ]);
    expect(p.courses[0]).toEqual({
      id: '101',
      name: 'Intro to Marine Ecology',
      course_code: 'ECO 101',
    });
    expect(p.courses.find((c) => c.id === '104')).toEqual({
      id: '104',
      name: '',
      course_code: null,
    });
    expect(p.assignments.find((a) => a.id === '7')?.name).toBe('(untitled)');
    expect(p.files.find((f) => f.id === '8')?.display_name).toBe('file');
    expect(typeof p.assignments[0]?.id).toBe('string');
  });

  it('P6 probe returns the user, or null when not signed in / not Canvas / network', async () => {
    const ok = createCanvasClient({
      credential: { kind: 'session' },
      fetch: fakeCanvas({ session: true }),
    });
    expect(await ok.probe(CANVAS_ORIGIN)).toEqual({
      origin: CANVAS_ORIGIN,
      canvasUserId: '1001',
      name: 'Sample Student',
      primary_email: 'sample@fixture.invalid',
    });
    const noCookie = createCanvasClient({
      credential: { kind: 'session' },
      fetch: (async (u: string | URL | Request) =>
        fakeCanvas({ session: true })(u, {})) as typeof fetch,
    });
    expect(await noCookie.probe(CANVAS_ORIGIN)).toBeNull();
    const down = createCanvasClient({
      credential: { kind: 'session' },
      fetch: (async () => {
        throw new Error('net');
      }) as typeof fetch,
    });
    expect(await down.probe(CANVAS_ORIGIN)).toBeNull();
  });

  it('P7 only exact https origins are accepted', () => {
    expect(isExactHttpsOrigin('https://school.instructure.com')).toBe(true);
    for (const bad of [
      'http://school.instructure.com',
      'https://school.instructure.com/',
      'https://school.instructure.com/x',
      'school.instructure.com',
      42,
      null,
    ])
      expect(isExactHttpsOrigin(bad)).toBe(false);
  });

  it('P10 file type filter matches Nook (name or content-type)', () => {
    expect(canvasFileMatchesType({ display_name: 'a.PPTX' }, 'ppt')).toBe(true);
    expect(
      canvasFileMatchesType(
        { display_name: 'a', 'content-type': 'application/vnd.ms-powerpoint' },
        'ppt',
      ),
    ).toBe(true);
    expect(canvasFileMatchesType({ display_name: 'a.pdf' }, 'ppt')).toBe(false);
    expect(
      canvasFileMatchesType({ display_name: 'notes', 'content-type': 'application/pdf' }, 'pdf'),
    ).toBe(true);
  });

  it('error mapping: 401 on courses is an auth failure, 429 is a rate limit with Retry-After', async () => {
    const bad = createCanvasClient({
      credential: { kind: 'token', token: 'wrong' },
      fetch: fakeCanvas({ token: TOKEN }),
    });
    await expect(bad.collect({ origin: CANVAS_ORIGIN, canvasUserId: '1' })).rejects.toBeInstanceOf(
      ConnectorAuthError,
    );
    const slow = createCanvasClient({
      credential: { kind: 'token', token: TOKEN },
      fetch: fakeCanvas({ token: TOKEN, rateLimitSeconds: 42 }),
    });
    await expect(slow.collect({ origin: CANVAS_ORIGIN, canvasUserId: '1' })).rejects.toMatchObject({
      retryAfterMs: 42_000,
    });
  });
});

function setup() {
  const db = openMemoryDb();
  const store = createContextStore(db);
  let t = Date.parse('2026-10-25T12:00:00Z');
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const mk = (over: Partial<ContextConnection> = {}): ContextConnection => {
    const c: ContextConnection = {
      id: 'conn_a',
      ownerId: 's_ana',
      provider: 'canvas',
      mode: 'live',
      variant: 'token',
      accountHash: 'h',
      scopes: ['canvas.api_token.read'],
      status: 'live',
      degraded: false,
      statusNote: null,
      createdAt: t,
      lastSyncAt: null,
      expiresAt: null,
      ...over,
    };
    store.upsertConnection(c);
    return c;
  };
  return { store, clock, mk, deps: { store, now: clock.now } };
}

describe('Nook parity: normalized sources, citation anchors and states from the same fake Canvas', () => {
  const auth: CanvasAuth = { variant: 'token', token: TOKEN, baseUrl: CANVAS_ORIGIN };

  it('the extension route (pushed payload) and the token route produce identical sources', async () => {
    const f = fakeCanvas({ token: TOKEN });
    const client = createCanvasClient({ credential: { kind: 'token', token: TOKEN }, fetch: f });
    const payload = await client.collect({ origin: CANVAS_ORIGIN, canvasUserId: '1001' });

    const a = setup();
    const ca = a.mk({ id: 'conn_a', variant: 'session' });
    await syncConnection({ ...a.deps, full: true }, ca, createPushedCanvasConnector(payload), {
      variant: 'session',
      origin: CANVAS_ORIGIN,
      canvasUserId: '1001',
    });
    const b = setup();
    const cb = b.mk({ id: 'conn_a' });
    await syncConnection(
      { ...b.deps, full: true },
      cb,
      createLiveCanvasConnector({ fetch: f }),
      auth,
    );

    const shape = (s: ReturnType<typeof setup>) =>
      s.store
        .sourcesOfConnection('conn_a')
        .map((x) => ({
          uri: x.uri,
          kind: x.kind,
          title: x.title,
          course: x.courseId,
          due: x.dueAt,
          url: x.url,
          hash: x.contentHash,
          anchors: s.store.chunks(x.id).map((c) => c.anchor),
        }))
        .sort((x, y) => x.uri.localeCompare(y.uri));
    expect(shape(a)).toEqual(shape(b));
    const rows = shape(a);
    expect(rows.filter((r) => r.kind === 'canvas_assignment')).toHaveLength(3);
    expect(rows.filter((r) => r.kind === 'canvas_file')).toHaveLength(3);
    const tide = rows.find((r) => r.title === 'Tide pool survey report')!;
    expect(tide.uri).toMatch(/^source:\/\/canvas_assignment\/src_/);
    expect(tide.anchors[0]).toBe('s1');
    expect(tide.due).toBe(Date.parse('2026-11-03T06:59:00Z'));
    // Description HTML is reduced to words and is searchable with a verified quote.
    const hits = a.store.search('tide pool survey cite two readings', {
      studentId: 's_ana',
      squadIds: [],
    });
    expect(hits[0]?.source.title).toBe('Tide pool survey report');
    expect(hits[0]?.chunk.text).toContain('Cite two readings.');
  });

  it('a file is metadata only (Nook never extracts file text) and carries its link', async () => {
    const f = fakeCanvas({ token: TOKEN });
    const s = setup();
    const c = s.mk();
    await syncConnection(
      { ...s.deps, full: true },
      c,
      createLiveCanvasConnector({ fetch: f }),
      auth,
    );
    const file = s.store
      .sourcesOfConnection('conn_a')
      .find((x) => x.title.startsWith('Lecture 4'))!;
    expect(file.url).toBe(`${CANVAS_ORIGIN}/files/9001/download`);
    expect(
      s.store
        .chunks(file.id)
        .map((x) => x.text)
        .join(' '),
    ).toMatch(/Type: slides/);
  });

  it('P19 states: live, fixture, expired, revoked, rate_limited, error', async () => {
    expect(connectionState({ mode: 'live', status: 'live' })).toBe('live');
    expect(connectionState({ mode: 'fixture', status: 'live' })).toBe('fixture');
    for (const st of ['expired', 'revoked', 'rate_limited', 'error'] as const)
      expect(connectionState({ mode: 'live', status: st })).toBe(st);
  });

  it('expired session or token (401) -> honest degraded state, data kept, no purge', async () => {
    const good = fakeCanvas({ token: TOKEN });
    const s = setup();
    const c = s.mk();
    await syncConnection(
      { ...s.deps, full: true },
      c,
      createLiveCanvasConnector({ fetch: good }),
      auth,
    );
    const before = s.store.sourcesOfConnection('conn_a').length;
    const dead = fakeCanvas({ token: 'another' });
    const r = await syncConnection(
      { ...s.deps, full: true },
      c,
      createLiveCanvasConnector({ fetch: dead }),
      auth,
    );
    expect(r.outcome).toBe('degraded');
    expect(s.store.connection('conn_a')).toMatchObject({ status: 'error', degraded: true });
    expect(s.store.syncState('conn_a').lastOutcome).toBe('degraded');
    expect(s.store.sourcesOfConnection('conn_a')).toHaveLength(before);
  });

  it('rate limited (429) -> rate_limited, waits out Retry-After without calling upstream, then recovers', async () => {
    const s = setup();
    const c = s.mk();
    const log: string[] = [];
    const limited = createLiveCanvasConnector({
      fetch: fakeCanvas({ token: TOKEN, rateLimitSeconds: 120, log }),
    });
    const r1 = await syncConnection(s.deps, c, limited, auth);
    expect(r1).toMatchObject({ outcome: 'rate_limited', retryAfter: s.clock.now() + 120_000 });
    expect(s.store.connection('conn_a')?.status).toBe('rate_limited');
    const calls = log.length;
    s.clock.advance(30_000);
    const r2 = await syncConnection(s.deps, c, limited, auth);
    expect(r2.outcome).toBe('rate_limited');
    expect(log.length).toBe(calls); // no upstream call while waiting
    s.clock.advance(120_000);
    s.store.setStatus('conn_a', 'live', null); // the hub's tick lifts the state once retryAfter passed
    const ok = createLiveCanvasConnector({ fetch: fakeCanvas({ token: TOKEN }) });
    const r3 = await syncConnection(s.deps, c, ok, auth);
    expect(r3.outcome).toBe('ok');
    expect(s.store.connection('conn_a')?.status).toBe('live');
    expect(s.store.syncState('conn_a').retryAfter).toBeNull();
  });

  it('cursor and backfill: first pass is full, the next is incremental with a since mark; deletions only on full passes', async () => {
    const data = defaultCanvasData();
    const f = fakeCanvas({ token: TOKEN, data });
    const s = setup();
    const c = s.mk();
    const conn = createLiveCanvasConnector({ fetch: f });
    const r1 = await syncConnection(s.deps, c, conn, auth);
    expect(r1).toMatchObject({ outcome: 'ok', pass: 'backfill' });
    const cur = s.store.syncState('conn_a').cursor!;
    expect(cur.updatedAt).toBe(
      Date.parse('2026-10-22T12:00:00Z') > Date.parse('2026-10-21T09:00:00Z')
        ? Date.parse('2026-10-22T12:00:00Z')
        : 0,
    );
    expect(cur.windowTo - cur.windowFrom).toBe(300 * 86_400_000);
    // An assignment disappears upstream: an incremental pass must NOT conclude it was deleted.
    data.assignments['102'] = [];
    s.clock.advance(3_600_000);
    const r2 = await syncConnection(s.deps, c, conn, auth);
    expect(r2).toMatchObject({ outcome: 'ok', pass: 'incremental', removed: 0 });
    // The daily full pass does detect it and deletes the derived copy (tombstone for the owner).
    s.clock.advance(24 * 3_600_000);
    const r3 = await syncConnection(s.deps, c, conn, auth);
    expect(r3).toMatchObject({ pass: 'backfill', removed: 1 });
  });
});

describe('Nook parity: Google OAuth and Workspace (bridge/google-workspace.ts)', () => {
  const cfg = {
    clientId: 'CLIENT-ID-PLACEHOLDER',
    clientSecret: 'CLIENT-SECRET-SENTINEL-77',
    redirectUri: 'https://hub.example.test/oauth/google/callback',
  };

  it('P13 authorization URL: PKCE S256, offline, consent, state, login_hint, minimal scopes only', () => {
    const verifier = 'v'.repeat(48);
    const u = new URL(
      buildGoogleAuthorizationUrl(cfg, {
        state: 'gst_abc',
        verifier,
        loginHint: 'me@fixture.invalid',
      }),
    );
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = u.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent select_account');
    expect(q.get('include_granted_scopes')).toBe('true');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe(pkceChallenge(verifier));
    expect(q.get('state')).toBe('gst_abc');
    expect(q.get('login_hint')).toBe('me@fixture.invalid');
    const scopes = q.get('scope')!.split(' ');
    expect(scopes.sort()).toEqual(['email', 'openid', ...Object.values(GOOGLE_SCOPES)].sort());
    // Nook asks for gmail.modify, full drive, calendar, ... Squad never does.
    for (const broad of ['gmail', 'auth/drive"', 'auth/calendar"', 'documents', 'spreadsheets'])
      expect(scopes.join(' ')).not.toMatch(new RegExp(broad.replace('"', '(\\s|$)')));
    expect(u.toString()).not.toContain(cfg.clientSecret);
  });

  it("P15 code exchange: needs the PKCE verifier; failures carry only Google's error code", async () => {
    const f = fakeGoogle({
      accessToken: 'AT-1',
      issue: { access_token: 'AT-1', refresh_token: 'RT-1', scope: GOOGLE_SCOPES.calendar },
    });
    // exchangeGoogleCode talks to the token endpoint with the verifier and the secret in the body only.
    const body: string[] = [];
    const spy = (async (u: string | URL | Request, i?: RequestInit) => {
      body.push(String(i?.body));
      return f(u, i);
    }) as typeof fetch;
    const tok = await exchangeGoogleCode(cfg, 'good-code', 'verifier-xyz', spy);
    expect(tok).toMatchObject({ access_token: 'AT-1', refresh_token: 'RT-1' });
    expect(body[0]).toContain('code_verifier=verifier-xyz');
    await expect(exchangeGoogleCode(cfg, 'bad', 'verifier-xyz', f)).rejects.toThrow(
      'google_token_exchange_failed:invalid_grant',
    );
    await expect(exchangeGoogleCode(cfg, 'bad', 'verifier-xyz', f)).rejects.not.toThrow(
      /SENTINEL|AT-1|RT-1/,
    );
  });

  const gauth = (over: Partial<GoogleAuth> = {}): GoogleAuth => ({
    accessToken: 'AT-1',
    refreshToken: 'RT-1',
    scopes: Object.values(GOOGLE_SCOPES),
    pickedFileIds: ['d1', 'd2', 'gone'],
    ...over,
  });

  it('ingests Calendar, picked Drive files (docs as text, binaries as metadata) and Classroom coursework', async () => {
    const log: string[] = [];
    const f = fakeGoogle({ accessToken: 'AT-1', refreshToken: 'RT-1', log });
    const s = setup();
    const c = s.mk({
      id: 'conn_g',
      provider: 'google',
      variant: 'oauth',
      scopes: Object.values(GOOGLE_SCOPES),
    });
    const r = await syncConnection(
      { ...s.deps, full: true },
      c,
      createLiveGoogleConnector({ fetch: f, oauth: cfg }),
      gauth(),
    );
    expect(r.outcome).toBe('ok');
    const kinds = s.store
      .sourcesOfConnection('conn_g')
      .map((x) => x.kind)
      .sort();
    expect(kinds).toEqual(['classroom_item', 'gcal_event', 'gcal_event', 'gdoc', 'gdrive_file']);
    // The vanished picked file (404) is skipped, not a failure.
    expect(r.failed).toBe(0);
    const doc = s.store.sourcesOfConnection('conn_g').find((x) => x.kind === 'gdoc')!;
    expect(s.store.chunks(doc.id)[0]?.text).toContain('urchin density rose near the north reef');
    const pdf = s.store.sourcesOfConnection('conn_g').find((x) => x.kind === 'gdrive_file')!;
    expect(s.store.chunks(pdf.id)[0]?.text).toContain('Text is not extracted');
    const work = s.store.sourcesOfConnection('conn_g').find((x) => x.kind === 'classroom_item')!;
    expect(work.dueAt).toBe(Date.UTC(2026, 10, 5, 23, 59));
    // Only the scopes granted are used: without Drive and Classroom, no such call is made.
    log.length = 0;
    await createLiveGoogleConnector({ fetch: f }).listItems(
      gauth({ scopes: [GOOGLE_SCOPES.calendar] }),
    );
    expect(log.some((l) => l.includes('/drive/') || l.includes('classroom.googleapis.com'))).toBe(
      false,
    );
  });

  it('incremental Calendar pass asks for updatedMin from the cursor', async () => {
    const log: string[] = [];
    const f = fakeGoogle({ accessToken: 'AT-1', log });
    const s = setup();
    const c = s.mk({
      id: 'conn_g',
      provider: 'google',
      variant: 'oauth',
      scopes: [GOOGLE_SCOPES.calendar],
    });
    const conn = createLiveGoogleConnector({ fetch: f });
    await syncConnection(s.deps, c, conn, gauth({ scopes: [GOOGLE_SCOPES.calendar] }));
    log.length = 0;
    s.clock.advance(3_600_000);
    await syncConnection(s.deps, c, conn, gauth({ scopes: [GOOGLE_SCOPES.calendar] }));
    expect(log.find((l) => l.includes('/calendar/v3/'))).toContain('updatedMin=');
  });

  it('P16 refresh: success moves the token; invalid_grant is revoked; 429 is rate limited', async () => {
    const f = fakeGoogle({
      accessToken: 'AT-1',
      refreshToken: 'RT-1',
      issue: { access_token: 'AT-2' },
    });
    const conn = createLiveGoogleConnector({ fetch: f, oauth: cfg });
    const r = await conn.refresh!(gauth());
    expect(r.accessToken).toBe('AT-2');
    expect(r.expiresAt).toBeGreaterThan(Date.now());
    await expect(conn.refresh!(gauth({ refreshToken: undefined }))).rejects.toBeInstanceOf(
      ConnectorExpiredError,
    );
    const revoked = createLiveGoogleConnector({
      fetch: fakeGoogle({ accessToken: 'AT-1', refreshToken: 'RT-1', refreshInvalidGrant: true }),
      oauth: cfg,
    });
    await expect(revoked.refresh!(gauth())).rejects.toBeInstanceOf(ConnectorRevokedError);
  });

  it('error mapping: 401 -> revoked state on probe; 429 and quota 403 -> rate limit; plain 403 -> auth error', async () => {
    const stale = createLiveGoogleConnector({ fetch: fakeGoogle({ accessToken: 'OTHER' }) });
    expect(await stale.status(gauth())).toMatchObject({ state: 'revoked' });
    const slow = createLiveGoogleConnector({
      fetch: fakeGoogle({ accessToken: 'AT-1', rateLimitSeconds: 9 }),
    });
    await expect(slow.listItems(gauth({ scopes: [GOOGLE_SCOPES.calendar] }))).rejects.toMatchObject(
      { retryAfterMs: 9000 },
    );
    const quota = createLiveGoogleConnector({
      fetch: fakeGoogle({ accessToken: 'AT-1', calendarQuota: true }),
    });
    await expect(
      quota.listItems(gauth({ scopes: [GOOGLE_SCOPES.calendar] })),
    ).rejects.toBeInstanceOf(ConnectorRateLimitError);
  });

  it("P17 revoke calls Google's revoke endpoint (best effort) and never throws", async () => {
    const revoked: string[] = [];
    const conn = createLiveGoogleConnector({ fetch: fakeGoogle({ accessToken: 'AT-1', revoked }) });
    await conn.revoke(gauth());
    expect(revoked).toEqual(['revoked']);
    const down = createLiveGoogleConnector({
      fetch: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    await expect(down.revoke(gauth())).resolves.toBeUndefined();
  });
});
