import { spawnSync } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { GeminiLlm, DEFAULT_GEMINI_MODELS } from '@squad/core/node';
import type { Llm } from '@squad/core';
import { Budget, limitsFromEnv, type BudgetLimits } from './budget';
import { makeRedactor, ROOT } from './env';
import { meterClient, meterLlm, Telemetry, type GenAiClient } from './meter';
import { exitCodeFor, runChecks, summarize } from './runner';
import type { Check, ElevenPort, LiveContext, RunReport } from './types';

export interface Injected {
  /** A genai-shaped client (fake). GeminiLlm is built on top of the metered version. */
  client?: GenAiClient;
  /** A ready Llm (OracleLlm, FakeLlm...): metered logically. */
  llm?: Llm;
  eleven?: ElevenPort;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Pretend ffmpeg/python availability (tests). */
  tools?: { ffmpeg?: boolean; python?: boolean };
}

export interface RunOptions {
  env: Record<string, string>;
  checks: Check[];
  root?: string;
  injected?: Injected;
  limits?: Partial<BudgetLimits>;
  log?: (line: string) => void;
}

const has = (cmd: string, arg = '-version') =>
  spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;

export function parseIdList(v: string | undefined): Set<number> | undefined {
  if (!v) return undefined;
  const ids = v
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  return ids.length ? new Set(ids) : undefined;
}

/** Builds the metered context. Never touches the network. */
export function buildContext(o: RunOptions): LiveContext {
  const env = o.env;
  const budget = new Budget({ ...limitsFromEnv(env), ...o.limits });
  const tel = new Telemetry();
  const inj = o.injected ?? {};
  const sleep = inj.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = inj.now ?? Date.now;
  const models = {
    fast: env.GEMINI_MODEL_FAST ?? DEFAULT_GEMINI_MODELS.fast,
    main: env.GEMINI_MODEL_MAIN ?? DEFAULT_GEMINI_MODELS.main,
    chair: env.GEMINI_MODEL_CHAIR ?? DEFAULT_GEMINI_MODELS.chair,
  };
  let llm: Llm;
  let client: GenAiClient | undefined;
  if (inj.llm) {
    llm = meterLlm(inj.llm, budget, tel, now);
  } else {
    const raw: GenAiClient =
      inj.client ?? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY ?? 'missing' });
    client = meterClient(raw, budget, tel, now);
    llm = new GeminiLlm({ client, models, retries: 2, sleep });
  }
  return {
    env,
    budget,
    telemetry: tel,
    llm,
    ...(client ? { client } : {}),
    models,
    redact: makeRedactor(env),
    root: o.root ?? ROOT,
    eleven: inj.eleven,
    allowVoiceDesign: env.LIVE_ELEVENLABS === '1',
    fetch: inj.fetch ?? fetch,
    sleep,
    now,
  };
}

export const PROBE_PROMPT = 'Reply with the single word OK.';

/** The whole run: gate, plan, probe, checks, report object. Writing files is the caller's job. */
export async function runVerify(o: RunOptions): Promise<{ report: RunReport; ctx: LiveContext }> {
  const log = o.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const ctx = buildContext(o);
  const env = o.env;
  const inj = o.injected ?? {};
  const injectedModel = Boolean(inj.llm || inj.client);
  const mode: RunReport['mode'] = injectedModel ? 'injected' : 'real';
  const only = parseIdList(env.LIVE_ONLY);
  const skip = parseIdList(env.LIVE_SKIP) ?? new Set<number>();
  const hasGemini = injectedModel || Boolean(env.GEMINI_API_KEY);
  const hasEleven = Boolean(inj.eleven) || Boolean(env.ELEVENLABS_API_KEY);
  const ffmpeg = inj.tools?.ffmpeg ?? has('ffmpeg');
  const python = inj.tools?.python ?? has('python3', '--version');

  const selected = o.checks.filter((c) => (!only || only.has(c.id)) && !skip.has(c.id));
  const skipReason = (c: Check): string | undefined => {
    if (only && !only.has(c.id)) return 'not selected (LIVE_ONLY)';
    if (skip.has(c.id)) return 'excluded (LIVE_SKIP)';
    if (c.needs.includes('gemini') && !hasGemini) return 'GEMINI_API_KEY is not set';
    if (c.needs.includes('elevenlabs') && !hasEleven) return 'ELEVENLABS_API_KEY is not set';
    if (c.needs.includes('ffmpeg') && !ffmpeg)
      return 'ffmpeg is not installed (brew install ffmpeg)';
    if (c.needs.includes('python') && !python) return 'python3 is not installed';
    return undefined;
  };

  const est = selected
    .filter((c) => !skipReason(c))
    .reduce(
      (a, c) => ({
        calls: a.calls + c.estimate.calls,
        tokens: a.tokens + c.estimate.tokens,
        chars: a.chars + (c.estimate.chars ?? 0),
      }),
      { calls: 0, tokens: 0, chars: 0 },
    );
  const L = ctx.budget.limits;
  log(
    `plan: ~${est.calls} calls / ~${est.tokens} tokens / ~${est.chars} chars; caps ${L.maxCalls} calls / ${L.maxTokens} tokens / ${L.maxChars} chars / $${L.maxUsd}`,
  );
  if (est.calls > L.maxCalls || est.tokens > L.maxTokens)
    log(
      'note: the estimated worst case exceeds a cap; later checks will SKIP when the cap is hit (raise LIVE_MAX_CALLS / LIVE_MAX_TOKENS to run them all).',
    );

  const { results, aborted } = await runChecks(ctx, {
    checks: o.checks,
    skipReason,
    preflight: async () => {
      const r = await ctx.llm.complete({
        model: 'fast',
        messages: PROBE_PROMPT,
        maxTokens: 256,
        temperature: 0,
      });
      if (!/ok/i.test(r.text))
        throw new Error(`probe answered without OK: ${JSON.stringify(r.text.slice(0, 80))}`);
    },
  });

  const summary = summarize(results);
  const budgetStop = aborted?.kind === 'budget';
  const outcome: RunReport['outcome'] = budgetStop
    ? 'budget'
    : aborted
      ? 'aborted'
      : results.every((r) => r.status === 'SKIP')
        ? 'refused'
        : summary.fail > 0
          ? 'fail'
          : 'pass';
  const report: RunReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    exitCode: 0,
    outcome,
    ...(aborted ? { aborted } : {}),
    models: ctx.models,
    limits: { ...L } as unknown as Record<string, number>,
    spend: ctx.budget.spend(),
    latency: ctx.telemetry.latency(),
    checks: results,
    summary,
  };
  report.exitCode = exitCodeFor(report);
  return { report, ctx };
}
