import {
  LiveSnapshotSchema,
  LiveStartResponseSchema,
  LiveStreamEventSchema,
  SENTINELS,
  VillageEventSchema,
  type LiveStreamEvent,
} from '@squad/core';
import { describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../app';
import { signToken } from '../auth';
import { filterEvent } from '../filter';
import { createLiveService } from '../live/service';
import { makeKit } from '../live/testkit';
import { FakeLive } from '../live/fake-client';
import type { LiveAgentClient, LiveConnectOptions } from '../live/types';

const SECRET = 'auth-test';
const FAKE_KEY = 'AIzaSyFAKE-KEY-FOR-LEAK-TEST-0123456789';

class Stall implements LiveAgentClient {
  connect(_o: LiveConnectOptions) {
    return Promise.resolve();
  }
  sendText() {}
  interrupt() {}
  close() {}
}

function setup(over: Parameters<typeof makeKit>[0] = {}) {
  const hub: Hub = createHub({
    config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
  });
  const kit = makeKit({
    limits: { maxTurns: 4 },
    village: (e) => void hub.deps.ingest.village(e),
    ...over,
  });
  hub.deps.live = createLiveService(kit.deps);
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  const tok = (sub: string, kind: 'bearer' | 'stream' = 'bearer') =>
    signToken(SECRET, { kind, sub, ttlMs: 60_000 }).token;
  const call = (path: string, sub: string | null, body?: unknown) =>
    hub.app.request(path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(sub ? { authorization: `Bearer ${tok(sub)}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const start = async (sub: string, body: unknown) => {
    const res = await call('/v1/live/start', sub, body);
    return { res, json: (await res.json()) as { id: string } };
  };
  const settle = async (id: string) => {
    await hub.deps.live!.get(id)!.settled();
  };
  return { hub, kit, tok, call, start, settle };
}

async function frames(res: Response): Promise<LiveStreamEvent[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .map((raw) => /^event: live\ndata: (.*)$/m.exec(raw)?.[1])
    .filter((d): d is string => !!d)
    .map((d) => JSON.parse(d) as LiveStreamEvent);
}

describe('live routes', () => {
  it('requires auth and validates the body', async () => {
    const { call } = setup();
    expect((await call('/v1/live/start', null, { topic: 'normal distribution' })).status).toBe(401);
    for (const b of [{}, { topic: 'x' }, { topic: 'fine topic', extra: 1 }]) {
      const r = await call('/v1/live/start', 's_ana', b);
      expect(r.status).toBe(400);
    }
    expect(
      (await call('/v1/live/start', 's_ana', { topic: 'a topic', chatId: 'group:other' })).status,
    ).toBe(403);
    expect((await call('/v1/live/ld_aaaaaaaaaaaa', null)).status).toBe(401);
  });

  it('start 202, snapshot valid, SSE is snapshot first, every event valid, ended last', async () => {
    const { call, start, settle, tok } = setup();
    const { res, json } = await start('s_ana', { topic: 'the normal distribution and z-scores' });
    expect(res.status).toBe(202);
    const body = LiveStartResponseSchema.parse(json);
    expect(body.streamUrl).toBe(`/v1/live/${body.id}/stream`);
    await settle(body.id);
    const snap = await call(body.resultUrl, 's_ana');
    expect(snap.status).toBe(200);
    expect(LiveSnapshotSchema.parse(await snap.json()).status).toBe('ended');
    // a squad mate watches; auth by query token like the council stream
    const s = await call(`${body.streamUrl}?st=${tok('s_ben', 'stream')}`, null);
    expect(s.status).toBe(200);
    expect(s.headers.get('content-type')).toContain('text/event-stream');
    const evs = await frames(s);
    expect(evs[0]!.k).toBe('snapshot');
    expect(evs.at(-1)!.k).toBe('ended');
    for (const e of evs) expect(LiveStreamEventSchema.safeParse(e).success).toBe(true);
  });

  it('live SSE delivers turns, captions and audio, then closes', async () => {
    const { start, call, tok, settle } = setup({ clients: () => new FakeLive({ speedMs: 2 }) });
    const { json } = await start('s_ana', { topic: 'regression and correlation' });
    const res = await call(`/v1/live/${json.id}/stream?st=${tok('s_ana', 'stream')}`, null);
    const evs = await frames(res);
    await settle(json.id);
    const kinds = new Set(evs.map((e) => e.k));
    for (const k of [
      'snapshot',
      'status',
      'floor',
      'caption',
      'turn',
      'audio',
      'takeaways',
      'ended',
    ])
      expect(kinds.has(k as never)).toBe(true);
    for (const e of evs) expect(LiveStreamEventSchema.safeParse(e).success).toBe(true);
  });

  it('404 (not 403) for another squad and for another viewer on a private run', async () => {
    const { call, start, settle } = setup();
    const pub = await start('s_ana', { topic: 'squad topic here' });
    const priv = await start('s_ben', { topic: 'private topic here', chatId: 'dm:s_ben' });
    await settle(pub.json.id);
    await settle(priv.json.id);
    expect((await call(`/v1/live/${pub.json.id}`, 's_zed')).status).toBe(404);
    expect((await call(`/v1/live/${pub.json.id}/stream`, 's_zed')).status).toBe(404);
    expect((await call(`/v1/live/${pub.json.id}`, 's_chi')).status).toBe(200);
    expect((await call(`/v1/live/${priv.json.id}`, 's_ana')).status).toBe(404);
    expect((await call(`/v1/live/${priv.json.id}/stream`, 's_ana')).status).toBe(404);
    expect((await call(`/v1/live/${priv.json.id}`, 's_ben')).status).toBe(200);
    expect((await call('/v1/live/ld_zzzzzzzzzzzz', 's_ana')).status).toBe(404);
    expect((await call('/v1/live/not-an-id', 's_ana')).status).toBe(404);
  });

  it('say and stop: only the asker steers; a stopped run rejects say', async () => {
    const { call, start, settle } = setup({
      clients: () => new FakeLive({ speedMs: 0 }),
      limits: { maxTurns: 40 },
    });
    const { json } = await start('s_ana', { topic: 'something long' });
    expect((await call(`/v1/live/${json.id}/say`, 's_ben', { text: 'hi there' })).status).toBe(403);
    expect((await call(`/v1/live/${json.id}/say`, 's_zed', { text: 'hi there' })).status).toBe(404);
    expect((await call(`/v1/live/${json.id}/say`, 's_ana', { text: '' })).status).toBe(400);
    expect(
      (await call(`/v1/live/${json.id}/say`, 's_ana', { text: 'I am lost', kind: 'lost' })).status,
    ).toBe(202);
    expect((await call(`/v1/live/${json.id}/stop`, 's_ana', {})).status).toBe(202);
    await settle(json.id);
    expect((await call(`/v1/live/${json.id}/say`, 's_ana', { text: 'late' })).status).toBe(409);
    const s = LiveSnapshotSchema.parse(await (await call(`/v1/live/${json.id}`, 's_ana')).json());
    expect(s.endReason).toBe('user_left');
    expect(s.turns.some((t) => t.speaker === 'user')).toBe(true);
  });

  it('429 busy while a run is active', async () => {
    const { start, hub } = setup({ clients: () => new Stall() });
    const a = await start('s_ana', { topic: 'first topic' });
    expect(a.res.status).toBe(202);
    const b = await start('s_ana', { topic: 'second topic' });
    expect(b.res.status).toBe(429);
    hub.deps.live!.get(a.json.id)!.hardStop();
  });

  it('actions: post-chat posts a live card, study-plan stores steps, quiz needs a quiz port', async () => {
    const { call, start, settle, hub } = setup();
    const { json } = await start('s_ana', { topic: 'the normal distribution' });
    await settle(json.id);
    const posted = await call(`/v1/live/${json.id}/actions/post-chat`, 's_ana', {});
    expect(posted.status).toBe(200);
    const out = (await posted.json()) as { ok: boolean; ref: string };
    expect(out.ref).toMatch(/^m_/);
    const m = hub.deps.chat.store.get(out.ref);
    expect(m?.card).toMatchObject({ type: 'live', liveId: json.id });
    expect(m?.sender.id).toBe('cubbie');
    expect((await call(`/v1/live/${json.id}/actions/post-chat`, 's_ben', {})).status).toBe(403);
    const plan = await call(`/v1/live/${json.id}/actions/study-plan`, 's_ana', {});
    expect(plan.status).toBe(200);
    expect(((await plan.json()) as { count: number }).count).toBeGreaterThan(0);
    const q = await call(`/v1/live/${json.id}/actions/quiz`, 's_ana', {});
    expect([200, 501]).toContain(q.status);
  });
});

describe('privacy', () => {
  it('sentinels and the api key never reach another viewer, the village stream or any payload', async () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = FAKE_KEY;
    try {
      const { call, start, settle, hub, tok } = setup();
      // a private run about the sentinels, and a squad run, side by side
      const priv = await start('s_ana', {
        topic: `my budget is ${SENTINELS[0]} and my ${SENTINELS[1]} plan`,
        chatId: 'dm:s_ana',
      });
      await settle(priv.json.id);
      const pub = await start('s_ben', { topic: 'the normal distribution' });
      await settle(pub.json.id);
      const mine = await (await call(`/v1/live/${priv.json.id}`, 's_ana')).text();
      expect(mine).toContain('therapy'); // the owner sees their own run
      // everything another viewer can get: snapshot, stream, village stream
      const gathered: string[] = [];
      for (const id of [priv.json.id, pub.json.id]) {
        const r1 = await call(`/v1/live/${id}`, 's_chi');
        gathered.push(await r1.text());
        const r2 = await call(`/v1/live/${id}/stream?st=${tok('s_chi', 'stream')}`, null);
        expect(r2.status).toBe(id === priv.json.id ? 404 : 200);
        gathered.push(await r2.text());
      }
      const viewer = { studentId: 's_chi', squadId: 'sq_demo', projector: false };
      const logged = hub.deps.events.since(0);
      expect(logged).not.toBe('too_old');
      const discussion = (logged as Exclude<typeof logged, 'too_old'>).filter((e) =>
        e.type.startsWith('discussion.'),
      );
      expect(discussion.length).toBeGreaterThan(0);
      for (const e of discussion) {
        expect(VillageEventSchema.safeParse(e.payload).success).toBe(true);
        gathered.push(
          JSON.stringify(
            filterEvent(e, { ...viewer, squadId: e.squadId ?? viewer.squadId }, hub.deps.filterCtx),
          ),
        );
        expect(JSON.stringify(e.payload)).not.toContain(FAKE_KEY);
        expect(JSON.stringify(e.payload)).not.toMatch(/180|therapy/);
      }
      // the squad's village events for a private run carry no text at all
      const privEvents = discussion.filter(
        (e) => (e.payload as { discussionId: string }).discussionId === priv.json.id,
      );
      for (const e of privEvents) expect((e.payload as { text?: string }).text).toBeUndefined();
      const all = gathered.join('\n') + mine;
      expect(all).not.toContain(FAKE_KEY);
      expect(gathered.filter((g) => g.includes(priv.json.id)).join('')).not.toMatch(/180/);
      expect(gathered.join('\n')).not.toContain('therapy');
      expect(gathered.join('\n')).not.toContain('$180');
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});
