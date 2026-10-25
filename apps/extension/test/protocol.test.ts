import { describe, expect, it, vi } from 'vitest';
import { createExtensionAuth } from '../src/auth';
import { CanvasAccessError, type CanvasSyncPayload } from '../src/canvas';
import { createHandler, deriveSync, isExactHttpsOrigin } from '../src/protocol';
import { memoryStateStore, type ExtState } from '../src/state';

const SENTINEL = 'SENTINEL-EXT-TOKEN-do-not-leak';
const HUB = 'http://hub.test';
const ORIGIN = 'https://canvas.school.test';
const seen = { origin: ORIGIN, canvasUserId: '7', name: 'Sam', primary_email: 's@x.test' };
const payload: CanvasSyncPayload = {
  origin: ORIGIN,
  canvas_user_id: '7',
  courses: [],
  assignments: [],
  files: [],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(
  opts: {
    state?: Partial<ExtState>;
    hub?: (path: string, init: RequestInit) => Response;
    collect?: () => Promise<CanvasSyncPayload>;
  } = {},
) {
  const store = memoryStateStore({
    session: { token: SENTINEL, userId: 'u1', expiresAt: Date.now() + 3_600_000 },
    accounts: [seen],
    ...opts.state,
  });
  const calls: { path: string; auth: string | undefined; body: unknown }[] = [];
  const logs: unknown[][] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace(HUB, '');
    calls.push({
      path,
      auth: (init.headers as Record<string, string>).Authorization,
      body: init.body ? JSON.parse(init.body as string) : null,
    });
    return (
      opts.hub ??
      ((p) =>
        p.endsWith('/register')
          ? json(201, { connection: { id: 'conn_1' } })
          : json(200, { ok: true }))
    )(path, init);
  }) as unknown as typeof fetch;
  const handle = createHandler({
    namespace: 'squad',
    hubBase: HUB,
    store,
    auth: createExtensionAuth(HUB, store, f),
    fetch: f,
    canvas: { collect: opts.collect ?? (async () => payload) },
    openSignIn: vi.fn(),
    log: (...a) => logs.push(a),
  });
  return { handle, store, calls, logs };
}
const authorize = (extra = {}) => ({
  type: 'squad:canvas-authorize',
  canvasUserId: '7',
  origin: ORIGIN,
  userId: 'u1',
  ...extra,
});
const ctx = { senderOrigin: 'http://localhost:5330' };

