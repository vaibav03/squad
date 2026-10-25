// Ask the council (docs/council-api.md): start a run, read its snapshot, watch it over SSE.
// The service itself is built with the real ports, or lazily with the deterministic demo model.
import type { CouncilService } from '@squad/brain';
import {
  CouncilAskBodySchema,
  CouncilResultSchema,
  type CouncilAction,
  type CouncilAskResponse,
  CouncilLiveEventSchema,
  type CouncilResult,
  CouncilRunsResponseSchema,
  CouncilStatusSchema,
  councilRunActions,
  councilRunOwner,
  type VillageEvent,
} from '@squad/core';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireViewer } from '../auth';
import { COURSE_ID } from '../cast';
import { createCouncilViewerData } from '../council/viewer-data';
import { buildCouncilStatus } from '../council/status';
import { createCouncilLiveHub } from '../council/live/hub';
import type { HubApp, HubDeps, HubEnv, Viewer } from '../types';

const enc = new TextEncoder();
const MAX_BODY_BYTES = 4096;
const RUN_ID = /^cn_[a-z0-9]{12}$/;

const ActionBodySchema = z.strictObject({ actionId: z.string().min(1).max(40) });

const err = (code: string) => ({ error: { code } });

/** Duck-typed so this module never imports brain at runtime (createHub stays light). */
function busyCode(e: unknown): 'busy' | 'rate_limited' | undefined {
  if (!(e instanceof Error) || e.name !== 'CouncilBusyError') return undefined;
  return (e as Error & { code?: string }).code === 'rate_limited' ? 'rate_limited' : 'busy';
}

