// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LiveConfigProvider } from './live-config';
import { useEventFeed } from './feed';

class FakeES {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  close() {
    this.readyState = 2;
  }
}

const wrap = ({ children }: { children: ReactNode }) => (
  <LiveConfigProvider
    value={{ mode: 'live', hubUrl: 'http://hub.test', token: 'tok', userId: 's_ana' }}
  >
    {children}
  </LiveConfigProvider>
);
const feed = () =>
  renderHook(
    () =>
      useEventFeed<string>(
        { recorded: [], live: { parse: (r) => String(r), refresh: async () => {} } },
        () => {},
      ),
    { wrapper: wrap },
  );
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  FakeES.all = [];
  vi.stubGlobal('EventSource', FakeES);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useEventFeed never stays on "connecting"', () => {
  it('goes live when the stream opens', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ st: 'a' }), { status: 200 }));
    const { result } = feed();
    await flush();
    expect(result.current.connection).toBe('connecting');
    act(() => FakeES.all[0]!.onopen?.());
    expect(result.current.connection).toBe('live');
  });

  it('a refused stream (browser closed it: expired token, 401/403/404) becomes an error, then retries with a fresh token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ st: 'a' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = feed();
    await flush();
    const first = FakeES.all[0]!;
    first.readyState = 2;
    act(() => first.onerror?.());
    expect(result.current.connection).toBe('error');
    await act(async () => void (await vi.advanceTimersByTimeAsync(1100)));
    expect(FakeES.all).toHaveLength(2); // reconnected on its own, one backoff step later
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('stream-token'))).toHaveLength(
      2,
    );
  });

  it('a failing stream-token request ends in error and backs off exponentially', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = feed();
    await flush();
    expect(result.current.connection).toBe('error');
    const tokenCalls = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('stream-token')).length;
    expect(tokenCalls()).toBe(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1001)));
    expect(tokenCalls()).toBe(2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    expect(tokenCalls()).toBe(2); // second wait is 2 s, not 1 s
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(tokenCalls()).toBe(3);
  });

  it('a hub that never answers times out into error instead of connecting forever', async () => {
    vi.stubGlobal(
      'fetch',
      (_u: unknown, init?: RequestInit) =>
        new Promise((_r, rej) =>
          init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
        ),
    );
    const { result } = feed();
    await flush();
    expect(result.current.connection).toBe('connecting');
    await act(async () => void (await vi.advanceTimersByTimeAsync(8100)));
    expect(result.current.connection).toBe('error');
  });

  it('a stream that never opens times out into error', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ st: 'a' }), { status: 200 }));
    const { result } = feed();
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(8100)));
    expect(result.current.connection).toBe('error');
  });
});
