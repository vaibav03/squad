// What the chat header, the Connections page and the plan panel show about the iMessage bridge. Honest by construction:
// a scripted transport reads "Fixture transport (no real iMessage)", an off bridge says it is off, and nothing says
// "connected" unless a real transport is running with a bound group. Browser-safe.
import { z } from 'zod';

export const IMESSAGE_MODES = ['off', 'dry_run', 'live', 'fixture'] as const;

export const ImessageSquadStatusSchema = z.object({
  squadId: z.string(),
  name: z.string(),
  /** Number of iMessage groups bound to this squad (never their ids). */
  bound: z.number().int().nonnegative(),
  lastSyncAt: z.number().nullable(),
  mirror: z.string().optional(),
});
export type ImessageSquadStatus = z.infer<typeof ImessageSquadStatusSchema>;

/** `GET /v1/imessage/status`. Additive: older hubs return only `{ enabled }` (or `{ enabled, transport, queued, ... }`). */
/** The provider's own bridge state (Sendblue): the exact header line, computed by the hub. */
export const ImessageBridgeSchema = z.object({
  provider: z.enum(['off', 'fake', 'local', 'sendblue']),
  state: z.enum(['connected', 'not_configured', 'degraded', 'fixture', 'dry_run', 'off', 'local']),
  label: z.string(),
  missingEnv: z.array(z.string()).optional(),
  lastInboundAt: z.number().optional(),
  lastStatusAt: z.number().optional(),
  queued: z.number().int().nonnegative().optional(),
  /** The Demo/Fixture bridge: scripted transport, never a real message. */
  demo: z.boolean().optional(),
  safety: z
    .object({
      dryRun: z.boolean(),
      killSwitch: z.boolean(),
      allowlist: z.object({
        chats: z.number().int().nonnegative(),
        handles: z.number().int().nonnegative(),
        allowAll: z.boolean(),
      }),
    })
    .optional(),
});
export type ImessageBridge = z.infer<typeof ImessageBridgeSchema>;

export const ImessageStatusSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['off', 'fake', 'local', 'sendblue']).optional(),
  bridge: ImessageBridgeSchema.optional(),
  mode: z.enum(IMESSAGE_MODES).optional(),
  /** IMESSAGE_ENABLED is not 1. */
  killSwitch: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  /** A scripted transport (tests, demo), not Apple's Messages. */
  fixture: z.boolean().optional(),
  /** ok | degraded | disabled | dry_run */
  transport: z.string().optional(),
  degradedReason: z.string().optional(),
  queued: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  watcherDown: z.boolean().optional(),
  lastSyncAt: z.number().nullable().optional(),
  squads: z.array(ImessageSquadStatusSchema).optional(),
});
export type ImessageStatus = z.infer<typeof ImessageStatusSchema>;

export type ImessageIndicatorState =
  | 'web_only'
  | 'not_connected'
  | 'dry_run'
  | 'connected'
  | 'degraded'
  | 'fixture';

export interface ImessageIndicator {
  state: ImessageIndicatorState;
  /** The exact words for the chat header. */
  label: string;
  /** One more sentence for a tooltip or the Connections card. */
  detail: string;
  /** Show a "setup" link to Connections. */
  setup: boolean;
}

export const FIXTURE_LABEL = 'Fixture transport (no real iMessage)';

/** "just now", "3 min ago", "2 h ago", "4 d ago". */
export function agoWords(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/**
 * The header indicator for one chat thread. DMs never cross to iMessage (docs/imessage.md 8.4): `Web only`.
 * A group says exactly how far the bridge got.
 */
export function imessageIndicator(
  status: ImessageStatus | null | undefined,
  thread: { kind: 'group' | 'dm'; squadId?: string | undefined },
  now: number,
): ImessageIndicator {
  if (thread.kind === 'dm')
    return {
      state: 'web_only',
      label: 'Web only',
      detail: 'Private chats with Cubbie stay on the web and are never sent to iMessage.',
      setup: false,
    };
  if (!status)
    return {
      state: 'web_only',
      label: 'Web only',
      detail: 'The iMessage bridge status is not available.',
      setup: false,
    };
  // Sendblue: the hub computed the exact line (connected / not configured with the env names / degraded / dry run)
  if (status.provider === 'sendblue' && status.bridge) {
    const b = status.bridge;
    const state: Record<ImessageBridge['state'], ImessageIndicatorState> = {
      connected: 'connected',
      not_configured: 'not_connected',
      degraded: 'degraded',
      fixture: 'fixture',
      dry_run: 'dry_run',
      off: 'not_connected',
      local: 'connected',
    };
    return {
      state: state[b.state],
      label: b.label,
      detail:
        b.state === 'not_configured'
          ? `Set ${b.missingEnv?.join(', ') ?? 'the SENDBLUE_* env'} in the hub environment, then restart it.`
          : 'Messages in the bound group are carried by Sendblue. Private chats never leave the web.',
      setup: b.state === 'not_configured' || b.state === 'off',
    };
  }
  const sq = status.squads?.find((s) => s.squadId === thread.squadId) ?? status.squads?.[0];
  const bound = sq?.bound ?? 0;
  if (!status.enabled || status.mode === 'off')
    return {
      state: 'not_connected',
      label: 'iMessage: not connected (setup)',
      detail: status.killSwitch === false ? 'The bridge is not running.' : 'The bridge is switched off (kill switch).',
      setup: true,
    };
  const queued = status.queued ?? 0;
  if (status.transport === 'degraded')
    return {
      state: 'degraded',
      label: `iMessage: degraded: ${status.degradedReason ?? (status.watcherDown ? 'watcher stopped' : 'sends are failing')}`,
      detail: `${queued} queued. Messages stay on the web until the bridge recovers.`,
      setup: false,
    };
  if (status.mode === 'dry_run' || status.dryRun)
    return {
      state: 'dry_run',
      label: 'iMessage: dry run',
      detail: 'Messages are parsed and routed but nothing is sent to Messages.',
      setup: false,
    };
  if (bound === 0)
    return {
      state: 'not_connected',
      label: 'iMessage: not connected (setup)',
      detail: 'The bridge is running but no iMessage group is bound to this squad yet.',
      setup: true,
    };
  const last = sq?.lastSyncAt ?? status.lastSyncAt ?? null;
  const when = last ? `last sync ${agoWords(last, now)}` : 'no sync yet';
  const fixture = status.fixture || status.mode === 'fixture';
  return {
    state: fixture ? 'fixture' : 'connected',
    label: `${fixture ? `${FIXTURE_LABEL}: ` : 'iMessage: '}connected to ${sq?.name ?? 'this squad'}, ${when}, ${queued} queued`,
    detail: fixture
      ? 'A scripted transport is connected. Nothing here reaches a real phone.'
      : 'Bot replies and @cubbie messages are mirrored to the bound iMessage group.',
    setup: false,
  };
}
