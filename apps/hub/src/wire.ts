// Chooses the hub's ports at boot: real (brain + media) when a Gemini key exists, in-memory stubs otherwise.
import { GeminiLlm } from '@squad/core/node';
import type { Llm } from '@squad/core';
import type { RunningHub } from './server';
import { createRealPorts, type RealPorts, type RealPortsOptions } from './adapters/real';

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
