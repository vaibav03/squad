import { describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { signToken } from '../auth';
import { createLogger } from '../log';
import { createTokenStore, parseTokenKey, TokenKeyError } from '../context/tokens';
import { openMemoryDb } from '@squad/core/node';
import { createFakeCanvasConnector, createFakeGoogleConnector, GOOGLE_SCOPES } from '@squad/brain';
import { contextServiceFor } from '../context/service';

const SECRET = 'auth-test';
const TOKEN_SENTINEL = 'CANVAS-PAT-SENTINEL-7c1e9b42';
const FEED_SENTINEL = 'feedsecret-SENTINEL-5d2a';
const FEED = `https://canvas.fixture.invalid/feeds/calendars/user_${FEED_SENTINEL}.ics`;
const TOKEN_SCOPE = ['canvas.api_token.read'];
const FEED_SCOPE = ['canvas.calendar_feed'];

function setup() {
  const hub = createHub({
    config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
  });
  const lines: string[] = [];
  hub.deps.log = createLogger('debug', (l) => lines.push(l));
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  const svc = contextServiceFor(hub.deps);
  const bodies: string[] = [];
  const call = async (method: string, path: string, sub: string | null, body?: unknown) => {
    const res = await hub.app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(sub
          ? {
              authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }).token}`,
            }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    bodies.push(text);
    return { status: res.status, json: JSON.parse(text || 'null') as any };
  };
  const connectCanvas = (sub: string, over: object = {}) =>
    call('POST', '/v1/connections', sub, {
      provider: 'canvas',
      variant: 'token',
      scopes: TOKEN_SCOPE,
      token: TOKEN_SENTINEL,
      baseUrl: 'https://canvas.fixture.invalid',
      ...over,
    });
  const search = (sub: string, q: string, extra = '') =>
    call('GET', `/v1/context/search?q=${encodeURIComponent(q)}${extra}`, sub);
  return { hub, svc, lines, bodies, call, connectCanvas, search };
}

const Q = 'when is the sampling distributions assignment due';

describe('connections: connect, sync, search, citation', () => {
  it('requires auth and refuses broad scopes, live mode and bad URLs', async () => {
    const { call } = setup();
    expect((await call('GET', '/v1/connections', null)).status).toBe(401);
    const body = { provider: 'google', scopes: ['https://www.googleapis.com/auth/drive'] };
    expect((await call('POST', '/v1/connections', 's_ana', body)).json.error.code).toBe(
      'scope_not_allowed',
    );
    expect(
      (
        await call('POST', '/v1/connections', 's_ana', {
          provider: 'google',
          scopes: ['https://mail.google.com/'],
        })
      ).status,
    ).toBe(400);
    const live = await call('POST', '/v1/connections', 's_ana', {
      provider: 'canvas',
      scopes: FEED_SCOPE,
      mode: 'live',
    });
    expect(live.status).toBe(501);
    expect(live.json.error.code).toBe('live_not_available');
    expect(
      (
        await call('POST', '/v1/connections', 's_ana', {
          provider: 'canvas',
          variant: 'feed',
          scopes: FEED_SCOPE,
          feedUrl: 'http://x.example/a.ics',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/connections', 's_ana', {
          provider: 'canvas',
          variant: 'feed',
          scopes: FEED_SCOPE,
          feedUrl: 'https://localhost/a.ics',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/connections', 's_ana', {
          provider: 'canvas',
          variant: 'feed',
          scopes: TOKEN_SCOPE,
          feedUrl: FEED,
        })
      ).status,
    ).toBe(400);
  });

  it('connects in labelled fixture mode and imports; search returns grounded chunks with citations', async () => {
    const { call, connectCanvas, search } = setup();
    const c = await connectCanvas('s_ana');
    expect(c.status).toBe(201);
    expect(c.json.connection).toMatchObject({
      provider: 'canvas',
      mode: 'fixture',
      status: 'live',
      degraded: false,
    });
    expect(c.json.connection.modeLabel).toMatch(/No real Canvas account is connected/);
    expect(c.json.connection.sources.total).toBe(5);
    expect(c.json.sync).toMatchObject({ outcome: 'ok', added: 5 });
    const list = await call('GET', '/v1/connections', 's_ana');
    expect(list.json.mode).toBe('fixture');
    expect(list.json.connections).toHaveLength(1);
    expect((await connectCanvas('s_ana')).status).toBe(409); // same account twice

    const r = await search('s_ana', Q, '&courseId=stat-101');
    expect(r.status).toBe(200);
    const top = r.json.results[0];
    expect(top).toMatchObject({
      kind: 'canvas_assignment',
      title: 'Assignment 3: Sampling Distributions',
      provenance: 'canvas:fixture',
      shared: false,
    });
    expect(top.citation.source).toMatchObject({
      kind: 'canvas_assignment',
      id: top.sourceId,
      anchor: top.anchor,
    });
    expect(top.url).toContain('/assignments/a301');
    expect(top.text).toContain('Due: 2026-11-02T23:59:00Z');

    // viewer contract: the citation's quote is verified, a fabricated one is not
    const q = encodeURIComponent(top.citation.quote);
    const src = await call(
      'GET',
      `/v1/context/source?id=${top.sourceId}&anchor=${top.anchor}&quote=${q}`,
      's_ana',
    );
    expect(src.json).toMatchObject({
      ok: true,
      sourceKind: 'canvas_assignment',
      quoteVerified: true,
      provenance: 'fixture',
      provider: 'canvas',
    });
    expect(src.json.externalUrl).toContain('canvas.fixture.invalid');
    const bad = await call(
      'GET',
      `/v1/context/source?id=${top.sourceId}&anchor=${top.anchor}&quote=${encodeURIComponent('Late work is forgiven for everyone')}`,
      's_ana',
    );
    expect(bad.json.quoteVerified).toBe(false);
    expect((await search('s_ana', Q)).json.results.length).toBeGreaterThan(0);
    expect((await call('GET', '/v1/context/search?q=', 's_ana')).status).toBe(400);
  });

  it('feed variant and google fixture connect with minimal scopes', async () => {
    const { call, svc } = setup();
    const f = await call('POST', '/v1/connections', 's_ana', {
      provider: 'canvas',
      variant: 'feed',
      scopes: FEED_SCOPE,
      feedUrl: FEED,
    });
    expect(f.status).toBe(201);
    expect(f.json.connection.sources.byKind).toEqual({ canvas_event: 3 });
    const g = await call('POST', '/v1/connections', 's_ana', {
      provider: 'google',
      scopes: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.drive, GOOGLE_SCOPES.classroomWork],
      pickedFileIds: ['doc-notes-1'],
    });
    expect(g.status).toBe(201);
    expect(g.json.connection.sources.byKind).toEqual({ gcal_event: 2, gdoc: 1, classroom_item: 1 });
    const hits = await call(
      'GET',
      `/v1/context/search?q=${encodeURIComponent('why standard error shrinks sample size')}`,
      's_ana',
    );
    expect(hits.json.results[0]).toMatchObject({ kind: 'gdoc', provenance: 'google:fixture' });
    expect(svc.store.connectionsOf('s_ana')).toHaveLength(2);
  });
});

describe('privacy isolation', () => {
  it('another student, even in the same squad, never reads a private source; opt-in shares to that squad only', async () => {
    const { call, connectCanvas, search } = setup();
    const c = await connectCanvas('s_ana');
    const id = c.json.connection.id as string;
    const mine = (await search('s_ana', Q)).json.results[0];
    expect((await search('s_ben', Q)).json.results).toEqual([]);
    expect((await search('s_zed', Q)).json.results).toEqual([]);
    expect(
      (await call('GET', `/v1/context/source?id=${mine.sourceId}&anchor=${mine.anchor}`, 's_ben'))
        .status,
    ).toBe(404);
    expect((await call('GET', '/v1/connections', 's_ben')).json.connections).toEqual([]);
    expect((await call('GET', `/v1/connections/${id}/sources`, 's_ben')).status).toBe(404);
    expect((await call('POST', `/v1/connections/${id}/sync`, 's_ben')).status).toBe(404);
    expect((await call('DELETE', `/v1/connections/${id}`, 's_ben')).status).toBe(404);
    expect(
      (
        await call('POST', `/v1/connections/${id}/share`, 's_ben', {
          squadId: 'sq_demo',
          all: true,
        })
      ).status,
    ).toBe(404);

    // cannot share into a squad the owner is not in
    expect(
      (
        await call('POST', `/v1/connections/${id}/share`, 's_ana', {
          squadId: 'sq_other',
          all: true,
        })
      ).status,
    ).toBe(404);
    // opt in for the demo squad
    const sh = await call('POST', `/v1/connections/${id}/share`, 's_ana', {
      squadId: 'sq_demo',
      all: true,
    });
    expect(sh.status).toBe(200);
    expect(sh.json.count).toBe(4); // the calendar-kind announcement is excluded from `all`
    const seen = (await search('s_ben', Q)).json.results[0];
    expect(seen).toMatchObject({ sourceId: mine.sourceId, shared: true });
    expect(
      (await call('GET', `/v1/context/source?id=${mine.sourceId}&anchor=${mine.anchor}`, 's_ben'))
        .json.ok,
    ).toBe(true);
    expect((await search('s_zed', Q)).json.results).toEqual([]); // other squad still sees nothing
    expect(
      (await search('s_ben', 'midterm review session moved Thursday room')).json.results,
    ).toEqual([]);
    const sources = (await call('GET', `/v1/connections/${id}/sources`, 's_ana')).json.sources as {
      id: string;
      kind: string;
    }[];
    const ann = sources.find((s) => s.kind === 'canvas_event')!;
    await call('POST', `/v1/connections/${id}/share`, 's_ana', {
      squadId: 'sq_demo',
      sourceIds: [ann.id],
    });
    expect(
      (await search('s_ben', 'midterm review session moved Thursday room')).json.results.length,
    ).toBeGreaterThan(0);
    // opt out again
    await call('POST', `/v1/connections/${id}/share`, 's_ana', {
      squadId: 'sq_demo',
      all: true,
      shared: false,
    });
    await call('POST', `/v1/connections/${id}/share`, 's_ana', {
      squadId: 'sq_demo',
      sourceIds: [ann.id],
      shared: false,
    });
    expect((await search('s_ben', Q)).json.results).toEqual([]);
  });
});

describe('revoke, purge, expiry, degraded', () => {
  it('DELETE revokes upstream, deletes tokens and all derived rows; owner sees "revoked", others "not found"', async () => {
    const { call, connectCanvas, search, svc, hub } = setup();
    const id = (await connectCanvas('s_ana')).json.connection.id as string;
    const hit = (await search('s_ana', Q)).json.results[0];
    await call('POST', `/v1/connections/${id}/share`, 's_ana', { squadId: 'sq_demo', all: true });
    const del = await call('DELETE', `/v1/connections/${id}`, 's_ana');
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ status: 'revoked', purged: { sources: 5 } });
    expect(
      (svc.connectors.canvas as ReturnType<typeof createFakeCanvasConnector>).controls.revoked,
    ).toBe(1);
    for (const t of ['ctx_sources', 'ctx_chunks', 'ctx_shares', 'ctx_tokens'])
      expect((hub.deps.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n).toBe(0);
    expect((await search('s_ana', Q)).json.results).toEqual([]);
    expect((await search('s_ben', Q)).json.results).toEqual([]);
    const own = await call(
      'GET',
      `/v1/context/source?id=${hit.sourceId}&anchor=${hit.anchor}`,
      's_ana',
    );
    expect(own.json).toEqual({ ok: false, reason: 'revoked' });
    expect(
      (await call('GET', `/v1/context/source?id=${hit.sourceId}&anchor=${hit.anchor}`, 's_ben'))
        .status,
    ).toBe(404);
    const list = (await call('GET', '/v1/connections', 's_ana')).json.connections;
    expect(list[0]).toMatchObject({ status: 'revoked', sources: { total: 0 } });
    expect((await call('POST', `/v1/connections/${id}/sync`, 's_ana')).status).toBe(409);
    expect((await call('DELETE', `/v1/connections/${id}`, 's_ana')).status).toBe(200); // idempotent
    expect((await call('DELETE', `/v1/connections/${id}?remove=1`, 's_ana')).json).toEqual({
      removed: true,
    });
    expect((await call('GET', '/v1/connections', 's_ana')).json.connections).toEqual([]);
  });

  it('upstream revocation seen at sync purges everything', async () => {
    const { call, connectCanvas, svc, search } = setup();
    const id = (await connectCanvas('s_ana')).json.connection.id as string;
    (svc.connectors.canvas as ReturnType<typeof createFakeCanvasConnector>).controls.set('revoked');
    const r = await call('POST', `/v1/connections/${id}/sync`, 's_ana');
    expect(r.json.sync.outcome).toBe('revoked');
    expect(r.json.connection.status).toBe('revoked');
    expect((await search('s_ana', Q)).json.results).toEqual([]);
  });

  it('expired credential: status expired, sync stops (no upstream call); refresh renews a Google grant', async () => {
    const { call, svc, hub } = setup();
    const google = svc.connectors.google as ReturnType<typeof createFakeGoogleConnector>;
    const g = await call('POST', '/v1/connections', 's_ana', {
      provider: 'google',
      scopes: [GOOGLE_SCOPES.calendar],
    });
    const id = g.json.connection.id as string;

    // refresh path
    svc.store.patchConnection(id, { expiresAt: hub.deps.now() - 1000 });
    const ok = (await call('GET', '/v1/connections', 's_ana')).json.connections[0];
    expect(ok.status).toBe('live');
    expect(google.controls.calls).toContain('refresh');
    expect(ok.expiresAt).toBeGreaterThan(hub.deps.now());

    // expiry path
    google.controls.refreshFails = true;
    svc.store.patchConnection(id, { expiresAt: hub.deps.now() - 1000 });
    const ex = (await call('GET', '/v1/connections', 's_ana')).json.connections[0];
    expect(ex).toMatchObject({ status: 'expired', canSync: false });
    expect(ex.statusLabel).toMatch(/Expired/);
    expect(ex.sources.total).toBe(2); // imported data is kept, clearly labelled stale
    const n = google.controls.calls.length;
    const sync = await call('POST', `/v1/connections/${id}/sync`, 's_ana');
    expect(sync.status).toBe(409);
    expect(sync.json.error.code).toBe('connection_expired');
    expect(google.controls.calls.length).toBe(n);
  });

  it('upstream 401 marks the connection degraded with an honest label and keeps data', async () => {
    const { call, connectCanvas, svc, search } = setup();
    const id = (await connectCanvas('s_ana')).json.connection.id as string;
    (svc.connectors.canvas as ReturnType<typeof createFakeCanvasConnector>).controls.set(
      'unauthorized',
    );
    const r = await call('POST', `/v1/connections/${id}/sync`, 's_ana');
    expect(r.json.sync.outcome).toBe('degraded');
    expect(r.json.connection).toMatchObject({ status: 'error', degraded: true, canSync: true });
    expect(r.json.connection.statusLabel).toMatch(/^Degraded/);
    expect((await search('s_ana', Q)).json.results.length).toBeGreaterThan(0);
    (svc.connectors.canvas as ReturnType<typeof createFakeCanvasConnector>).controls.set('ok');
    const back = await call('POST', `/v1/connections/${id}/sync`, 's_ana');
    expect(back.json.connection).toMatchObject({ status: 'live', degraded: false });
  });
});

describe('tokens never leave the server', () => {
  it('sentinel scan: no response, log line or plaintext DB byte contains a token, feed URL or fixture grant', async () => {
    const { call, connectCanvas, svc, lines, bodies, hub, search } = setup();
    const a = await connectCanvas('s_ana');
    const f = await call('POST', '/v1/connections', 's_ben', {
      provider: 'canvas',
      variant: 'feed',
      scopes: FEED_SCOPE,
      feedUrl: FEED,
    });
    await call('POST', '/v1/connections', 's_ana', {
      provider: 'google',
      scopes: [GOOGLE_SCOPES.calendar],
    });
    await call('GET', '/v1/connections', 's_ana');
    await call('POST', `/v1/connections/${a.json.connection.id}/sync`, 's_ana');
    await search('s_ana', Q);
    (svc.connectors.canvas as ReturnType<typeof createFakeCanvasConnector>).controls.set(
      'unauthorized',
    );
    await call('POST', `/v1/connections/${a.json.connection.id}/sync`, 's_ana');
    await call('DELETE', `/v1/connections/${f.json.connection.id}`, 's_ana');
    await call('POST', '/v1/connections', 's_ana', {
      provider: 'canvas',
      variant: 'token',
      scopes: TOKEN_SCOPE,
      token: TOKEN_SENTINEL,
      baseUrl: 'http://insecure.example',
    });

    const secrets = [TOKEN_SENTINEL, FEED_SENTINEL, 'fixture-access-', 'fixture-refresh-'];
    const haystack = [...bodies, ...lines];
    expect(lines.length).toBeGreaterThan(0);
    for (const s of secrets) for (const h of haystack) expect(h).not.toContain(s);

    // encrypted at rest: ciphertext present, plaintext absent from every ctx table, round-trips through the store
    const raw = JSON.stringify([
      hub.deps.db
        .prepare('SELECT * FROM ctx_tokens')
        .all()
        .map((r) => Buffer.from(JSON.stringify(r)).toString('latin1')),
      hub.deps.db.prepare('SELECT * FROM ctx_connections').all(),
      hub.deps.db.prepare('SELECT * FROM ctx_sources').all(),
      hub.deps.db.prepare('SELECT * FROM ctx_chunks').all(),
    ]);
    for (const s of secrets) expect(raw).not.toContain(s);
    const rows = hub.deps.db.prepare('SELECT iv, tag, ct FROM ctx_tokens').all() as {
      iv: Buffer;
      tag: Buffer;
      ct: Buffer;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.ct.toString('latin1')).not.toContain('SENTINEL');
    expect(svc.tokens.get(a.json.connection.id)).toMatchObject({ apiToken: TOKEN_SENTINEL });
  });
});

describe('token store', () => {
  const mk = (over: Partial<Parameters<typeof createTokenStore>[1]> = {}) =>
    createTokenStore(openMemoryDb(), {
      fallbackSecret: 'fallback',
      production: false,
      now: () => 1,
      ...over,
    });
  const KEY = Buffer.alloc(32, 7).toString('base64');

  it('round-trips, uses a fresh IV, and binds ciphertext to its connection id', () => {
    const db = openMemoryDb();
    const s = createTokenStore(db, {
      keyEnv: KEY,
      fallbackSecret: 'x',
      production: true,
      now: () => 1,
    });
    expect(s.keyFromEnv).toBe(true);
    s.put('c1', { accessToken: 'A' });
    s.put('c1b', { accessToken: 'A' });
    const [r1, r2] = db.prepare('SELECT iv, ct FROM ctx_tokens ORDER BY connection_id').all() as {
      iv: Buffer;
      ct: Buffer;
    }[];
    expect(r1!.iv.equals(r2!.iv)).toBe(false);
    expect(s.get('c1')).toEqual({ accessToken: 'A' });
    db.prepare("UPDATE ctx_tokens SET connection_id='c2' WHERE connection_id='c1'").run();
    expect(() => s.get('c2')).toThrow();
    s.delete('c2');
    expect(s.get('c2')).toBeUndefined();
  });
  it('rejects a malformed key; production without a key refuses to store; dev derives one', () => {
    expect(() => mk({ keyEnv: 'short' })).toThrow(TokenKeyError);
    expect(() => mk({ production: true }).put('c', { accessToken: 'x' })).toThrow(TokenKeyError);
    const dev = mk();
    dev.put('c', { accessToken: 'x' });
    expect(dev.keyFromEnv).toBe(false);
    expect(parseTokenKey('00'.repeat(32))).toHaveLength(32);
    expect(parseTokenKey(undefined)).toBeUndefined();
  });
});
