export interface LiveLimits {
  maxTurns: number;
  maxSeconds: number;
  maxTurnChars: number;
  maxActivePerUser: number;
  startsPerHour: number;
  /** Per-turn stall guard. */
  turnTimeoutMs: number;
}

const num = (v: string | undefined, d: number, min: number, max: number): number => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d;
};

export function liveLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveLimits {
  return {
    maxTurns: num(env.LIVE_MAX_TURNS, 14, 2, 60),
    maxSeconds: num(env.LIVE_MAX_SECONDS, 240, 5, 1800),
    maxTurnChars: num(env.LIVE_MAX_TURN_CHARS, 600, 80, 1100),
    maxActivePerUser: num(env.LIVE_MAX_ACTIVE_PER_USER, 1, 1, 5),
    startsPerHour: num(env.LIVE_STARTS_PER_HOUR, 6, 1, 100),
    turnTimeoutMs: num(env.LIVE_TURN_TIMEOUT_MS, 30_000, 100, 120_000),
  };
}

/** ms per word for FakeLive. 0 in tests (VITEST) unless set. */
export function fakeSpeedFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  if (env.FAKE_LIVE_SPEED !== undefined && env.FAKE_LIVE_SPEED !== '')
    return num(env.FAKE_LIVE_SPEED, 25, 0, 2000);
  return env.VITEST ? 0 : 25;
}

export const liveModelFromEnv = (env: NodeJS.ProcessEnv = process.env): string =>
  env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
