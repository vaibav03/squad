import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHub, type RunningHub } from '../src/server';
import type { HubConfig } from '../src/config';

export const SECRET = 'test-secret';
export const FIXTURE = new URL(
  '../../../packages/core/fixtures/sample-replay.json',
  import.meta.url,
).pathname;

export async function boot(over: Partial<HubConfig> = {}): Promise<RunningHub> {
  const replayDir = mkdtempSync(join(tmpdir(), 'hub-replays-'));
  cpSync(FIXTURE, join(replayDir, 'sample.json'));
  return startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: SECRET,
      authSecret: 'auth-test',
      seed: true,
      sim: true,
      production: false,
      logLevel: 'silent',
      replayDir,
      ...over,
    },
  });
}

export async function login(url: string, studentId: string): Promise<string> {
  const r = await fetch(`${url}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId }),
  });
  return ((await r.json()) as { token: string }).token;
}

export const auth = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

export async function get<T = unknown>(
  url: string,
  path: string,
  token?: string,
): Promise<{ status: number; body: T }> {
  const r = await fetch(url + path, { headers: token ? auth(token) : {} });
  return { status: r.status, body: (await r.json()) as T };
}

export async function post<T = unknown>(
  url: string,
  path: string,
  body: unknown,
  token?: string,
  headers: Record<string, string> = {},
) {
  const r = await fetch(url + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, body: parsed as T, text };
}

export const emit = (url: string, event: unknown) =>
  post(url, '/internal/events', event, undefined, { 'x-nook-internal': SECRET });

export interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
}

/** Minimal SSE reader. `stop()` aborts the request. */
export async function openSse(
  url: string,
  opts: { st: string; lastEventId?: number; query?: string },
) {
  const ac = new AbortController();
  const q = `?st=${encodeURIComponent(opts.st)}${opts.query ?? ''}`;
  const res = await fetch(`${url}/v1/squad/stream${q}`, {
    headers: opts.lastEventId !== undefined ? { 'last-event-id': String(opts.lastEventId) } : {},
    signal: ac.signal,
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const frames: SseFrame[] = [];
  const waiters: (() => void)[] = [];
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const f: SseFrame = {};
          for (const line of raw.split('\n')) {
            if (line.startsWith('id: ')) f.id = line.slice(4);
            else if (line.startsWith('event: ')) f.event = line.slice(7);
            else if (line.startsWith('data: ')) f.data = line.slice(6);
          }
          if (f.event || f.data) {
            frames.push(f);
            waiters.splice(0).forEach((w) => w());
          }
        }
      }
    } catch {
      /* aborted */
    }
    waiters.splice(0).forEach((w) => w());
  })();
  return {
    res,
    frames,
    async waitFor(pred: (frames: SseFrame[]) => boolean, ms = 3000) {
      const t0 = Date.now();
      while (!pred(frames)) {
        if (Date.now() - t0 > ms)
          throw new Error(`timeout waiting for sse; got ${frames.map((f) => f.event).join(',')}`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    },
    stop: () => ac.abort(),
  };
}
