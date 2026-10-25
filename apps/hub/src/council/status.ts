// `GET /v1/council/status`: provider, models, key state with the exact fix, transports and A2A counters. Viewer-safe by
// construction (see CouncilStatusSchema): enums, counts, model ids and fixed sentences, never a key or a message.
import {
  COUNCIL_KEY_FIX,
  COUNCIL_PROVIDER_NAME,
  CouncilStatusSchema,
  type CouncilKeyState,
  type CouncilStatus,
} from '@squad/core';
import type { HubDeps } from '../types';

const MODELS = {
  fast: 'gemini-3.5-flash-lite',
  main: 'gemini-3.8-flash',
  chair: 'gemini-3.8-flash',
} as const;

function keyState(deps: HubDeps, env: Record<string, string | undefined>): CouncilKeyState {
  if (!env.GEMINI_API_KEY) return 'no_key';
  const st = deps.runtime?.llm();
  if (!st || st.llm === 'real') return 'ok';
  switch (st.reason) {
    case 'credits_depleted':
      return 'credits_depleted';
    case 'rate_limited':
      return 'rate_limited';
    case 'no_key':
      return 'no_key';
    default:
      // forced fake, bad key and probing are not a key problem we can name more precisely; probing resolves to ok
      return st.reason === 'probing' ? 'ok' : st.reason === 'invalid_key' ? 'no_key' : 'ok';
  }
}

export function buildCouncilStatus(
  deps: HubDeps,
  env: Record<string, string | undefined> = process.env,
  squadId?: string,
): CouncilStatus {
  const live = deps.councilLive;
  const avail = live?.availability() ?? { state: 'untested' as const };
  const state = keyState(deps, env);
  const forced =
    env.FORCE_FAKE_LLM === '1' || env.CHAT_FORCE_DEMO === '1' || env.FORCE_FAKE_LIVE === '1';
  const stats = deps.councilRuns?.stats(squadId) ?? {
    runs: 0,
    messages: 0,
    delegations: 0,
    active: 0,
  };
  const noKey = state === 'no_key';
  const out: CouncilStatus = {
    provider: COUNCIL_PROVIDER_NAME,
    generatedAt: deps.now(),
    key: { state, fix: COUNCIL_KEY_FIX[state] },
    defaultTransport: live?.defaultTransport ?? 'stream',
    models: {
      fast: env.GEMINI_MODEL_FAST?.trim() || MODELS.fast,
      main: env.GEMINI_MODEL_MAIN?.trim() || MODELS.main,
      chair: env.GEMINI_MODEL_CHAIR?.trim() || MODELS.chair,
      live: live?.enabled ? live.model : null,
    },
    transports: {
      stream: {
        available: !noKey && !forced,
        label: noKey || forced ? 'Demo (scripted, not Gemini)' : 'Gemini streaming text',
      },
      live: {
        enabled: !!live?.enabled && !noKey && !forced,
        state: avail.state,
        ...(avail.why ? { why: avail.why } : {}),
        ...(avail.checkedAt ? { checkedAt: avail.checkedAt } : {}),
        label: !live?.enabled
          ? 'Gemini Live is switched off on this hub'
          : avail.state === 'unavailable'
            ? `Gemini Live unavailable: ${(avail.why ?? 'unknown').replace(/_/g, ' ')}`
            : avail.state === 'ok'
              ? 'Gemini Live (audio + transcript)'
              : 'Gemini Live (not tried yet)',
      },
    },
    demo: { forced },
    a2a: {
      runs: stats.runs,
      messages: stats.messages,
      delegations: stats.delegations,
      activeRuns: stats.active,
      ...(stats.lastStage ? { lastStage: stats.lastStage } : {}),
    },
  };
  return CouncilStatusSchema.parse(out);
}
