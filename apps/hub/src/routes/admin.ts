import { Hono, type Context } from 'hono';
import { hideSmall, type LlmStatus } from '@squad/core';
import { secretMatches, verifyToken } from '../auth';
import type { Observability } from '../observability';
import type { HubApp, HubDeps, HubEnv } from '../types';

/** The exact fix text per fallback reason, shown on the Status page and in the runbook. */
export const FIX_TEXT: Record<string, string> = {
  credits_depleted:
    'Top up Gemini credits in Google AI Studio (Billing). The hub rechecks every 60 seconds and switches back to the real model by itself, no restart needed.',
  invalid_key:
    'Set a valid GEMINI_API_KEY in .env, then restart the hub. A rejected key is rechecked every 10 minutes.',
  rate_limited:
    'Gemini is rate limiting. Wait for the quota window to reset or lower traffic; the hub rechecks every 60 seconds.',
  no_key: 'Add GEMINI_API_KEY to .env and restart the hub (pnpm dev:all).',
  forced_fake:
    'FORCE_FAKE_LLM=1 is set. Remove it (or set it to 0) and restart the hub to use the real model.',
};

export type AdminKind = 'internal' | 'token' | 'student';

/**
 * Who may read ops data: the internal secret (header x-nook-internal), HUB_ADMIN_TOKEN (Bearer or
 * x-admin-token), or the normal login token of a student listed in HUB_ADMINS. Anyone else: a signed-in
 * non-admin gets 403, everyone without valid credentials gets 404 (the endpoint does not advertise itself).
 */
