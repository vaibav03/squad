import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VILLAGE_EVENT_TYPES, validateReplay, type LlmStatus } from '@squad/core';
import WebSocket from 'ws';
import type { RunningHub } from '../../src/server';
import { boot, emit, get, login, openSse, post, auth } from '../helpers';

let hub: RunningHub;
let url: string;
let ana: string;
let ben: string;

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  ana = await login(url, 's_ana');
  ben = await login(url, 's_ben');
});
afterAll(async () => {
  await hub.stop();
});

const stream = async (token: string, lastEventId?: number, query?: string) => {
  const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, token);
  return openSse(url, {
    st: body.st,
    ...(lastEventId !== undefined ? { lastEventId } : {}),
    ...(query ? { query } : {}),
  });
};

describe('ingest and stream', () => {
  it('rejects /internal/events without the secret (401) and never parses the body', async () => {
    const r = await post(url, '/internal/events', { t: 'agent.state' });
    expect(r.status).toBe(401);
    const bad = await post(url, '/internal/events', { t: 'agent.state' }, undefined, {
      'x-nook-internal': 'nope',
    });
    expect(bad.status).toBe(401);
  });

  it('rejects an invalid event with 422 and issues that never echo the submitted value', async () => {
    const r = await emit(url, {
      t: 'ledger.entry',
      taskId: 'x',
      student: 's_ana',
      field: 'budget',
      withheld: '$180',
    });
    expect(r.status).toBe(422);
    expect(r.text).not.toContain('$180');
    expect(r.text).toContain('invalid_event');
  });

  it('delivers an ingested event to a subscriber, every event type round-trips', async () => {
    const s = await stream(ana);
    const sample = validateReplay(
      await (
        await import('node:fs/promises')
      ).readFile(
        new URL('../../../../packages/core/fixtures/sample-replay.json', import.meta.url),
        'utf8',
      ),
    );
    if (!sample.ok) throw new Error('fixture invalid');
    // keep only the events Ana is allowed to see; every type must come through for her
    for (const { event } of sample.script.events) {
      // the fixture's squad id is not the seeded one; route it to the demo squad
      const r = await emit(
        url,
        event.t === 'trip.confirmed' ? { ...event, squadId: 'sq_demo' } : event,
      );
      expect(r.status).toBe(200);
    }
    await s.waitFor((f) => f.some((x) => x.event === 'trip.confirmed'));
    const seen = new Set(s.frames.map((f) => f.event));
    for (const t of VILLAGE_EVENT_TYPES) expect(seen.has(t), `missing ${t}`).toBe(true);
    s.stop();
  });

  it('late joiner: snapshot then Last-Event-ID resume loses nothing', async () => {
    const snap0 = await get<{ seq: number }>(url, '/v1/squad/state', ana);
    await emit(url, { t: 'agent.state', agent: 'student:s_chi', state: 'studying' });
    await emit(url, { t: 'agent.state', agent: 'student:s_dev', state: 'studying' });
    const s = await stream(ana, snap0.body.seq);
    await s.waitFor((f) => f.filter((x) => x.event === 'agent.state').length >= 2);
    const ids = s.frames.filter((f) => f.id).map((f) => Number(f.id));
    expect(ids[0]).toBeGreaterThan(snap0.body.seq);
    expect(new Set(ids).size).toBe(ids.length);
    s.stop();
  });

  it('too-old resume asks for a resync', async () => {
    const small = await boot({ sse: { bufferSize: 3, maxQueue: 256, pingMs: 15000 } });
    try {
      for (let i = 0; i < 10; i++)
        await emit(small.url, {
          t: 'agent.state',
          agent: 'dean',
          state: i % 2 ? 'idle' : 'studying',
        });
      const t = await login(small.url, 's_ana');
      const { body } = await post<{ st: string }>(small.url, '/v1/squad/stream-token', {}, t);
      const s = await openSse(small.url, { st: body.st, lastEventId: 1 });
      await s.waitFor((f) => f.some((x) => x.event === 'x.resync'));
      s.stop();
    } finally {
      await small.stop();
    }
  });

  it('a stream without a valid token is 401', async () => {
    const r = await fetch(`${url}/v1/squad/stream?st=bogus`);
    expect(r.status).toBe(401);
  });

  it('client abort leaves no subscriber behind', async () => {
    const before = hub.deps.broker.count();
    const s = await stream(ben);
    expect(hub.deps.broker.count()).toBe(before + 1);
    s.stop();
    for (let i = 0; i < 40 && hub.deps.broker.count() !== before; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(hub.deps.broker.count()).toBe(before);
  });
});

describe('viewer filtering', () => {
  it("Ben never receives Ana's confirms or mastery, but sees ledger 'hidden'", async () => {
    const s = await stream(ben);
    await emit(url, {
      t: 'confirm.pending',
      student: 's_ana',
      taskId: 't1',
      question: 'Share your budget?',
    });
    await emit(url, { t: 'mastery.changed', student: 's_ana', chapter: 'ch6', box: 3 });
    await emit(url, {
      t: 'ledger.entry',
      taskId: 't1',
      student: 's_ana',
      field: 'budget',
      withheld: 'hidden',
    });
    await s.waitFor((f) => f.some((x) => x.event === 'ledger.entry'));
    expect(
      s.frames.some((f) => f.event === 'confirm.pending' || f.event === 'mastery.changed'),
    ).toBe(false);
    const led = JSON.parse(s.frames.find((f) => f.event === 'ledger.entry')!.data!);
    expect(led.withheld).toBe('hidden');
    s.stop();
  });

  it("Ben's trip view has no Ana limits; Ana sees her own", async () => {
    const b = await get<{ myLimits: unknown }>(url, '/v1/trips/trip_cabo', ben);
    expect(JSON.stringify(b.body)).not.toMatch(/\$180|therapy/i);
    const a = await get<{ myLimits: { budget: string } }>(url, '/v1/trips/trip_cabo', ana);
    expect(a.body.myLimits.budget).toBe('$180');
  });

  it('quiz payload and answer omit correct by default', async () => {
    const q = await get<Record<string, unknown>>(url, '/v1/quiz/qz_ch6_1', ana);
    expect(q.status).toBe(200);
    expect(JSON.stringify(q.body)).not.toMatch(/correct|explanation|answer/i);
    const a = await post<Record<string, unknown>>(
      url,
      '/v1/quiz/qz_ch6_1/answer',
      { choice: 'b' },
      ana,
    );
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ recorded: true });
    const again = await post(url, '/v1/quiz/qz_ch6_1/answer', { choice: 'b' }, ana);
    expect(again.status).toBe(409);
    const both = await post(url, '/v1/quiz/qz_ch6_2/answer', { choice: 'a', text: 'x' }, ben);
    expect(both.status).toBe(400);
  });

  it('answer reveals correctness only when the squad setting allows', async () => {
    await emit(url, {
      type: 'x.squad.settings',
      data: { squadId: 'sq_demo', revealQuizCorrectness: true },
    });
    const c = await login(url, 's_chi');
    const a = await post<{ correct: boolean; explanation: string }>(
      url,
      '/v1/quiz/qz_ch6_1/answer',
      { choice: 'b' },
      c,
    );
    expect(a.body.correct).toBe(true);
    expect(a.body.explanation).toBeTruthy();
    await emit(url, {
      type: 'x.squad.settings',
      data: { squadId: 'sq_demo', revealQuizCorrectness: false },
    });
  });
});

