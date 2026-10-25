import { execFileSync } from 'node:child_process';
import type { Context, Next } from 'hono';
import { matchedRoutes } from 'hono/route';
import {
  corrFromHeaders,
  createErrorBuffer,
  createSeriesStore,
  CORR_HEADER,
  hashId,
  type ErrorBuffer,
  type Labels,
  type Logger,
  type SeriesStore,
} from '@squad/core';
import { createAdminRoutes } from '../routes/admin';
import type { HubApp, HubDeps } from '../types';
import { currentCorr, runWithTrace } from './context';
import { defineMetrics, type HubMetrics } from './metrics';
import { createSentryHook, type SentryHook } from './sentry';

export * from './context';
export { defineMetrics, instrumentLlm, outcomeForStatus } from './metrics';
export { createSentryHook, parseDsn } from './sentry';

export interface SkillRecord {
  name: string;
  ok: boolean;
  at: number;
  /** 0..1 band only, never message text */
  score?: number;
}

export interface AgentHealth {
  id: string;
  url: string;
  up: boolean;
  checkedAt: number;
  latencyMs?: number;
}

export interface ObsOptions {
  version?: string;
  gitSha?: string;
  builtAt?: string;
  /** Bearer token that grants admin (env HUB_ADMIN_TOKEN). */
  adminToken?: string;
  /** Student ids whose normal login token is admin (env HUB_ADMINS, comma separated). */
  adminIds?: string[];
  /** agent id -> base URL for health probes (default: AGENT_PEERS env). */
  agents?: () => Record<string, string>;
  /** Run the 15 s background tick (default: off under vitest). */
  tick?: boolean;
  sentryDsn?: string;
  fetch?: typeof fetch;
  /** Error ring capacity. */
  errorCap?: number;
}

export interface Observability {
  metrics: HubMetrics;
  series: SeriesStore;
  errors: ErrorBuffer;
  log: Logger;
  sentry: SentryHook;
  info: { version: string; gitSha: string; builtAt: string; startedAt: number };
  options: Required<Pick<ObsOptions, 'adminIds'>> & { adminToken?: string };
  skills(): SkillRecord[];
  recordSkill(r: Omit<SkillRecord, 'at'>): void;
  agents(): AgentHealth[];
  probeAgents(): Promise<AgentHealth[]>;
  /** One tick: probe agents, accrue demo-mode time, sample gauges into the minute series. */
  tick(): Promise<void>;
  /** Hash a student id for logs and metrics labels. */
  hash(id: string): string;
  /** Add the correlation header to outgoing fetches towards these origins (bot, agents). */
  propagateTo(urls: (string | undefined)[]): void;
  installProcessHandlers(): void;
  stop(): void;
}

const registry = new WeakMap<HubDeps, Observability>();
export const getObs = (deps: HubDeps): Observability | undefined => registry.get(deps);

function gitShaFromEnvOrGit(env: Record<string, string | undefined>): string {
  const e =
    env.GIT_SHA || env.SOURCE_COMMIT || env.VERCEL_GIT_COMMIT_SHA || env.RAILWAY_GIT_COMMIT_SHA;
  if (e) return e.slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function agentsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (env.AGENT_PEERS ?? '').split(',').filter(Boolean)) {
    const i = kv.indexOf('=');
    if (i > 0)
      out[kv.slice(0, i).trim()] = kv
        .slice(i + 1)
        .trim()
        .replace(/\/+$/, '');
  }
  return out;
}

const SAFE = /[^a-z0-9_.:@-]/gi;
const label = (v: unknown, max = 40) =>
  String(v ?? '')
    .replace(SAFE, '_')
    .slice(0, max) || 'unknown';

/** Routes whose successful calls feed a domain counter. */
function domainCounters(m: HubMetrics, method: string, route: string, status: number) {
  if (status >= 400) return;
  if (method === 'POST' && route === '/v1/quiz/:quizId/answer') m.quizAnswers.inc();
  else if (method === 'GET' && route === '/v1/squad/replay/:name') m.replayPlays.inc();
  else if (
    method === 'POST' &&
    (route === '/v1/trips/:tripId/vote' || route === '/v1/trips/:tripId/confirm')
  )
    m.tripActions.inc({ action: route.endsWith('vote') ? 'vote' : 'confirm' });
  else if (method === 'POST' && route === '/v1/call/start') m.chatMessages.inc({ channel: 'call' });
  else if (method === 'POST' && route === '/v1/voices/preview')
    m.chatMessages.inc({ channel: 'voice_preview' });
}

