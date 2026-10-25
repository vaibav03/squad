import { SharedEventSource } from '@squad/village/sources';
import { timedFetch } from '../../lib/http';
import {
  ChatAttachmentSchema,
  ChatCitationExcerptSchema,
  ChatContextRefSchema,
  ChatMessageSchema,
  ChatSummarySchema,
  ChatSyncFieldsSchema,
  ChatTypingSchema,
  ChatUpdateSchema,
  HubStatusSchema,
  ImessageStatusSchema,
  type ChatAttachment,
  type ChatCitationExcerpt,
  type ChatContextRef,
  type ChatMessage,
  type ChatSendBody,
  type ChatSummary,
  type ChatTyping,
  type ChatUpdate,
  type HubStatus,
  type ImessageStatus,
} from '@squad/core';
import { z } from 'zod';

/** `ChatSendBody` plus the idempotency id and the confirm task a numeric answer belongs to. */
export type ChatSendInput = ChatSendBody & { clientId?: string; confirmTaskId?: string };

/** Everything the chat UI needs from the hub. Tests and the gallery inject a fake that implements this. */
export interface ChatApi {
  status(): Promise<HubStatus>;
  chats(): Promise<ChatSummary[]>;
  history(
    chatId: string,
    opts?: { before?: number; limit?: number },
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  send(body: ChatSendInput): Promise<ChatMessage>;
  upload(file: File): Promise<ChatAttachment>;
  /** A hub-verified context ref for "Ask Cubbie" (`groupView` is what a group chat may show). Rejects when unreadable. */
  contextRef?(sourceId: string, anchor?: string): Promise<{ ref: ChatContextRef; groupView: ChatContextRef }>;
  /** `context` is the answer text: the hub opens the page at the sentence that best matches it. */
  citation(file: string, page: number, context?: string): Promise<ChatCitationExcerpt>;
  /** Absolute URL an <img>/<audio> can load for an attachment. */
  fileUrl(att: ChatAttachment): string;
  /** Fetches the file-scoped token that `fileUrl` puts in <img>/<audio> URLs (never the bearer token). */
  prepare?(): Promise<void>;
  /** Opens the live stream; returns a closer. `lastEventId` is a chat seq to resume after. */
  subscribe(h: StreamHandlers, lastEventId?: number): () => void;
  /** Asks the hub to retry a failed iMessage send (POST /v1/imessage/messages/:id/retry). */
  retryImessage?(messageId: string): Promise<boolean>;
  /** GET /v1/imessage/status; null when the hub has no such route or cannot say (never throws). */
  imessageStatus?(): Promise<ImessageStatus | null>;
}

export type StreamState = 'connecting' | 'live' | 'offline' | 'expired';
export interface StreamHandlers {
  onMessage(m: ChatMessage): void;
  onUpdate(u: ChatUpdate): void;
  /** A message's iMessage delivery state changed (queued, sent, delivered, failed, dry_run, web_only). */
  onSync?(e: ChatSyncEvent): void;
  onTyping(t: ChatTyping): void;
  onResync(seq: number): void;
  onState(s: StreamState): void;
}

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    /** hub error code (`rate_limited`, `forbidden`, ...) when the body had one */
    readonly code?: string,
  ) {
    super(`chat ${status}${code ? ` ${code}` : ''}`);
  }
  /** true when the hub never answered in time (status 0, code `timeout`) */
  get timedOut(): boolean {
    return this.status === 0 && this.code === 'timeout';
  }
}

/** Every hub call gives up after this long, so no screen can wait forever. */
export const CHAT_TIMEOUT_MS = 8_000;

/**
 * The plain-words reason a load failed, for the error state next to a Retry button. Never echoes a status line or body.
 * `online` is `navigator.onLine`: when the browser itself is offline that is the reason, whatever the error was.
 */