describe('trip.confirmed and mastery', () => {
  it('trip.confirmed reaches the stream once, only after every student confirmed', async () => {
    await post(url, '/__sim/squad/reset', {});
    const s = await stream(ana);
    const tokens = await Promise.all(
      ['s_ana', 's_ben', 's_chi', 's_dev'].map((id) => login(url, id)),
    );
    const premature = await emit(url, {
      t: 'trip.confirmed',
      taskId: 'task_trip_cabo',
      squadId: 'sq_demo',
    });
    expect((premature.body as { dropped?: string }).dropped).toBe('trip_not_complete');
    for (const t of tokens) {
      const r = await post(url, '/v1/trips/trip_cabo/confirm', { optionId: 'vegas', yes: true }, t);
      expect(r.status).toBe(200);
    }
    await s.waitFor((f) => f.some((x) => x.event === 'trip.confirmed'));
    const dup = await emit(url, {
      t: 'trip.confirmed',
      taskId: 'task_trip_cabo',
      squadId: 'sq_demo',
    });
    expect((dup.body as { dropped?: string }).dropped).toBe('duplicate_trip_confirmed');
    await new Promise((r) => setTimeout(r, 100));
    expect(s.frames.filter((f) => f.event === 'trip.confirmed')).toHaveLength(1);
    s.stop();
  });

  it('a squad of 2 gets no averages or counts', async () => {
    const small = await boot();
    try {
      small.deps.directory.upsertSquad({
        id: 'sq_demo',
        name: 'Pair',
        members: ['s_ana', 's_ben'],
      });
      const t = await login(small.url, 's_ana');
      const m = await get<{ squadAvg: unknown }>(small.url, '/v1/mastery/demo', t);
      expect(m.body.squadAvg).toBeNull();
      expect(JSON.stringify(m.body)).not.toContain('"squad"');
      const st = await get<{ squad: { memberCount: unknown } }>(small.url, '/v1/squad/state', t);
      expect(st.body.squad.memberCount).toBeNull();
      const trip = await get<{ voteProgress: unknown; votes?: unknown; tallies?: unknown }>(
        small.url,
        '/v1/trips/trip_cabo',
        t,
      );
      expect(trip.body.voteProgress).toBeNull(); // squads under 3 get no counts
      expect(trip.body.tallies).toBeUndefined(); // the ballot is secret: no tallies, no other rankings
      expect(trip.body.votes).toBeUndefined();
    } finally {
      await small.stop();
    }
  });

  it('a squad of 4 gets averages', async () => {
    const m = await get<{ squadAvg: number[] }>(url, '/v1/mastery/demo', ana);
    expect(m.body.squadAvg).toHaveLength(4);
  });
});

