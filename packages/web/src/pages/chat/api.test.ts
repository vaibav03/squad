import { describe, expect, it, vi } from 'vitest';
import { ChatApiError, chatErrorText, createChatApi, isExpired, type StreamHandlers } from './api';
import { buildFixtures } from './fixtures';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http chat api', () => {
  it('parses responses with the core schemas and sends the bearer token', async () => {
    const fx = buildFixtures(1_700_000_000_000);
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/v1/chat/chats')) return json({ chats: fx.chats });
      if (u.includes('/v1/chat/history'))
        return json({
          chatId: 'group:sq_demo',
          messages: fx.messages['group:sq_demo'],
          hasMore: true,
        });
      return json({}, 404);
    });
    const api = createChatApi({
      hubUrl: 'http://hub/',
      token: 'tok',
      fetchImpl: f as unknown as typeof fetch,
    });
    expect((await api.chats()).map((c) => c.id)).toEqual(['group:sq_demo', 'dm:s_ana']);
    const h = await api.history('group:sq_demo', { before: 9, limit: 20 });
    expect(h.hasMore).toBe(true);
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('http://hub/v1/chat/history?chatId=group%3Asq_demo&limit=20&before=9');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('turns a bad body into a 502 and a bad status into its code, never echoing either', async () => {
    const bad = createChatApi({
      hubUrl: 'http://hub',
      token: 't',
      fetchImpl: (async () => json({ chats: [{ id: 'nope' }] })) as unknown as typeof fetch,
    });
    await expect(bad.chats()).rejects.toMatchObject({ status: 502 });
    const limited = createChatApi({
      hubUrl: 'http://hub',
      token: 't',
      fetchImpl: (async () =>
        json({ error: { code: 'rate_limited' } }, 429)) as unknown as typeof fetch,
    });
    const err = await limited.send({ chatId: 'group:sq_demo', text: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(ChatApiError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited' });
    expect(chatErrorText(err, 'x')).toMatch(/too fast/);
    expect(chatErrorText(new ChatApiError(401), 'x')).toBe('Your session ended. Sign in again.');
    expect(isExpired(new ChatApiError(401))).toBe(true);
    expect(chatErrorText(new Error('secret'), 'Fallback')).toBe('Fallback');
  });

  it('builds file urls with the token and leaves data urls alone', () => {
    const api = createChatApi({ hubUrl: 'http://hub', token: 'a b', fetchImpl: fetch });
    const att = { id: 'a', kind: 'image' as const, mime: 'image/png', url: '/v1/chat/files/abc' };
    expect(api.fileUrl(att)).toBe('http://hub/v1/chat/files/abc?st=a%20b');
    expect(api.fileUrl({ ...att, url: 'data:image/png;base64,xx' })).toBe(
      'data:image/png;base64,xx',
    );
  });

  it('opens the stream with a stream token and resumes after the last seq on reopen', async () => {
    const urls: string[] = [];
    const sources: FakeES[] = [];
    class FakeES {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readyState = 1;
      listeners = new Map<string, (e: MessageEvent) => void>();
      constructor(public url: string) {
        urls.push(url);
        sources.push(this);
      }
      addEventListener(t: string, fn: (e: MessageEvent) => void) {
        this.listeners.set(t, fn);
      }
      close() {
        this.readyState = 2;
      }
    }
    let n = 0;
    const f = (async () => json({ st: `st${++n}` })) as unknown as typeof fetch;
    const api = createChatApi({
      hubUrl: 'http://hub',
      token: 'bearer',
      fetchImpl: f,
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    const got: number[] = [];
    const states: string[] = [];
    const resync = vi.fn();
    const h: StreamHandlers = {
      onMessage: (m) => got.push(m.seq),
      onUpdate: () => {},
      onTyping: () => {},
      onResync: resync,
      onState: (s) => states.push(s),
    };
    vi.useFakeTimers();
    const close = api.subscribe(h, 5);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls[0]).toBe('http://hub/v1/chat/stream?st=st1&lastEventId=5');
    const msg = buildFixtures().messages['group:sq_demo']![0]!;
    sources[0]!.listeners.get('chat.message')!({
      data: JSON.stringify({ ...msg, seq: 9 }),
    } as MessageEvent);
    sources[0]!.listeners.get('chat.message')!({ data: '{not json' } as MessageEvent);
    sources[0]!.listeners.get('chat.resync')!({
      data: JSON.stringify({ seq: 11 }),
    } as MessageEvent);
    expect(got).toEqual([9]);
    expect(resync).toHaveBeenCalledWith(11);
    // the browser gave up (stale stream token): reopen with a fresh token after the last seq we saw
    sources[0]!.readyState = 2;
    sources[0]!.onerror!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(urls[1]).toBe('http://hub/v1/chat/stream?st=st2&lastEventId=11');
    expect(states).toContain('offline');
    close();
    vi.useRealTimers();
  });

  it('reports an expired session when the stream token call is a 401', async () => {
    class ES {}
    const api = createChatApi({
      hubUrl: 'http://hub',
      token: 't',
      fetchImpl: (async () => json({}, 401)) as unknown as typeof fetch,
      EventSourceImpl: ES as unknown as typeof EventSource,
    });
    const states: string[] = [];
    api.subscribe({
      onMessage() {},
      onUpdate() {},
      onTyping() {},
      onResync() {},
      onState: (s) => states.push(s),
    });
    await vi.waitFor(() => expect(states).toContain('expired'));
  });
});
