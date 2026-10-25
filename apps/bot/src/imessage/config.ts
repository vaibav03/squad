// Safety configuration for every iMessage path (hub bridge and the standalone bot transport).
// Everything is fail-closed: OFF unless IMESSAGE_ENABLED=1, and ON still needs an allowlist (or IMESSAGE_ALLOW_ALL=1).

export interface IMessageConfig {
  /** Kill switch. Default false: nothing is read or sent. */
  enabled: boolean;
  /** Log what would be sent and never send. Inbound is still processed. */
  dryRun: boolean;
  /** Chat GUIDs (groups) the bot may read and speak in. */
  allowedChats: string[];
  /** Phone numbers / Apple ID emails the bot may talk to 1:1. */
  allowedHandles: string[];
  /** Explicit opt-out of the allowlists (never use on a Mac with real chats). */
  allowAll: boolean;
  /** Outbound messages per chat per minute. */
  ratePerMin: number;
  /** Other bots / numbers to ignore completely. */
  ignoreHandles: string[];
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const flag = (v: string | undefined): boolean => v === '1' || v?.toLowerCase() === 'true';

export function imessageConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): IMessageConfig {
  const rate = Number(env.IMESSAGE_RATE_PER_MIN);
  return {
    enabled: flag(env.IMESSAGE_ENABLED),
    dryRun: flag(env.IMESSAGE_DRY_RUN),
    allowedChats: list(env.IMESSAGE_ALLOWED_CHATS),
    allowedHandles: list(env.IMESSAGE_ALLOWED_HANDLES),
    allowAll: flag(env.IMESSAGE_ALLOW_ALL),
    ratePerMin: Number.isFinite(rate) && rate > 0 ? Math.floor(rate) : 10,
    ignoreHandles: list(env.IMESSAGE_IGNORE_HANDLES),
  };
}

/** Why the configuration must not start, or undefined when it may. */
export function configProblem(c: IMessageConfig): string | undefined {
  if (!c.enabled) return 'IMESSAGE_ENABLED is not 1 (kill switch is on)';
  if (!c.allowAll && c.allowedChats.length === 0 && c.allowedHandles.length === 0)
    return 'set IMESSAGE_ALLOWED_CHATS and/or IMESSAGE_ALLOWED_HANDLES (or IMESSAGE_ALLOW_ALL=1)';
  return undefined;
}