describe('replay', () => {
  it('serves an ordered, schema-valid, viewer-filtered replay', async () => {
    const r = await get<unknown>(url, '/v1/squad/replay/sample');
    expect(r.status).toBe(200);
    const v = validateReplay(r.body);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ats = v.script.events.map((e) => e.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(
      v.script.events.some((e) => e.event.t === 'ledger.entry' && e.event.withheld === 'hidden'),
    ).toBe(true);
    expect(v.script.events.some((e) => e.event.t === 'call.caption')).toBe(true); // Ana's own call
  });
  it('404s unknown and traversal names', async () => {
    expect((await get(url, '/v1/squad/replay/nope')).status).toBe(404);
    expect((await get(url, '/v1/squad/replay/..%2Fsecret')).status).toBe(404);
    expect((await get(url, '/v1/squad/replay/Sample')).status).toBe(404);
  });
});

describe('calls', () => {
  it('start, websocket captions mirrored to the stream, end', async () => {
    const s = await stream(ana);
    const start = await post<{ callId: string; wsUrl: string; ticket: string }>(
      url,
      '/v1/call/start',
      { agentId: 'expert:ch6' },
      ana,
    );
    expect(start.status).toBe(200);
    const again = await post(url, '/v1/call/start', { agentId: 'expert:ch6' }, ana);
    expect(again.status).toBe(409);
    const ws = new WebSocket(
      `${url.replace('http', 'ws')}/v1/call/ws/${start.body.callId}?st=${start.body.ticket}`,
    );
    const msgs: { type: string; text?: string }[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    ws.send(JSON.stringify({ type: 'user.text', text: 'what is amortized analysis?' }));
    for (let i = 0; i < 60 && msgs.filter((m) => m.type === 'caption').length < 3; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(msgs[0]?.type).toBe('ready');
    expect(msgs.filter((m) => m.type === 'caption').length).toBeGreaterThanOrEqual(3);
    ws.send(JSON.stringify({ type: 'end' }));
    await s.waitFor((f) => f.some((x) => x.event === 'call.end'));
    expect(s.frames.filter((f) => f.event === 'call.start')).toHaveLength(1);
    expect(s.frames.filter((f) => f.event === 'call.end')).toHaveLength(1);
    expect(s.frames.some((f) => f.event === 'call.caption')).toBe(true);
    expect(hub.deps.calls.active()).toHaveLength(0);
    s.stop();
  });

  it("another student does not receive Ana's captions, and cannot use her ticket", async () => {
    const b = await stream(ben);
    const start = await post<{ callId: string; ticket: string }>(
      url,
      '/v1/call/start',
      { agentId: 'expert:ch6' },
      ana,
    );
    const ws = new WebSocket(
      `${url.replace('http', 'ws')}/v1/call/ws/${start.body.callId}?st=${start.body.ticket}`,
    );
    await new Promise<void>((r) => ws.on('open', () => r()));
    await new Promise((r) => setTimeout(r, 200));
    expect(b.frames.some((f) => f.event === 'call.caption')).toBe(false);
    expect(b.frames.some((f) => f.event === 'call.start')).toBe(true);
    const bt = await login(url, 's_ben');
    const stolen = await post<{ ticket: string }>(url, '/v1/call/start', { agentId: 'dean' }, bt);
    const bad = new WebSocket(
      `${url.replace('http', 'ws')}/v1/call/ws/${start.body.callId}?st=${stolen.body.ticket}`,
    );
    const code = await new Promise<number>((r) =>
      bad.on('unexpected-response', (_q, res) => r(res.statusCode ?? 0)),
    );
    expect(code).toBe(403);
    ws.send(JSON.stringify({ type: 'end' }));
    b.stop();
  });

  it('audio.end and mute:true end a mic turn and stream the reply back', async () => {
    const start = await post<{ callId: string; ticket: string }>(
      url,
      '/v1/call/start',
      { agentId: 'dean' },
      ana,
    );
    const ws = new WebSocket(
      `${url.replace('http', 'ws')}/v1/call/ws/${start.body.callId}?st=${start.body.ticket}`,
    );
    const msgs: { type: string; speaker?: string; code?: string }[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    const agentCaptions = () =>
      msgs.filter((m) => m.type === 'caption' && m.speaker === 'agent').length;
    for (let i = 0; i < 60 && agentCaptions() < 1; i++) await new Promise((r) => setTimeout(r, 25));
    const base = agentCaptions();
    ws.send(new Uint8Array([1, 2, 3, 4]));
    ws.send(JSON.stringify({ type: 'audio.end' }));
    for (let i = 0; i < 60 && agentCaptions() < base + 1; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(agentCaptions()).toBe(base + 1);
    ws.send(new Uint8Array([5, 6]));
    ws.send(JSON.stringify({ type: 'mute', muted: true }));
    for (let i = 0; i < 60 && agentCaptions() < base + 2; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(agentCaptions()).toBe(base + 2);
    ws.send('not json');
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.some((m) => m.type === 'error' && m.code === 'invalid_message')).toBe(true);
    ws.send(JSON.stringify({ type: 'end' }));
  });

  it('unknown agent is 404', async () => {
    expect((await post(url, '/v1/call/start', { agentId: 'student:s_ben' }, ana)).status).toBe(404);
  });
});

describe('misc', () => {
  it('health, auth gate, cors', async () => {
    expect((await get<{ ok: boolean }>(url, '/health')).body.ok).toBe(true);
    expect((await get(url, '/v1/squad/state')).status).toBe(401);
    const r = await fetch(`${url}/v1/health`, { headers: { origin: 'http://localhost:5173' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const evil = await fetch(`${url}/v1/health`, { headers: { origin: 'http://evil.test' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('voice preview returns audio/mpeg', async () => {
    const r = await fetch(`${url}/v1/voices/preview`, {
      method: 'POST',
      headers: auth(ana),
      body: JSON.stringify({ voiceId: 'voice_calm', text: 'hello' }),
    });
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });
});

describe('GET /v1/status', () => {
  it('is public and reports demo mode when no runtime is wired, without secrets', async () => {
    const r = await get<Record<string, unknown>>(url, '/v1/status');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ llm: 'fake', tts: 'none', demo: true, ports: 'stub' });
    expect(r.body.notice).toMatch(/GEMINI_API_KEY/);
  });
  it('reflects the runtime: real, then credits_depleted', async () => {
    let llm: LlmStatus = { llm: 'real' };
    hub.deps.runtime = { llm: () => llm, tts: () => true, ports: () => 'real' };
    const live = await get<Record<string, unknown>>(url, '/v1/status');
    expect(live.body).toMatchObject({ llm: 'gemini', tts: 'elevenlabs', demo: false });
    expect(live.body.notice).toBeUndefined();
    llm = { llm: 'fake', reason: 'credits_depleted', since: 1, lastProbeAt: 5, nextProbeAt: 65 };
    const dead = await get<Record<string, unknown>>(url, '/v1/status');
    expect(dead.body).toMatchObject({
      llm: 'fake',
      demo: true,
      reason: 'credits_depleted',
      lastProbeAt: 5,
      nextProbeAt: 65,
    });
    expect(dead.body.notice).toMatch(/credits depleted/);
    hub.deps.runtime = undefined;
  });
});

describe('POST /v1/confirms/:taskId', () => {
  it('fails closed for unknown tasks and bad bodies, needs auth, and confirms a trip task', async () => {
    expect((await post(url, '/v1/confirms/task_nope', { yes: true })).status).toBe(401);
    expect((await post(url, '/v1/confirms/task_nope', { yes: true }, ana)).status).toBe(404);
    expect((await post(url, '/v1/confirms/task_trip_cabo', { nope: 1 }, ana)).status).toBe(400);
    // a trip task needs the option being confirmed
    expect((await post(url, '/v1/confirms/task_trip_cabo', { yes: true }, ana)).status).toBe(400);
  });

  it('answers an open confirm card through the owner agent, and 422s when no agent is wired', async () => {
    const calls: { url: string; body: string }[] = [];
    const secret = hub.deps.config.internalSecret;
    const { createConfirmRouter } = await import('../../src/confirms');
    hub.deps.confirms = createConfirmRouter(hub.deps, {
      fetch: (async (u: string, init: RequestInit) => {
        calls.push({ url: u, body: String(init.body) });
        expect(new Headers(init.headers).get('X-Nook-Internal')).toBe(secret);
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    hub.deps.ingest.village({
      t: 'confirm.pending',
      student: 's_ana',
      taskId: 'task_study_x',
      question: 'Study Tuesday 7pm?',
    });
    const none = await post<{ error: { code: string } }>(
      url,
      '/v1/confirms/task_study_x',
      { yes: true },
      ana,
    );
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('unsupported_kind');
    hub.deps.confirms.setAgentUrls({ s_ana: 'http://agent-ana.test' });
    // another student cannot answer ana's card
    expect((await post(url, '/v1/confirms/task_study_x', { yes: true }, ben)).status).toBe(404);
    const ok = await post(url, '/v1/confirms/task_study_x', { yes: false }, ana);
    expect(ok.status).toBe(200);
    expect(calls).toEqual([
      {
        url: 'http://agent-ana.test/internal/confirm/answer',
        body: JSON.stringify({ taskId: 'task_study_x', answer: 'no' }),
      },
    ]);
  });
});
