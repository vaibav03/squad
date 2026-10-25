// Starts the iMessage bridge inside the hub process. Off unless IMESSAGE_ENABLED=1 and an allowlist is set.
import {
  FakeIMessageTransport,
  configProblem,
  createIMessageGateway,
  imessageConfigFromEnv,
  type IMessageConfig,
  type IMessageGateway,
  type IMessageSdkLike,
  type Logger,
} from '@squad/bot';
import type { HubDeps } from '../types';
import { createIMessageBridge, type IMessageBridge } from './bridge';
import { createSendblueClient } from './sendblue/client';
import {
  missingSendblueEnv,
  providerFromEnv,
  sendblueConfigFromEnv,
  type ImessageProvider,
} from './sendblue/config';
import { createMediaSigner } from './sendblue/media';
import { createSendblueRuntime } from './sendblue/runtime';
import { createSendblueSdk, GROUP_PREFIX } from './sendblue/sdk';
import { createSendblueStore } from './sendblue/store';

export interface IMessageHandle {
  bridge: IMessageBridge;
  gateway: IMessageGateway;
  stop(): Promise<void>;
  /** The watcher came back (or a manual nudge): fetch what the bound chats missed and flush the queue. */
  reconnect(): Promise<{ chats: number; messages: number }>;
}

export interface AttachIMessageOptions {
  env?: Record<string, string | undefined>;
  /** Tests inject a fake SDK; production loads @photon-ai/imessage-kit. */
  sdk?: IMessageSdkLike;
  config?: IMessageConfig;
  /** sendblue | local | fake | off. Default: IMESSAGE_PROVIDER, else local when IMESSAGE_ENABLED=1, else off. */
  provider?: ImessageProvider;
  /** Tests: the fetch the Sendblue client and media download use (default: the global fetch). */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
  /** false: no retry and backfill timers (tests). */
  timers?: boolean;
}

/** The one chat guid the fixture transport knows. Allowlist it with IMESSAGE_ALLOWED_CHATS. */
export const FIXTURE_CHAT = 'iMessage;+;chat-fixture-0001';

/** The hub's logger takes (message, fields); the bot's takes (fields, message). */
const botLog = (deps: Pick<HubDeps, 'log'>): Logger => ({
  info: (a, m) =>
    deps.log.info(
      typeof a === 'string' ? a : (m ?? 'imessage'),
      typeof a === 'string' ? undefined : a,
    ),
  warn: (a, m) =>
    deps.log.warn(
      typeof a === 'string' ? a : (m ?? 'imessage'),
      typeof a === 'string' ? undefined : a,
    ),
  error: (a, m) =>
    deps.log.error(
      typeof a === 'string' ? a : (m ?? 'imessage'),
      typeof a === 'string' ? undefined : a,
    ),
  debug() {},
});

