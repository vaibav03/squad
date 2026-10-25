import { afterEach, describe, expect, it, vi } from 'vitest';
import { councilFixtures as f } from './fixtures';
import {
  COUNCIL_ERROR_COPY,
  CouncilClientError,
  askCouncil,
  councilErrorCopy,
  councilStreamUrl,
  getCouncil,
  openCouncilStream,
  type EventSourceLike,
} from './council-client';

const hub = { hubUrl: 'http://hub.test/', token: 'tok en' };
const ASK = {
  id: f.done.id,
  status: 'running',
  streamUrl: `/v1/council/${f.done.id}/stream`,
  resultUrl: `/v1/council/${f.done.id}`,
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('askCouncil', () => {
  it('posts the question with the bearer token and validates the response', async () => {
    const fetchMock = vi.fn(async () => reply(202, ASK));
    vi.stubGlobal('fetch', fetchMock);
    const r = await askCouncil(hub, { question: 'B or C?', chatId: 'dm:s_ana' });
    expect(r.id).toBe(ASK.id);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0]!;
    expect(url).toBe('http://hub.test/v1/council/ask');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok en');
    expect(JSON.parse(init.body as string)).toEqual({ question: 'B or C?', chatId: 'dm:s_ana' });
  });

  it.each([
    [429, { error: { code: 'busy' } }, 'busy'],
    [429, { error: { code: 'rate_limited' } }, 'rate_limited'],
    [400, { error: { code: 'invalid_request' } }, 'invalid'],
    [403, {}, 'session'],
    [404, {}, 'not_found'],
    [500, { error: { code: 'x', message: 'secret stack trace' } }, 'failed'],
  ])('maps %s %j to %s with fixed copy', async (status, body, kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(status, body)),
    );
    const e = await askCouncil(hub, { question: 'abc' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CouncilClientError);
    expect((e as CouncilClientError).kind).toBe(kind);
    expect(councilErrorCopy(e)).not.toMatch(/secret|stack|\d{3}/);
  });

  it('uses the exact copy for busy and rate limited', () => {
    expect(COUNCIL_ERROR_COPY.busy).toBe(
      'The council is already deliberating. Wait for it to finish.',
    );
    expect(COUNCIL_ERROR_COPY.rate_limited).toBe(
      'You have asked a lot of questions. Try again in a bit.',
    );
  });

  it('treats a fetch failure as offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const e = await askCouncil(hub, { question: 'abc' }).catch((x: unknown) => x);
    expect((e as CouncilClientError).kind).toBe('offline');
  });

  it('does not even try when the browser says it is offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: false });
    const e = await askCouncil(hub, { question: 'abc' }).catch((x: unknown) => x);
    expect((e as CouncilClientError).kind).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a response that fails the core schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(202, { id: 'nope' })),
    );
    const e = await askCouncil(hub, { question: 'abc' }).catch((x: unknown) => x);
    expect((e as CouncilClientError).kind).toBe('failed');
  });
});

describe('getCouncil', () => {
  it('returns a validated result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, f.done)),
    );
    expect((await getCouncil(hub, f.done.id)).verdict?.confidence).toBe('fairly_sure');
  });
  it('rejects unknown fields (strict schema)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, { ...f.done, score: 0.9 })),
    );
    await expect(getCouncil(hub, f.done.id)).rejects.toBeInstanceOf(CouncilClientError);
  });
});

class FakeES implements EventSourceLike {
  handlers = new Map<string, (e: MessageEvent) => void>();
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(t: string, fn: (e: MessageEvent) => void) {
    this.handlers.set(t, fn);
  }
  close() {
    this.closed = true;
  }
  emit(t: string, data: unknown) {
    this.handlers.get(t)?.({
      data: typeof data === 'string' ? data : JSON.stringify(data),
    } as MessageEvent);
  }
}

describe('openCouncilStream', () => {
  const tokenFetch = (st: string | null) =>
    vi.fn(async (_u: string, _i?: RequestInit) => (st ? reply(200, { st }) : reply(500, {})));
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('gets a stream token, puts it in ?st=, and delivers validated steps then done', async () => {
    const fetchMock = tokenFetch('stream tok');
    vi.stubGlobal('fetch', fetchMock);
    let es!: FakeES;
    const step = vi.fn();
    const done = vi.fn();
    const err = vi.fn();
    openCouncilStream(
      hub,
      ASK.streamUrl,
      { onStep: step, onDone: done, onError: err },
      (u) => (es = new FakeES(u)),
    );
    await flush();
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('http://hub.test/v1/squad/stream-token');
    expect((tokenInit?.headers as Record<string, string>).Authorization).toBe('Bearer tok en');
    expect(es.url).toBe(`http://hub.test/v1/council/${f.done.id}/stream?st=stream%20tok`);
    expect(es.url).not.toContain('tok%20en');
    es.emit('council.step', f.opinions);
    es.emit('council.step', 'not json');
    es.emit('council.step', { id: 'bad' });
    expect(step).toHaveBeenCalledTimes(1);
    es.emit('council.done', f.done);
    expect(step).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledTimes(1);
    expect(es.closed).toBe(true);
    expect(err).not.toHaveBeenCalled();
  });

  it('calls onError when no stream token can be had', async () => {
    vi.stubGlobal('fetch', tokenFetch(null));
    const err = vi.fn();
    const make = vi.fn();
    openCouncilStream(hub, ASK.streamUrl, { onStep: vi.fn(), onDone: vi.fn(), onError: err }, make);
    await flush();
    expect(err).toHaveBeenCalledTimes(1);
    expect(make).not.toHaveBeenCalled();
  });

  it('calls onError once when the stream breaks, and nothing after a close', async () => {
    vi.stubGlobal('fetch', tokenFetch('s'));
    let es!: FakeES;
    const err = vi.fn();
    const close = openCouncilStream(
      hub,
      ASK.streamUrl,
      { onStep: vi.fn(), onDone: vi.fn(), onError: err },
      (u) => (es = new FakeES(u)),
    );
    await flush();
    es.onerror?.(new Event('error'));
    es.onerror?.(new Event('error'));
    expect(err).toHaveBeenCalledTimes(1);
    close();
  });

  it('never opens a stream that was closed before the token arrived', async () => {
    vi.stubGlobal('fetch', tokenFetch('s'));
    const make = vi.fn();
    const close = openCouncilStream(
      hub,
      ASK.streamUrl,
      { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      make,
    );
    close();
    await flush();
    expect(make).not.toHaveBeenCalled();
  });

  it('appends st with & when the url already has a query', () => {
    expect(councilStreamUrl({ hubUrl: 'http://h', token: 't' }, '/x?a=1', 's')).toBe(
      'http://h/x?a=1&st=s',
    );
  });
});