export function createObservability(deps: HubDeps, o: ObsOptions = {}): Observability {
  const env = process.env;
  const now = deps.now;
  const startedAt = now();
  const salt = deps.config.authSecret;
  const m = defineMetrics();
  const series = createSeriesStore(now);
  const sentry = createSentryHook({
    dsn: o.sentryDsn ?? env.SENTRY_DSN,
    release: o.version,
    environment: deps.config.production ? 'production' : 'development',
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  const errors = createErrorBuffer(
    o.errorCap ?? 100,
    now,
    (e) => {
      m.errors.inc({ kind: e.kind });
      series.add('errors');
      sentry.send(e);
    },
    salt,
  );
  const log = deps.log;
  const skills: SkillRecord[] = [];
  let agentHealth: AgentHealth[] = [];
  let lastTick = now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const agentsFn = o.agents ?? (() => agentsFromEnv());

  const obs: Observability = {
    metrics: m,
    series,
    errors,
    log,
    sentry,
    info: {
      version: o.version ?? '0.0.0',
      gitSha: o.gitSha ?? gitShaFromEnvOrGit(env),
      builtAt: o.builtAt ?? env.BUILD_TIME ?? new Date(startedAt).toISOString(),
      startedAt,
    },
    options: {
      adminIds:
        o.adminIds ??
        (env.HUB_ADMINS ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ...((o.adminToken ?? env.HUB_ADMIN_TOKEN)
        ? { adminToken: o.adminToken ?? env.HUB_ADMIN_TOKEN }
        : {}),
    },
    skills: () => [...skills],
    recordSkill(r) {
      skills.unshift({ ...r, name: label(r.name), at: now() });
      if (skills.length > 50) skills.length = 50;
      m.skillCalls.inc({ skill: label(r.name), outcome: r.ok ? 'ok' : 'fail' });
      if (typeof r.score === 'number')
        m.skillScore.observe(Math.min(1, Math.max(0, r.score)), { skill: label(r.name) });
      series.add('skills');
    },
    agents: () => [...agentHealth],
    async probeAgents() {
      const f = o.fetch ?? fetch;
      const entries = Object.entries(agentsFn());
      agentHealth = await Promise.all(
        entries.map(async ([id, url]): Promise<AgentHealth> => {
          const t0 = now();
          try {
            const r = await f(`${url}/healthz`, { signal: AbortSignal.timeout(1500) });
            return {
              id,
              url: new URL(url).host,
              up: r.ok,
              checkedAt: now(),
              latencyMs: now() - t0,
            };
          } catch {
            return { id, url: safeHost(url), up: false, checkedAt: now() };
          }
        }),
      );
      for (const a of agentHealth) m.agentUp.set(a.up ? 1 : 0, { agent: label(a.id) });
      return [...agentHealth];
    },
    async tick() {
      const t = now();
      const rt = deps.runtime;
      if (rt?.llm().llm === 'fake') m.llmDemoSeconds.inc({}, (t - lastTick) / 1000);
      lastTick = t;
      series.set('sse_subscribers', deps.broker.count());
      series.set('demo_mode', rt && rt.llm().llm === 'real' ? 0 : 1);
      await obs.probeAgents();
    },
    hash: (id) => hashId(id, salt),
    propagateTo(urls) {
      const origins = new Set<string>();
      for (const u of urls) {
        try {
          if (u) origins.add(new URL(u).origin);
        } catch {
          /* ignore bad url */
        }
      }
      patchFetch(origins);
    },
    installProcessHandlers() {
      if ((globalThis as { __squadObsHandlers?: boolean }).__squadObsHandlers) return;
      (globalThis as { __squadObsHandlers?: boolean }).__squadObsHandlers = true;
      process.on('unhandledRejection', (reason) => {
        const e = errors.capture(reason, { kind: 'unhandledRejection', corr: currentCorr() });
        log.error('unhandled rejection', { name: e.name, message: e.message, corr: e.corr });
      });
      process.on('uncaughtException', (err) => {
        const e = errors.capture(err, { kind: 'uncaughtException', corr: currentCorr() });
        log.error('uncaught exception', { name: e.name, message: e.message });
        // Registering a listener disables Node's default crash; keep the crash so the supervisor restarts us.
        process.exitCode = 1;
        setTimeout(() => process.exit(1), 250).unref();
      });
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };

  // scrape-time gauges
  m.registry.collect((set) => {
    set('squad_uptime_seconds', 'Hub uptime', (now() - startedAt) / 1000);
    set('squad_build_info', 'Build info (value is always 1)', 1, {
      version: obs.info.version,
      git_sha: obs.info.gitSha,
    });
    set('squad_sse_subscribers', 'Open SSE subscribers', deps.broker.count());
    set('squad_event_log_seq', 'Last event sequence number', deps.events.lastSeq());
    set('squad_event_log_size', 'Events retained in the log', deps.events.size());
    set('squad_calls_active', 'Active voice calls', deps.calls.active().length);
    const llm = deps.runtime?.llm();
    set(
      'squad_llm_demo_mode',
      '1 while answers come from the demo model',
      !llm || llm.llm === 'fake' ? 1 : 0,
      !llm ? { reason: 'no_key' } : llm.reason ? { reason: llm.reason } : {},
    );
    set('squad_tts_enabled', '1 when text-to-speech is wired', deps.runtime?.tts() ? 1 : 0);
    set('squad_process_memory_rss_bytes', 'Resident memory', process.memoryUsage().rss);
    set('squad_error_ring_size', 'Errors held in the ring buffer', errors.size());
  });

  if (o.tick ?? !process.env.VITEST) {
    timer = setInterval(() => void obs.tick(), 15_000);
    timer.unref();
  }
  registry.set(deps, obs);
  return obs;
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return 'invalid';
  }
}

let patched: Set<string> | undefined;
function patchFetch(origins: Set<string>) {
  if (patched) {
    for (const o of origins) patched.add(o);
    return;
  }
  patched = origins;
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    try {
      const corr = currentCorr();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (corr && patched!.has(new URL(url).origin)) {
        const h = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        if (!h.has(CORR_HEADER)) h.set(CORR_HEADER, corr);
        return real(input, { ...init, headers: h });
      }
    } catch {
      /* fall through to the plain call */
    }
    return real(input, init);
  }) as typeof fetch;
}

/** Wires the hub: request middleware (corr id, latency, errors), ingest/broker counters, and the ops routes. */
export function installObservability(
  app: HubApp,
  deps: HubDeps,
  o: ObsOptions = {},
): Observability {
  const obs = createObservability(deps, o);
  const { metrics: m, series } = obs;

  app.use('*', async (c: Context, next: Next) => {
    const corr = corrFromHeaders(c.req.raw.headers);
    c.header(CORR_HEADER, corr);
    c.header('x-request-id', corr);
    const t0 = performance.now();
    await runWithTrace({ corr }, next);
    const route = routeOf(c);
    const status = c.res.status;
    const secs = (performance.now() - t0) / 1000;
    const labels: Labels = { method: c.req.method, route, status };
    m.httpRequests.inc(labels);
    m.httpDuration.observe(secs, { route, class: `${Math.floor(status / 100)}xx` });
    series.add('http_requests');
    if (status >= 500 || c.error) {
      series.add('http_errors');
      if (c.error)
        obs.errors.capture(c.error, {
          kind: 'http',
          corr,
          context: { route, method: c.req.method, status },
        });
    }
    domainCounters(m, c.req.method, route, status);
    if (secs > 1) deps.log.warn('slow request', { route, status, ms: Math.round(secs * 1000) });
  });

  // events: accepted / invalid / dropped
  const ing = deps.ingest;
  const count = (type: string | undefined, r: ReturnType<typeof ing.village>) => {
    if (!r.ok) m.events.inc({ outcome: 'invalid' });
    else if (r.dropped) m.events.inc({ outcome: `dropped_${r.dropped}` });
    else if (r.seq === null) m.events.inc({ outcome: 'stored_private' });
    else {
      m.events.inc({ outcome: 'accepted' });
      if (type) m.eventsByType.inc({ type: label(type, 60) });
      series.add('events');
      deps.log.info('event ingested', { type, seq: r.seq });
    }
    return r;
  };
  const village = ing.village.bind(ing);
  const x = ing.x.bind(ing);
  ing.village = (input) => {
    const t = (input as { t?: unknown } | null)?.t;
    return count(typeof t === 'string' ? t : undefined, village(input));
  };
  ing.x = (type, data) => count(type, x(type, data));

  // SSE: opened subscriptions and overflow drops
  const br = deps.broker;
  const publish = br.publish.bind(br);
  const subscribe = br.subscribe.bind(br);
  br.publish = (e) => {
    const before = br.count();
    publish(e);
    const dropped = before - br.count();
    if (dropped > 0) {
      m.sseDrops.inc({}, dropped);
      series.add('sse_drops', dropped);
    }
  };
  br.subscribe = (viewer, opts) => {
    m.sseOpened.inc();
    return subscribe(viewer, opts);
  };

  app.route('/', createAdminRoutes(deps, obs));
  return obs;
}

function routeOf(c: Context): string {
  const hit = [...matchedRoutes(c)].reverse().find((r) => r.path !== '/*' && r.path !== '*');
  return hit?.path ?? 'unmatched';
}
