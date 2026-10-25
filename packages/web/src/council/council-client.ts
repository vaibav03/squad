import { permitRunStream } from '@squad/village/sources';
import { timedFetch } from '../lib/http';
import {
  CouncilAskResponseSchema,
  CouncilResultSchema,
  type CouncilAskResponse,
  type CouncilResult,
} from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { announceCouncilStarted } from './started-event';

/** Pure fetch helpers for `POST /v1/council/ask`, `GET /v1/council/:id` and the SSE stream. No React, no secrets in errors. */

export type CouncilErrorKind =
  'busy' | 'rate_limited' | 'session' | 'invalid' | 'not_found' | 'offline' | 'failed';

export class CouncilClientError extends Error {
  constructor(readonly kind: CouncilErrorKind) {
    super(kind);
  }
}

/** Fixed, user-safe copy. Never echoes a status line, body or schema error. */
export const COUNCIL_ERROR_COPY: Record<CouncilErrorKind, string> = {
  busy: 'The council is already deliberating. Wait for it to finish.',
  rate_limited: 'You have asked a lot of questions. Try again in a bit.',
  session: 'Your session ended. Sign in again.',
  invalid: 'That question could not be sent. Check it and try again.',
  not_found: 'That answer is no longer available.',
  offline: 'You are offline. Check your connection and try again.',
  failed: 'The council could not be reached. Try again.',
};

export function councilErrorKind(e: unknown): CouncilErrorKind {
  return e instanceof CouncilClientError ? e.kind : 'failed';
}
export function councilErrorCopy(e: unknown): string {
  return COUNCIL_ERROR_COPY[councilErrorKind(e)];
}

const base = (c: HubCtx) => c.hubUrl.replace(/\/+$/, '');
const auth = (c: HubCtx): Record<string, string> =>
  c.token ? { Authorization: `Bearer ${c.token}` } : {};

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function send(url: string, init: RequestInit): Promise<Response> {
  if (isOffline()) throw new CouncilClientError('offline');
  let res: Response;
  try {
    res = await timedFetch(url, init);
  } catch {
    // The request never reached the hub: treat it as being offline (retry is offered).
    throw new CouncilClientError('offline');
  }
  if (res.ok) return res;
  let code = '';
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null;
    if (typeof body?.error?.code === 'string') code = body.error.code;
  } catch {
    /* body is not JSON: the status decides */
  }
  if (res.status === 401 || res.status === 403) throw new CouncilClientError('session');
  if (res.status === 400) throw new CouncilClientError('invalid');
  if (res.status === 404) throw new CouncilClientError('not_found');
  if (res.status === 429) throw new CouncilClientError(code === 'busy' ? 'busy' : 'rate_limited');
  throw new CouncilClientError('failed');
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new CouncilClientError('failed');
  }
}

export async function askCouncil(
  hub: HubCtx,
  body: { question: string; chatId?: string; transport?: 'stream' | 'live' },
  signal?: AbortSignal,
): Promise<CouncilAskResponse> {
  const res = await send(`${base(hub)}/v1/council/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(hub) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const parsed = CouncilAskResponseSchema.safeParse(await readJson(res));
  if (!parsed.success) throw new CouncilClientError('failed');
  return parsed.data;
}

export async function getCouncil(
  hub: HubCtx,
  id: string,
  signal?: AbortSignal,
): Promise<CouncilResult> {
  const res = await send(`${base(hub)}/v1/council/${encodeURIComponent(id)}`, {
    headers: auth(hub),
    ...(signal ? { signal } : {}),
  });
  const parsed = CouncilResultSchema.safeParse(await readJson(res));
  if (!parsed.success) throw new CouncilClientError('failed');
  return parsed.data;
}

export interface CouncilStreamHandlers {
  /** A validated snapshot (`council.step`, and `council.done` when it carries one). */
  onStep(r: CouncilResult): void;
  /** The run finished (`council.done`). */
  onDone(): void;
  /** The stream broke before it finished. The caller decides whether to fall back to `getCouncil`. */
  onError(): void;
}

export interface EventSourceLike {
  addEventListener(type: string, fn: (e: MessageEvent) => void): void;
  close(): void;
  onerror: ((e: Event) => void) | null;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

const defaultFactory: EventSourceFactory | undefined =
  typeof EventSource === 'undefined'
    ? undefined
    : (url) => permitRunStream(() => new EventSource(url));

/** `streamUrl` is hub-relative; the stream token rides as `?st=` because EventSource cannot set headers. */
export function councilStreamUrl(hub: HubCtx, streamUrl: string, st?: string): string {
  const abs = /^https?:\/\//.test(streamUrl)
    ? streamUrl
    : `${base(hub)}${streamUrl.startsWith('/') ? '' : '/'}${streamUrl}`;
  if (!st) return abs;
  return `${abs}${abs.includes('?') ? '&' : '?'}st=${encodeURIComponent(st)}`;
}

/** A short-lived stream token (`POST /v1/squad/stream-token`) so the long-lived bearer never rides in a URL. */
async function streamToken(hub: HubCtx): Promise<string | undefined> {
  if (!hub.token || isOffline()) return undefined;
  try {
    const res = await timedFetch(`${base(hub)}/v1/squad/stream-token`, {
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

/**
 * Opens the SSE stream and returns a closer. Bad frames are ignored; a broken or unauthorised stream calls `onError`
 * once (the caller falls back to `getCouncil`).
 */
export function openCouncilStream(
  hub: HubCtx,
  streamUrl: string,
  h: CouncilStreamHandlers,
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
  const parse = (e: MessageEvent): CouncilResult | null => {
    try {
      const r = CouncilResultSchema.safeParse(JSON.parse(String(e.data)));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };
  void (async () => {
    const st = await streamToken(hub);
    if (closed) return;
    if (hub.token && !st) return h.onError();
    const src = factory(councilStreamUrl(hub, streamUrl, st));
    es = src;
    src.addEventListener('council.step', (e) => {
      if (closed) return;
      const r = parse(e);
      if (r) h.onStep(r);
    });
    src.addEventListener('council.done', (e) => {
      if (closed) return;
      const r = parse(e);
      if (r) h.onStep(r);
      close();
      h.onDone();
    });
    src.onerror = () => {
      if (closed) return;
      close();
      h.onError();
    };
  })();
  return close;
}

/** Everything the run hook needs from a backend; `hubTransport` is the real one, fixtures bring their own. */
export interface CouncilTransport {
  ask(
    question: string,
    chatId?: string,
    transport?: 'stream' | 'live',
  ): Promise<CouncilAskResponse>;
  get(id: string): Promise<CouncilResult>;
  stream(resp: CouncilAskResponse, h: CouncilStreamHandlers): () => void;
}

export function hubTransport(hub: HubCtx, factory?: EventSourceFactory): CouncilTransport {
  return {
    ask: async (question, chatId, transport) => {
      const res = await askCouncil(hub, {
        question,
        ...(chatId ? { chatId } : {}),
        ...(transport ? { transport } : {}),
      });
      announceCouncilStarted(res.id, transport);
      return res;
    },
    get: (id) => getCouncil(hub, id),
    stream: (resp, h) => openCouncilStream(hub, resp.streamUrl, h, factory),
  };
}
