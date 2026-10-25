import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchManifest, MANIFEST_TIMEOUT_MS } from './assets';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchManifest', () => {
  it('gives up on a request that never answers (the village boot must not hang on it)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const log = vi.fn();
    const p = fetchManifest('/assets', log);
    await vi.advanceTimersByTimeAsync(MANIFEST_TIMEOUT_MS + 50);
    await expect(p).resolves.toEqual([]);
    expect(log).toHaveBeenCalled();
  });

  it('still parses a healthy manifest', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ assets: [{ id: 'a', kind: 'image', file: 'x/a.png' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const specs = await fetchManifest('/assets', () => {});
    expect(specs.map((s) => s.key)).toEqual(['a']);
  });
});