export function adminGate(
  deps: HubDeps,
  obs: Observability,
  c: Context,
): { admin: AdminKind | null; viewer: boolean } {
  const internal = c.req.header('x-nook-internal');
  if (internal && secretMatches(internal, deps.config.internalSecret))
    return { admin: 'internal', viewer: false };
  const auth = c.req.header('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  const given = c.req.header('x-admin-token') ?? bearer;
  const tok = obs.options.adminToken;
  if (tok && given && secretMatches(given, tok)) return { admin: 'token', viewer: false };
  if (bearer) {
    const v = verifyToken(deps.config.authSecret, bearer, ['bearer'], deps.now());
    if (v) return { admin: obs.options.adminIds.includes(v.sub) ? 'student' : null, viewer: true };
  }
  return { admin: null, viewer: false };
}

const deny = (c: Context, viewer: boolean) =>
  viewer
    ? c.json({ error: { code: 'forbidden' } }, 403)
    : c.json({ error: { code: 'not_found' } }, 404);

const PUSH_COUNTERS = {
  squad_chat_messages_total: ['channel'],
  squad_tts_characters_total: ['engine'],
  squad_skill_invocations_total: ['skill', 'outcome'],
  squad_council_runs_total: ['outcome'],
  squad_quiz_answers_total: ['outcome'],
  squad_llm_calls_total: ['tier', 'outcome'],
  squad_llm_tokens_total: ['tier', 'dir'],
  squad_llm_cost_usd_total: ['tier'],
  squad_mesh_tasks_total: ['kind', 'outcome'],
  squad_mesh_share_bytes_total: ['kind'],
  squad_replay_plays_total: [],
  squad_trip_actions_total: ['action'],
} as const;
const PUSH_HISTS = {
  squad_skill_score: ['skill'],
  squad_mesh_task_duration_seconds: ['kind'],
  squad_mesh_psi_duration_seconds: [],
} as const;
const SAFE = /[^a-z0-9_.:@-]/gi;

type PushBody = {
  c?: [string, Record<string, unknown> | undefined, number][];
  h?: [string, Record<string, unknown> | undefined, number][];
  skill?: { name: string; ok: boolean; score?: number };
};

export function createAdminRoutes(deps: HubDeps, obs: Observability): HubApp {
  const r = new Hono<HubEnv>();
  const m = obs.metrics;
  const now = deps.now;

  const llmState = () => {
    const llm: LlmStatus = deps.runtime?.llm() ?? { llm: 'fake', reason: 'no_key' };
    return llm;
  };

  /** Merge build, uptime and tts detail into the public /v1/status (no secrets, no student data). */
  r.use('/v1/status', async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    try {
      const body = (await c.res.clone().json()) as Record<string, unknown>;
      c.res = c.json({
        ...body,
        version: obs.info.version,
        gitSha: obs.info.gitSha,
        builtAt: obs.info.builtAt,
        uptimeS: Math.round((now() - obs.info.startedAt) / 1000),
        ttsState: body.tts === 'none' ? 'off' : 'on',
      });
      c.header('cache-control', 'no-store');
    } catch {
      /* leave the original response */
    }
  });

  // Liveness: the process is up and answering. Cheap, no dependencies. Keeps the legacy fields.
  r.get('/health', (c) =>
    c.json({
      ok: true,
      version: obs.info.version,
      uptimeS: Math.round((now() - obs.info.startedAt) / 1000),
      seq: deps.events.lastSeq(),
      subscribers: deps.broker.count(),
      seed: deps.config.seed,
    }),
  );

  // Readiness: can we serve traffic? 503 only when the database is not writable.
  r.get('/ready', async (c) => {
    let dbOk = true;
    try {
      deps.db.exec('CREATE TABLE IF NOT EXISTS obs_probe(id INTEGER PRIMARY KEY, ts INTEGER)');
      deps.db.prepare('INSERT OR REPLACE INTO obs_probe(id, ts) VALUES (1, ?)').run(now());
    } catch {
      dbOk = false;
    }
    const agents = await obs.probeAgents();
    const llm = llmState();
    const degraded = agents.some((a) => !a.up) || llm.llm === 'fake';
    const strict = c.req.query('strict') === '1';
    const ready = dbOk && !(strict && degraded);
    c.header('cache-control', 'no-store');
    return c.json(
      {
        ready,
        status: !dbOk ? 'down' : degraded ? 'degraded' : 'ok',
        checks: {
          db: dbOk ? 'ok' : 'fail',
          agents:
            agents.length === 0
              ? 'none_configured'
              : agents.every((a) => a.up)
                ? 'ok'
                : 'some_down',
          llm: llm.llm === 'real' ? 'real' : `demo:${llm.reason ?? 'unknown'}`,
        },
        agents: agents.map((a) => ({ id: a.id, up: a.up })),
      },
      ready ? 200 : 503,
    );
  });

  r.get('/metrics', (c) => {
    const g = adminGate(deps, obs, c);
    if (!g.admin) return deny(c, g.viewer);
    return c.body(m.registry.render(), 200, {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    });
  });

  r.get('/v1/admin/status', (c) => {
    const g = adminGate(deps, obs, c);
    if (!g.admin) return deny(c, g.viewer);
    const llm = llmState();
    const fake = llm.llm === 'fake';
    const reason = fake ? (llm.reason ?? 'no_key') : undefined;
    const snap = m.registry.snapshot();
    const sum = (name: string, pick?: (l: string) => boolean) =>
      (snap[name] ?? [])
        .filter((x) => (pick ? pick(x.labels) : true))
        .reduce((a, x) => a + x.value, 0);
    const count = (name: string) => hideSmall(sum(name));
    const bySkill = new Map<string, number>();
    for (const s of snap.squad_skill_invocations_total ?? []) {
      const name = /skill="([^"]*)"/.exec(s.labels)?.[1] ?? 'unknown';
      bySkill.set(name, (bySkill.get(name) ?? 0) + s.value);
    }
    c.header('cache-control', 'no-store');
    return c.json({
      now: now(),
      version: obs.info.version,
      gitSha: obs.info.gitSha,
      builtAt: obs.info.builtAt,
      uptimeS: Math.round((now() - obs.info.startedAt) / 1000),
      llm: {
        mode: fake ? 'demo' : 'real',
        reason,
        since: llm.since,
        lastProbeAt: llm.lastProbeAt,
        nextProbeAt: llm.nextProbeAt,
        fix: reason ? FIX_TEXT[reason] : undefined,
        demoSeconds: Math.round(sum('squad_llm_demo_seconds_total')),
        calls: {
          ok: sum('squad_llm_calls_total', (l) => l.includes('outcome="ok"')),
          fallback: sum('squad_llm_calls_total', (l) => /outcome="(402|429|401|fake)"/.test(l)),
          failed: sum('squad_llm_calls_total', (l) => /outcome="(timeout|error)"/.test(l)),
        },
        tokens: sum('squad_llm_tokens_total'),
        costUsd: Math.round(sum('squad_llm_cost_usd_total') * 10000) / 10000,
      },
      credits: {
        state: reason === 'credits_depleted' ? 'depleted' : fake ? 'unknown' : 'ok',
        fix: reason === 'credits_depleted' ? FIX_TEXT.credits_depleted : undefined,
      },
      tts: {
        state: deps.runtime?.tts() ? 'on' : 'off',
        characters: sum('squad_tts_characters_total'),
      },
      ports: deps.runtime?.ports() ?? 'stub',
      agents: obs
        .agents()
        .map((a) => ({ id: a.id, up: a.up, checkedAt: a.checkedAt, latencyMs: a.latencyMs })),
      sse: {
        subscribers: deps.broker.count(),
        drops: sum('squad_sse_queue_drops_total'),
        lastSeq: deps.events.lastSeq(),
      },
      events: {
        accepted: sum('squad_events_total', (l) => l.includes('accepted')),
        invalid: sum('squad_events_total', (l) => l.includes('invalid')),
        dropped: sum('squad_events_total', (l) => l.includes('dropped_')),
      },
      http: {
        requests: sum('squad_http_requests_total'),
        errors5xx: sum('squad_http_requests_total', (l) => /status="5\d\d"/.test(l)),
      },
      errors: {
        total: obs.errors.size(),
        recent: obs.errors
          .list()
          .slice(0, 20)
          .map((e) => ({
            id: e.id,
            ts: e.ts,
            kind: e.kind,
            name: e.name,
            message: e.message,
            corr: e.corr,
            count: e.count,
          })),
        sentry: obs.sentry.enabled,
      },
      series: Object.fromEntries(
        [
          'http_requests',
          'http_errors',
          'sse_subscribers',
          'events',
          'sse_drops',
          'errors',
          'skills',
          'demo_mode',
        ].map((n) => [n, obs.series.read(n, 60)]),
      ),
      skills: {
        recent: obs
          .skills()
          .slice(0, 15)
          .map((s) => ({ name: s.name, ok: s.ok, at: s.at })),
        counts: Object.fromEntries([...bySkill].sort((a, b) => b[1] - a[1]).slice(0, 12)),
      },
      activity: {
        quizAnswers: count('squad_quiz_answers_total'),
        councilRuns: count('squad_council_runs_total'),
        tripActions: count('squad_trip_actions_total'),
        replayPlays: count('squad_replay_plays_total'),
      },
    });
  });

  r.get('/v1/admin/errors', (c) => {
    const g = adminGate(deps, obs, c);
    if (!g.admin) return deny(c, g.viewer);
    c.header('cache-control', 'no-store');
    return c.json({ errors: obs.errors.list() });
  });

  /** Bots and agents push counter deltas and observations. Allow-listed names and label keys only. */
  r.post('/internal/metrics', async (c) => {
    if (!secretMatches(c.req.header('x-nook-internal'), deps.config.internalSecret))
      return c.json({ error: { code: 'unauthorized' } }, 401);
    const raw = await c.req.text();
    if (raw.length > 32 * 1024) return c.json({ error: { code: 'invalid_request' } }, 413);
    let body: PushBody;
    try {
      body = JSON.parse(raw) as PushBody;
    } catch {
      return c.json({ error: { code: 'invalid_request' } }, 400);
    }
    const pick = (keys: readonly string[], labels: Record<string, unknown> | undefined) =>
      Object.fromEntries(
        keys.map((k) => [
          k,
          String(labels?.[k] ?? 'unknown')
            .replace(SAFE, '_')
            .slice(0, 40),
        ]),
      );
    let applied = 0;
    const counters = m.registry;
    for (const [name, labels, by] of (body.c ?? []).slice(0, 100)) {
      const keys = (PUSH_COUNTERS as Record<string, readonly string[]>)[name];
      if (!keys || typeof by !== 'number') continue;
      counters.counter(name, name).inc(pick(keys, labels), by);
      applied++;
    }
    for (const [name, labels, v] of (body.h ?? []).slice(0, 100)) {
      const keys = (PUSH_HISTS as Record<string, readonly string[]>)[name];
      if (!keys || typeof v !== 'number') continue;
      counters.histogram(name, name).observe(v, pick(keys, labels));
      applied++;
    }
    if (body.skill && typeof body.skill.name === 'string') {
      const s = body.skill;
      obs.recordSkill({
        name: s.name,
        ok: s.ok !== false,
        ...(typeof s.score === 'number' ? { score: s.score } : {}),
      });
      applied++;
    }
    return c.json({ ok: true, applied });
  });

  return r;
}