describe('bridge protocol (P7, P8, P23)', () => {
  it('ping and unknown', async () => {
    const { handle } = setup();
    expect(await handle({ type: 'squad:ping' }, ctx)).toEqual({ ok: true });
    expect(await handle({ type: 'nook:ping' }, ctx)).toBeNull();
    expect(await handle('x', ctx)).toBeNull();
  });
  it('exact https origin rule', () => {
    expect(isExactHttpsOrigin('https://a.test')).toBe(true);
    for (const o of ['http://a.test', 'https://a.test/', 'https://a.test/x', 5, 'nope'])
      expect(isExactHttpsOrigin(o)).toBe(false);
  });
  it('status lists seen accounts only with https origins', async () => {
    const { handle } = setup({ state: { accounts: [seen, { ...seen, origin: 'http://x.test' }] } });
    const r = (await handle({ type: 'squad:canvas-status' }, ctx)) as {
      accounts: unknown[];
      squadUserId: string;
      signInUrl: string;
    };
    expect(r.accounts).toHaveLength(1);
    expect(r.squadUserId).toBe('u1');
    expect(r.signInUrl).toBe('http://localhost:5330/settings');
  });
  it('authorize error codes', async () => {
    expect(await setup().handle(authorize({ origin: 'http://x' }), ctx)).toMatchObject({
      error: 'canvas_origin_not_allowed',
    });
    expect(await setup().handle(authorize({ canvasUserId: 5 }), ctx)).toMatchObject({
      error: 'canvas_session_changed',
    });
    expect(await setup({ state: { session: null } }).handle(authorize(), ctx)).toMatchObject({
      error: 'squad_not_signed_in',
    });
    expect(await setup().handle(authorize({ userId: 'u2' }), ctx)).toMatchObject({
      error: 'squad_account_mismatch',
      squadUserId: 'u1',
    });
    expect(
      await setup({ state: { allowedOrigins: ['https://other.test'] } }).handle(authorize(), ctx),
    ).toMatchObject({ error: 'canvas_origin_not_allowed' });
    expect(await setup({ state: { accounts: [] } }).handle(authorize(), ctx)).toMatchObject({
      error: 'canvas_session_changed',
    });
  });
  it('hub registration conflicts map through', async () => {
    for (const [status, code] of [
      [409, 'canvas_account_already_bound'],
      [409, 'canvas_account_conflict'],
      [400, 'canvas_origin_not_allowed'],
    ] as const) {
      const { handle } = setup({ hub: () => json(status, { error: { code } }) });
      expect(await handle(authorize(), ctx)).toMatchObject({ ok: false, error: code });
    }
    const { handle } = setup({ hub: () => json(500, {}) });
    expect(await handle(authorize(), ctx)).toMatchObject({ error: 'canvas_registration_failed' });
  });
  it('a hub 401 clears the session and reports not signed in', async () => {
    const { handle, store } = setup({ hub: () => json(401, {}) });
    expect(await handle(authorize(), ctx)).toMatchObject({ error: 'squad_not_signed_in' });
    expect((await store.get()).session).toBeNull();
  });
  it('success registers, syncs and reports idle ok', async () => {
    const { handle, calls, store } = setup();
    const r = (await handle(authorize(), ctx)) as {
      ok: boolean;
      sync: { phase: string; lastOutcome: string };
    };
    expect(r.ok).toBe(true);
    expect(r.sync).toMatchObject({ phase: 'idle', lastOutcome: 'ok' });
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/connections/canvas/register',
      '/v1/connections/conn_1/canvas-sync',
    ]);
    expect(calls[0]!.body).toEqual({
      canvas_user_id: '7',
      canvas_origin: ORIGIN,
      name: 'Sam',
      primary_email: 's@x.test',
    });
    expect((await store.get()).bound?.connectionId).toBe('conn_1');
  });
  it('maps Canvas 401/429 and hub errors to sync outcomes', async () => {
    for (const [err, want] of [
      [new CanvasAccessError('expired', 401), 'expired'],
      [new CanvasAccessError('rate_limited', 429), 'rate_limited'],
      [new Error('x'), 'error'],
    ] as const) {
      const { handle } = setup({
        collect: async () => {
          throw err;
        },
      });
      const r = (await handle(authorize(), ctx)) as { ok: boolean; sync: { lastOutcome: string } };
      expect(r.ok).toBe(true);
      expect(r.sync.lastOutcome).toBe(want);
    }
    const { handle } = setup({
      hub: (p) =>
        p.endsWith('/register')
          ? json(201, { connection: { id: 'c' } })
          : json(409, { error: { code: 'canvas_session_mismatch' } }),
    });
    expect(
      ((await handle(authorize(), ctx)) as { sync: { lastOutcome: string } }).sync.lastOutcome,
    ).toBe('error');
  });
  it('deriveSync phases', () => {
    const base = {
      bound: { canvasUserId: '7', origin: ORIGIN, userId: 'u1', connectionId: 'c', boundAt: 1 },
      lastSyncOutcome: null,
      lastSyncFinishedAt: null,
      syncFinishedAt: null,
    } as unknown as ExtState;
    expect(deriveSync({ ...base, bound: null, syncStartedAt: null })).toBeNull();
    expect(deriveSync({ ...base, syncStartedAt: 5 })?.phase).toBe('syncing');
    expect(deriveSync({ ...base, syncStartedAt: 5, syncFinishedAt: 9 })?.phase).toBe('idle');
  });
});

describe('secrets never leak (P20)', () => {
  it('token absent from page replies and logs, sent only as Authorization header to the hub', async () => {
    const outputs: string[] = [];
    for (const hub of [undefined, () => json(500, {}), () => json(401, {})]) {
      const { handle, logs, calls } = setup(hub ? { hub } : {});
      for (const m of [{ type: 'squad:canvas-status' }, authorize(), { type: 'squad:ping' }])
        outputs.push(JSON.stringify(await handle(m, ctx)));
      outputs.push(JSON.stringify(logs));
      for (const c of calls) expect(JSON.stringify(c.body)).not.toContain(SENTINEL);
    }
    const throwing = setup({
      collect: async () => {
        throw new Error(`boom ${SENTINEL}`);
      },
    });
    outputs.push(
      JSON.stringify(await throwing.handle(authorize(), ctx)),
      JSON.stringify(throwing.logs),
    );
    for (const o of outputs) expect(o).not.toContain(SENTINEL);
  });
});

describe('extension auth (pairing)', () => {
  it('pair stores the scoped token; expired token reads as signed out', async () => {
    const store = memoryStateStore();
    let t = 1000;
    const f = (async () =>
      json(200, { token: 'tok', userId: 'u1', expiresAt: 5000 })) as unknown as typeof fetch;
    const auth = createExtensionAuth(HUB, store, f, () => t);
    await auth.pair('CODE');
    expect(await auth.getToken()).toBe('tok');
    t = 6000;
    expect(await auth.getToken()).toBeNull();
    expect((await store.get()).session).toBeNull();
  });
  it('a rejected code surfaces the hub error code', async () => {
    const f = (async () =>
      json(401, { error: { code: 'pairing_invalid' } })) as unknown as typeof fetch;
    await expect(createExtensionAuth(HUB, memoryStateStore(), f).pair('x')).rejects.toThrow(
      'pairing_invalid',
    );
  });
});
