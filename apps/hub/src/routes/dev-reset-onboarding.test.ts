import { describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { signToken } from '../auth';

const SECRET = 'reset-onboard-secret-0123456789abcdef';
const T0 = Date.UTC(2026, 10, 3, 9);

function setup(extra: Record<string, unknown> = {}) {
  const hub = createHub({
    config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent', ...extra },
    now: () => T0,
  });
  const call = async (method: string, path: string, sub: string, body?: unknown) => {
    const res = await hub.app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }, T0).token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  return { call };
}
const demo = { provider: 'canvas', variant: 'demo', scopes: ['canvas.demo_workspace'] };

describe('POST /v1/dev/reset-onboarding', () => {
  it('resets only the caller: own connections and skip are gone, another user keeps theirs', async () => {
    const { call } = setup();
    await call('POST', '/v1/connections', 's_ana', demo);
    await call('POST', '/v1/connections', 's_ben', demo);
    await call('POST', '/v1/onboarding/skip', 's_ana');
    const r = await call('POST', '/v1/dev/reset-onboarding', 's_ana');
    expect(r.status).toBe(200);
    expect(r.json.connectionsRemoved).toBe(1);
    expect(r.json.skipped).toBeNull();
    expect((await call('GET', '/v1/connections', 's_ana')).json.connections).toHaveLength(0);
    expect((await call('GET', '/v1/connections', 's_ben')).json.connections).toHaveLength(1);
    expect((await call('GET', '/v1/onboarding', 's_ana')).json.nextStep).toBe('connect');
  });
  it('is unavailable when dev sign-in is off (production)', async () => {
    const { call } = setup({ devLogin: false });
    expect((await call('POST', '/v1/dev/reset-onboarding', 's_ana')).status).toBe(404);
  });
});
