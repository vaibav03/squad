import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnError, hub } from './api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connections reads are time limited', () => {
  it('a hub that never answers ends in the offline state (Retry) instead of loading forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
        ),
    );
    const caught = hub({ hubUrl: 'http://hub.test', token: 't' })
      .list()
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(8100);
    const e = await caught;
    expect(e).toBeInstanceOf(ConnError);
    expect((e as ConnError).code).toBe('offline');
  });
});
