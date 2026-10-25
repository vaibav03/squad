// Bridge state (the chat header indicator) and Integration Health checks for the iMessage provider.
// Consumed by GET /v1/imessage/status and GET /v1/imessage/health, and by the shared Integration Health page
// (GET /v1/connections/health) once it lands. Credentials never appear here: only env NAMES and masked numbers.
import { imessageConfigFromEnv, type IMessageGateway } from '@squad/bot';
import type { HubDeps } from '../../types';
import {
  maskNumber,
  missingSendblueEnv,
  providerFromEnv,
  sendblueConfigFromEnv,
  type ImessageProvider,
} from './config';
import { GROUP_PREFIX } from './sdk';

type Env = Record<string, string | undefined>;

export interface BridgeState {
  provider: ImessageProvider;
  state: 'connected' | 'not_configured' | 'degraded' | 'fixture' | 'dry_run' | 'off' | 'local';
  /** The exact line the chat header shows. */
  label: string;
  missingEnv: string[];
  lastInboundAt?: number;
  lastStatusAt?: number;
  queued: number;
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'blocked';
export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was found (or `BLOCKED(missing env: NAMES)` for a live check without credentials). */
  reason: string;
  /** What to do about it. */
  fix: string;
  blocked?: boolean;
  /** For a blocked check: the exact env names that are missing. */
  missingEnv?: string[];
}
export interface HealthReport {
  provider: ImessageProvider;
  ok: boolean;
  blocked: number;
  webhookUrl: string;
  checks: HealthCheck[];
}

export interface BridgeInfo {
  provider: ImessageProvider;
  /** The env the bridge was started with (names and values never leave this module). */
  env: Env;
  dryRun: boolean;
  gateway: IMessageGateway;
}

const ago = (t: number | undefined, now: number): string => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function sendblueGroupNames(deps: HubDeps): string[] {
  return deps.imessage
    .allBindings()
    .filter((b) => b.chatGuid.startsWith(GROUP_PREFIX))
    .map((b) => deps.directory.squad(b.squadId)?.name ?? 'a squad');
}

export function bridgeState(deps: HubDeps, envIn?: Env): BridgeState {
  const env = envIn ?? deps.imessageInfo?.env ?? process.env;
  const provider = deps.imessageInfo?.provider ?? providerFromEnv(env);
  const cfg = sendblueConfigFromEnv(env, deps.config.baseUrl);
  const missing = missingSendblueEnv(cfg);
  const queued = deps.imessage.outCounts().queued;
  const now = deps.now();
  const base = { provider, missingEnv: [] as string[], queued };
  if (provider === 'fake')
    return { ...base, state: 'fixture', label: 'Fixture transport (no real iMessage)' };
  if (provider === 'local') return { ...base, state: 'local', label: 'iMessage: local Mac bridge' };
  if (provider === 'off')
    return { ...base, state: 'off', label: 'iMessage is off (set IMESSAGE_PROVIDER=sendblue)' };
  if (missing.length)
    return {
      ...base,
      missingEnv: missing,
      state: 'not_configured',
      label: `Sendblue: not configured (set ${missing.join(', ')})`,
    };
  const dry = deps.imessageInfo?.dryRun ?? imessageConfigFromEnv(env).dryRun;
  const lastInboundAt = deps.sendblue?.store.meta('last_inbound');
  const lastStatusAt = deps.sendblue?.store.meta('last_status');
  const times = {
    ...(lastInboundAt ? { lastInboundAt } : {}),
    ...(lastStatusAt ? { lastStatusAt } : {}),
  };
  if (dry) return { ...base, ...times, state: 'dry_run', label: 'Dry run, not sent' };
  if (!deps.sendblue || !deps.imessageInfo)
    return {
      ...base,
      ...times,
      state: 'degraded',
      label:
        'degraded: the Sendblue bridge is not running (check IMESSAGE_ENABLED and the allowlist)',
    };
  const h = deps.imessageInfo.gateway.health();
  if (h.state === 'degraded' || h.state === 'disabled') {
    const reason =
      h.state === 'disabled'
        ? 'iMessage is switched off (IMESSAGE_ENABLED is not 1)'
        : `${h.consecutiveFailures} sends in a row failed`;
    return { ...base, ...times, state: 'degraded', label: `degraded: ${reason}` };
  }
  const groups = sendblueGroupNames(deps);
  return {
    ...base,
    ...times,
    state: 'connected',
    label: `Sendblue: connected to ${groups.length ? groups.join(', ') : 'no group yet'}, last inbound ${ago(lastInboundAt, now)}, last status ${ago(lastStatusAt, now)}, ${queued} queued`,
  };
}

let probeCache: { at: number; result: HealthCheck } | undefined;
export const resetProbeCache = () => {
  probeCache = undefined;
};

