import { Hono } from 'hono';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const enc = new TextEncoder();

export function createStreamRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();

  r.get('/v1/squad/stream', requireViewer(deps, { allowQuery: true }), (c) => {
    const viewer = c.get('viewer');
    const raw = c.req.header('last-event-id') ?? c.req.query('lastEventId');
    const afterSeq = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
    const taskId = c.req.query('taskId') || undefined;
    const sub = deps.broker.subscribe(viewer, {
      ...(afterSeq !== undefined ? { afterSeq } : {}),
      ...(taskId ? { taskId } : {}),
    });
    const it = sub.events[Symbol.asyncIterator]();
    let ping: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (ping) clearInterval(ping);
      ping = undefined;
      sub.close();
    };
    deps.log.info('sse open', {
      squadId: viewer.squadId,
      resume: afterSeq !== undefined,
      subs: deps.broker.count(),
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('retry: 2000\n: connected\n\n'));
        ping = setInterval(() => {
          // skip when the client is not draining; the broker drops it on queue overflow
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
        const v = n.value;
        const frame =
          'resync' in v
            ? `event: x.resync\ndata: ${JSON.stringify({ seq: v.resync })}\n\n`
            : `id: ${v.id}\nevent: ${v.event}\ndata: ${JSON.stringify(v.data)}\n\n`;
        controller.enqueue(enc.encode(frame));
      },
      cancel() {
        cleanup();
        deps.log.info('sse closed', { subs: deps.broker.count() });
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
