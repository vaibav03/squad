import { easeOut, lerp, type Curve } from './curves';
import { createMotionPrefs, getMotionPrefs, type MotionPrefsStore } from './prefs';
import type { Animatable, MotionHandle } from './types';

/**
 * A job is the unit of animation. `update` receives the scaled delta in ms and returns true
 * when finished. `finish` must put the target in its end (rest) state; it is called by
 * handle.skip(). `abort` is called by cancel() and must NOT jump to the end state.
 */
export interface Job {
  update(dtMs: number): boolean;
  finish?(): void;
  abort?(): void;
}

export interface TweenTo {
  x?: number;
  y?: number;
  alpha?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
}
export interface TweenOpts {
  duration: number;
  curve?: Curve;
  delay?: number;
  from?: TweenTo;
  pixelSnap?: boolean;
  onUpdate?: (t: number) => void;
  onComplete?: () => void;
}

class Handle implements MotionHandle {
  done = false;
  readonly finished: Promise<void>;
  private resolve!: () => void;
  constructor(
    readonly job: Job,
    private readonly rt: MotionRuntime,
  ) {
    this.finished = new Promise<void>((r) => {
      this.resolve = r;
    });
  }
  complete(): void {
    if (this.done) return;
    this.done = true;
    this.rt._remove(this);
    this.resolve();
  }
  cancel(): void {
    if (this.done) return;
    this.job.abort?.();
    this.complete();
  }
  skip(): void {
    if (this.done) return;
    this.job.finish?.();
    this.complete();
  }
}

/** A handle that is already finished (used for instant reduced-motion branches). */
export function doneHandle(): MotionHandle {
  return { done: true, finished: Promise.resolve(), cancel() {}, skip() {} };
}

/** Combine handles: done when all are done; cancel/skip forwards to every child. */
export function allHandles(handles: MotionHandle[]): MotionHandle {
  const finished = Promise.all(handles.map((h) => h.finished)).then(() => undefined);
  return {
    get done() {
      return handles.every((h) => h.done);
    },
    finished,
    cancel() {
      handles.forEach((h) => h.cancel());
    },
    skip() {
      handles.forEach((h) => h.skip());
    },
  };
}

export class MotionRuntime {
  readonly prefs: MotionPrefsStore;
  timeScale = 1;
  paused = false;
  private t = 0;
  private readonly maxDelta: number;
  private handles: Handle[] = [];
  private dropNext = false;

  constructor(opts: { prefs?: MotionPrefsStore; maxDeltaMs?: number } = {}) {
    this.prefs = opts.prefs ?? getMotionPrefs();
    this.maxDelta = opts.maxDeltaMs ?? 100;
  }

  get now(): number {
    return this.t;
  }

  /** True when reduced-motion or Calm mode is on. Read at call time by every primitive. */
  get reduced(): boolean {
    return this.prefs.effectiveReduced;
  }

  /** Called by pauseWhenHidden: the first update after resume is dropped (no catch-up). */
  dropNextDelta(): void {
    this.dropNext = true;
  }

  update(deltaMs: number): void {
    if (this.paused) return;
    if (this.dropNext) {
      this.dropNext = false;
      return;
    }
    const d = Math.min(Math.max(deltaMs, 0), this.maxDelta);
    this.advance(d * this.timeScale);
  }

  step(deltaMs: number): void {
    this.advance(deltaMs);
  }

  private advance(dt: number): void {
    this.t += dt;
    let settled = this.pass(dt);
    // Sequencers chain inside the same step: when something finished, run zero-dt passes so the
    // next step starts in the same frame instead of one frame late (bounded, no unbounded loops).
    for (let i = 0; i < 4 && settled; i++) settled = this.pass(0);
  }

  private pass(dt: number): boolean {
    let anyDone = false;
    for (const h of [...this.handles]) {
      if (h.done) continue;
      if (h.job.update(dt)) {
        h.complete();
        anyDone = true;
      }
    }
    return anyDone;
  }

  /** Register a custom job. Primitives are built on this. */
  spawn(job: Job): MotionHandle {
    const h = new Handle(job, this);
    this.handles.push(h);
    return h;
  }

  /** @internal */
  _remove(h: Handle): void {
    const i = this.handles.indexOf(h);
    if (i >= 0) this.handles.splice(i, 1);
  }

  get activeCount(): number {
    return this.handles.length;
  }

  cancelAll(): void {
    for (const h of [...this.handles]) h.cancel();
  }

  after(ms: number, fn: () => void): MotionHandle {
    let left = ms;
    return this.spawn({
      update: (dt) => {
        left -= dt;
        if (left <= 0) {
          fn();
          return true;
        }
        return false;
      },
      finish: fn,
    });
  }

  tween(target: Animatable, to: TweenTo, opts: TweenOpts): MotionHandle {
    const curve = opts.curve ?? easeOut;
    const snap = opts.pixelSnap ?? true;
    const dur = Math.max(0, opts.duration);
    let wait = opts.delay ?? 0;
    let elapsed = 0;
    let started = false;
    type Key = 'x' | 'y' | 'alpha' | 'scaleX' | 'scaleY';
    const start: Partial<Record<Key, number>> = {};
    const end: Partial<Record<Key, number>> = {};
    const set = (k: Key, v: number): void => {
      target[k] = (k === 'x' || k === 'y') && snap ? Math.round(v) : v;
    };
    if (to.x !== undefined) end.x = to.x;
    if (to.y !== undefined) end.y = to.y;
    if (to.alpha !== undefined) end.alpha = to.alpha;
    const sx = to.scaleX ?? to.scale;
    const sy = to.scaleY ?? to.scale;
    if (sx !== undefined) end.scaleX = sx;
    if (sy !== undefined) end.scaleY = sy;
    const keys = Object.keys(end) as Key[];

    const begin = (): void => {
      started = true;
      const f = opts.from;
      if (f) {
        if (f.x !== undefined) target.x = snap ? Math.round(f.x) : f.x;
        if (f.y !== undefined) target.y = snap ? Math.round(f.y) : f.y;
        if (f.alpha !== undefined) target.alpha = f.alpha;
        const fx = f.scaleX ?? f.scale;
        const fy = f.scaleY ?? f.scale;
        if (fx !== undefined) target.scaleX = fx;
        if (fy !== undefined) target.scaleY = fy;
      }
      for (const k of keys) start[k] = target[k];
    };
    const apply = (t: number): void => {
      const c = curve(t);
      for (const k of keys) set(k, lerp(start[k] as number, end[k] as number, c));
      opts.onUpdate?.(t);
    };
    const finish = (): void => {
      if (!started) begin();
      for (const k of keys) set(k, end[k] as number);
      opts.onUpdate?.(1);
      opts.onComplete?.();
    };
    // `from` is applied immediately so a delayed enter does not flash at its old pose.
    if (opts.from) begin();
    return this.spawn({
      update: (dt) => {
        if (wait > 0) {
          wait -= dt;
          if (wait > 0) return false;
          dt = -wait;
          wait = 0;
        }
        if (!started) begin();
        elapsed += dt;
        if (elapsed >= dur) {
          finish();
          return true;
        }
        apply(elapsed / dur);
        return false;
      },
      finish,
    });
  }
}

export function createRuntime(
  opts: { reduced?: boolean; calm?: boolean; maxDeltaMs?: number } = {},
): MotionRuntime {
  const prefs = createMotionPrefs({ storage: null, matchMedia: null });
  if (opts.reduced) prefs.setReducedOverride(true);
  if (opts.calm) prefs.setCalm(true);
  return new MotionRuntime({ prefs, maxDeltaMs: opts.maxDeltaMs });
}
