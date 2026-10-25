import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from '@squad/core/node';
import type { Db } from '@squad/core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStubPorts } from './adapters';
import { createBroker } from './broker';
import { createConsoleCodeSender, createImessageCodeSender, type CodeSender } from './code-sender';
import { createCallRegistry } from './calls';
import { loadHubConfig, type HubConfig } from './config';
import { createChatHub } from './chat/hub-chat';
import { createChatRoutes } from './chat/routes';
import { createConnectionRoutes } from './routes/connections';
import { createConfirmRouter } from './confirms';
import { createIngestor } from './ingest';
import { applySecurity, type SecurityOptions } from './middleware';
import { createLogger } from './log';
import { installObservability, type ObsOptions } from './observability';
import type { Ports } from './ports';
import { createAuthRoutes } from './routes/auth';
import { createInviteRoutes } from './routes/invites';
import { createMemberRoutes } from './routes/members';
import { createSquadRoutes } from './routes/squads';
import { createCallRoutes } from './routes/call';
import { createCouncilRoutes } from './routes/council';
import { createDomainRoutes } from './routes/domain';
import { createInternalRoutes } from './routes/internal';
import { createLiveRoutes } from './routes/live';
import { createLibraryRoutes } from './routes/library';
import { createMediaRoutes } from './routes/media';
import { createPlanRoutes } from './plans/routes';
import { createDefaultPlanContext } from './plans/context';
import { createPlanService } from './plans/service';
import { createPlanStore } from './plans/store';
import { COURSE_ID } from './cast';
import { createQuizRoutes } from './routes/quiz';
import { createReplayRoutes } from './routes/replay';
import { createSimRoutes } from './routes/sim';
import { createStateRoutes } from './routes/state';
import { createStatusRoutes } from './routes/status';
import { createStreamRoutes } from './routes/stream';
import { SQUAD_ID } from './cast';
import { seedDemo } from './sim/seed';
import { createAccountsStore } from './store/accounts';
import { createDirectory } from './store/directory';
import { createSquadsStore } from './store/squads';
import { createImessageStore } from './imessage/store';
import { createImessageRoutes } from './imessage/routes';
import { createEventLog } from './store/eventlog';
import { createLedgerStore } from './store/ledger';
import { createSquadState } from './store/state';
import { createTripStore } from './store/trips';
import { createTripService } from './trips/service';
import { createTripRoutes } from './routes/trips';
import type { HubApp, HubDeps, HubEnv } from './types';

export interface HubOptions {
  config?: Partial<HubConfig>;
  /** Override any subset of ports (brain/media plug in here). Missing ports use the in-memory stubs. */
  ports?: Partial<Ports>;
  now?: () => number;
  /** How verification codes are delivered. Default: console, or iMessage when CODE_SENDER=imessage. */
  codeSender?: CodeSender;
  /** Shared sqlite (core `openDb`). Default: open `config.dbPath` (`:memory:` under vitest). */
  db?: Db;
  /** HTTP hardening knobs (rate limits, trust proxy); defaults are safe. */
  security?: SecurityOptions;
  /** Observability overrides (admin token, agent probes, sentry). Defaults come from env. */
  obs?: ObsOptions;
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
  const log = createLogger(config.logLevel, undefined, config.authSecret);
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
  deps.accounts = createAccountsStore(deps.db, {
    secret: config.sessionSecret,
    pepper: config.contactPepper,
    now,
    sessionDays: config.sessionDays,
  });
  deps.squads = createSquadsStore(deps.db, deps.directory, deps.accounts, {
    now,
    maxSize: config.squadMax,
    onDisband: (id) => void deps.db.prepare('DELETE FROM hub_events WHERE squad_id=?').run(id),
    onLog: (msg, f) => log.debug(msg, f),
  });
  deps.imessage = createImessageStore(deps.db, now);
  deps.codeSender =
    opts.codeSender ??
    (config.codeSender === 'imessage' && config.imessageSendUrl
      ? createImessageCodeSender({ url: config.imessageSendUrl, log })
      : createConsoleCodeSender(log));
  // Real accounts come back into the directory at boot, and again after a dev reset wipes it.
  const clearDirectory = deps.directory.clear.bind(deps.directory);
  deps.directory.clear = () => {
    clearDirectory();
    deps.squads.hydrate();
  };
  deps.squads.hydrate();
  deps.events = createEventLog({ max: config.sse.bufferSize, db: deps.db });
  deps.ledger = createLedgerStore(deps.db);
  deps.trips = createTripStore(deps.db);
  deps.calls = createCallRegistry(now);
  deps.filterCtx = { directory: deps.directory, calls: deps.calls, trips: deps.trips };
  deps.broker = createBroker(deps);
  deps.state = createSquadState(deps);
  deps.state.rebuild(); // agent states and pending confirms come back from the persisted log
  deps.ingest = createIngestor(deps);
  deps.confirms = createConfirmRouter(deps);
  deps.ports = { ...createStubPorts(deps), ...opts.ports };
  deps.chat = createChatHub(
    deps,
    config.dbPath === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'squad-chat-files-'))
      : join(dirname(config.dbPath), 'chat-files'),
  );
  deps.plans = createPlanService(
    deps,
    createDefaultPlanContext(deps.db, COURSE_ID),
    createPlanStore(deps.db),
  );
  deps.tripSvc = createTripService(deps);
  if (config.seed) {
    seedDemo(deps);
    // The seeded demo squad becomes a real one (owner = its first member) so Members, invites and roles work.
    deps.squads.adopt(SQUAD_ID);
  }

  const app: HubApp = new Hono<HubEnv>();
  applySecurity(app, deps, opts.security);
  app.use(
    '*',
    cors({
      origin: (origin) =>
        config.corsOrigins.includes('*') || config.corsOrigins.includes(origin) ? origin : null,
      allowHeaders: [
        'authorization',
        'content-type',
        'last-event-id',
        'x-nook-internal',
        'x-squad-id',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['content-type', 'x-squad-token'],
      credentials: true,
    }),
  );
  // ops: correlation ids, metrics, /health, /ready, /metrics, /v1/admin/*; registered before the legacy health below
  const obs = installObservability(app, deps, { version: VERSION, ...opts.obs });
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
    createSquadRoutes(deps),
    createMemberRoutes(deps),
    createInviteRoutes(deps),
    createImessageRoutes(deps),
    createInternalRoutes(deps),
    createStatusRoutes(deps),
    createStateRoutes(deps),
    createStreamRoutes(deps),
    createReplayRoutes(deps),
    createQuizRoutes(deps),
    createLibraryRoutes(deps),
    createCallRoutes(deps),
    createMediaRoutes(deps),
    createTripRoutes(deps),
    createDomainRoutes(deps),
    createCouncilRoutes(deps),
    createLiveRoutes(deps),
    createChatRoutes(deps),
    createConnectionRoutes(deps),
    createPlanRoutes(deps),
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
      obs.stop();
      deps.broker.closeAll();
      deps.chat.close();
      deps.tripSvc.stop();
      if (ownDb) deps.db.close();
    },
  };
}
