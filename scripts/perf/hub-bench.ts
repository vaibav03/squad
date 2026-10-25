/**
 * Backend benchmark: per-route latency percentiles under concurrency, SSE fan-out at 1x and 10x event rate with 50
 * clients, SSE reconnect storm, sqlite query plans for the hot paths, ingest throughput and hub memory.
 *
 *   pnpm perf:hub                      # in-process hub on a free port, writes docs/perf/data/hub.json
 *   HUB_URL=http://localhost:8788 SECRET=... pnpm perf:hub   # against a running hub (skips plan + memory)
 *
 * Env: REQS (per route, default 1500), CONC (default 16), EVENTS (default 500).
 */
import http from 'node:http';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHub } from '../../apps/hub/src/server.ts';
import { runLoad } from '../../apps/hub/scripts/load.ts';

const REQS = Number(process.env.REQS) || 1500;
const CONC = Number(process.env.CONC) || 16;
const secret = process.env.SECRET || 'perf-secret';
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number[], p: number) =>
  r2(a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0);

let own: Awaited<ReturnType<typeof startHub>> | undefined;
let base = process.env.HUB_URL;
if (!base) {
  own = await startHub({
    config: {
      port: 0,
      internalSecret: secret,
      authSecret: 'perf-auth',
      logLevel: 'silent',
      seed: true,
      sim: false,
      dbPath: join(mkdtempSync(join(tmpdir(), 'squad-perf-')), 'hub.db'),
      sse: { bufferSize: 5000, maxQueue: 256, pingMs: 15_000 },
    },
  });
  base = own.url;
}
const U = base;
const login = async (id: string) =>
  (
    (await (
      await fetch(U + '/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: id }),
      })
    ).json()) as { token: string }
  ).token;
const tok = await login('s_ana');
const auth = { authorization: `Bearer ${tok}` };

interface Route {
  name: string;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: () => string;
}
let evN = 0;
const routes: Route[] = [
  { name: 'GET /health', path: '/health' },
  { name: 'GET /v1/status', path: '/v1/status' },
  { name: 'GET /v1/auth/students', path: '/v1/auth/students' },
  { name: 'GET /v1/me', path: '/v1/me', headers: auth },
  { name: 'GET /v1/tasks', path: '/v1/tasks', headers: auth },
  { name: 'GET /v1/squad/state', path: '/v1/squad/state', headers: auth },
  { name: 'GET /v1/squad/courses', path: '/v1/squad/courses', headers: auth },
  { name: 'GET /v1/squad/replays', path: '/v1/squad/replays' },
  { name: 'GET /v1/squad/replay/:name', path: '/v1/squad/replay/__first__' },
  { name: 'GET /v1/ledger/:taskId', path: '/v1/ledger/task_study_ch6', headers: auth },
  { name: 'GET /v1/personas', path: '/v1/personas', headers: auth },
  { name: 'GET /v1/voices', path: '/v1/voices', headers: auth },
  { name: 'GET /v1/mastery/:courseId', path: '/v1/mastery/c1', headers: auth },
  {
    name: 'POST /v1/auth/dev-login',
    method: 'POST',
    path: '/v1/auth/dev-login',
    headers: { 'content-type': 'application/json' },
    body: () => JSON.stringify({ studentId: 's_ben' }),
  },
  {
    name: 'POST /v1/squad/stream-token',
    method: 'POST',
    path: '/v1/squad/stream-token',
    headers: { ...auth, 'content-type': 'application/json' },
    body: () => '{}',
  },
  {
    name: 'POST /internal/events',
    method: 'POST',
    path: '/internal/events',
    headers: { 'content-type': 'application/json', 'x-nook-internal': secret },
    body: () =>
      JSON.stringify({
        t: 'agent.state',
        agent: `student:bench${evN++ % 50}`,
        state: evN % 2 ? 'studying' : 'idle',
      }),
  },
];
const first = (
  (await (await fetch(U + '/v1/squad/replays')).json()) as { replays: { name: string }[] }
).replays[0]?.name;
for (const r of routes) r.path = r.path.replace('__first__', first ?? 'none');

async function hit(r: Route): Promise<{ ms: number; status: number }> {
  const t = performance.now();
  try {
    const res = await fetch(U + r.path, {
      method: r.method ?? 'GET',
      headers: r.headers,
      ...(r.body ? { body: r.body() } : {}),
    });
    await res.arrayBuffer();
    return { ms: performance.now() - t, status: res.status };
  } catch {
    return { ms: performance.now() - t, status: 0 }; // 0 = connection error
  }
}
async function bench(r: Route) {
  for (let i = 0; i < 50; i++) await hit(r); // warm up JIT
  const lat: number[] = [];
  const statuses: Record<string, number> = {};
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next++ < REQS) {
        const { ms, status } = await hit(r);
        lat.push(ms);
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    }),
  );
  const wall = performance.now() - t0;
  lat.sort((a, b) => a - b);
  return {
    route: r.name,
    rps: Math.round(REQS / (wall / 1000)),
    p50: pct(lat, 0.5),
    p95: pct(lat, 0.95),
    p99: pct(lat, 0.99),
    max: r2(lat.at(-1) ?? 0),
    status: statuses,
  };
}
const routeResults = [];
for (const r of routes) routeResults.push(await bench(r));

