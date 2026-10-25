// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAccount } from '../auth/AuthProvider';
import { createAccountsClient } from '../auth/client';
import { errorFromResponse, userMessage } from '../auth/errors';
import { RateLimitedState } from '../primitives/EmptyState';
import { RateLimitBanner } from '../shell/RateLimitBanner';
import { chatLoadReason, ChatApiError } from '../pages/chat/api';
import { timedFetch } from './http';
import { clearRateLimited, parseRetryAfter, rateLimitSnapshot } from './rate-limit';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
const limited = (retry = '3') =>
  new Response(JSON.stringify({ error: { code: 'rate_limited' } }), {
    status: 429,
    headers: { 'retry-after': retry },
  });
const ok = () => new Response('{"ok":true}', { status: 200 });

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  clearRateLimited();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Retry-After', () => {
  it('reads seconds and HTTP dates, ignores junk', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter('0')).toBe(0);
    expect(
      parseRetryAfter('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')),
    ).toBe(10);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
  it('maps a 429 to rate_limited with retryAfterS, from the body or the header', () => {
    const a = errorFromResponse(429, { error: { code: 'rate_limited', retryAfterS: 12 } });
    expect(a.code).toBe('rate_limited');
    expect(a.retryAfterS).toBe(12);
    const b = errorFromResponse(429, null, 5);
    expect(b.code).toBe('rate_limited');
    expect(b.retryAfterS).toBe(5);
    expect(userMessage(b)).toMatch(/wait 5 seconds/i);
    expect(userMessage(b)).not.toMatch(/offline/i);
  });
  it('chat reads say slow down, not offline', () => {
    const msg = chatLoadReason(new ChatApiError(429, 'rate_limited'));
    expect(msg).toMatch(/too many requests/i);
    expect(msg).not.toMatch(/offline/i);
  });
});

describe('timedFetch on HTTP 429', () => {
  it('waits Retry-After, retries by itself, and returns the success', async () => {
    vi.useFakeTimers();
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(limited('3')).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    const p = timedFetch('http://hub.test/v1/x');
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1);
    expect(rateLimitSnapshot()?.auto).toBe(true); // banner state while waiting
    await vi.advanceTimersByTimeAsync(2900);
    expect(f).toHaveBeenCalledTimes(1); // honours the 3 s
    await vi.advanceTimersByTimeAsync(200);
    const res = await p;
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(rateLimitSnapshot()).toBeNull(); // recovered: banner gone
  });

  it('gives up after two automatic retries and returns the 429 (never throws offline)', async () => {
    vi.useFakeTimers();
    const f = vi.fn<typeof fetch>(async () => limited('1'));
    vi.stubGlobal('fetch', f);
    const p = timedFetch('http://hub.test/v1/x');
    await vi.advanceTimersByTimeAsync(5000);
    const res = await p;
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(3);
    expect(rateLimitSnapshot()?.auto).toBe(false);
  });

  it('never retries writes', async () => {
    const f = vi.fn<typeof fetch>(async () => limited('1'));
    vi.stubGlobal('fetch', f);
    const res = await timedFetch('http://hub.test/v1/x', { method: 'POST', body: '{}' });
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('caps a long Retry-After wait for the automatic retry', async () => {
    vi.useFakeTimers();
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(limited('120'))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    const p = timedFetch('http://hub.test/v1/x');
    await vi.advanceTimersByTimeAsync(10_100);
    expect((await p).status).toBe(200);
  });

  it('the banner says "Too many requests, retrying in N s" and Retry now skips the wait', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(limited('9')).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    render(<RateLimitBanner />);
    const p = timedFetch('http://hub.test/v1/x');
    const banner = await screen.findByTestId('rate-limit-banner');
    expect(banner.textContent).toMatch(/Too many requests, retrying in \d+ s/);
    expect(banner.textContent).not.toMatch(/offline/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect((await p).status).toBe(200);
    await waitFor(() => expect(screen.queryByTestId('rate-limit-banner')).toBeNull());
  });
});

describe('account load answered 429', () => {
  function Probe() {
    const a = useAccount();
    return (
      <div>
        <p data-testid="status">{a.status}</p>
        {a.status === 'rate-limited' && (
          <RateLimitedState retryAt={a.retryAt} onRetry={() => void a.refresh().catch(() => {})} />
        )}
      </div>
    );
  }

  it('is rate-limited (not offline), says so with Retry, and recovers by itself', async () => {
    localStorage.setItem('squad.token', 'tok');
    let calls = 0;
    const me = {
      user: { id: 'u_1', name: 'Ana', contactHint: null, createdAt: 0 },
      squads: [],
      activeSquadId: null,
    };
    const f: typeof fetch = async () => {
      calls++;
      return calls === 1 ? limited('1') : new Response(JSON.stringify(me), { status: 200 });
    };
    render(
      <AuthProvider client={createAccountsClient({ hubUrl: 'http://hub.test', fetch: f })}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('rate-limited'));
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Too many requests, retrying in \d+ s/);
    expect(document.body.textContent).not.toMatch(/offline/i);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'), {
      timeout: 4000,
    });
  });

  it('Retry now asks again immediately', async () => {
    localStorage.setItem('squad.token', 'tok');
    const f: typeof fetch = async () => limited('30');
    const client = createAccountsClient({ hubUrl: 'http://hub.test', fetch: f });
    const spy = vi.spyOn(client, 'me');
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByRole('button', { name: 'Retry now' });
    const before = spy.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    });
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId('status').textContent).toBe('rate-limited');
  });
});
