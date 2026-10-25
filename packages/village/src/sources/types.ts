export type Unsubscribe = () => void;

/** Optional second argument to subscribers; plain `(e) => void` consumers can ignore it. */
export interface EventMeta {
  /** Replay seek fast-forward: apply state, skip animation. */
  fast?: boolean;
  /** Synthesised from the late-joiner snapshot. */
  snapshot?: boolean;
  /** Hub seq (live) or `${name}:${index}` (replay). */
  id?: string;
}

/** Injectable clock: no real timers in tests. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface SourceLogger {
  warn(msg: string, extra?: unknown): void;
}
export const consoleLogger: SourceLogger = {
  warn: (m, e) => console.warn(`[village] ${m}`, e ?? ''),
};
