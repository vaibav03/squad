// Chooses the hub's ports at boot: real (brain + media) when a Gemini key exists, in-memory stubs otherwise.
import { GeminiLlm } from '@squad/core/node';
import { FakeLlm, createResilientLlm, type Llm, type ResilientLlm } from '@squad/core';
import type { RunningHub } from './server';
import { createRealPorts, type RealPorts, type RealPortsOptions } from './adapters/real';

export { busyBlocksOf } from './adapters/real';

/** Real ports need a hub's deps (db, ingest, directory), so they are attached after `createHub`; routes read `deps.ports` lazily. */
export async function wireRealPorts(
  hub: Pick<RunningHub, 'deps'>,
  o: RealPortsOptions,
): Promise<RealPorts> {
  const real = await createRealPorts(hub.deps, o);
  hub.deps.ports = real.ports;
  return real;
}

/** Gemini when `GEMINI_API_KEY` is set; undefined means "keep the stubs" (replay and demo mode). */
export function llmFromEnv(env: Record<string, string | undefined> = process.env): Llm | undefined {
  if (!env.GEMINI_API_KEY) return undefined;
  return new GeminiLlm({ apiKey: env.GEMINI_API_KEY });
}

/**
 * Always returns a resilient LLM: Gemini when `GEMINI_API_KEY` is set, FakeLlm otherwise (status reason
 * `no_key`), `FORCE_FAKE_LLM=1` pins the fake. HTTP 402/429/401 serve the fake and re-probe the real model (60 s; 10 min for a bad key).
 */
export function resilientLlmFromEnv(
  env: Record<string, string | undefined> = process.env,
  onSwitch?: (reason: string | undefined) => void,
  onRecover?: () => void,
): ResilientLlm {
  const real = llmFromEnv(env);
  return createResilientLlm({
    ...(real ? { real } : {}),
    fake: new FakeLlm(),
    forceFake: env.FORCE_FAKE_LLM === '1',
    ...(onSwitch ? { onSwitch: (s) => onSwitch(s.reason) } : {}),
    ...(onRecover ? { onRecover: () => onRecover() } : {}),
  });
}

/** `AGENT_PEERS=s_ana=http://localhost:4101,s_ben=...`: where each student's mesh agent listens (calendar push). */
export function agentUrlsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (env.AGENT_PEERS ?? '').split(',').filter(Boolean)) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return out;
}