/** Returns undefined (and starts nothing) when the kill switch is on or the config is unsafe. */
export async function attachIMessage(
  hub: { deps: HubDeps },
  o: AttachIMessageOptions = {},
): Promise<IMessageHandle | undefined> {
  const { deps } = hub;
  const env = o.env ?? process.env;
  // an injected sdk or config is the pre-Sendblue (local) path: keep it working unchanged
  const provider: ImessageProvider =
    o.provider ?? (o.sdk || o.config ? 'local' : providerFromEnv(env));
  if (provider === 'off') {
    deps.log.info('imessage: not started (IMESSAGE_PROVIDER is off)');
    return undefined;
  }
  let config = o.config ?? imessageConfigFromEnv(env);
  let sdk = o.sdk;
  let fixture = false;
  let sbParts:
    | {
        cfg: ReturnType<typeof sendblueConfigFromEnv>;
        sdk: ReturnType<typeof createSendblueSdk>;
        client: ReturnType<typeof createSendblueClient>;
        store: ReturnType<typeof createSendblueStore>;
        media: ReturnType<typeof createMediaSigner>;
      }
    | undefined;
  if (provider === 'fake') {
    // fixture transport (also IMESSAGE_FIXTURE=1): nothing real is ever read or sent. Without an allowlist
    // the fixture needs none; with one (IMESSAGE_ALLOWED_CHATS naming FIXTURE_CHAT) it is honoured.
    fixture = !o.sdk;
    sdk ??= new FakeIMessageTransport([
      { chatId: FIXTURE_CHAT, name: 'Fixture group', kind: 'group' },
    ]);
    if (!o.config && config.allowedChats.length + config.allowedHandles.length === 0)
      config = { ...config, enabled: true, dryRun: false, allowAll: true };
  }
  if (provider === 'sendblue') {
    const cfg = sendblueConfigFromEnv(env, deps.config.baseUrl);
    const missing = missingSendblueEnv(cfg);
    if (missing.length) {
      deps.log.info(`imessage: Sendblue not started (missing env: ${missing.join(', ')})`);
      return undefined;
    }
    // a bare Sendblue group_id in the allowlist means the chat guid Sendblue;+;<group_id>
    config = {
      ...config,
      allowedChats: config.allowedChats.map((c) => (c.includes(';') ? c : `${GROUP_PREFIX}${c}`)),
    };
  }
  const problem = configProblem(config);
  if (problem) {
    deps.log.info(`imessage: not started (${problem})`);
    return undefined;
  }
  if (provider === 'sendblue') {
    const cfg = sendblueConfigFromEnv(env, deps.config.baseUrl);
    const client = createSendblueClient(cfg, o.fetch);
    const media = createMediaSigner(`sb-media:${deps.config.authSecret}`, o.now ?? deps.now);
    sbParts = {
      cfg,
      client,
      media,
      store: createSendblueStore(deps.db),
      sdk: createSendblueSdk({
        cfg,
        client,
        media,
        safety: config,
        log: botLog(deps),
        ...(o.fetch ? { fetchFn: o.fetch } : {}),
      }),
    };
    sdk = sbParts.sdk;
  }
  const gateway = createIMessageGateway({
    config,
    ...(sdk ? { sdk } : {}),
    log: botLog(deps),
    ...(o.now ? { now: o.now } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.minGapMs !== undefined ? { minGapMs: o.minGapMs } : {}),
    // the identity map is the dedupe: a guid is done once stored or handled (hub restart safe)
    seen: (g) => deps.imessage.inboundDone(g),
  });
  deps.imessageInfo = { provider, env, dryRun: config.dryRun, gateway };
  if (sbParts) deps.sendblue = createSendblueRuntime({ deps, safety: config, gateway, ...sbParts });
  const bridge = createIMessageBridge({
    deps,
    gateway,
    store: deps.imessage,
    provider: provider === 'sendblue' ? 'sendblue' : provider === 'fake' ? 'fixture' : 'photon',
    ...(o.now ? { now: o.now } : {}),
    ...(o.timers !== undefined ? { timers: o.timers } : {}),
    ...(o.sdk || fixture ? { fixture: true } : {}),
  });
  if (fixture) {
    const squad = env.IMESSAGE_FIXTURE_SQUAD ?? deps.directory.students()[0]?.id;
    const squadId = env.IMESSAGE_FIXTURE_SQUAD ?? (squad ? deps.directory.squadOf(squad) : undefined);
    if (squadId && !deps.imessage.binding(FIXTURE_CHAT)) deps.imessage.bind(FIXTURE_CHAT, squadId, 'fixture');
  }
  deps.imessageSync = bridge.sync;
  await gateway.start((m) => bridge.handleInbound(m));
  // pick up what chat.db received while the hub was down (cursor per bound chat), then keep retrying queued sends
  await bridge.sync.backfillAll().catch(() => undefined);
  void bridge.sync.drain();
  deps.log.info(
    `imessage: running (dryRun=${config.dryRun}, chats=${config.allowedChats.length}, handles=${config.allowedHandles.length}, allowAll=${config.allowAll})`,
  );
  return {
    bridge,
    gateway,
    async reconnect() {
      const r = await bridge.sync.backfillAll();
      await bridge.sync.drain();
      return r;
    },
    async stop() {
      bridge.stop();
      deps.imessageSync = undefined;
      deps.sendblue = undefined;
      deps.imessageInfo = undefined;
      await gateway.stop();
    },
  };
}