export async function healthReport(deps: HubDeps, envIn?: Env): Promise<HealthReport> {
  const env = envIn ?? deps.imessageInfo?.env ?? process.env;
  const provider = deps.imessageInfo?.provider ?? providerFromEnv(env);
  const cfg = sendblueConfigFromEnv(env, deps.config.baseUrl);
  const missing = missingSendblueEnv(cfg);
  const gwCfg = imessageConfigFromEnv(env);
  const now = deps.now();
  const webhookUrl = `${cfg.publicUrl || deps.config.baseUrl}/v1/webhooks/sendblue`;
  const rt = deps.sendblue;
  const blockedReason = missing.length
    ? `BLOCKED(missing env: ${missing.join(', ')})`
    : provider !== 'sendblue'
      ? 'BLOCKED(IMESSAGE_PROVIDER is not sendblue)'
      : undefined;
  const live = !blockedReason;
  const checks: HealthCheck[] = [];
  const add = (c: HealthCheck) => checks.push(c);
  const blocked = (id: string, label: string, fix: string): HealthCheck => ({
    id,
    label,
    status: 'blocked',
    reason: blockedReason!,
    fix,
    blocked: true,
    ...(missing.length ? { missingEnv: missing } : {}),
  });

  add(
    missing.length
      ? {
          id: 'sendblue_configured',
          label: 'Sendblue credentials',
          status: 'fail',
          reason: `missing env: ${missing.join(', ')}`,
          fix: `Set ${missing.join(', ')} in the hub environment (.env) and restart the hub.`,
        }
      : provider !== 'sendblue'
        ? {
            id: 'sendblue_configured',
            label: 'Sendblue credentials',
            status: 'warn',
            reason: `credentials are set but IMESSAGE_PROVIDER is "${provider}"`,
            fix: 'Set IMESSAGE_PROVIDER=sendblue (and IMESSAGE_ENABLED=1) and restart the hub.',
          }
        : {
            id: 'sendblue_configured',
            label: 'Sendblue credentials',
            status: 'pass',
            reason: `all of ${['SENDBLUE_API_KEY', 'SENDBLUE_API_SECRET', 'SENDBLUE_FROM_NUMBER', 'SENDBLUE_WEBHOOK_SECRET'].join(', ')} are set (line ${maskNumber(cfg.fromNumber)})`,
            fix: 'Nothing to do.',
          },
  );
  add(
    cfg.webhookSecret
      ? {
          id: 'webhook_secret_set',
          label: 'Webhook secret',
          status: 'pass',
          reason: `SENDBLUE_WEBHOOK_SECRET is set; inbound requests must carry it in the ${cfg.secretHeader} header`,
          fix: 'Add the same secret to the webhook in the Sendblue dashboard (Developer, Webhooks).',
        }
      : {
          id: 'webhook_secret_set',
          label: 'Webhook secret',
          status: 'fail',
          reason:
            'missing env: SENDBLUE_WEBHOOK_SECRET (the webhook endpoint refuses every request)',
          fix: 'Set SENDBLUE_WEBHOOK_SECRET to a long random string and paste it into the Sendblue webhook secret field.',
        },
  );
  const https = webhookUrl.startsWith('https://');
  const loop = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(webhookUrl);
  add(
    https && !loop
      ? {
          id: 'webhook_reachable_url',
          label: 'Webhook URL',
          status: 'pass',
          reason: `${webhookUrl} is a public https URL (reachability is proven by inbound_seen)`,
          fix: 'Paste this URL as the receive webhook in the Sendblue dashboard.',
        }
      : {
          id: 'webhook_reachable_url',
          label: 'Webhook URL',
          status: 'warn',
          reason: `${webhookUrl} is not a public https URL; Sendblue cannot reach it`,
          fix: 'Expose the hub with a tunnel (for example cloudflared or ngrok) and set SENDBLUE_PUBLIC_URL to the https origin.',
        },
  );
  // outbound_probe: account/line status only. It NEVER sends a message.
  if (!live || !rt) {
    add(
      blocked(
        'outbound_probe',
        'Sendblue account and line',
        live
          ? 'Start the hub with IMESSAGE_ENABLED=1 and an allowlist.'
          : `Set the missing env and restart.`,
      ),
    );
  } else if (probeCache && now - probeCache.at < 60_000) {
    add(probeCache.result);
  } else {
    let r: HealthCheck;
    try {
      const l = await rt.client.lines();
      const mine = l.numbers.some(
        (n) => n.replace(/\D/g, '') === cfg.fromNumber.replace(/\D/g, ''),
      );
      r = mine
        ? {
            id: 'outbound_probe',
            label: 'Sendblue account and line',
            status: 'pass',
            reason: `account reachable, ${l.count} line(s), ${maskNumber(cfg.fromNumber)} is on the account (no message sent)`,
            fix: 'Nothing to do.',
          }
        : {
            id: 'outbound_probe',
            label: 'Sendblue account and line',
            status: 'warn',
            reason: `account reachable, ${l.count} line(s), but SENDBLUE_FROM_NUMBER (${maskNumber(cfg.fromNumber)}) is not one of them`,
            fix: 'Set SENDBLUE_FROM_NUMBER to a line shown in the Sendblue dashboard.',
          };
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'error';
      r = {
        id: 'outbound_probe',
        label: 'Sendblue account and line',
        status: 'fail',
        reason: `Sendblue did not accept the credentials or was unreachable (${code})`,
        fix: 'Check SENDBLUE_API_KEY and SENDBLUE_API_SECRET in the Sendblue dashboard (API credentials).',
      };
    }
    probeCache = { at: now, result: r };
    add(r);
  }
  const last = rt?.store.lastStatus();
  if (!live)
    add(
      blocked(
        'last_delivery_status',
        'Last delivery status',
        'Set the missing env, send a message from the web.',
      ),
    );
  else
    add(
      !last
        ? {
            id: 'last_delivery_status',
            label: 'Last delivery status',
            status: 'warn',
            reason: 'no delivery status callback received yet',
            fix: 'Send a message from the web chat in the bound group and check the badge.',
          }
        : last.state === 'failed'
          ? {
              id: 'last_delivery_status',
              label: 'Last delivery status',
              status: 'fail',
              reason: `last status was failed${last.errorCode ? ` (error ${last.errorCode})` : ''}, ${ago(last.at, now)}`,
              fix: 'Open the failed message in the web chat and press Retry; check the Sendblue dashboard logs for the error code.',
            }
          : {
              id: 'last_delivery_status',
              label: 'Last delivery status',
              status: 'pass',
              reason: `last status was ${last.state}, ${ago(last.at, now)}`,
              fix: 'Nothing to do.',
            },
    );
  const lastIn = rt?.store.meta('last_inbound');
  const lastVer = rt?.store.meta('last_verified');
  if (!live)
    add(
      blocked(
        'inbound_seen',
        'Inbound webhook seen',
        'Set the missing env, then text the Sendblue line.',
      ),
    );
  else
    add(
      lastIn
        ? {
            id: 'inbound_seen',
            label: 'Inbound webhook seen',
            status: 'pass',
            reason: `a verified inbound message arrived ${ago(lastIn, now)}`,
            fix: 'Nothing to do.',
          }
        : lastVer
          ? {
              id: 'inbound_seen',
              label: 'Inbound webhook seen',
              status: 'warn',
              reason: `a verified webhook arrived ${ago(lastVer, now)} but no inbound message yet`,
              fix: 'Text the Sendblue line from an allowlisted number or group.',
            }
          : {
              id: 'inbound_seen',
              label: 'Inbound webhook seen',
              status: 'warn',
              reason: 'no verified webhook received yet',
              fix: 'Add the webhook URL and secret in the Sendblue dashboard, then text the line.',
            },
    );
  const groups = sendblueGroupNames(deps);
  add(
    groups.length
      ? {
          id: 'thread_mapped_to_web_thread',
          label: 'Group mapped to the web thread',
          status: 'pass',
          reason: `Sendblue group bound to ${groups.join(', ')}`,
          fix: 'Nothing to do.',
        }
      : {
          id: 'thread_mapped_to_web_thread',
          label: 'Group mapped to the web thread',
          status: 'warn',
          reason: 'no Sendblue group is bound to a squad yet',
          fix: 'In the iMessage group send: join <invite code> (the code from the Squad invite).',
        },
  );
  const allow = gwCfg.allowedChats.length + gwCfg.allowedHandles.length;
  add(
    gwCfg.allowAll
      ? {
          id: 'allowlist_configured',
          label: 'Allowlist',
          status: 'warn',
          reason: 'IMESSAGE_ALLOW_ALL is on: any number can talk to the bot',
          fix: 'Remove IMESSAGE_ALLOW_ALL and list IMESSAGE_ALLOWED_CHATS (Sendblue;+;<group_id>) and IMESSAGE_ALLOWED_HANDLES.',
        }
      : allow
        ? {
            id: 'allowlist_configured',
            label: 'Allowlist',
            status: 'pass',
            reason: `${gwCfg.allowedChats.length} chat(s) and ${gwCfg.allowedHandles.length} number(s) allowlisted`,
            fix: 'Nothing to do.',
          }
        : {
            id: 'allowlist_configured',
            label: 'Allowlist',
            status: 'fail',
            reason: 'no allowlist: the transport refuses to send and ignores every inbound message',
            fix: 'Set IMESSAGE_ALLOWED_CHATS=Sendblue;+;<group_id> and/or IMESSAGE_ALLOWED_HANDLES=<your number>.',
          },
  );
  return {
    provider,
    ok: !checks.some((c) => c.status === 'fail'),
    blocked: checks.filter((c) => c.blocked).length,
    webhookUrl,
    checks,
  };
}
