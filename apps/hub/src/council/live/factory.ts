// Builds the per-run Gemini Live council (CouncilServiceDeps.live): its own runtime over the Live transport, a pre-flight
// that opens every participant's session, and the availability note the status endpoint reports.
import {
  createCouncilAgents,
  type LiveCouncilFactory,
  type LiveCouncilHandle,
  type ModeInputs,
} from '@squad/brain';
import type { LivePersonaId, VillageEvent } from '@squad/core';
import { GeminiLive } from '../../live/gemini-client';
import type { LiveAgentClient } from '../../live/types';
import type { CouncilLiveHub } from './hub';
import {
  createLiveCouncilTransport,
  liveCouncilLimitsFromEnv,
  type LiveCouncilLimits,
  type LiveCouncilTransport,
} from './transport';

export interface LiveCouncilFactoryDeps {
  hub: CouncilLiveHub;
  env?: Record<string, string | undefined>;
  emit: (e: VillageEvent) => void | Promise<unknown>;
  health?: () => ModeInputs['health'];
  /** Tests inject FakeLive or a scripted client; production is always Gemini Live. */
  makeClient?: (persona: LivePersonaId) => LiveAgentClient;
  limits?: Partial<LiveCouncilLimits>;
  /** FakeLive speaks the Live Discussion relay format. */
  relayFormat?: boolean;
  /** Exposes the transport of the latest run (scripts and tests read its stats). */
  onTransport?: (runId: string, t: LiveCouncilTransport) => void;
}

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

export function createLiveCouncilFactory(d: LiveCouncilFactoryDeps): LiveCouncilFactory {
  const env = d.env ?? process.env;
  return (run): LiveCouncilHandle | { unavailable: string } => {
    if (!d.hub.enabled) return { unavailable: 'live_disabled' };
    const limits = { ...liveCouncilLimitsFromEnv(env), ...d.limits };
    const transport = createLiveCouncilTransport({
      runId: run.id,
      channel: d.hub.channel(run.id),
      makeClient: d.makeClient ?? (() => new GeminiLive({ model: d.hub.model })),
      model: d.hub.model,
      limits,
      ...(d.relayFormat ? { relayFormat: true } : {}),
    });
    d.onTransport?.(run.id, transport);
    const agents = createCouncilAgents({
      env,
      emit: d.emit,
      transport,
      ...(d.health ? { health: d.health } : {}),
      // speakers queue for the floor, so a call waits for the turns ahead of it: generous per-call and wall limits
      budget: {
        callTimeoutMs: num(env.COUNCIL_LIVE_CALL_TIMEOUT_MS, 120_000),
        maxWallMs: num(env.COUNCIL_LIVE_MAX_WALL_MS, 240_000),
        maxTurns: Math.max(limits.maxTurns * 2, 12),
        maxConcurrency: 6,
      },
    });
    return {
      agents,
      async prepare(roster) {
        const res = await transport.prepare(roster);
        if (res.ok) d.hub.note('ok');
        else d.hub.note('unavailable', res.why);
        return res.ok ? { ok: true, models: res.models } : { ok: false, why: res.why };
      },
      close: () => transport.close(),
    };
  };
}
