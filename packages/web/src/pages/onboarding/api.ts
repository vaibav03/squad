import { timedFetch } from '../../lib/http';
import { phaseHasData, phaseOf } from '../../lib/connection-phase';
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
    return list.some((c) => phaseHasData(phaseOf(c)));
  } catch {
    return null;
  }
}

export async function fetchOnboarding(ctx: OnboardingCtx): Promise<OnboardingState> {
  try {
    const res = await timedFetch(`${base(ctx)}/v1/onboarding`, { headers: auth(ctx) });
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as {
        connected?: unknown;
        skipped?: unknown;
        skippedAt?: unknown;
      } | null;
      if (j && typeof j === 'object') {
        const connected =
          typeof j.connected === 'boolean' ? j.connected : await deriveConnected(ctx);
        const skippedAt = typeof j.skippedAt === 'number' ? j.skippedAt : null;
        return {
          connected,
          skipped: j.skipped === true || skippedAt !== null,
          skippedAt,
          source: 'server',
        };
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
      const j = (await res.json().catch(() => null)) as { skippedAt?: unknown } | null;
      const at = typeof j?.skippedAt === 'number' ? j.skippedAt : now;
      return {
        connected: await deriveConnected(ctx),
        skipped: true,
        skippedAt: at,
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
