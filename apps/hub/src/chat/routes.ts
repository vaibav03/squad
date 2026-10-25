import { readFileSync, statSync } from 'node:fs';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ChatIdSchema, ChatSendBodySchema } from '@squad/core';
import type { MiddlewareHandler } from 'hono';
import { requireViewer, signToken, verifyToken, viewerFor } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';
import { canAccessChat } from './access';
import { collapseRepeatedPairs } from './dedupe';
import { excerptWindow } from './excerpt';
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from './files';

const enc = new TextEncoder();
const err = (code: string) => ({ error: { code } });
const History = z.object({
  chatId: ChatIdSchema,
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Magic-byte check so a mislabelled upload is rejected, whatever the client claims. */
export function sniffImage(b: Uint8Array): (typeof UPLOAD_TYPES)[number] | undefined {
  const at = (i: number, ...x: number[]) => x.every((v, k) => b[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

export function createChatRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const chat = () => deps.chat;

  r.get('/v1/chat/chats', need, (c) => c.json({ chats: chat().summaries(c.get('viewer')) }));

  r.get('/v1/chat/history', need, (c) => {
    const q = History.safeParse(c.req.query());
    if (!q.success) return c.json(err('invalid'), 400);
    if (!canAccessChat(c.get('viewer'), q.data.chatId)) return c.json(err('forbidden'), 403);
    const h = chat().store.history(q.data.chatId, {
      ...(q.data.before !== undefined ? { before: q.data.before } : {}),
      limit: q.data.limit,
    });
    // history already on the account from before the send guard: exact repeated prompt+answer pairs show once
    return c.json({ chatId: q.data.chatId, ...h, messages: collapseRepeatedPairs(h.messages) });
  });

  r.post(
    '/v1/chat/send',
    need,
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json(err('too_large'), 413) }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(err('invalid'), 400);
      }
      const body = ChatSendBodySchema.safeParse(raw);
      if (!body.success) return c.json(err('invalid'), 400);
      const res = await chat().send(c.get('viewer'), body.data);
      if (!res.ok) return c.json(err(res.code), res.status);
      return c.json(
        {
          message: res.message,
          ...(res.duplicate ? { duplicate: true } : {}),
          ...(res.hint ? { hint: res.hint } : {}),
        },
        202,
      );
    },
  );

  r.post(
    '/v1/chat/upload',
    need,
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
      onError: (c) => c.json(err('too_large'), 413),
    }),
    async (c) => {
      const v = c.get('viewer');
      let form: Record<string, unknown>;
      try {
        form = await c.req.parseBody();
      } catch {
        return c.json(err('invalid'), 400);
      }
      const f = form.file;
      if (!(f instanceof File)) return c.json(err('invalid'), 400);
      if (f.size > MAX_UPLOAD_BYTES) return c.json(err('too_large'), 413);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sniffed = sniffImage(bytes);
      if (!sniffed || !(UPLOAD_TYPES as readonly string[]).includes(f.type) || sniffed !== f.type)
        return c.json(err('unsupported_type'), 415);
      chat().files.sweep(); // unsent uploads older than an hour go away
      const saved = chat().files.saveUpload(v.studentId, bytes, sniffed, f.name);
      if (!saved) return c.json(err('upload_limit'), 429);
      return c.json({ attachment: saved });
    },
  );

  // A file-scoped token (`ft`, 2 h) can read chat files and nothing else, so it is safe in an <img src>.
  const FILE_TTL = 2 * 60 * 60 * 1000;
  r.post('/v1/chat/file-token', need, (c) => {
    const { token, expiresAt } = signToken(
      deps.config.authSecret,
      { kind: 'file', sub: c.get('viewer').studentId, ttlMs: FILE_TTL },
      deps.now(),
    );
    return c.json({ ft: token, expiresAt });
  });
  const fileViewer: MiddlewareHandler<HubEnv> = async (c, next) => {
    const h = c.req.header('authorization');
    const sub = h?.startsWith('Bearer ')
      ? verifyToken(deps.config.authSecret, h.slice(7), ['bearer'], deps.now())?.sub
      : (verifyToken(deps.config.authSecret, c.req.query('ft'), ['file'], deps.now())?.sub ??
        verifyToken(deps.config.authSecret, c.req.query('st'), ['stream', 'bearer'], deps.now())
          ?.sub);
    const viewer = sub ? viewerFor(deps, sub) : null;
    if (!viewer) return c.json(err('unauthorized'), 401);
    c.set('viewer', viewer);
    await next();
  };

  r.get('/v1/chat/files/:token', fileViewer, (c) => {
    const file = chat().files.open(c.req.param('token'), c.get('viewer'));
    if (!file) return c.json(err('not_found'), 404);
    const size = statSync(file.path).size;
    const buf = readFileSync(file.path);
    const headers: Record<string, string> = {
      'content-type': file.mime,
      // a student's own uploads and DM files are not left in a shared browser cache
      'cache-control':
        file.chatId === null || file.chatId.startsWith('dm:')
          ? 'private, no-store'
          : 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      'content-disposition': 'inline',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end)
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      return new Response(buf.subarray(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': String(end - start + 1),
        },
      });
    }
    return new Response(buf, { headers: { ...headers, 'content-length': String(size) } });
  });

  r.get('/v1/chat/citation', need, (c) => {
    const q = z
      .object({
        file: z.string().min(1).max(200),
        page: z.coerce.number().int().positive(),
        q: z.string().max(2000).optional(),
      })
      .safeParse(c.req.query());
    if (!q.success) return c.json(err('invalid'), 400);
    const ex = chat().engine?.excerpt(q.data.file, q.data.page);
    if (!ex) return c.json(err('not_found'), 404);
    const w = excerptWindow(ex.text, q.data.q);
    return c.json({
      file: q.data.file,
      page: q.data.page,
      ...(ex.chapter ? { chapter: ex.chapter } : {}),
      ...(ex.title ? { title: ex.title } : {}),
      excerpt: w.excerpt,
      ...(w.highlight ? { highlight: w.highlight } : {}),
    });
  });

  r.get('/v1/chat/stream', requireViewer(deps, { allowQuery: true }), (c) => {
    const viewer = c.get('viewer');
    const raw = c.req.header('last-event-id') ?? c.req.query('lastEventId');
    const afterSeq = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
    const sub = chat().subscribe(viewer, afterSeq);
    const it = sub.events[Symbol.asyncIterator]();
    let ping: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (ping) clearInterval(ping);
      ping = undefined;
      sub.close();
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('retry: 2000\n: connected\n\n'));
        ping = setInterval(() => {
          if ((controller.desiredSize ?? 0) > 0) controller.enqueue(enc.encode(': ping\n\n'));
        }, deps.config.sse.pingMs);
        ping.unref?.();
      },
      async pull(controller) {
        const n = await it.next();
        if (n.done) {
          cleanup();
          controller.close();
          return;
        }
        const w = n.value;
        const id = w.event === 'chat.message' ? `id: ${w.id}\n` : '';
        controller.enqueue(
          enc.encode(`${id}event: ${w.event}\ndata: ${JSON.stringify(w.data)}\n\n`),
        );
      },
      cancel: cleanup,
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