export function chatLoadReason(e: unknown, online = true): string {
  if (!online) return 'You are offline. Reconnect and try again.';
  if (e instanceof ChatApiError) {
    if (e.timedOut) return 'The hub took too long to answer (over 8 seconds). Try again.';
    if (e.status === 0) return 'We could not reach the hub. Check your connection and try again.';
    if (e.status === 401) return 'Your session ended. Sign in again.';
    if (e.code === 'context_unreadable')
      return 'That imported item is not available to attach (removed, or not shared with you).';
    if (e.status === 403) return 'You do not have access to this chat.';
    if (e.status === 429) return 'Too many requests. Wait a few seconds, then try again.';
    if (e.status === 409) return 'Create or join a squad to chat with it.';
    if (e.status === 404) return 'This chat was not found. Try again, or pick another squad.';
    if (e.status >= 500) return 'The hub had a problem answering. Try again in a moment.';
  }
  return 'Something went wrong loading chat. Try again.';
}

/** Fixed, user-safe copy. Never echoes a status line, body or schema error. */
export function chatErrorText(e: unknown, fallback: string): string {
  if (e instanceof ChatApiError) {
    if (e.status === 401) return 'Your session ended. Sign in again.';
    if (e.status === 429) return 'You are sending messages too fast. Wait a moment and try again.';
    if (e.status === 413) return 'That image is over 8 MB.';
    if (e.status === 415) return 'Only PNG, JPEG, WebP or GIF images can be sent.';
    if (e.code === 'stale_confirm') return 'That question is no longer open.';
    if (e.status === 403) return 'You do not have access to this chat.';
  }
  return fallback;
}
export const isExpired = (e: unknown): boolean => e instanceof ChatApiError && e.status === 401;

const HistorySchema = z.object({
  chatId: z.string(),
  messages: z.array(ChatMessageSchema),
  hasMore: z.boolean(),
});
/** Status is read leniently: the hub may add fields (ports, since) or reasons the client does not know yet. */
const StatusSchema = z.object({
  ...HubStatusSchema.shape,
  reason: z.string().optional(),
});
const ChatsSchema = z.object({ chats: z.array(ChatSummarySchema) });
const ContextRefSchema = z.object({ ref: ChatContextRefSchema, groupView: ChatContextRefSchema });
const SendSchema = z.object({ message: ChatMessageSchema });
const UploadSchema = z.object({ attachment: ChatAttachmentSchema });
const StreamTokenSchema = z.object({ st: z.string().min(1) });
const FileTokenSchema = z.object({ ft: z.string().min(1), expiresAt: z.number() });
const ResyncSchema = z.object({ seq: z.number() });
const RetryAck = z.object({ ok: z.boolean() });
/** `chat.sync`: a message's delivery state (or other sync fields) changed. */
export const ChatSyncEventSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  patch: ChatSyncFieldsSchema.partial(),
});
export type ChatSyncEvent = z.infer<typeof ChatSyncEventSchema>;

export interface HttpChatApiOptions {
  hubUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** injectable for tests */
  EventSourceImpl?: typeof EventSource;
  /** per-request timeout, default 8 s */
  timeoutMs?: number;
}

/** fetch with a deadline: a hung hub becomes `ChatApiError(0, 'timeout')`, a dead network `ChatApiError(0)`. */
async function fetchWithin(
  f: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, ms);
  try {
    return await f(url, { ...init, signal: ctl.signal });
  } catch {
    throw new ChatApiError(0, timedOut ? 'timeout' : undefined);
  } finally {
    clearTimeout(timer);
  }
}

