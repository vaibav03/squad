import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from '@squad/core/node';
import type { Db } from '@squad/core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { createStubPorts } from './adapters';
import { createBroker } from './broker';
import { createCallRegistry } from './calls';
import { loadHubConfig, type HubConfig } from './config';
import { createIngestor } from './ingest';
import { createLogger } from './log';
import type { Ports } from './ports';
import { createAuthRoutes } from './routes/auth';
import { createCallRoutes } from './routes/call';
import { createCouncilRoutes } from './routes/council';
import { createDomainRoutes } from './routes/domain';
import { createInternalRoutes } from './routes/internal';
import { createMediaRoutes } from './routes/media';
import { createQuizRoutes } from './routes/quiz';
import { createReplayRoutes } from './routes/replay';
import { createSimRoutes } from './routes/sim';
import { createStateRoutes } from './routes/state';
import { createStreamRoutes } from './routes/stream';
import { seedDemo } from './sim/seed';
import { createDirectory } from './store/directory';
import { createEventLog } from './store/eventlog';
import { createLedgerStore } from './store/ledger';
import { createSquadState } from './store/state';
import { createTripStore } from './store/trips';
import type { HubApp, HubDeps, HubEnv } from './types';

export interface HubOptions {
  config?: Partial<HubConfig>;
  /** Override any subset of ports (brain/media plug in here). Missing ports use the in-memory stubs. */
  ports?: Partial<Ports>;
  now?: () => number;
  /** Shared sqlite (core `openDb`). Default: open `config.dbPath` (`:memory:` under vitest). */
  db?: Db;
}
export interface Hub {
  app: HubApp;
  deps: HubDeps;
  close(): Promise<void>;
}

const VERSION = '0.1.0';

export function createHub(opts: HubOptions = {}): Hub {
  const config: HubConfig = { ...loadHubConfig(), ...opts.config };
  const now = opts.now ?? Date.now;
  const log = createLogger(config.logLevel);
  const startedAt = now();

  // Components reference `deps` lazily, so the container is filled in dependency order below.
  const deps = { config, log, now, projector: new Set<string>() } as unknown as HubDeps;
  let ownDb = false;
  if (opts.db) deps.db = opts.db;
  else {
    if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
    deps.db = openDb(config.dbPath);
    ownDb = true;
  }
  deps.directory = createDirectory(deps.db);
  deps.events = createEventLog({ max: config.sse.bufferSize, db: deps.db });
  deps.ledger = createLedgerStore(deps.db);
  deps.trips = createTripStore(deps.db);
  deps.calls = createCallRegistry(now);
  deps.filterCtx = { directory: deps.directory, calls: deps.calls, trips: deps.trips };
  deps.broker = createBroker(deps);
  deps.state = createSquadState(deps);
  deps.state.rebuild(); // agent states and pending confirms come back from the persisted log
  deps.ingest = createIngestor(deps);
  deps.ports = { ...createStubPorts(deps), ...opts.ports };
  if (config.seed) seedDemo(deps);

  const app: HubApp = new Hono<HubEnv>();
  app.use(
    '*',
    cors({
      origin: (origin) =>
        config.corsOrigins.includes('*') || config.corsOrigins.includes(origin) ? origin : null,
      allowHeaders: ['authorization', 'content-type', 'last-event-id', 'x-nook-internal'],
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      exposeHeaders: ['content-type'],
    }),
  );
  const health = (c: Context) =>
    c.json({
      ok: true,
      version: VERSION,
      uptimeS: Math.round((now() - startedAt) / 1000),
      seq: deps.events.lastSeq(),
      subscribers: deps.broker.count(),
      seed: config.seed,
    });
  app.get('/health', health);
  app.get('/v1/health', health);

  for (const routes of [
    createAuthRoutes(deps),
    createInternalRoutes(deps),
    createStateRoutes(deps),
    createStreamRoutes(deps),
    createReplayRoutes(deps),
    createQuizRoutes(deps),
    createCallRoutes(deps),
    createMediaRoutes(deps),
    createDomainRoutes(deps),
    createCouncilRoutes(deps),
    ...(config.sim ? [createSimRoutes(deps)] : []),
  ])
    app.route('/', routes);

  app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));
  app.onError((err, c) => {
    log.error('unhandled', { path: new URL(c.req.url).pathname, err: err.name });
    return c.json({ error: { code: 'internal' } }, 500);
  });

  return {
    app,
    deps,
    async close() {
      deps.broker.closeAll();
      if (ownDb) deps.db.close();
    },
  };
}
