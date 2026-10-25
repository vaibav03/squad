import { describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { DEFAULT_RULES } from './index';
import { memoryStore, sqliteStore } from './rate-limit';
import { openDb } from '@squad/core/node';

const ORIGIN = 'http://localhost:5350';

function hub(rules?: unknown[]) {
  return createHub({
    config: {
      authSecret: 'auth-test',
      internalSecret: 'x',
      seed: false,
      sim: false,
      production: false,
      logLevel: 'silent',
      dbPath: ':memory:',
      corsOrigins: [ORIGIN],
    },
    security: { configCheck: 'skip', ...(rules ? { rules: rules as never } : {}) },
  });
}

describe('hub rate limits for interactive use', () => {
  const rule = (name: string) => DEFAULT_RULES.find((r) => r.name === name)!;
  const perMin = (name: string) => (rule(name).limit * 60_000) / rule(name).windowMs;

  it('reads are generous, per IP and per user', () => {
    expect(perMin('api-ip')).toBeGreaterThanOrEqual(300);
    expect(perMin('api-user')).toBeGreaterThanOrEqual(300);
    expect(perMin('students')).toBeGreaterThanOrEqual(300);
    expect(perMin('stream-token')).toBeGreaterThanOrEqual(120);
    expect(rule('api-user').by).toBe('user'); // keyed on the session when there is one
  });

  it('abuse limits stay: auth, uploads, calls, LLM routes, internal events', () => {
    expect(perMin('login')).toBeLessThanOrEqual(120);
    expect(rule('upload-course').limit).toBeLessThanOrEqual(10);
    expect(rule('upload-cal').limit).toBeLessThanOrEqual(20);
    expect(rule('call-start').limit).toBeLessThanOrEqual(20);
    expect(rule('council-ask').limit).toBeLessThanOrEqual(12);
    expect(rule('chat-send').limit).toBeLessThanOrEqual(60);
    expect(rule('internal').limit).toBeLessThanOrEqual(6000);
    expect(rule('internal').by).toBe('ip');
  });

  it('one address can load pages without being throttled (600 reads in a minute)', async () => {
    const h = hub();
    let throttled = 0;
    for (let i = 0; i < 600; i++) {
      const r = await h.app.request('/v1/status', { headers: { origin: ORIGIN } });
      if (r.status === 429) throttled++;
    }
    expect(throttled).toBe(0);
    await h.close();
  });

  it('a 429 carries Retry-After, retryAfterS and CORS headers (so the browser can read it)', async () => {
    const h = hub([
      { name: 't', method: 'GET', path: '/v1/status', limit: 2, windowMs: 30_000, by: 'ip' },
    ]);
    const get = () => h.app.request('/v1/status', { headers: { origin: ORIGIN } });
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    const r = await get();
    expect(r.status).toBe(429);
    const retry = Number(r.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(30);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(r.headers.get('access-control-expose-headers')?.toLowerCase()).toContain('retry-after');
    const body = (await r.json()) as { error: { code: string; retryAfterS: number } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterS).toBe(retry);
    await h.close();
  });
});

describe('chat limits only count sends and uploads', () => {
  it('rules match exact paths, so page-load calls (file-token, history) are never counted as sends', () => {
    const send = DEFAULT_RULES.find((r) => r.name === 'chat-send')!;
    const up = DEFAULT_RULES.find((r) => r.name === 'chat-upload')!;
    expect(send.path).toBe('/v1/chat/send');
    expect(up.path).toBe('/v1/chat/upload');
    expect(send.limit).toBeLessThanOrEqual(60);
    expect(up.limit).toBeLessThanOrEqual(30);
  });

  it('120 file-token calls in a minute from one account are not throttled', async () => {
    const h = hub();
    // the rate limiter only needs a valid bearer subject (no seeded student required)
    const { signToken } = await import('../auth');
    const { token } = signToken(
      'auth-test',
      { kind: 'bearer', sub: 's_ana', ttlMs: 60_000 },
      Date.now(),
    );
    let limited = 0;
    for (let i = 0; i < 120; i++) {
      const r = await h.app.request('/v1/chat/file-token', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      if (r.status === 429) limited++;
    }
    expect(limited).toBe(0);
    await h.close();
  });
});

describe('store ttl', () => {
  it.each([
    ['memory', () => memoryStore()],
    ['sqlite', () => sqliteStore(openDb(':memory:'))],
  ] as const)('%s reports the time left in the window', (_n, make) => {
    const s = make();
    expect(s.ttl('k', 1000, 0)).toBe(0);
    s.hit('k', 1000, 100);
    expect(s.ttl('k', 1000, 400)).toBe(700);
    expect(s.ttl('k', 1000, 1200)).toBe(0);
  });
});