export function createChatApi(o: HttpChatApiOptions): ChatApi {
  const base = o.hubUrl.replace(/\/+$/, '');
  // reads give up after 8 s (timedFetch), so a stalled hub ends in the error state with Retry, not "Loading chats" forever
  const f: typeof fetch = o.fetchImpl ?? ((i, init) => timedFetch(i, init));
  const auth = { Authorization: `Bearer ${o.token}` };
  const ms = o.timeoutMs ?? CHAT_TIMEOUT_MS;

  async function call<T>(
    schema: z.ZodType<T>,
    path: string,
    init?: RequestInit,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetchWithin(
      f,
      `${base}${path}`,
      { ...init, headers: { ...auth, ...headers } },
      ms,
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
      const code = typeof body?.error?.code === 'string' ? body.error.code : undefined;
      throw new ChatApiError(res.status, code);
    }
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ChatApiError(502, 'bad_response');
    return parsed.data;
  }
  const q = encodeURIComponent;
  let fileToken: { ft: string; exp: number } | null = null;
  let refreshing: Promise<void> | null = null;
  function refreshFileToken(): Promise<void> {
    refreshing ??= call(
      FileTokenSchema,
      '/v1/chat/file-token',
      { method: 'POST', body: '{}' },
      { 'content-type': 'application/json' },
    )
      .then((r) => void (fileToken = { ft: r.ft, exp: r.expiresAt }))
      .catch(() => undefined)
      .finally(() => void (refreshing = null));
    return refreshing;
  }

  return {
    status: () =>
      fetchWithin(f, `${base}/v1/status`, undefined, ms)
        .then(async (r) => {
          if (!r.ok) throw new ChatApiError(r.status);
          const p = StatusSchema.safeParse(await r.json().catch(() => null));
          if (!p.success) throw new ChatApiError(502, 'bad_response');
          const { llm, tts, demo, notice, probing, ttsReason, ttsNotice } = p.data;
          return {
            llm,
            tts,
            demo,
            ...(notice ? { notice } : {}),
            ...(probing ? { probing } : {}),
            ...(ttsReason ? { ttsReason } : {}),
            ...(ttsNotice ? { ttsNotice } : {}),
          };
        })
        .catch((e) => {
          throw e instanceof ChatApiError ? e : new ChatApiError(0);
        }),
    chats: async () => (await call(ChatsSchema, '/v1/chat/chats')).chats,
    history: async (chatId, opts = {}) => {
      const p = new URLSearchParams({ chatId, limit: String(opts.limit ?? 50) });
      if (opts.before) p.set('before', String(opts.before));
      const r = await call(HistorySchema, `/v1/chat/history?${p}`);
      return { messages: r.messages, hasMore: r.hasMore };
    },
    send: async (body) =>
      (
        await call(
          SendSchema,
          '/v1/chat/send',
          { method: 'POST', body: JSON.stringify(body) },
          { 'content-type': 'application/json' },
        )
      ).message,
    contextRef: async (sourceId, anchor) => {
      const p = new URLSearchParams({ sourceId });
      if (anchor) p.set('anchor', anchor);
      return call(ContextRefSchema, `/v1/chat/context-ref?${p}`);
    },
    upload: async (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await call(UploadSchema, '/v1/chat/upload', { method: 'POST', body: fd })).attachment;
    },
    imessageStatus: async () => {
      try {
        const res = await fetchWithin(f, `${base}/v1/imessage/status`, { headers: auth }, ms);
        if (!res.ok) return null;
        const parsed = ImessageStatusSchema.safeParse(await res.json().catch(() => null));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    citation: (file, page, context) =>
      call(
        ChatCitationExcerptSchema,
        `/v1/chat/citation?file=${q(file)}&page=${page}${context ? `&q=${q(context.slice(0, 1500))}` : ''}`,
      ),
    // <img>/<audio> cannot send headers: files take a file-scoped token (`ft`, 2 h), never the bearer token.
    prepare: refreshFileToken,
    async retryImessage(messageId) {
      try {
        await call(RetryAck, `/v1/imessage/messages/${q(messageId)}/retry`, { method: 'POST' });
        return true;
      } catch {
        return false;
      }
    },
    fileUrl: (att) => {
      if (/^(data|blob):/.test(att.url) || /^https?:/.test(att.url)) return att.url;
      if (fileToken && fileToken.exp - Date.now() < 15 * 60_000) void refreshFileToken();
      return `${base}${att.url}${fileToken ? `${att.url.includes('?') ? '&' : '?'}ft=${q(fileToken.ft)}` : ''}`;
    },

    subscribe(h, lastEventId) {
      const ES =
        o.EventSourceImpl ??
        (typeof EventSource !== 'undefined'
          ? // one hub connection for every tab and channel (see @squad/village/sources shared-stream)
            (SharedEventSource as unknown as typeof EventSource)
          : undefined);
      let es: EventSource | null = null;
      let closed = false;
      let last = lastEventId ?? 0;
      let attempt = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const retry = () => {
        if (closed) return;
        attempt += 1;
        timer = setTimeout(() => void open(), Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4)));
      };
      const parse = <T>(schema: z.ZodType<T>, raw: unknown): T | null => {
        if (typeof raw !== 'string') return null;
        try {
          const r = schema.safeParse(JSON.parse(raw));
          return r.success ? r.data : null;
        } catch {
          return null;
        }
      };

      async function open() {
        if (closed || paused || !ES) return;
        h.onState('connecting');
        let st = o.token;
        try {
          st = (
            await call(
              StreamTokenSchema,
              '/v1/squad/stream-token',
              { method: 'POST', body: '{}' },
              { 'content-type': 'application/json' },
            )
          ).st;
        } catch (e) {
          if (isExpired(e)) return h.onState('expired');
          h.onState('offline');
          return retry();
        }
        if (closed || paused) return;
        const url = `${base}/v1/chat/stream?st=${q(st)}${last ? `&lastEventId=${last}` : ''}`;
        const src = new ES(url);
        es = src;
        src.onopen = () => {
          attempt = 0;
          h.onState('live');
        };
        src.addEventListener('chat.message', (ev) => {
          const m = parse(ChatMessageSchema, (ev as MessageEvent).data);
          if (!m) return;
          last = Math.max(last, m.seq);
          h.onMessage(m);
        });
        src.addEventListener('chat.update', (ev) => {
          const u = parse(ChatUpdateSchema, (ev as MessageEvent).data);
          if (u) h.onUpdate(u);
        });
        src.addEventListener('chat.sync', (ev) => {
          const e = parse(ChatSyncEventSchema, (ev as MessageEvent).data);
          if (e) h.onSync?.(e);
        });
        src.addEventListener('chat.typing', (ev) => {
          const t = parse(ChatTypingSchema, (ev as MessageEvent).data);
          if (t) h.onTyping(t);
        });
        src.addEventListener('chat.resync', (ev) => {
          const r = parse(ResyncSchema, (ev as MessageEvent).data);
          if (r) {
            last = Math.max(last, r.seq);
            h.onResync(r.seq);
          }
        });
        src.onerror = () => {
          h.onState('offline');
          // CLOSED: the browser gave up (stale stream token, 4xx). Reopen with a fresh token and our own seq.
          if (src.readyState === 2) {
            src.close();
            retry();
          }
        };
      }
      // Browsers allow ~6 connections per origin over HTTP/1.1 and every open tab holds streams for as long as it
      // lives. A few forgotten background tabs starve every fetch of the tab in front (history and send queue forever
      // behind them), so a hidden tab lets its chat stream go and picks it up again, resyncing, when it is shown.
      const hiddenNow = () =>
        typeof document !== 'undefined' && document.visibilityState === 'hidden';
      let paused = false;
      const onVis = () => {
        if (closed) return;
        if (hiddenNow()) {
          if (paused) return;
          paused = true;
          if (timer) clearTimeout(timer);
          es?.close();
          es = null;
        } else if (paused) {
          paused = false;
          attempt = 0;
          void open().then(() => h.onResync(last));
        }
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
      if (hiddenNow()) paused = true;
      else void open();
      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        if (typeof document !== 'undefined')
          document.removeEventListener('visibilitychange', onVis);
        es?.close();
      };
    },
  };
}
