import {
  ChatAttachmentSchema,
  ChatCitationExcerptSchema,
  ChatMessageSchema,
  ChatSummarySchema,
  ChatTypingSchema,
  ChatUpdateSchema,
  HubStatusSchema,
  type ChatAttachment,
  type ChatCitationExcerpt,
  type ChatMessage,
  type ChatSendBody,
  type ChatSummary,
  type ChatTyping,
  type ChatUpdate,
  type HubStatus,
} from '@squad/core';
import { z } from 'zod';

/** Everything the chat UI needs from the hub. Tests and the gallery inject a fake that implements this. */
export interface ChatApi {
  status(): Promise<HubStatus>;
  chats(): Promise<ChatSummary[]>;
  history(
    chatId: string,
    opts?: { before?: number; limit?: number },
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  send(body: ChatSendBody): Promise<ChatMessage>;
  upload(file: File): Promise<ChatAttachment>;
  /** `context` is the answer text: the hub opens the page at the sentence that best matches it. */
  citation(file: string, page: number, context?: string): Promise<ChatCitationExcerpt>;
  /** Absolute URL an <img>/<audio> can load for an attachment. */
  fileUrl(att: ChatAttachment): string;
  /** Fetches the file-scoped token that `fileUrl` puts in <img>/<audio> URLs (never the bearer token). */
  prepare?(): Promise<void>;
  /** Opens the live stream; returns a closer. `lastEventId` is a chat seq to resume after. */
  subscribe(h: StreamHandlers, lastEventId?: number): () => void;
}

export type StreamState = 'connecting' | 'live' | 'offline' | 'expired';
export interface StreamHandlers {
  onMessage(m: ChatMessage): void;
  onUpdate(u: ChatUpdate): void;
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
}

/** Fixed, user-safe copy. Never echoes a status line, body or schema error. */
export function chatErrorText(e: unknown, fallback: string): string {
  if (e instanceof ChatApiError) {
    if (e.status === 401) return 'Your session ended. Sign in again.';
    if (e.status === 429) return 'You are sending messages too fast. Wait a moment and try again.';
    if (e.status === 413) return 'That image is over 8 MB.';
    if (e.status === 415) return 'Only PNG, JPEG, WebP or GIF images can be sent.';
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
const SendSchema = z.object({ message: ChatMessageSchema });
const UploadSchema = z.object({ attachment: ChatAttachmentSchema });
const StreamTokenSchema = z.object({ st: z.string().min(1) });
const FileTokenSchema = z.object({ ft: z.string().min(1), expiresAt: z.number() });
const ResyncSchema = z.object({ seq: z.number() });

export interface HttpChatApiOptions {
  hubUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** injectable for tests */
  EventSourceImpl?: typeof EventSource;
}

export function createChatApi(o: HttpChatApiOptions): ChatApi {
  const base = o.hubUrl.replace(/\/+$/, '');
  const f: typeof fetch = o.fetchImpl ?? ((...a) => fetch(...a));
  const auth = { Authorization: `Bearer ${o.token}` };

  async function call<T>(
    schema: z.ZodType<T>,
    path: string,
    init?: RequestInit,
    headers: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { ...init, headers: { ...auth, ...headers } });
    } catch {
      throw new ChatApiError(0);
    }
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
      f(`${base}/v1/status`)
        .then(async (r) => {
          if (!r.ok) throw new ChatApiError(r.status);
          const p = StatusSchema.safeParse(await r.json().catch(() => null));
          if (!p.success) throw new ChatApiError(502, 'bad_response');
          const { llm, tts, demo, notice } = p.data;
          return { llm, tts, demo, ...(notice ? { notice } : {}) };
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
    upload: async (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await call(UploadSchema, '/v1/chat/upload', { method: 'POST', body: fd })).attachment;
    },
    citation: (file, page, context) =>
      call(
        ChatCitationExcerptSchema,
        `/v1/chat/citation?file=${q(file)}&page=${page}${context ? `&q=${q(context.slice(0, 1500))}` : ''}`,
      ),
    // <img>/<audio> cannot send headers: files take a file-scoped token (`ft`, 2 h), never the bearer token.
    prepare: refreshFileToken,
    fileUrl: (att) => {
      if (/^(data|blob):/.test(att.url) || /^https?:/.test(att.url)) return att.url;
      if (fileToken && fileToken.exp - Date.now() < 15 * 60_000) void refreshFileToken();
      return `${base}${att.url}${fileToken ? `${att.url.includes('?') ? '&' : '?'}ft=${q(fileToken.ft)}` : ''}`;
    },

    subscribe(h, lastEventId) {
      const ES =
        o.EventSourceImpl ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
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
        if (closed || !ES) return;
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
        if (closed) return;
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
      void open();
      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        es?.close();
      };
    },
  };
}
