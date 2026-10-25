import {
  LiveActionResultSchema,
  LiveSnapshotSchema,
  LiveStartResponseSchema,
  LiveStreamEventSchema,
  type LiveActionResult,
  type LiveSayBody,
  type LiveSnapshot,
  type LiveStartBody,
  type LiveStartResponse,
  type LiveStreamEvent,
} from '@squad/core';
import type { HubCtx } from '../pages/village/hub';

/** Fetch helpers for `/v1/live/*` and the SSE stream (`event: live`). No React; fixed user-safe error copy. */

export type LiveErrorKind =
  'busy' | 'rate_limited' | 'session' | 'invalid' | 'not_found' | 'offline' | 'failed';

export class LiveClientError extends Error {
  constructor(readonly kind: LiveErrorKind) {
    super(kind);
  }
}

export const LIVE_ERROR_COPY: Record<LiveErrorKind, string> = {
  busy: 'A discussion is already running. Leave it or wait for it to wrap up.',
  rate_limited: 'You have started a lot of discussions. Try again in a bit.',
  session: 'Your session ended. Sign in again.',
  invalid: 'That could not be sent. Check it and try again.',
  not_found: 'That discussion is no longer available.',
  offline: 'You are offline. Check your connection and try again.',
  failed: 'The discussion could not be reached. Try again.',
};

export const liveErrorKind = (e: unknown): LiveErrorKind =>
  e instanceof LiveClientError ? e.kind : 'failed';
export const liveErrorCopy = (e: unknown): string => LIVE_ERROR_COPY[liveErrorKind(e)];

const base = (c: HubCtx) => c.hubUrl.replace(/\/+$/, '');
const auth = (c: HubCtx): Record<string, string> =>
  c.token ? { Authorization: `Bearer ${c.token}` } : {};
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function send(url: string, init: RequestInit): Promise<Response> {
  if (isOffline()) throw new LiveClientError('offline');
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new LiveClientError('offline');
  }
  if (res.ok) return res;
  let code = '';
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null;
    if (typeof body?.error?.code === 'string') code = body.error.code;
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) throw new LiveClientError('session');
  if (res.status === 400) throw new LiveClientError('invalid');
  if (res.status === 404) throw new LiveClientError('not_found');
  if (res.status === 429) throw new LiveClientError(code === 'busy' ? 'busy' : 'rate_limited');
  throw new LiveClientError('failed');
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new LiveClientError('failed');
  }
}

const post = (hub: HubCtx, path: string, body?: unknown) =>
  send(`${base(hub)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(hub) },
    body: JSON.stringify(body ?? {}),
  });

export async function startLive(hub: HubCtx, body: LiveStartBody): Promise<LiveStartResponse> {
  const p = LiveStartResponseSchema.safeParse(await json(await post(hub, '/v1/live', body)));
  if (!p.success) throw new LiveClientError('failed');
  return p.data;
}

export async function getLive(hub: HubCtx, id: string): Promise<LiveSnapshot> {
  const res = await send(`${base(hub)}/v1/live/${encodeURIComponent(id)}`, { headers: auth(hub) });
  const p = LiveSnapshotSchema.safeParse(await json(res));
  if (!p.success) throw new LiveClientError('failed');
  return p.data;
}

export async function say(hub: HubCtx, id: string, body: Partial<LiveSayBody> & { text: string }) {
  await post(hub, `/v1/live/${encodeURIComponent(id)}/say`, { kind: 'say', ...body });
}

export async function stop(hub: HubCtx, id: string) {
  await post(hub, `/v1/live/${encodeURIComponent(id)}/stop`);
}

async function action(hub: HubCtx, id: string, name: string): Promise<LiveActionResult> {
  const res = await post(hub, `/v1/live/${encodeURIComponent(id)}/actions/${name}`);
  const p = LiveActionResultSchema.safeParse(await json(res));
  if (!p.success) throw new LiveClientError('failed');
  return p.data;
}
export const postToChat = (hub: HubCtx, id: string) => action(hub, id, 'post-chat');
export const makeQuiz = (hub: HubCtx, id: string) => action(hub, id, 'quiz');
export const addToPlan = (hub: HubCtx, id: string) => action(hub, id, 'study-plan');

export interface EventSourceLike {
  addEventListener(type: string, fn: (e: MessageEvent) => void): void;
  close(): void;
  onerror: ((e: Event) => void) | null;
}
export type EventSourceFactory = (url: string) => EventSourceLike;
const defaultFactory: EventSourceFactory | undefined =
  typeof EventSource === 'undefined' ? undefined : (url) => new EventSource(url);

async function streamToken(hub: HubCtx): Promise<string | undefined> {
  if (!hub.token || isOffline()) return undefined;
  try {
    const res = await fetch(`${base(hub)}/v1/squad/stream-token`, {
      method: 'POST',
      headers: auth(hub),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { st?: unknown };
    return typeof body.st === 'string' && body.st ? body.st : undefined;
  } catch {
    return undefined;
  }
}

export interface LiveStreamHandlers {
  onEvent(e: LiveStreamEvent): void;
  /** The stream broke (the caller reconnects; the first event of a new stream is a full snapshot). */
  onError(): void;
}

/** Every frame is validated with `LiveStreamEventSchema`; bad frames are dropped. Returns a closer. */
export function openLiveStream(
  hub: HubCtx,
  id: string,
  h: LiveStreamHandlers,
  factory: EventSourceFactory | undefined = defaultFactory,
): () => void {
  let closed = false;
  let es: EventSourceLike | undefined;
  const close = () => {
    closed = true;
    es?.close();
  };
  if (!factory) {
    queueMicrotask(h.onError);
    return close;
  }
  void (async () => {
    const st = await streamToken(hub);
    if (closed) return;
    if (hub.token && !st) return h.onError();
    const url = `${base(hub)}/v1/live/${encodeURIComponent(id)}/stream${
      st ? `?st=${encodeURIComponent(st)}` : ''
    }`;
    const src = factory(url);
    es = src;
    src.addEventListener('live', (e) => {
      if (closed) return;
      try {
        const p = LiveStreamEventSchema.safeParse(JSON.parse(String(e.data)));
        if (p.success) h.onEvent(p.data);
      } catch {
        /* ignore bad frame */
      }
    });
    src.onerror = () => {
      if (closed) return;
      close();
      h.onError();
    };
  })();
  return close;
}

/** What the hook needs; `hubLiveTransport` is real, `mockLiveTransport` (fixtures.ts) is scripted. */
export interface LiveTransport {
  readonly mock: boolean;
  start(body: LiveStartBody): Promise<LiveStartResponse>;
  get(id: string): Promise<LiveSnapshot>;
  open(id: string, h: LiveStreamHandlers): () => void;
  say(id: string, body: Partial<LiveSayBody> & { text: string }): Promise<void>;
  stop(id: string): Promise<void>;
  postToChat(id: string): Promise<LiveActionResult>;
  makeQuiz(id: string): Promise<LiveActionResult>;
  addToPlan(id: string): Promise<LiveActionResult>;
}

export function hubLiveTransport(hub: HubCtx, factory?: EventSourceFactory): LiveTransport {
  return {
    mock: false,
    start: (b) => startLive(hub, b),
    get: (id) => getLive(hub, id),
    open: (id, h) => openLiveStream(hub, id, h, factory),
    say: (id, b) => say(hub, id, b),
    stop: (id) => stop(hub, id),
    postToChat: (id) => postToChat(hub, id),
    makeQuiz: (id) => makeQuiz(hub, id),
    addToPlan: (id) => addToPlan(hub, id),
  };
}
