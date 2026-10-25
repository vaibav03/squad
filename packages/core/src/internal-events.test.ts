import { describe, expect, it, vi } from 'vitest';
import { postEvent, type VillageEvent } from './index';

const ev: VillageEvent = { t: 'agent.state', agent: 'dean', state: 'idle' };
const res = (status: number) => new Response('', { status });

describe('postEvent', () => {
  it('POSTs the event with the internal header', async () => {
    const f = vi.fn(async () => res(200));
    const r = await postEvent(ev, { baseUrl: 'http://hub:1/', secret: 's3', fetch: f as any });
    expect(r).toMatchObject({ ok: true, status: 200, attempts: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://hub:1/internal/events');
    expect((init.headers as Record<string, string>)['X-Nook-Internal']).toBe('s3');
    expect(JSON.parse(init.body as string)).toEqual(ev);
  });

  it('reads secret and base url from env', async () => {
    vi.stubEnv('HUB_BASE_URL', 'http://envhub:9');
    vi.stubEnv('INTERNAL_EVENTS_SECRET', 'envsecret');
    const f = vi.fn(async () => res(204));
    await postEvent(ev, { fetch: f as any });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://envhub:9/internal/events');
    expect((init.headers as Record<string, string>)['X-Nook-Internal']).toBe('envsecret');
    vi.unstubAllEnvs();
  });

  it('retries 5xx and network errors, then succeeds', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValue(res(200));
    const r = await postEvent(ev, { fetch: f as any, retryDelayMs: 1 });
    expect(r).toMatchObject({ ok: true, attempts: 3 });
  });

  it('does not retry 401 and never throws on network failure', async () => {
    const f401 = vi.fn(async () => res(401));
    expect(await postEvent(ev, { fetch: f401 as any })).toMatchObject({
      ok: false,
      status: 401,
      attempts: 1,
    });
    const down = vi.fn().mockRejectedValue(new Error('down'));
    const r = await postEvent(ev, { fetch: down as any, retries: 1, retryDelayMs: 1 });
    expect(r).toMatchObject({ ok: false, attempts: 2, error: 'down' });
  });

  it('throws on an invalid event without calling the hub', async () => {
    const f = vi.fn();
    await expect(postEvent({ t: 'bogus' } as any, { fetch: f as any })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
