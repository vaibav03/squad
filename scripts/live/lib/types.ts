import type { Llm } from '@squad/core';
import type { Budget, Fatal } from './budget';
import type { GenAiClient, Telemetry } from './meter';

export type Status = 'PASS' | 'FAIL' | 'SKIP';

export interface StepResult {
  name: string;
  status: Status;
  evidence: string[];
  ms: number;
}

export interface CheckResult {
  id: number;
  name: string;
  status: Status;
  steps: StepResult[];
  metrics: Record<string, number | string>;
  ms: number;
  spend: { calls: number; billedTokens: number; chars: number; usd: number };
  note?: string;
}

export type Need = 'gemini' | 'elevenlabs' | 'ffmpeg' | 'python';

export interface Tracker {
  /** Records one named assertion. */
  pass(name: string, ...evidence: string[]): void;
  fail(name: string, ...evidence: string[]): void;
  skip(name: string, reason: string): void;
  /** Runs `fn`; a throw becomes a FAIL (budget/fatal aborts are rethrown so the run stops). */
  step(name: string, fn: () => Promise<string[] | string | void>): Promise<void>;
  metric(key: string, value: number | string): void;
}

export interface LiveContext {
  env: Record<string, string>;
  budget: Budget;
  telemetry: Telemetry;
  /** Metered Llm (real GeminiLlm over the metered client, or an injected one). */
  llm: Llm;
  /** Metered raw client for list/caches; absent when an Llm was injected. */
  client?: GenAiClient;
  /** Resolved concrete model ids per tier. */
  models: { fast: string; main: string; chair: string };
  redact: (s: string) => string;
  root: string;
  /** Injected for tests; real runs leave these undefined. */
  eleven?: ElevenPort | undefined;
  /** LIVE_ELEVENLABS=1 allows the (possibly billed) voice design. */
  allowVoiceDesign: boolean;
  /** An unpatched fetch for ElevenLabs/hub HTTP; tests inject. */
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** What check 7 needs from ElevenLabs; the real implementation lives in checks/07-elevenlabs.ts. */
export interface ElevenPort {
  listVoices(): Promise<{ id: string; name: string; category?: string }[]>;
  designVoice(description: string): Promise<{ generatedVoiceId: string }[]>;
  tts(voiceId: string, text: string): Promise<{ audio: Uint8Array; timings: number }>;
  dialogue(inputs: { voiceId: string; text: string }[]): Promise<Uint8Array>;
}

export interface Check {
  id: number;
  name: string;
  needs: Need[];
  /** Rough worst-case cost shown in the plan: calls / tokens / chars. */
  estimate: { calls: number; tokens: number; chars?: number };
  run(ctx: LiveContext, t: Tracker): Promise<void>;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  mode: 'real' | 'injected';
  exitCode: number;
  outcome: 'pass' | 'fail' | 'aborted' | 'budget' | 'refused';
  aborted?: Fatal & { atCheck?: number };
  models: { fast: string; main: string; chair: string };
  limits: Record<string, number>;
  spend: ReturnType<Budget['spend']>;
  latency: { p50: number; p95: number; n: number };
  checks: CheckResult[];
  summary: { pass: number; fail: number; skip: number };
}
