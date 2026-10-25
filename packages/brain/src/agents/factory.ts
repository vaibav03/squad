import { type AgentMode, type Llm, type VillageEvent } from '@squad/core';
import { registerCouncilDemos } from '../councils/demos';
import { HourlyCap, budgetFromEnv, type CouncilBudget } from './budget';
import { createDemoTransport } from './demo-transport';
import { councilAgentsFlag, decideRunMode, modeInputsFromEnv, type ModeInputs } from './mode';
import { createCouncilRuntime } from './runtime';
import { createStreamTextTransport } from './stream-transport';
import type { AgentTransport } from './types';

const THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high']);

export interface CouncilAgentsDeps {
  /**
   * The RAW real model (GeminiLlm), never the ResilientLlm: a live council must not silently swap to the hub's
   * demo model mid-run. Omit when there is no key.
   */
  real?: Llm;
  env?: Record<string, string | undefined>;
  /** Hub-level health at run start (ResilientLlm.status()). */
  health?: () => ModeInputs['health'];
  emit: (e: VillageEvent) => void | Promise<unknown>;
  budget?: Partial<CouncilBudget>;
  now?: () => number;
  /** Override the real transport (tests, Live transport). */
  transport?: AgentTransport;
}

export interface CouncilAgents {
  runtime: ReturnType<typeof createCouncilRuntime>;
  /** The single decision point: called once per run, at its start. */
  decideMode(): AgentMode;
  /** `v2` = real agent runtime (default), `v1` = legacy three-phase prompts. */
  flag: 'v1' | 'v2';
  /** Hub-wide hourly run cap. false = refuse this run. */
  tryStart(): boolean;
  budget: CouncilBudget;
  /** Kind of the real transport behind this runtime (`stream-text`, `live-audio`), for transport-specific orchestration. */
  kind: AgentTransport['kind'] | undefined;
}

/** Builds the council runtime: raw Gemini over streaming text + tool calling, scripted transport for demo runs only. */
export function createCouncilAgents(d: CouncilAgentsDeps): CouncilAgents {
  const env = d.env ?? {};
  registerCouncilDemos();
  const budget = { ...budgetFromEnv(env), ...d.budget };
  const hourly = new HourlyCap(budget.maxRunsPerHour, d.now);
  const real = d.transport ?? (d.real ? createStreamTextTransport(d.real) : undefined);
  const runtime = createCouncilRuntime({
    ...(real ? { real } : {}),
    demo: createDemoTransport(),
    emit: d.emit,
    budget,
    hourly,
    ...(THINKING.has(env.COUNCIL_THINKING ?? '')
      ? { thinking: env.COUNCIL_THINKING as 'off' | 'minimal' | 'low' | 'medium' | 'high' }
      : {}),
    ...(d.now ? { now: d.now } : {}),
  });
  return {
    runtime,
    kind: real?.kind,
    flag: councilAgentsFlag(env),
    budget,
    tryStart: () => hourly.tryAcquire(),
    decideMode: () => {
      const inputs = modeInputsFromEnv(env, d.health?.());
      const mode = decideRunMode({ ...inputs, hasKey: !!real || inputs.hasKey });
      // a key that exists but has no usable raw transport here can never be a live run
      return mode === 'live' && !real ? 'demo:unavailable' : mode;
    },
  };
}
