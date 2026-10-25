import { validateReplay } from '@squad/core';
import type { ReplayScript, VillageEvent, VillageSource } from '@squad/core';
import type { Clock, EventMeta, Unsubscribe } from './types';
import { systemClock } from './types';

export type ReplayStatus = 'paused' | 'playing' | 'ended';
export type ReplaySpeed = 0.5 | 1 | 2;

export interface ReplaySourceOptions {
  clock?: Clock;
  speed?: ReplaySpeed;
  autoplay?: boolean;
}

export interface ReplaySource extends VillageSource {
  subscribe(fn: (e: VillageEvent, meta?: EventMeta) => void): Unsubscribe;
  play(): void;
  pause(): void;
  restart(): void;
  setSpeed(s: ReplaySpeed): void;
  /** Jump to ms or a named checkpoint. Events before the target are re-emitted with meta.fast when replayState is true. */
  seek(target: number | string, opts?: { replayState?: boolean }): void;
  readonly status: ReplayStatus;
  readonly position: number;
  readonly duration: number;
  readonly speed: ReplaySpeed;
  readonly checkpoints: Readonly<Record<string, number>>;
  readonly cast: ReplayScript['cast'];
  readonly name: string;
  onStatus(fn: (s: ReplayStatus) => void): Unsubscribe;
  onLoop(fn: () => void): Unsubscribe;
  close(): void;
}

/** ReplayScript player. Deterministic given a Clock; validates input with the core schema. */
export function createReplaySource(
  input: ReplayScript | string | unknown,
  opts: ReplaySourceOptions = {},
): ReplaySource {
  const v = validateReplay(input);
  if (!v.ok) throw new Error(`invalid replay script:\n${v.errors.join('\n')}`);
  const script = v.script;
  const clock = opts.clock ?? systemClock;
  const events = script.events;
  const duration = events.at(-1)?.at ?? 0;

  const subs = new Set<(e: VillageEvent, m?: EventMeta) => void>();
  const statusSubs = new Set<(s: ReplayStatus) => void>();
  const loopSubs = new Set<() => void>();
  let status: ReplayStatus = 'paused';
  let speed: ReplaySpeed = opts.speed ?? 1;
  let pos = 0; // script ms at lastWall
  let lastWall = 0;
  let next = 0; // index of next event to emit
  let timer: unknown = undefined;
  let closed = false;
  let gen = 0; // bumped by pause/seek/restart/close so an in-progress emit loop can notice

  const setStatus = (s: ReplayStatus) => {
    if (status === s) return;
    status = s;
    statusSubs.forEach((f) => f(s));
  };
  const emit = (e: VillageEvent, m?: EventMeta) => {
    for (const f of [...subs]) f(e, m);
  };
  const SPEEDS: readonly number[] = [0.5, 1, 2];
  const checkSpeed = (s: number) => {
    if (!SPEEDS.includes(s))
      throw new RangeError(`invalid replay speed ${String(s)}; use 0.5, 1 or 2`);
  };
  const MIN_LOOP_MS = 16;
  const clear = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const current = () => (status === 'playing' ? pos + (clock.now() - lastWall) * speed : pos);

  const schedule = () => {
    clear();
    if (status !== 'playing' || closed) return;
    const nxt = events[next];
    if (!nxt) {
      // nothing left: end (or loop) when the script duration is reached
      let wait = Math.max(0, (duration - current()) / speed);
      // a (near) zero-length looping script must not spin
      if (script.loop && duration / speed < MIN_LOOP_MS) wait = Math.max(wait, MIN_LOOP_MS);
      timer = clock.setTimeout(finish, wait);
      return;
    }
    const wait = Math.max(0, (nxt.at - current()) / speed);
    timer = clock.setTimeout(tick, wait);
  };

  const tick = () => {
    timer = undefined;
    if (status !== 'playing') return;
    const now = current();
    const g = gen;
    // a subscriber may pause, close or seek mid-loop: stop as soon as that happens
    while (
      status === 'playing' &&
      !closed &&
      g === gen &&
      next < events.length &&
      events[next]!.at <= now + 1e-6
    ) {
      const idx = next++;
      emit(events[idx]!.event, { id: `${script.name}:${idx}` });
    }
    if (g === gen) schedule();
  };

  const finish = () => {
    timer = undefined;
    pos = duration;
    if (script.loop) {
      loopSubs.forEach((f) => f());
      pos = 0;
      next = 0;
      lastWall = clock.now();
      schedule();
      return;
    }
    setStatus('ended');
  };

  if (opts.speed !== undefined) checkSpeed(opts.speed);
  const src: ReplaySource = {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    play() {
      if (closed) return;
      if (status === 'ended') {
        pos = 0;
        next = 0;
      }
      if (status === 'playing') return;
      lastWall = clock.now();
      setStatus('playing');
      // events at exactly the current position (e.g. at: 0) fire right away
      schedule();
    },
    pause() {
      if (status !== 'playing') return;
      pos = current();
      gen++;
      clear();
      setStatus('paused');
    },
    restart() {
      if (closed) return;
      clear();
      gen++;
      pos = 0;
      next = 0;
      lastWall = clock.now();
      if (status === 'playing') {
        schedule();
        return;
      }
      if (status === 'ended') setStatus('paused');
      src.play();
    },
    setSpeed(s) {
      checkSpeed(s);
      if (status === 'playing') {
        pos = current();
        lastWall = clock.now();
      }
      speed = s;
      schedule();
    },
    seek(target, o) {
      const ms = typeof target === 'string' ? script.checkpoints[target] : target;
      if (ms === undefined) throw new Error(`unknown checkpoint "${String(target)}"`);
      if (typeof ms !== 'number' || !Number.isFinite(ms))
        throw new Error('seek target must be a finite number of ms or a checkpoint name');
      const to = Math.max(0, Math.min(duration, ms));
      const wasPlaying = status === 'playing';
      clear();
      gen++;
      let i = 0;
      while (i < events.length && events[i]!.at < to) {
        if (o?.replayState) emit(events[i]!.event, { fast: true, id: `${script.name}:${i}` });
        i++;
      }
      next = i;
      pos = to;
      lastWall = clock.now();
      if (status === 'ended') setStatus('paused');
      if (wasPlaying) schedule();
    },
    get status() {
      return status;
    },
    get position() {
      return Math.min(duration, current());
    },
    duration,
    get speed() {
      return speed;
    },
    checkpoints: script.checkpoints,
    cast: script.cast,
    name: script.name,
    onStatus(fn) {
      statusSubs.add(fn);
      return () => statusSubs.delete(fn);
    },
    onLoop(fn) {
      loopSubs.add(fn);
      return () => loopSubs.delete(fn);
    },
    close() {
      closed = true;
      gen++;
      clear();
      subs.clear();
      statusSubs.clear();
      loopSubs.clear();
      setStatus('ended');
    },
  };
  if (opts.autoplay) src.play();
  return src;
}

/** GET /v1/squad/replay/:name (no auth, filtered server-side as cast.me) and validate. */
export async function loadReplay(
  name: string,
  o: { baseUrl?: string; fetch?: typeof fetch; opts?: ReplaySourceOptions } = {},
): Promise<ReplaySource> {
  const f = o.fetch ?? fetch;
  const res = await f(`${o.baseUrl ?? ''}/v1/squad/replay/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`replay "${name}" not available (HTTP ${res.status})`);
  return createReplaySource(await res.json(), o.opts);
}
