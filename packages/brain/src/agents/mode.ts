import { LlmError, type AgentMode } from '@squad/core';

/**
 * THE one decision point for "real or scripted" (plan section 5.1). Called once when a run starts; the result
 * is carried on every event of that run. A run that starts `live` never becomes scripted: it can only get worse
 * to `degraded:<reason>`, and scripted text under a live mode is rejected by the runtime.
 */
export interface ModeInputs {
  /** A raw Gemini transport exists (a key was configured). */
  hasKey: boolean;
  /** FORCE_FAKE_LLM=1 / FORCE_FAKE_LIVE=1 / CHAT_FORCE_DEMO=1. */
  forced: boolean;
  /**
   * Hub-level health at start (ResilientLlm.status()). `fake` with a reason means the key exists but is not usable
   * right now (credits, rate limit, bad key, still probing); the run is then an honest demo run with that reason.
   */
  health?: { llm: 'real' | 'fake'; reason?: string };
}

const token = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z_]+/g, '_')
    .slice(0, 24);

export function decideRunMode(i: ModeInputs): AgentMode {
  if (!i.hasKey) return 'demo:no_key';
  if (i.forced) return 'demo:forced';
  if (i.health && i.health.llm !== 'real') {
    const r = i.health.reason ? token(i.health.reason) : '';
    if (r === 'no_key') return 'demo:no_key';
    if (r === 'forced_fake') return 'demo:forced';
    return r.length >= 3 ? (`demo:${r}` as AgentMode) : 'demo:unavailable';
  }
  return 'live';
}

export function modeInputsFromEnv(
  env: Record<string, string | undefined>,
  health?: ModeInputs['health'],
): ModeInputs {
  return {
    hasKey: !!env.GEMINI_API_KEY,
    forced:
      env.FORCE_FAKE_LLM === '1' || env.CHAT_FORCE_DEMO === '1' || env.FORCE_FAKE_LIVE === '1',
    ...(health ? { health } : {}),
  };
}

/** Council agent runtime flag. `v2` is the default; `v1` keeps the legacy three-phase prompts (rollback). */
export function councilAgentsFlag(env: Record<string, string | undefined>): 'v1' | 'v2' {
  const v = (env.COUNCIL_AGENTS ?? '').trim().toLowerCase();
  return v === 'v1' || v === 'off' || v === '0' ? 'v1' : 'v2';
}

/** Short snake_case reason for `degraded:<reason>` from whatever a transport threw. */
export function degradedReason(e: unknown): string {
  if (e instanceof LlmError) {
    if (e.kind === 'credits_depleted') return 'credits_depleted';
    if (e.kind === 'rate_limited') return 'rate_limited';
    if (e.kind === 'auth') return 'invalid_key';
    return 'model_error';
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError' || /timeout|timed out/i.test(e.message)) return 'timeout';
    const m = /^reason:([a-z_]{3,32})$/.exec(e.message);
    if (m) return m[1]!;
    // Live close reasons mapped like hub/live/gemini-client.ts
    if (/credits|prepay|depleted|billing|\b402\b/i.test(e.message)) return 'credits_depleted';
    if (/quota|rate|exhausted|\b429\b/i.test(e.message)) return 'rate_limited';
    if (/api key|permission|unauth|denied/i.test(e.message)) return 'invalid_key';
    if (/closed|1011|goaway/i.test(e.message)) return 'session_closed';
  }
  return 'model_error';
}

export const degraded = (reason: string): AgentMode => `degraded:${reason}` as AgentMode;

/** A reason that stops every not-yet-started agent of the run (a retry cannot help). */
export const isHaltReason = (reason: string): boolean =>
  reason === 'credits_depleted' || reason === 'invalid_key' || reason === 'budget';
