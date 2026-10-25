// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { timedFetch } from './http';
import {
  BUSY_AFTER_MS,
  MAX_READS,
  busySnapshot,
  resetRequestBudget,
  retryStuckRequests,
} from './request-budget';
import { ConnectionBusyBanner } from '../shell/ConnectionBusyBanner';

let started: string[] = [];
let resolvers: Record<string, (r: Response) => void> = {};

beforeEach(() => {
  vi.useFakeTimers();
  started = [];
  resolvers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      started.push(url);
      return new Promise<Response>((resolve, reject) => {
        resolvers[url] = resolve;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')));
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  resetRequestBudget();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = () => new Response('{"a":1}', { status: 200 });

describe('read budget', () => {
  it('shares identical in-flight GETs: one network request, every caller can read the body', async () => {
    const a = timedFetch('http://h/x', { headers: { Authorization: 'Bearer t' } });
    const b = timedFetch('http://h/x', { headers: { Authorization: 'Bearer t' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['http://h/x']);
    resolvers['http://h/x']?.(ok());
    const [ra, rb] = await Promise.all([a, b]);
    expect(await ra.json()).toEqual({ a: 1 });
    expect(await rb.json()).toEqual({ a: 1 });
  });

  it('never shares a read between two credentials', async () => {
    void timedFetch('http://h/x', { headers: { Authorization: 'Bearer ana' } }).catch(() => 0);
    void timedFetch('http://h/x', { headers: { Authorization: 'Bearer ben' } }).catch(() => 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(2);
  });

  it('runs at most MAX_READS reads at once; the rest start as slots free up', async () => {
    const calls = Array.from({ length: MAX_READS + 3 }, (_, i) =>
      timedFetch(`http://h/r${i}`).catch(() => 0),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(MAX_READS);
    resolvers['http://h/r0']?.(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(MAX_READS + 1);
    for (const u of started) resolvers[u]?.(ok());
    await vi.advanceTimersByTimeAsync(0);
    for (const u of started) resolvers[u]?.(ok());
    await vi.advanceTimersByTimeAsync(0);
    for (const u of started) resolvers[u]?.(ok());
    await Promise.all(calls);
    expect(started).toHaveLength(MAX_READS + 3);
  });

  it('a read still waiting for a slot gives up with the usual timeout, not forever', async () => {
    for (let i = 0; i < MAX_READS; i++)
      void timedFetch(`http://h/hold${i}`, {}, 60_000).catch(() => 0);
    const waiter = timedFetch('http://h/late', {}, 2000);
    const settled = vi.fn();
    waiter.catch(settled);
    await vi.advanceTimersByTimeAsync(2100);
    expect(settled).toHaveBeenCalled();
    expect(started).not.toContain('http://h/late');
  });

  it('writes are not limited or shared', async () => {
    void timedFetch('http://h/w', { method: 'POST', body: '{}' }).catch(() => 0);
    void timedFetch('http://h/w', { method: 'POST', body: '{}' }).catch(() => 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(2);
  });
});

describe('stuck-request watchdog', () => {
  it('marks the connection busy after a few seconds and the banner offers Retry', async () => {
    render(<ConnectionBusyBanner />);
    expect(screen.queryByTestId('connection-busy-banner')).toBeNull();
    const p = timedFetch('http://h/stuck');
    const settled = vi.fn();
    p.catch(settled);
    await vi.advanceTimersByTimeAsync(BUSY_AFTER_MS + 1100);
    expect(busySnapshot()).not.toBeNull();
    expect(screen.getByTestId('connection-busy-banner')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
    act(() => retryStuckRequests());
    await vi.advanceTimersByTimeAsync(1100);
    expect(settled).toHaveBeenCalled();
    expect(busySnapshot()).toBeNull();
    expect(screen.queryByTestId('connection-busy-banner')).toBeNull();
  });

  it('stays quiet for requests that answer in time', async () => {
    const p = timedFetch('http://h/fast');
    await vi.advanceTimersByTimeAsync(500);
    resolvers['http://h/fast']?.(ok());
    await p;
    await vi.advanceTimersByTimeAsync(BUSY_AFTER_MS * 2);
    expect(busySnapshot()).toBeNull();
  });
});
