import { timedFetch } from '../../lib/http';
import { anyConnected } from './model';
import { hub } from '../connections/api';

/**
 * First-run state adapter.
 *
 * Contract (built by the journey worker, not on origin yet):
 *   GET  /v1/onboarding       -> { connected?: boolean, skipped?: boolean, skippedAt?: number | null }
 *   POST /v1/onboarding/skip  -> records the skip server-side
 *
 * TEMPORARY FALLBACK: while those routes 404 (or the network fails) we derive `connected` from GET /v1/connections
 * and keep the skip flag in a per-account localStorage key. Delete the fallback branches once the routes ship.
 */
export interface OnboardingCtx {
  hubUrl: string;
  token: string;
  /** Account id, used to scope the localStorage fallback. */
  userId: string | null;
}
export interface OnboardingState {
  /** null = could not tell (hub unreachable): the gate stays out of the way. */
  connected: boolean | null;
  skipped: boolean;
  skippedAt: number | null;
  source: 'server' | 'fallback';
  /** From GET /v1/onboarding (absent on the fallback). */
  identityDone?: boolean;
  sharingChosen?: boolean;
  nextStep?: 'identity' | 'connect' | 'sharing' | 'done';
  integrations?: Partial<Record<'canvas' | 'google', ProviderIntegration>>;
}
export interface ProviderIntegration {
  state: string;
  sub: string | null;
  counts: Record<string, number>;
  lastSyncAt: number | null;
  demo: boolean;
}

const HAS_DATA = new Set(['syncing', 'live', 'demo', 'degraded']);

/** Parses the hub's GET /v1/onboarding body (identityDone, integrations, sharingChosen, skipped, nextStep). */
export function parseOnboarding(j: unknown): Omit<OnboardingState, 'source'> | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const ints = (o.integrations ?? undefined) as OnboardingState['integrations'];
  const skippedObj = o.skipped && typeof o.skipped === 'object' ? (o.skipped as { at?: unknown }) : null;
  const skippedAt =
    typeof skippedObj?.at === 'number' ? skippedObj.at : typeof o.skippedAt === 'number' ? o.skippedAt : null;
  const connected =
    typeof o.connected === 'boolean'
      ? o.connected
      : ints
        ? Object.values(ints).some((p) => !!p && HAS_DATA.has(p.state))
        : null;
  return {
    connected,
    skipped: o.skipped === true || skippedObj !== null || skippedAt !== null,
    skippedAt,
    ...(typeof o.identityDone === 'boolean' ? { identityDone: o.identityDone } : {}),
    ...(typeof o.sharingChosen === 'boolean' ? { sharingChosen: o.sharingChosen } : {}),
    ...(typeof o.nextStep === 'string' ? { nextStep: o.nextStep as OnboardingState['nextStep'] } : {}),
    ...(ints ? { integrations: ints } : {}),
  };
}

export const skipKey = (userId: string | null): string =>
  `squad.onboarding.skip.${userId ?? 'anon'}`;

function readLocalSkip(userId: string | null): number | null {
  try {
    const v = localStorage.getItem(skipKey(userId));
    return v ? Number(v) || Date.now() : null;
  } catch {
    return null;
  }
}
function writeLocalSkip(userId: string | null, at: number): void {
  try {
    localStorage.setItem(skipKey(userId), String(at));
  } catch {
    /* storage blocked: the skip lasts for this page view only */
  }
}

const base = (ctx: OnboardingCtx) => ctx.hubUrl.replace(/\/+$/, '');
const auth = (ctx: OnboardingCtx) => ({ Authorization: `Bearer ${ctx.token}` });

/** True when the person has at least one live or demo connection with imported data. */
export async function deriveConnected(ctx: OnboardingCtx): Promise<boolean | null> {
  try {
    const list = await hub({ hubUrl: base(ctx), token: ctx.token }).list();
    return anyConnected(list);
  } catch {
    return null;
  }
}

export async function fetchOnboarding(ctx: OnboardingCtx): Promise<OnboardingState> {
  try {
    const res = await timedFetch(`${base(ctx)}/v1/onboarding`, { headers: auth(ctx) });
    if (res.ok) {
      const parsed = parseOnboarding(await res.json().catch(() => null));
      if (parsed) {
        const connected = parsed.connected ?? (await deriveConnected(ctx));
        return { ...parsed, connected, source: 'server' };
      }
    }
  } catch {
    /* network error: fall through to the fallback */
  }
  const at = readLocalSkip(ctx.userId);
  return {
    connected: await deriveConnected(ctx),
    skipped: at !== null,
    skippedAt: at,
    source: 'fallback',
  };
}

/** Records "skip for now": server first, per-account localStorage when the route is missing or unreachable. */
export async function recordSkip(ctx: OnboardingCtx): Promise<OnboardingState> {
  const now = Date.now();
  try {
    const res = await timedFetch(`${base(ctx)}/v1/onboarding/skip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(ctx) },
      body: '{}',
    });
    if (res.ok) {
      const parsed = parseOnboarding(await res.json().catch(() => null));
      return {
        ...(parsed ?? {}),
        connected: parsed?.connected ?? (await deriveConnected(ctx)),
        skipped: true,
        skippedAt: parsed?.skippedAt ?? now,
        source: 'server',
      };
    }
  } catch {
    /* fall through */
  }
  writeLocalSkip(ctx.userId, now);
  return {
    connected: await deriveConnected(ctx),
    skipped: true,
    skippedAt: now,
    source: 'fallback',
  };
}

/** Whether the hub has real Google OAuth configured (top-level `mode` of GET /v1/connections), else demo only. */
export async function googleIsLive(ctx: OnboardingCtx): Promise<boolean> {
  try {
    const res = await timedFetch(`${base(ctx)}/v1/connections`, { headers: auth(ctx) });
    const j = (await res.json().catch(() => null)) as { mode?: unknown } | null;
    return res.ok && j?.mode === 'live';
  } catch {
    return false;
  }
}
