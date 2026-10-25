// Starts the iMessage bridge inside the hub process. Off unless IMESSAGE_ENABLED=1 and an allowlist is set.
import {
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
}

export interface AttachIMessageOptions {
  env?: Record<string, string | undefined>;
  /** Tests inject a fake SDK; production loads @photon-ai/imessage-kit. */
  sdk?: IMessageSdkLike;
  config?: IMessageConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
}

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
  const gateway = createIMessageGateway({
    config,
    ...(o.sdk ? { sdk: o.sdk } : {}),
    log: botLog(deps),
    ...(o.now ? { now: o.now } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.minGapMs !== undefined ? { minGapMs: o.minGapMs } : {}),
    seen: (g) => deps.imessage.seen(g),
  });
  const bridge = createIMessageBridge({
    deps,
    gateway,
    store: deps.imessage,
    ...(o.now ? { now: o.now } : {}),
  });
  await gateway.start((m) => bridge.handleInbound(m));
  deps.log.info(
    `imessage: running (dryRun=${config.dryRun}, chats=${config.allowedChats.length}, handles=${config.allowedHandles.length}, allowAll=${config.allowAll})`,
  );
  return {
    bridge,
    gateway,
    async stop() {
      bridge.stop();
      await gateway.stop();
    },
  };
}