export function createCouncilRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const needSse = requireViewer(deps, { allowQuery: true });

  let pending: Promise<CouncilService> | undefined;
  const service = (): Promise<CouncilService> => {
    if (deps.council) return Promise.resolve(deps.council);
    pending ??= buildDemoService(deps).then((s) => (deps.council ??= s));
    return pending;
  };

  /** Squad scoping and privacy in one place. false means answer 404, never reveal existence. */
  const canSee = (res: CouncilResult, viewer: Viewer): boolean => {
    if (res.visibility === 'private') return res.askedBy === viewer.studentId;
    return deps.directory.squadOf(res.askedBy) === viewer.squadId;
  };

  const liveHub = () => (deps.councilLive ??= createCouncilLiveHub(process.env, () => deps.now()));

  /** Provider, models, key state (with the fix), transports and A2A counters. Viewer-safe, no secrets. */
  r.get('/v1/council/status', need, (c) => {
    c.header('cache-control', 'no-store');
    liveHub();
    const out = CouncilStatusSchema.safeParse(
      buildCouncilStatus(deps, process.env, c.get('viewer').squadId),
    );
    if (!out.success) return c.json(err('internal'), 500);
    return c.json(out.data);
  });

  /** The last council runs of the viewer's squad (newest first), filtered like the live stream. */
  r.get('/v1/council/runs', need, async (c) => {
    c.header('cache-control', 'no-store');
    const viewer = c.get('viewer');
    const key = c.req.query('council');
    const limit = Number(c.req.query('limit') ?? '20');
    const svc = deps.council;
    const runs =
      deps.councilRuns?.list(viewer, {
        ...(key && /^[a-z][a-z-]{1,23}$/.test(key) ? { councilKey: key } : {}),
        ...(Number.isFinite(limit) ? { limit } : {}),
        result: (id) => {
          const res = svc?.get(id);
          return res && canSee(res, viewer) ? res : undefined;
        },
      }) ?? [];
    const out = CouncilRunsResponseSchema.safeParse({ runs });
    if (!out.success) return c.json(err('internal'), 500);
    return c.json(out.data);
  });

  r.post('/v1/council/ask', need, async (c) => {
    const viewer = c.get('viewer');
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (raw.byteLength > MAX_BODY_BYTES) return c.json(err('too_large'), 413);
    let json: unknown = null;
    try {
      json = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      /* invalid */
    }
    const parsed = CouncilAskBodySchema.safeParse(json);
    if (!parsed.success) return c.json(err('invalid_request'), 400);
    const { question, chatId, transport } = parsed.data;
    if (chatId !== undefined) {
      const ok = chatId === `group:${viewer.squadId}` || chatId === `dm:${viewer.studentId}`;
      if (!ok) return c.json(err('forbidden'), 403);
    }
    const svc = await service();
    let handle;
    try {
      handle = svc.ask({
        question,
        askedBy: viewer.studentId,
        ...(chatId !== undefined ? { chatId } : {}),
        visibility: chatId?.startsWith('dm:') ? 'private' : 'squad',
        ...(transport ? { transport } : {}),
      });
    } catch (e) {
      const code = busyCode(e);
      if (code) return c.json(err(code), 429);
      throw e;
    }
    const body: CouncilAskResponse = {
      id: handle.id,
      status: handle.result().status,
      streamUrl: `/v1/council/${handle.id}/stream`,
      resultUrl: `/v1/council/${handle.id}`,
    };
    return c.json(body, 202);
  });

  r.get('/v1/council/:id', need, async (c) => {
    const id = c.req.param('id');
    c.header('cache-control', 'no-store');
    if (!RUN_ID.test(id)) return c.json(err('not_found'), 404);
    const res = (await service()).get(id);
    if (!res || !canSee(res, c.get('viewer'))) return c.json(err('not_found'), 404);
    const out = CouncilResultSchema.safeParse(res);
    if (!out.success) return c.json(err('internal'), 500);
    return c.json(out.data);
  });

  /**
   * Action items of a run (CouncilResult.actions). The client names an item by id; the text always comes from the
   * run, never from the request body. Unknown runs, runs of another squad and other people's private runs are all
   * 404 (canSee, existence is never revealed); an unknown item is 404 `action_not_found`.
   */
  type Got = { res: Response } | { action: CouncilAction };
  const actionFor = async (c: Context<HubEnv>): Promise<Got> => {
    const id = c.req.param('id') ?? '';
    const notFound = { res: c.json(err('not_found'), 404) as unknown as Response };
    if (!RUN_ID.test(id)) return notFound;
    const viewer = c.get('viewer');
    const run = (await service()).get(id);
    // Runs that are not CouncilService runs (Round Table, Debate) are known by their A2A owner record only.
    const owner = run ? undefined : councilRunOwner(id);
    if (run ? !canSee(run, viewer) : !owner) return notFound;
    if (owner) {
      const seen = owner.private
        ? owner.askedBy === viewer.studentId
        : deps.directory.squadOf(owner.askedBy) === viewer.squadId;
      if (!seen) return notFound;
    }
    const body = ActionBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return { res: c.json(err('invalid_request'), 400) as unknown as Response };
    const action = (run ? run.actions : councilRunActions(id))?.find(
      (a) => a.id === body.data.actionId,
    );
    if (!action) return { res: c.json(err('action_not_found'), 404) as unknown as Response };
    return { action };
  };

  r.post('/v1/council/:id/actions/plan', need, async (c) => {
    const viewer = c.get('viewer');
    const got = await actionFor(c);
    if ('res' in got) return got.res;
    const res = deps.plans.addItem(viewer, {
      title: got.action.title,
      ...(got.action.detail ? { detail: got.action.detail } : {}),
      source: 'council',
    });
    if (!res.ok)
      return c.json(
        { ok: false, error: { code: res.code, message: res.message } },
        res.status as 403 | 409 | 422,
      );
    if (res.say.text) deps.plans.post(viewer.squadId, res.say);
    return c.json({
      ok: true,
      added: res.say.text !== '',
      planId: res.plan.id,
      rev: res.plan.rev,
    });
  });

  r.post('/v1/council/:id/actions/chat', need, async (c) => {
    const viewer = c.get('viewer');
    const got = await actionFor(c);
    if ('res' in got) return got.res;
    const who = deps.directory.student(viewer.studentId)?.name ?? 'Someone';
    const posted = deps.chat.postBot({
      chatId: `group:${viewer.squadId}`,
      personaId: 'cubbie',
      personaName: 'Squad',
      emoji: '🐻',
      text: `Council action item (shared by ${who}): ${got.action.title}`,
      citations: [],
      attachments: [],
    });
    if (!posted) return c.json({ ok: false, error: { code: 'chat_unavailable' } }, 409);
    return c.json({ ok: true, messageId: posted.id });
  });

  /**
   * Captions and audio of a Gemini Live council (`CouncilLiveEvent`): who holds the floor, the streaming transcript
   * per turn, base64 PCM only when `?audio=1`. Same visibility as the run (404 otherwise). Text is replayed on connect.
   */
  r.get('/v1/council/:id/live', needSse, async (c) => {
    const viewer = c.get('viewer');
    const id = c.req.param('id');
    if (!RUN_ID.test(id)) return c.json(err('not_found'), 404);
    const run = (await service()).get(id);
    if (!run || !canSee(run, viewer)) return c.json(err('not_found'), 404);
    const withAudio = c.req.query('audio') === '1';
    const channel = liveHub().channel(id);
    let unsub: (() => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (ping) clearInterval(ping);
      ping = undefined;
      unsub?.();
      unsub = undefined;
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let step = 0;
        const finish = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        controller.enqueue(enc.encode('retry: 2000\n: connected\n\n'));
        ping = setInterval(() => {
          if ((controller.desiredSize ?? 0) > 0) controller.enqueue(enc.encode(': ping\n\n'));
        }, deps.config.sse.pingMs);
        ping.unref?.();
        unsub = channel.subscribe((ev) => {
          if (ev.t === 'audio' && !withAudio) return;
          const ok = CouncilLiveEventSchema.safeParse(ev);
          if (!ok.success) return;
          step += 1;
          controller.enqueue(
            enc.encode(`id: ${step}\nevent: live\ndata: ${JSON.stringify(ok.data)}\n\n`),
          );
        });
        // close when the run is over (its channel ends with it); poll cheaply, runs are short
        const t = setInterval(() => {
          void service().then((svc) => {
            if (channel.ended || svc.get(id)?.status !== 'running') {
              clearInterval(t);
              finish();
            }
          });
        }, 700);
        t.unref?.();
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

  /** The asker steers a running Live council by text (or a push-to-talk transcript): the speaker is cut off, the chair answers. */
  r.post('/v1/council/:id/say', need, async (c) => {
    const viewer = c.get('viewer');
    const id = c.req.param('id');
    if (!RUN_ID.test(id)) return c.json(err('not_found'), 404);
    const run = (await service()).get(id);
    if (!run || !canSee(run, viewer)) return c.json(err('not_found'), 404);
    if (run.askedBy !== viewer.studentId) return c.json(err('forbidden'), 403);
    if (run.status !== 'running') return c.json(err('ended'), 409);
    const body = z
      .strictObject({ text: z.string().trim().min(1).max(300) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err('invalid_request'), 400);
    if (!liveHub().channel(id).live) return c.json(err('not_live'), 409);
    liveHub().channel(id).interject(body.data.text);
    return c.json({ ok: true }, 202);
  });

  r.get('/v1/council/:id/stream', needSse, async (c) => {
    const viewer = c.get('viewer');
    const id = c.req.param('id');
    if (!RUN_ID.test(id)) return c.json(err('not_found'), 404);
    const svc = await service();
    const first = svc.get(id);
    if (!first || !canSee(first, viewer)) return c.json(err('not_found'), 404);

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
        const send = (event: string, data: unknown) => {
          step += 1;
          controller.enqueue(
            enc.encode(`id: ${step}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };
        controller.enqueue(enc.encode('retry: 2000\n: connected\n\n'));
        ping = setInterval(() => {
          if ((controller.desiredSize ?? 0) > 0) controller.enqueue(enc.encode(': ping\n\n'));
        }, deps.config.sse.pingMs);
        ping.unref?.();
        const onSnapshot = (snap: CouncilResult) => {
          if (closed) return;
          const ok = CouncilResultSchema.safeParse(snap);
          if (!ok.success || !canSee(snap, viewer)) return finish();
          send('council.step', ok.data);
          if (snap.status !== 'running') {
            send('council.done', ok.data);
            finish();
          }
        };
        const u = svc.subscribe(id, onSnapshot);
        if (!u) return finish();
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

  return r;
}

/** Demo hub (stub ports, no GEMINI_API_KEY): deterministic model, fixture course for grounding when it loads. */
async function buildDemoService(deps: HubDeps): Promise<CouncilService> {
  const {
    createBrain,
    createCouncilAgents,
    createCouncilService,
    createDemoCouncilLlm,
    loadFixtureCourse,
  } = await import('@squad/brain');
  const llm = createDemoCouncilLlm();
  const emit = (e: VillageEvent) => {
    deps.ingest.village(e);
  };
  let brain;
  try {
    brain = createBrain({
      llm,
      db: deps.db,
      emit: (e: VillageEvent) => {
        if (e.t !== 'call.caption') emit(e);
      },
    });
    if (!brain.store.getCourse(COURSE_ID))
      await loadFixtureCourse({ store: brain.store }, COURSE_ID);
  } catch {
    brain = undefined; // ungrounded: members say it is general reasoning
  }
  return createCouncilService({
    llm,
    db: deps.db,
    emit,
    ...(brain ? { brain, courseId: () => COURSE_ID } : {}),
    demo: true,
    viewer: createCouncilViewerData(deps, { courseId: () => COURSE_ID }),
    // no real model here: every run is an honestly labelled scripted demo run
    agents: createCouncilAgents({ env: process.env, emit }),
  });
}