// SSE reconnect storm: N clients connect, drop at once, reconnect with Last-Event-ID; measure time to first byte.
async function reconnectStorm(n: number) {
  const st = async () =>
    (
      (await (
        await fetch(U + '/v1/squad/stream-token', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: '{}',
        })
      ).json()) as { st: string }
    ).st;
  const open = async (lastId?: number): Promise<number> => {
    const t = performance.now();
    const s = await st().catch((e: { cause?: { code?: string } }) => {
      const c = e.cause?.code ?? 'token-fetch';
      errCodes[c] = (errCodes[c] ?? 0) + 1;
      return '';
    });
    if (!s) return -1;
    return new Promise<number>((resolve) => {
      const req = http.get(
        `${U}/v1/squad/stream?st=${s}${lastId !== undefined ? `&lastEventId=${lastId}` : ''}`,
        (res) => {
          res.once('data', () => {
            const ms = performance.now() - t;
            req.destroy();
            resolve(ms);
          });
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) => {
        errCodes[e.code ?? 'sse'] = (errCodes[e.code ?? 'sse'] ?? 0) + 1;
        resolve(-1);
      });
    });
  };
  const rounds = [];
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    // waves of WAVE connects: macOS somaxconn is 128 so bigger bursts fail in the kernel, not in the hub
    const WAVE = Number(process.env.WAVE) || 100;
    const ms: number[] = [];
    for (let w = 0; w < n; w += WAVE)
      ms.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(WAVE, n - w) }, () => open(k === 0 ? undefined : 1)),
        )),
      );
    const ok = ms.filter((m) => m >= 0).sort((a, b) => a - b);
    rounds.push({
      round: k,
      clients: n,
      ok: ok.length,
      wallMs: Math.round(performance.now() - t),
      ttfbP50: pct(ok, 0.5),
      ttfbP99: pct(ok, 0.99),
    });
  }
  return rounds;
}
const errCodes: Record<string, number> = {};
const storm = await reconnectStorm(200);

// Fan-out: 50 clients at the shipped rate (500/s) and 10x (5000/s).
const fan1 = await runLoad({
  url: U,
  secret,
  clients: 50,
  events: Number(process.env.EVENTS) || 500,
  ratePerSec: 500,
});
const fan10 = await runLoad({
  url: U,
  secret,
  clients: 50,
  events: Number(process.env.EVENTS) || 500,
  ratePerSec: 5000,
});

// Ingest throughput, 8 posters, no SSE clients.
const ingestRoute = routes.find((r) => r.name === 'POST /internal/events')!;
const ingest = await bench({ ...ingestRoute, name: 'ingest burst' });

let plans: unknown = null;
let memory: unknown = null;
if (own) {
  const db = own.deps.db as { prepare(s: string): { all(...a: unknown[]): unknown[] } };
  const q = [
    [
      'event resume (after seq)',
      'SELECT seq, ts, kind, type, payload_json, squad_id FROM hub_events WHERE seq > ? ORDER BY seq LIMIT 5000',
    ],
    ['event prune', 'DELETE FROM hub_events WHERE seq <= ?'],
    [
      'ledger rows by task',
      "SELECT task_id, student, field, ts, shared, has_withheld FROM hub_ledger_rows WHERE task_id = 'x'",
    ],
    [
      'ledger rows full scan (startup)',
      'SELECT task_id, student, field, ts, shared, has_withheld FROM hub_ledger_rows',
    ],
    [
      'busy blocks by student',
      "SELECT start, end, title FROM hub_busy_blocks WHERE student='s_ana' ORDER BY start",
    ],
    [
      'events by squad',
      "SELECT seq FROM hub_events WHERE squad_id='sq1' ORDER BY seq DESC LIMIT 100",
    ],
  ] as const;
  plans = q.map(([name, sql]) => {
    try {
      const rows = db
        .prepare('EXPLAIN QUERY PLAN ' + sql)
        .all(...(sql.includes('?') ? [0] : [])) as { detail: string }[];
      return { name, plan: rows.map((r) => r.detail) };
    } catch (e) {
      return { name, error: (e as Error).message };
    }
  });
  const m = process.memoryUsage();
  memory = {
    rssMb: r2(m.rss / 1048576),
    heapUsedMb: r2(m.heapUsed / 1048576),
    externalMb: r2(m.external / 1048576),
    note: 'hub + bench client in one process',
  };
}
const out = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  reqsPerRoute: REQS,
  concurrency: CONC,
  routes: routeResults,
  sseReconnectStorm: storm,
  stormErrors: errCodes,
  somaxconn: process.platform === 'darwin' ? 'kern.ipc.somaxconn' : 'net.core.somaxconn',
  fanout: { x1: fan1, x10: fan10 },
  ingestBurst: ingest,
  plans,
  memory,
};
mkdirSync('docs/perf/data', { recursive: true });
writeFileSync('docs/perf/data/hub.json', JSON.stringify(out, null, 2));
console.table(
  routeResults.map((r) => ({
    route: r.route,
    rps: r.rps,
    p50: r.p50,
    p95: r.p95,
    p99: r.p99,
    max: r.max,
  })),
);
console.log(JSON.stringify({ storm, fan1, fan10, plans, memory }, null, 2));
await own?.stop();
process.exit(0);
