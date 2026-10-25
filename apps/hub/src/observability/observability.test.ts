import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlm, createResilientLlm, CORR_HEADER } from '@squad/core';
import type { RunningHub } from '../server';
import { startHub } from '../server';
import { signToken } from '../auth';
import { getObs } from './index';
import { defineMetrics, instrumentLlm } from './metrics';
import { createSentryHook, parseDsn } from './sentry';
import { currentCorr } from './context';

const SECRET = 'test-secret';
const ADMIN = 'adm-token-xyz';
let hub: RunningHub;
let ingestCorr: (string | undefined)[] = [];
let agentUp = true;

const fakeFetch = (async (url: string) => {
  if (String(url).includes('agent-ana')) return new Response('{}', { status: agentUp ? 200 : 500 });
  throw new Error('network off');
}) as unknown as typeof fetch;

beforeAll(async () => {
  hub = await startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: SECRET,
      authSecret: 'auth-test',
      seed: true,
      sim: true,
      production: false,
      logLevel: 'silent',
    },
    obs: {
      adminToken: ADMIN,
      adminIds: ['s_ana'],
      agents: () => ({ s_ana: 'http://agent-ana.test' }),
      fetch: fakeFetch,
      tick: false,
    },
  });
  // The hub logs "event ingested" inside the request's trace context; record which corr id was active.
  const log = hub.deps.log;
  const info = log.info.bind(log);
  log.info = (m, f) => {
    if (m === 'event ingested') ingestCorr.push(currentCorr());
    info(m, f);
  };
});
afterAll(async () => {
  await hub.stop();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(hub.url + path, { headers });
const bearer = (sub: string) =>
  signToken('auth-test', { kind: 'bearer', sub, ttlMs: 60_000 }).token;

describe('liveness and readiness', () => {
  it('/health is cheap and keeps legacy fields', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, version: '0.1.0' });
  });
  it('/ready is 200 with db writable, reports degraded agents and llm, strict mode is 503', async () => {
    const ok = await get('/ready');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ready: boolean; checks: Record<string, string> };
    expect(body.ready).toBe(true);
    expect(body.checks.db).toBe('ok');
    expect(body.checks.agents).toBe('ok');
    expect(body.checks.llm).toMatch(/^demo:/); // stubs, no key
    agentUp = false;
    const down = (await (await get('/ready')).json()) as {
      checks: Record<string, string>;
      status: string;
    };
    expect(down.checks.agents).toBe('some_down');
    expect(down.status).toBe('degraded');
    expect((await get('/ready?strict=1')).status).toBe(503);
    agentUp = true;
  });
  it('/ready is 503 when the database is not writable', async () => {
    const real = hub.deps.db.exec.bind(hub.deps.db);
    hub.deps.db.exec = (() => {
      throw new Error('database is locked');
    }) as typeof hub.deps.db.exec;
    const r = await get('/ready');
    hub.deps.db.exec = real;
    expect(r.status).toBe(503);
    expect(((await r.json()) as { checks: { db: string } }).checks.db).toBe('fail');
  });
});

describe('admin authz', () => {
  const guarded = ['/metrics', '/v1/admin/status', '/v1/admin/errors'];
  it('anonymous callers get 404, signed-in non-admins get 403', async () => {
    for (const p of guarded) {
      expect((await get(p)).status).toBe(404);
      expect((await get(p, { authorization: 'Bearer nonsense' })).status).toBe(404);
      expect((await get(p, { authorization: `Bearer ${bearer('s_ben')}` })).status).toBe(403);
    }
  });
  it('admits the internal secret, the admin token and a listed student', async () => {
    for (const h of <Record<string, string>[]>[
      { 'x-nook-internal': SECRET },
      { authorization: `Bearer ${ADMIN}` },
      { 'x-admin-token': ADMIN },
      { authorization: `Bearer ${bearer('s_ana')}` },
    ])
      expect((await get('/v1/admin/status', h)).status).toBe(200);
    expect((await get('/v1/admin/status', { 'x-nook-internal': 'wrong' })).status).toBe(404);
  });
});

