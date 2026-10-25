import { Hono } from 'hono';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const enc = new TextEncoder();
const CHANNELS = ['squad', 'chat'] as const;
type Channel = (typeof CHANNELS)[number];
const RETRY_MS = 2000;

const num = (s: string | undefined): number | undefined =>
  s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined;

/** `<squadSeq>:<chatSeq>` (either side may be empty); a plain number is the squad side only. */
export function parseCursor(raw: string | undefined): { squad?: number; chat?: number } {
  if (raw === undefined) return {};
  const m = /^(\d*):(\d*)$/.exec(raw);
  if (m) {
    const squad = num(m[1]);
    const chat = num(m[2]);
    return { ...(squad !== undefined ? { squad } : {}), ...(chat !== undefined ? { chat } : {}) };
  }
  const squad = num(raw);
  return squad !== undefined ? { squad } : {};
}

/**
 * GET /v1/stream: the squad broker stream and the chat stream for the same viewer on ONE connection (browsers cap
 * HTTP/1.1 at 6 connections per host, and every tab used to hold two SSEs). Filtering is exactly the legacy one: the
 * events come from `broker.subscribe` and `chat.subscribe` for this viewer, this route only wraps and merges them.
 */
export function createMultiplexRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();

  r.get('/v1/stream', requireViewer(deps, { allowQuery: true }), (c) => {
    const viewer = c.get('viewer');
    const wanted = new Set(
      (c.req.query('channels') ?? 'squad,chat').split(',').map((s) => s.trim()),
    );
    const channels = CHANNELS.filter((ch) => wanted.has(ch));
    if (channels.length === 0) return c.json({ error: { code: 'invalid_channels' } }, 400);

    const cursor = parseCursor(c.req.header('last-event-id') ?? c.req.query('lastEventId'));
    let squadSeq = num(c.req.query('squadLast')) ?? cursor.squad;
    let chatSeq = num(c.req.query('chatLast')) ?? cursor.chat;
    // An unknown side starts at the current head so every frame id is a complete cursor: a reconnect then replays
    // what happened after it instead of silently skipping the gap (read before subscribing: duplicates, never loss).
    if (channels.includes('squad')) squadSeq ??= deps.events.lastSeq();
    if (channels.includes('chat')) chatSeq ??= deps.chat.store.lastSeq();
    // head at subscribe time (same synchronous turn as the subscriptions below), reported in `hello`
    const head = {
      ...(channels.includes('squad') ? { squad: deps.events.lastSeq() } : {}),
      ...(channels.includes('chat') ? { chat: deps.chat.store.lastSeq() } : {}),
    };
    const subSquadFrom = squadSeq;
    const subChatFrom = chatSeq;
    const taskId = c.req.query('taskId') || undefined;

    interface Src {
      ch: Channel;
      it: AsyncIterator<unknown>;
      close: () => void;
      pending?: Promise<{ src: Src; r: IteratorResult<unknown> }>;
    }
    const srcs: Src[] = [];
    if (channels.includes('squad')) {
      const sub = deps.broker.subscribe(viewer, {
        ...(subSquadFrom !== undefined ? { afterSeq: subSquadFrom } : {}),
        ...(taskId ? { taskId } : {}),
      });
      srcs.push({
        ch: 'squad',
        it: sub.events[Symbol.asyncIterator](),
        close: () => sub.close(),
      });
    }
    if (channels.includes('chat')) {
      const sub = deps.chat.subscribe(viewer, subChatFrom);
      srcs.push({ ch: 'chat', it: sub.events[Symbol.asyncIterator](), close: () => sub.close() });
    }

    const cur = () => `${squadSeq ?? ''}:${chatSeq ?? ''}`;
    const sys = (event: string, data: unknown) =>
      enc.encode(`data: ${JSON.stringify({ ch: 'sys', event, data })}\n\n`);
    const frame = (ch: Channel, v: unknown): Uint8Array => {
      let event: string;
      let id: number | undefined;
      let data: unknown;
      if (ch === 'squad') {
        const s = v as { resync: number } | { id: number; event: string; data: unknown };
        if ('resync' in s) {
          event = 'x.resync';
          data = { seq: s.resync };
          squadSeq = s.resync;
        } else {
          event = s.event;
          id = s.id;
          data = s.data;
          squadSeq = Math.max(squadSeq ?? 0, s.id);
        }
      } else {
        const s = v as { event: string; id?: number; data: unknown };
        event = s.event;
        data = s.data;
        if (s.event === 'chat.message' && typeof s.id === 'number') {
          id = s.id;
          chatSeq = Math.max(chatSeq ?? 0, s.id);
        } else if (s.event === 'chat.resync') {
          chatSeq = (s.data as { seq: number }).seq;
        }
      }
      return enc.encode(`id: ${cur()}\ndata: ${JSON.stringify({ ch, event, id, data })}\n\n`);
    };

    let ping: ReturnType<typeof setInterval> | undefined;
    let done = false;
    const cleanup = () => {
      done = true;
      if (ping) clearInterval(ping);
      ping = undefined;
      for (const s of srcs) s.close();
    };
    deps.log.info('sse mux open', { squadId: viewer.squadId, channels, resume: cur() !== ':' });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(`retry: ${RETRY_MS}\n: connected\n\n`));
        controller.enqueue(
          sys('hello', {
            channels,
            pingMs: deps.config.sse.pingMs,
            retryMs: RETRY_MS,
            cursor: head,
          }),
        );
        ping = setInterval(() => {
          // skip when the client is not draining; the subscriptions drop it on queue overflow
          if ((controller.desiredSize ?? 0) > 0) controller.enqueue(sys('hb', { ts: deps.now() }));
        }, deps.config.sse.pingMs);
        ping.unref?.();
      },
      async pull(controller) {
        if (done) return;
        for (const s of srcs) s.pending ??= s.it.next().then((r) => ({ src: s, r }));
        const { src, r: n } = await Promise.race(srcs.map((s) => s.pending!));
        if (done) return;
        if (n.done) {
          // either side closing (overflow, per-student cap) ends the stream; the client reconnects with its cursor
          cleanup();
          controller.close();
          return;
        }
        src.pending = undefined;
        controller.enqueue(frame(src.ch, n.value));
      },
      cancel() {
        cleanup();
        deps.log.info('sse mux closed', { subs: deps.broker.count() });
      },
    });

    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  });

  return r;
}
