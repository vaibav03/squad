import { num } from './env';

export interface BudgetLimits {
  maxCalls: number; // raw provider calls (HTTP attempts, retries included)
  maxTokens: number; // billed tokens (input minus cached, plus output)
  maxChars: number; // ElevenLabs characters
  maxUsd: number; // estimated dollars
  maxOutPerCall: number; // default output cap per call when the request sets none
  priceInPerM: number;
  priceOutPerM: number;
  priceCharsPer1k: number;
}

export function limitsFromEnv(env: Record<string, string | undefined>): BudgetLimits {
  return {
    maxCalls: num(env, 'LIVE_MAX_CALLS', 150),
    maxTokens: num(env, 'LIVE_MAX_TOKENS', 120_000),
    maxChars: num(env, 'LIVE_MAX_EL_CHARS', 800),
    maxUsd: num(env, 'LIVE_MAX_USD', 0.5),
    maxOutPerCall: num(env, 'LIVE_MAX_OUT_PER_CALL', 3000),
    // Deliberately pessimistic placeholders; set the real price list in .env for a tighter cap.
    priceInPerM: num(env, 'LIVE_PRICE_IN_PER_M', 0.5),
    priceOutPerM: num(env, 'LIVE_PRICE_OUT_PER_M', 3),
    priceCharsPer1k: num(env, 'LIVE_PRICE_EL_PER_1K_CHARS', 0.3),
  };
}

export type FatalKind =
  | 'credits_depleted'
  | 'auth'
  | 'rate_limited'
  | 'budget'
  | 'el_payment'
  | 'el_auth'
  | 'el_rate_limited';

export interface Fatal {
  kind: FatalKind;
  provider: 'gemini' | 'elevenlabs' | 'harness';
  status?: number;
  message: string;
  fix: string;
}

/** Thrown before a paid call would exceed a cap, or when the run has already been aborted. */
export class BudgetExceeded extends Error {
  override readonly name = 'BudgetExceeded';
  constructor(
    message: string,
    readonly fatal: Fatal,
  ) {
    super(message);
  }
}

export interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  billedTokens: number;
  chars: number;
  usd: number;
}

/** Global spend guard shared by every check. `guard*` run BEFORE the network call. */
export class Budget {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  cachedTokens = 0;
  pendingEstimate = 0; // tokens reserved for creates that report no usage
  chars = 0;
  rateLimitHits = 0;
  fatal: Fatal | undefined;
  constructor(readonly limits: BudgetLimits) {}

  get billedTokens(): number {
    return (
      Math.max(0, this.inputTokens - this.cachedTokens) + this.outputTokens + this.pendingEstimate
    );
  }
  get usd(): number {
    const l = this.limits;
    return (
      (Math.max(0, this.inputTokens - this.cachedTokens) + this.pendingEstimate) *
        (l.priceInPerM / 1e6) +
      this.outputTokens * (l.priceOutPerM / 1e6) +
      (this.chars / 1000) * l.priceCharsPer1k
    );
  }
  spend(): Spend {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedTokens: this.cachedTokens,
      billedTokens: this.billedTokens,
      chars: this.chars,
      usd: Number(this.usd.toFixed(5)),
    };
  }

  abort(f: Fatal): void {
    this.fatal ??= f;
  }

  private stop(f: Fatal): never {
    this.abort(f);
    throw new BudgetExceeded(f.message, this.fatal as Fatal);
  }

  private over(what: string, used: number, max: number, knob: string): Fatal {
    return {
      kind: 'budget',
      provider: 'harness',
      message: `budget cap hit: ${what} ${used} would exceed ${max}`,
      fix: `Raise ${knob} (current ${max}) or run fewer checks with LIVE_ONLY=1,2,...; nothing is wrong with the providers.`,
    };
  }

  /** Call before one raw Gemini request. `estTokens` = rough input estimate (chars/4). */
  guardGeminiCall(estTokens: number): void {
    if (this.fatal) throw new BudgetExceeded(this.fatal.message, this.fatal);
    const l = this.limits;
    if (this.calls + 1 > l.maxCalls)
      this.stop(this.over('calls', this.calls + 1, l.maxCalls, 'LIVE_MAX_CALLS'));
    if (this.billedTokens + estTokens > l.maxTokens)
      this.stop(this.over('tokens', this.billedTokens + estTokens, l.maxTokens, 'LIVE_MAX_TOKENS'));
    const estUsd = this.usd + estTokens * (l.priceInPerM / 1e6);
    if (estUsd > l.maxUsd)
      this.stop(this.over('usd', Number(estUsd.toFixed(4)), l.maxUsd, 'LIVE_MAX_USD'));
    this.calls++;
  }

  /** Output tokens this call may still use: bounded by the per-call cap and the remaining token budget. */
  outputAllowance(requested: number | undefined, estIn: number): number {
    const l = this.limits;
    const left = Math.max(64, l.maxTokens - this.billedTokens - estIn);
    return Math.max(16, Math.min(requested ?? l.maxOutPerCall, l.maxOutPerCall, left));
  }

  addUsage(u: { input?: number; output?: number; cached?: number } | undefined): void {
    if (!u) return;
    this.inputTokens += u.input ?? 0;
    this.outputTokens += u.output ?? 0;
    this.cachedTokens += u.cached ?? 0;
  }

  /** Call before an ElevenLabs request that bills characters. */
  guardChars(n: number): void {
    if (this.fatal) throw new BudgetExceeded(this.fatal.message, this.fatal);
    const l = this.limits;
    if (this.chars + n > l.maxChars)
      this.stop(
        this.over('ElevenLabs characters', this.chars + n, l.maxChars, 'LIVE_MAX_EL_CHARS'),
      );
    if (this.usd + (n / 1000) * l.priceCharsPer1k > l.maxUsd)
      this.stop(this.over('usd', Number(this.usd.toFixed(4)), l.maxUsd, 'LIVE_MAX_USD'));
    this.chars += n;
  }

  /** Raw non-Gemini provider request that bills nothing (list voices): counts as a call. */
  guardFreeCall(): void {
    if (this.fatal) throw new BudgetExceeded(this.fatal.message, this.fatal);
    if (this.calls + 1 > this.limits.maxCalls)
      this.stop(this.over('calls', this.calls + 1, this.limits.maxCalls, 'LIVE_MAX_CALLS'));
    this.calls++;
  }
}