describe('/metrics', () => {
  it('serves Prometheus text with route latency, events, sse and build info', async () => {
    await get('/v1/status');
    await fetch(hub.url + '/internal/events', {
      method: 'POST',
      headers: { 'x-nook-internal': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ t: 'nope' }),
    });
    const r = await get('/metrics', { authorization: `Bearer ${ADMIN}` });
    expect(r.headers.get('content-type')).toMatch(/text\/plain/);
    const t = await r.text();
    expect(t).toContain('# TYPE squad_http_request_duration_seconds histogram');
    expect(t).toMatch(
      /squad_http_requests_total\{method="GET",route="\/v1\/status",status="200"\} \d/,
    );
    expect(t).toMatch(/squad_events_total\{outcome="invalid"\} 1/);
    expect(t).toContain('squad_sse_subscribers 0');
    expect(t).toContain('squad_build_info{');
    expect(t).toContain('squad_llm_demo_mode{reason="no_key"} 1');
    expect(t).not.toContain(SECRET);
    expect(t).not.toContain(ADMIN);
  });
  it('accepts allow-listed pushes only and sanitises labels', async () => {
    const push = (body: unknown) =>
      fetch(hub.url + '/internal/metrics', {
        method: 'POST',
        headers: { 'x-nook-internal': SECRET, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(
      (await fetch(hub.url + '/internal/metrics', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    const r = await push({
      c: [
        ['squad_chat_messages_total', { channel: 'imessage', extra: 'x' }, 3],
        ['not_allowed_total', {}, 1],
      ],
      h: [['squad_skill_score', { skill: 'plan trip!' }, 0.8]],
      skill: { name: 'study', ok: true, score: 0.9 },
    });
    expect(await r.json()).toEqual({ ok: true, applied: 3 });
    const t = await (await get('/metrics', { 'x-admin-token': ADMIN })).text();
    expect(t).toContain('squad_chat_messages_total{channel="imessage"} 3');
    expect(t).not.toContain('not_allowed_total');
    expect(t).toContain('skill="plan_trip_"');
    const st = (await (await get('/v1/admin/status', { 'x-admin-token': ADMIN })).json()) as {
      skills: { recent: { name: string }[] };
      activity: Record<string, number | null>;
    };
    expect(st.skills.recent[0]!.name).toBe('study');
    expect(st.activity.quizAnswers).toBeNull(); // hidden under 3
  });
});

describe('status extension', () => {
  it('/v1/status keeps its fields and adds version, sha, uptime', async () => {
    const b = (await (await get('/v1/status')).json()) as Record<string, unknown>;
    expect(b).toMatchObject({ llm: 'fake', demo: true, version: '0.1.0', ttsState: 'off' });
    expect(typeof b.gitSha).toBe('string');
    expect(typeof b.uptimeS).toBe('number');
    expect(JSON.stringify(b)).not.toMatch(/secret|token/i);
  });
  it('admin status carries the exact fix text for the demo reason', async () => {
    const b = (await (await get('/v1/admin/status', { 'x-admin-token': ADMIN })).json()) as {
      llm: { mode: string; reason: string; fix: string };
      series: Record<string, number[]>;
    };
    expect(b.llm).toMatchObject({ mode: 'demo', reason: 'no_key' });
    expect(b.llm.fix).toContain('GEMINI_API_KEY');
    expect(b.series.http_requests).toHaveLength(60);
  });
});

describe('credits depleted', () => {
  it('public and admin status carry the reason, probe times and the hub fix text', async () => {
    const prev = hub.deps.runtime;
    hub.deps.runtime = {
      llm: () => ({
        llm: 'fake',
        reason: 'credits_depleted',
        since: 1,
        lastProbeAt: 2,
        nextProbeAt: 62_000,
      }),
      tts: () => false,
      ports: () => 'stub',
    };
    try {
      const pub = (await (await get('/v1/status')).json()) as Record<string, unknown>;
      expect(pub).toMatchObject({
        llm: 'fake',
        demo: true,
        reason: 'credits_depleted',
        nextProbeAt: 62_000,
      });
      expect(String(pub.fix)).toContain('Top up Gemini credits');
      const adm = (await (await get('/v1/admin/status', { 'x-admin-token': ADMIN })).json()) as {
        llm: { reason: string; fix: string; nextProbeAt: number };
        credits: { state: string; fix: string };
      };
      expect(adm.llm).toMatchObject({ reason: 'credits_depleted', nextProbeAt: 62_000 });
      expect(adm.llm.fix).toContain('Top up Gemini credits');
      expect(adm.credits).toMatchObject({ state: 'depleted' });
      expect(adm.credits.fix).toContain('Top up Gemini credits');
    } finally {
      hub.deps.runtime = prev;
    }
  });
});

describe('correlation across hops', () => {
  it('echoes a supplied id, mints one otherwise, and the ingest log runs under it', async () => {
    ingestCorr = [];
    const r = await fetch(hub.url + '/internal/events', {
      method: 'POST',
      headers: {
        'x-nook-internal': SECRET,
        'content-type': 'application/json',
        [CORR_HEADER]: 'c_chat_test_01',
      },
      body: JSON.stringify({ t: 'agent.state', agent: 'student:s_ana', state: 'idle' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get(CORR_HEADER)).toBe('c_chat_test_01');
    expect(ingestCorr).toEqual(['c_chat_test_01']);
    expect((await get('/health')).headers.get(CORR_HEADER)).toMatch(/^c_[0-9a-f]{16}$/);
    const bad = await get('/health', { [CORR_HEADER]: 'evil header value' });
    expect(bad.headers.get(CORR_HEADER)).toMatch(/^c_/);
  });
});

describe('llm instrumentation', () => {
  it('counts calls by tier and outcome and never records prompts', async () => {
    const m = defineMetrics();
    const wrapped = instrumentLlm(
      createResilientLlm({ real: new FakeLlm(), fake: new FakeLlm() }),
      m,
    );
    await wrapped.complete({ model: 'fast', messages: 'secret prompt text' });
    expect(m.llmCalls.get({ tier: 'fast', outcome: 'ok' })).toBe(1);
    expect(m.registry.render()).not.toContain('secret prompt');
    const off = instrumentLlm(createResilientLlm({ fake: new FakeLlm() }), m);
    await off.complete({ messages: 'x' });
    expect(m.llmCalls.get({ tier: 'main', outcome: 'fake' })).toBe(1);
  });
  it('maps a 402 fallback to the 402 outcome and counts the switch', async () => {
    const m = defineMetrics();
    const broke = new FakeLlm();
    broke.complete = async () => {
      throw Object.assign(new Error('402 prepayment credits depleted'), { status: 402 });
    };
    const w = instrumentLlm(createResilientLlm({ real: broke, fake: new FakeLlm() }), m);
    await w.complete({ model: 'main', messages: 'hi' });
    expect(m.llmCalls.get({ tier: 'main', outcome: '402' })).toBe(1);
    expect(m.llmFallback.get({ reason: 'credits_depleted' })).toBe(1);
  });
});

describe('sentry hook', () => {
  it('is off without a DSN and never touches the network', () => {
    let hit = 0;
    const h = createSentryHook({
      fetch: (async () => (hit++, new Response())) as unknown as typeof fetch,
    });
    h.send({ id: 1, ts: 1, kind: 'error', name: 'E', message: 'm', count: 1 });
    expect(h.enabled).toBe(false);
    expect(hit).toBe(0);
  });
  it('posts a scrubbed envelope when configured', async () => {
    const seen: { url: string; body: string }[] = [];
    const h = createSentryHook({
      dsn: 'https://pubkey@sentry.example/42',
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, body: String(init.body) });
        return new Response();
      }) as unknown as typeof fetch,
    });
    h.send({
      id: 1,
      ts: 1000,
      kind: 'error',
      name: 'E',
      message: 'oops Bearer abcdefghijklmnop',
      corr: 'c_12345678',
      count: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen[0]!.url).toBe('https://sentry.example/api/42/envelope/');
    expect(seen[0]!.body).toContain('c_12345678');
    expect(seen[0]!.body).not.toContain('abcdefghijklmnop');
    expect(parseDsn('garbage')).toBeNull();
  });
});

describe('error capture', () => {
  it('a route that throws is captured with its corr id, scrubbed, and visible to admin only', async () => {
    const media = hub.deps.ports.media;
    hub.deps.ports = {
      ...hub.deps.ports,
      media: {
        ...media,
        personas: async () => {
          throw new Error('kaboom Bearer abcdefghijklmnop');
        },
      },
    };
    const r = await get('/v1/personas', {
      authorization: `Bearer ${bearer('s_ben')}`,
      [CORR_HEADER]: 'c_boom_0001',
    });
    expect(r.status).toBe(500);
    const b = await (await get('/v1/admin/errors', { 'x-admin-token': ADMIN })).text();
    expect(b).toContain('kaboom');
    expect(b).toContain('c_boom_0001');
    expect(b).not.toContain('abcdefghijklmnop');
    expect(getObs(hub.deps)!.metrics.errors.get({ kind: 'http' })).toBeGreaterThan(0);
  });
});
