import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatApi } from './api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chat api reads', () => {
  it('give up after 8 s when the hub never answers (error state, not "Loading chats" forever)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_u: string, init?: RequestInit) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const api = createChatApi({ hubUrl: 'http://hub.test', token: 't' });
    const p = api.chats();
    const out = expect(p).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(8100);
    await out;
  });
});
