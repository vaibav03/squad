import { signToken } from '../auth';
import { describe, expect, it } from 'vitest';
import { createHub } from '../app';

const SECRET = 'oauth-origin-secret-0123456789abcdef';

function setup(
  over: { production?: boolean; publicWebUrl?: string | null; now?: () => number } = {},
) {
  let t = Date.parse('2026-10-25T12:00:00Z');
  const now = over.now ?? (() => t);
  const hub = createHub({
    config: {
      seed: true,
      sim: false,
      authSecret: SECRET,
      logLevel: 'silent',
      baseUrl: 'http://localhost:8930',
      corsOrigins: ['http://localhost:5173', 'https://squad.example.edu'],
      webUrl: 'http://localhost:5173',
      publicWebUrl:
        over.publicWebUrl === undefined ? 'https://squad.example.edu' : over.publicWebUrl,
      ...(over.production !== undefined ? { production: over.production } : {}),
    },
    now,
  });
  const tok = signToken(SECRET, { kind: 'bearer', sub: 's_ana', ttlMs: 3_600_000 }, now()).token;
  const authorize = async (headers: Record<string, string> = {}, qs = '') => {
    const r = await hub.app.request(
      `/v1/connections/google/authorize?return_to=/squad/connections${qs}`,
      {
        headers: { authorization: `Bearer ${tok}`, ...headers },
      },
    );
    const j = (await r.json()) as { authorization_url: string };
    return new URL(j.authorization_url).searchParams.get('state')!;
  };
  const callback = (state: string, q = 'code=sim') =>
    hub.app.request(`/oauth/google/callback?state=${encodeURIComponent(state)}&${q}`, {
      redirect: 'manual',
    });
  return { hub, authorize, callback, advance: (ms: number) => (t += ms) };
}

describe('Google OAuth callback redirects to the origin that started the flow', () => {
  it('authorize from :5290 -> callback redirects to :5290 (not the default :5173)', async () => {
    const { authorize, callback } = setup();
    const state = await authorize({ origin: 'http://localhost:5290' });
    const r = await callback(state);
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(to.origin).toBe('http://localhost:5290');
    expect(to.pathname).toBe('/squad/connections');
    expect(to.searchParams.get('status')).toBe('connected');
    expect(to.searchParams.get('mode')).toBe('fixture');
  });

  it('an explicit return_origin works when there is no Origin header; the header wins when both are sent', async () => {
    const a = setup();
    const r1 = await a.callback(await a.authorize({}, '&return_origin=http://127.0.0.1:5291'));
    expect(new URL(r1.headers.get('location')!).origin).toBe('http://127.0.0.1:5291');
    const r2 = await a.callback(
      await a.authorize(
        { origin: 'http://localhost:5290' },
        '&return_origin=http://localhost:5555',
      ),
    );
    expect(new URL(r2.headers.get('location')!).origin).toBe('http://localhost:5290');
  });

  it('hostile or unknown origins fall back to PUBLIC_WEB_URL', async () => {
    const { authorize, callback } = setup();
    for (const o of [
      'https://evil.test',
      'http://localhost.evil.test:5290',
      'javascript:alert(1)',
      'http://localhost:5290/path',
      'http://user:pw@localhost:5290',
      'null',
    ]) {
      const r = await callback(await authorize({ origin: o }));
      expect(new URL(r.headers.get('location')!).origin).toBe('https://squad.example.edu');
    }
    const r = await callback(await authorize({}, '&return_origin=https://evil.test'));
    expect(new URL(r.headers.get('location')!).origin).toBe('https://squad.example.edu');
  });

  it('a configured CORS origin is allowed in any mode', async () => {
    const { authorize, callback } = setup({ production: false });
    const r = await callback(await authorize({ origin: 'https://squad.example.edu' }));
    expect(new URL(r.headers.get('location')!).origin).toBe('https://squad.example.edu');
  });

  it('no allowed origin and no PUBLIC_WEB_URL: a plain hub page, never a guessed redirect', async () => {
    const { authorize, callback } = setup({ publicWebUrl: null });
    const r = await callback(await authorize({ origin: 'https://evil.test' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBeNull();
    const html = await r.text();
    expect(html).toContain('Connected, return to the app');
    expect(html).toContain('PUBLIC_WEB_URL');
  });

  it('production ignores the localhost wildcard', async () => {
    const { authorize, callback } = setup({ production: true as const });
    const r = await callback(await authorize({ origin: 'http://localhost:5290' }));
    expect(new URL(r.headers.get('location')!).origin).toBe('https://squad.example.edu');
  });

  it('tampered, unknown, replayed and expired states are rejected', async () => {
    const { authorize, callback, advance } = setup();
    const state = await authorize({ origin: 'http://localhost:5290' });
    expect((await callback(state.slice(0, -2) + 'xx')).status).toBe(400);
    expect((await callback('gst_notarealstate0000')).status).toBe(400);
    expect((await callback(state)).status).toBe(302);
    expect((await callback(state)).status).toBe(400);
    const s2 = await authorize({ origin: 'http://localhost:5290' });
    advance(31 * 60_000);
    expect((await callback(s2)).status).toBe(400);
  });

  it('a denied consent also returns to the starting origin', async () => {
    const { authorize, callback } = setup();
    const r = await callback(
      await authorize({ origin: 'http://localhost:5290' }),
      'error=access_denied',
    );
    const to = new URL(r.headers.get('location')!);
    expect(to.origin).toBe('http://localhost:5290');
    expect(to.searchParams.get('status')).toBe('error');
  });
});

describe('demo consent page', () => {
  it('Allow and Cancel both go through the same state record', async () => {
    const { hub, authorize } = setup();
    const state = await authorize({ origin: 'http://localhost:5290' });
    const html = await (
      await hub.app.request(`/v1/connections/google/sim-consent?state=${encodeURIComponent(state)}`)
    ).text();
    expect(html).toContain('Allow (demo)');
    expect(html.match(new RegExp(encodeURIComponent(state), 'g'))?.length).toBe(2);
    expect(html).not.toMatch(/code_verifier|5173/);
  });
});

describe('invite links use the asking web origin when allowed', () => {
  it('web-origin helpers', async () => {
    const { webBaseFor, isAllowedWebOrigin } = await import('../web-origin');
    const cfg = {
      corsOrigins: ['http://localhost:5173'],
      production: false,
      publicWebUrl: 'https://squad.example.edu',
      webUrl: 'http://localhost:5173',
    } as never;
    expect(webBaseFor(cfg, 'http://localhost:5290')).toBe('http://localhost:5290');
    expect(webBaseFor(cfg, 'https://evil.test')).toBe('https://squad.example.edu');
    expect(
      isAllowedWebOrigin({ ...(cfg as object), production: true } as never, 'http://localhost:1'),
    ).toBeNull();
  });
});
