// Live agent discussions (docs/live-discussion-api.md): start, snapshot, SSE stream, say, stop, actions.
// Same auth/visibility rules as the council: 404 (never 403) for runs the viewer may not see.
import {
  LiveSayBodySchema,
  LiveSnapshotSchema,
  LiveStartBodySchema,
  LiveStreamEventSchema,
  type ChatCard,
  type LiveActionResult,
  type LiveSnapshot,
  type LiveStartResponse,
  type LiveStreamEvent,
} from '@squad/core';
import { Hono } from 'hono';
import { requireViewer } from '../auth';
import type { LiveRun } from '../live/engine';
import { LiveStateError } from '../live/engine';
import { LiveBusyError } from '../live/service';
import { liveServiceFor } from '../live/wire';
import type { HubApp, HubDeps, HubEnv, Viewer } from '../types';

const enc = new TextEncoder();
const MAX_BODY_BYTES = 4096;
const RUN_ID = /^ld_[a-z0-9]{12}$/;
const err = (code: string) => ({ error: { code } });

async function readJson(c: {
  req: { arrayBuffer(): Promise<ArrayBuffer> };
}): Promise<{ ok: true; json: unknown } | { ok: false; status: 400 | 413 }> {
  const raw = new Uint8Array(await c.req.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return { ok: false, status: 413 };
  try {
    return { ok: true, json: JSON.parse(new TextDecoder().decode(raw)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

const first = (xs: string[], n: number): string[] => xs.slice(0, n);

function chatSummary(s: LiveSnapshot): string {
  const t = s.takeaways;
  const parts = [`Discussion on "${s.topic}" wrapped up.`];
  if (t.decisions.length)
    parts.push(
      `Decided: ${first(
        t.decisions.map((d) => d.text),
        2,
      ).join(' ')}`,
    );
  if (t.disagreements.length) parts.push(`Still open: ${t.disagreements[0]!.topic}.`);
  if (t.nextSteps.length) parts.push(`Next: ${t.nextSteps[0]!.text}`);
  return parts.join(' ').slice(0, 600);
}

export function createLiveRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const needSse = requireViewer(deps, { allowQuery: true });

  /** Squad scoping and privacy in one place. false means answer 404, never reveal existence. */
  const canSee = (run: LiveRun, v: Viewer): boolean =>
    run.visibility === 'private' ? run.askedBy === v.studentId : run.squadId === v.squadId;
  const find = (id: string, v: Viewer): LiveRun | undefined => {
    if (!RUN_ID.test(id)) return undefined;
    const run = liveServiceFor(deps).get(id);
    return run && canSee(run, v) ? run : undefined;
  };

  r.post('/v1/live/start', need, async (c) => {
    const viewer = c.get('viewer');
    const body = await readJson(c);
    if (!body.ok)
      return c.json(err(body.status === 413 ? 'too_large' : 'invalid_request'), body.status);
    const parsed = LiveStartBodySchema.safeParse(body.json);
    if (!parsed.success) return c.json(err('invalid_request'), 400);
    const { topic, chatId, mode } = parsed.data;
    if (chatId !== undefined) {
      const ok = chatId === `group:${viewer.squadId}` || chatId === `dm:${viewer.studentId}`;
      if (!ok) return c.json(err('forbidden'), 403);
    }
    let run: LiveRun;
    try {
      run = liveServiceFor(deps).start({
        topic,
        askedBy: viewer.studentId,
        squadId: viewer.squadId,
        ...(chatId !== undefined ? { chatId } : {}),
        visibility: chatId?.startsWith('dm:') ? 'private' : 'squad',
        ...(mode ? { mode } : {}),
      });
    } catch (e) {
      if (e instanceof LiveBusyError) return c.json(err(e.code), 429);
      throw e;
    }
    const out: LiveStartResponse = {
      id: run.id,
      streamUrl: `/v1/live/${run.id}/stream`,
      resultUrl: `/v1/live/${run.id}`,
    };
    return c.json(out, 202);
  });

  r.get('/v1/live/:id', need, (c) => {
    c.header('cache-control', 'no-store');
    const run = find(c.req.param('id'), c.get('viewer'));
    if (!run) return c.json(err('not_found'), 404);
    const out = LiveSnapshotSchema.safeParse(run.snapshot());
    if (!out.success) return c.json(err('internal'), 500);
    return c.json(out.data);
  });

  r.get('/v1/live/:id/stream', needSse, (c) => {
    const run = find(c.req.param('id'), c.get('viewer'));
    if (!run) return c.json(err('not_found'), 404);

    let unsub: (() => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let step = 0;
    const cleanup = () => {
      closed = true;
      if (ping) clearInterval(ping);
      ping = undefined;
      unsub?.();
      unsub = undefined;
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const finish = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        const send = (e: LiveStreamEvent) => {
          const ok = LiveStreamEventSchema.safeParse(e);
          if (!ok.success) return; // never ship a malformed event
          step += 1;
          controller.enqueue(
            enc.encode(`id: ${step}\nevent: live\ndata: ${JSON.stringify(ok.data)}\n\n`),
          );
        };
        controller.enqueue(enc.encode('retry: 2000\n: connected\n\n'));
        ping = setInterval(() => {
          if ((controller.desiredSize ?? 0) > 0) controller.enqueue(enc.encode(': ping\n\n'));
        }, deps.config.sse.pingMs);
        ping.unref?.();
        const snapshot = run.snapshot();
        send({ k: 'snapshot', snapshot });
        if (run.isFinal) {
          send({ k: 'ended', reason: snapshot.endReason ?? 'error', snapshot });
          return finish();
        }
        const u = run.subscribe((e) => {
          if (closed) return;
          send(e);
          if (e.k === 'ended') finish();
        });
        if (closed) u();
        else unsub = u;
      },
      cancel() {
        cleanup();
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

  /** Only the person who started the run steers it. Other squad members watch. */
  const owned = (c: { get(k: 'viewer'): Viewer; req: { param(k: string): string } }) => {
    const run = find(c.req.param('id'), c.get('viewer'));
    if (!run) return { code: 404 as const };
    if (run.askedBy !== c.get('viewer').studentId) return { code: 403 as const };
    return { run };
  };

  r.post('/v1/live/:id/say', need, async (c) => {
    const o = owned(c);
    if (!o.run) return c.json(err(o.code === 404 ? 'not_found' : 'forbidden'), o.code);
    const body = await readJson(c);
    if (!body.ok)
      return c.json(err(body.status === 413 ? 'too_large' : 'invalid_request'), body.status);
    const parsed = LiveSayBodySchema.safeParse(body.json);
    if (!parsed.success) return c.json(err('invalid_request'), 400);
    try {
      await o.run.say(parsed.data);
    } catch (e) {
      if (e instanceof LiveStateError) return c.json(err('ended'), 409);
      throw e;
    }
    return c.json({ ok: true }, 202);
  });

  r.post('/v1/live/:id/stop', need, (c) => {
    const o = owned(c);
    if (!o.run) return c.json(err(o.code === 404 ? 'not_found' : 'forbidden'), o.code);
    o.run.stop();
    return c.json({ ok: true }, 202);
  });

  r.post('/v1/live/:id/actions/post-chat', need, (c) => {
    const o = owned(c);
    if (!o.run) return c.json(err(o.code === 404 ? 'not_found' : 'forbidden'), o.code);
    const run = o.run;
    const snap = run.snapshot();
    const viewer = c.get('viewer');
    const chatId =
      run.chatId ??
      (run.visibility === 'private' ? `dm:${viewer.studentId}` : `group:${viewer.squadId}`);
    const card: ChatCard = { type: 'live', liveId: snap.id, topic: snap.topic.slice(0, 400) };
    const msg = deps.chat.postBot({
      chatId,
      personaId: 'cubbie',
      personaName: 'Nook',
      emoji: '\u{1F43B}',
      text: chatSummary(snap),
      citations: [],
      attachments: [],
      card,
    });
    if (!msg) return c.json(err('unavailable'), 409);
    const out: LiveActionResult = { ok: true, ref: msg.id };
    return c.json(out);
  });

  r.post('/v1/live/:id/actions/quiz', need, async (c) => {
    const o = owned(c);
    if (!o.run) return c.json(err(o.code === 404 ? 'not_found' : 'forbidden'), o.code);
    const start = deps.ports.quiz.start;
    if (!start) return c.json(err('unavailable'), 501);
    const snap = o.run.snapshot();
    const file =
      snap.takeaways.sources[0]?.file ?? snap.turns.flatMap((t) => t.citations)[0]?.file ?? '';
    const chapter = /^(ch\d+)/i.exec(file)?.[1]?.toLowerCase() ?? 'ch2';
    const quizId = await start.call(deps.ports.quiz, {
      chapter,
      students: [c.get('viewer').studentId],
    });
    const out: LiveActionResult = { ok: true, ref: String(quizId).slice(0, 80) };
    return c.json(out);
  });

  r.post('/v1/live/:id/actions/study-plan', need, (c) => {
    const o = owned(c);
    if (!o.run) return c.json(err(o.code === 404 ? 'not_found' : 'forbidden'), o.code);
    const snap = o.run.snapshot();
    const steps = snap.takeaways.nextSteps;
    deps.db.exec(
      'CREATE TABLE IF NOT EXISTS hub_live_plan(student TEXT NOT NULL, live_id TEXT NOT NULL, step_id TEXT NOT NULL, text TEXT NOT NULL, owner TEXT, due TEXT, PRIMARY KEY(student, live_id, step_id))',
    );
    const ins = deps.db.prepare(
      'INSERT OR REPLACE INTO hub_live_plan(student, live_id, step_id, text, owner, due) VALUES(?,?,?,?,?,?)',
    );
    for (const s of steps)
      ins.run(c.get('viewer').studentId, snap.id, s.id, s.text, s.owner ?? null, s.due ?? null);
    const out: LiveActionResult = { ok: true, count: steps.length };
    return c.json(out);
  });

  return r;
}
