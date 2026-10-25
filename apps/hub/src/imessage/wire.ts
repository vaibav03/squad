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
  const config = o.config ?? imessageConfigFromEnv(o.env ?? process.env);
  const problem = configProblem(config);
  if (problem) {
    deps.log.info(`imessage: not started (${problem})`);
    return undefined;
  }
  const env = o.env ?? process.env;
  // IMESSAGE_FIXTURE=1 (with IMESSAGE_ENABLED=1 and an allowlist that names FIXTURE_CHAT) runs a scripted transport and
  // binds it to a squad, for demos and e2e. The status and the web say "Fixture transport (no real iMessage)".
  const fixture = !o.sdk && env.IMESSAGE_FIXTURE === '1';
  const sdk =
    o.sdk ?? (fixture ? new FakeIMessageTransport([{ chatId: FIXTURE_CHAT, name: 'Fixture group', kind: 'group' }]) : undefined);
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
  const bridge = createIMessageBridge({
    deps,
    gateway,
    store: deps.imessage,
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
      await gateway.stop();
    },
  };
}
