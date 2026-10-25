import { describe, expect, it } from 'vitest';
import { parseDotEnv } from './lib/env';
import { fetchHealth, waitForHealth } from './lib/http';
import { portFromScript, portFromUrl, villageUrl } from './lib/launch';

describe('env parsing', () => {
  it('parses keys, quotes and comments', () => {
    expect(parseDotEnv('# c\nA=1\nexport B="two"\nC=\n bad line\nD=\'x y\'')).toEqual({
      A: '1',
      B: 'two',
      C: '',
      D: 'x y',
    });
  });
});

describe('health', () => {
  const res = (status: number) =>
    (async () => new Response('{}', { status })) as unknown as typeof fetch;
  it('ok / not ok / network error never throw', async () => {
    expect((await fetchHealth('http://h/', { fetch: res(200) })).ok).toBe(true);
    expect((await fetchHealth('http://h', { fetch: res(503) })).ok).toBe(false);
    const boom = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await fetchHealth('http://h', { fetch: boom })).toEqual({
      ok: false,
      error: 'ECONNREFUSED',
    });
  });
  it('waitForHealth gives up at the deadline', async () => {
    const boom = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const r = await waitForHealth('http://h', { totalMs: 60, intervalMs: 10, fetch: boom });
    expect(r.ok).toBe(false);
  });
});

describe('launch helpers', () => {
  it('ports and url', () => {
    expect(portFromScript('vite --port 5180')).toBe(5180);
    expect(portFromScript('echo nope')).toBeUndefined();
    expect(portFromUrl('http://localhost:8788')).toBe(8788);
    expect(villageUrl('http://localhost:5173/', 'track2')).toBe(
      'http://localhost:5173/squad/village?replay=track2',
    );
  });
});
