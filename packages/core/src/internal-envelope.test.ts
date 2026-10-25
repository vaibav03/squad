import { describe, expect, it, vi } from 'vitest';
import { postHubEnvelope } from './internal-events';

describe('postHubEnvelope', () => {
  it('posts { type, data } with the secret header and returns ok', async () => {
    const fetchFn = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const r = await postHubEnvelope(
      'x.trip.upsert',
      { tripId: 't1' },
      { baseUrl: 'http://hub.test', secret: 's3', fetch: fetchFn as unknown as typeof fetch },
    );
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://hub.test/internal/events');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'x.trip.upsert',
      data: { tripId: 't1' },
    });
    expect((init.headers as Record<string, string>)['X-Nook-Internal']).toBe('s3');
  });

  it('rejects a malformed type as a programming error', async () => {
    await expect(postHubEnvelope('x.Bad Type' as `x.${string}`, {})).rejects.toThrow();
  });

  it('never throws on network failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('down');
    });
    const r = await postHubEnvelope(
      'x.ledger.private',
      {},
      { fetch: fetchFn as unknown as typeof fetch, retries: 0 },
    );
    expect(r.ok).toBe(false);
  });
});
