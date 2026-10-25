import { CURVES, spring } from './curves';
import { allHandles, doneHandle, type MotionRuntime } from './runtime';
import { DURATION } from './tokens';
import type { Animatable, MotionHandle } from './types';

type StepRun = (rt: MotionRuntime) => MotionHandle | Promise<void>;
type Entry =
  | { kind: 'step'; name: string; run: StepRun }
  | { kind: 'parallel'; name: string; runs: Array<(rt: MotionRuntime) => MotionHandle> }
  | { kind: 'wait'; name: string; ms: number };

export interface CutsceneHandle extends MotionHandle {
  readonly currentStep: string | null;
  /** Any key skips. Returns a detach function. */
  skipOnKey(target: EventTarget): () => void;
}

export interface CutsceneBuilder {
  step(name: string, run: StepRun): CutsceneBuilder;
  parallel(name: string, runs: Array<(rt: MotionRuntime) => MotionHandle>): CutsceneBuilder;
  wait(ms: number): CutsceneBuilder;
  /** Used instead of all steps when prefs.effectiveReduced (e.g. static card + 200 ms fade). */
  fallback(run: (rt: MotionRuntime) => MotionHandle): CutsceneBuilder;
  play(o?: { skippable?: boolean; onSkip?: () => void; onDone?: () => void }): CutsceneHandle;
}

function isHandle(x: MotionHandle | Promise<void>): x is MotionHandle {
  return typeof (x as MotionHandle).skip === 'function';
}

export function cutscene(rt: MotionRuntime): CutsceneBuilder {
  const entries: Entry[] = [];
  let fb: ((rt: MotionRuntime) => MotionHandle) | null = null;
  const b: CutsceneBuilder = {
    step(name, run) {
      entries.push({ kind: 'step', name, run });
      return b;
    },
    parallel(name, runs) {
      entries.push({ kind: 'parallel', name, runs });
      return b;
    },
    wait(ms) {
      entries.push({ kind: 'wait', name: `wait ${ms}`, ms });
      return b;
    },
    fallback(run) {
      fb = run;
      return b;
    },
    play(o = {}) {
      return play(rt, entries.slice(), fb, o);
    },
  };
  return b;
}

function play(
  rt: MotionRuntime,
  entries: Entry[],
  fb: ((rt: MotionRuntime) => MotionHandle) | null,
  o: { skippable?: boolean; onSkip?: () => void; onDone?: () => void },
): CutsceneHandle {
  const skippable = o.skippable ?? true;
  let current: string | null = null;
  let idx = 0;
  let active: MotionHandle | null = null;
  let pendingPromise = false;
  let finished = false;
  let skipped = false;
  let resolveFinished!: () => void;
  const finishedP = new Promise<void>((r) => (resolveFinished = r));

  const complete = (): void => {
    if (finished) return;
    finished = true;
    current = null;
    resolveFinished();
    if (skipped) o.onSkip?.();
    else o.onDone?.();
  };

  const useFallback = rt.reduced && fb !== null;
  const list: Entry[] = useFallback
    ? [
        {
          kind: 'step',
          name: 'fallback',
          run: (r) => (fb as (r: MotionRuntime) => MotionHandle)(r),
        },
      ]
    : entries;

  const startEntry = (e: Entry): void => {
    current = e.name;
    pendingPromise = false;
    if (e.kind === 'step') {
      const r = e.run(rt);
      if (isHandle(r)) active = r;
      else {
        pendingPromise = true;
        active = null;
        void r.then(() => {
          pendingPromise = false;
        });
      }
    } else if (e.kind === 'parallel') {
      active = allHandles(e.runs.map((run) => run(rt)));
    } else {
      active = rt.after(e.ms, () => {});
    }
  };

  const driver = rt.spawn({
    update: () => {
      if (list.length === 0) {
        complete();
        return true;
      }
      for (;;) {
        if (active === null && !pendingPromise) {
          if (idx >= list.length) {
            complete();
            return true;
          }
          startEntry(list[idx++] as Entry);
        }
        if (pendingPromise) return false;
        if (active && !active.done) return false;
        active = null;
      }
    },
    finish: () => {
      // skip: drive every remaining step to its end state
      skipped = true;
      active?.skip();
      active = null;
      while (idx < list.length) {
        const e = list[idx++] as Entry;
        if (e.kind === 'step') {
          const r = e.run(rt);
          if (isHandle(r)) r.skip();
        } else if (e.kind === 'parallel') {
          e.runs.forEach((run) => run(rt).skip());
        }
      }
      complete();
    },
    abort: () => {
      active?.cancel();
      complete();
    },
  });

  const handle: CutsceneHandle = {
    get done() {
      return driver.done;
    },
    finished: finishedP,
    get currentStep() {
      return current;
    },
    cancel: () => driver.cancel(),
    skip: () => {
      driver.skip();
    },
    skipOnKey(target) {
      if (!skippable) return () => {};
      const fn = (): void => handle.skip();
      target.addEventListener('keydown', fn);
      const detach = (): void => target.removeEventListener('keydown', fn);
      void finishedP.then(detach);
      return detach;
    },
  };
  // run the first entry synchronously so frame 0 is already in its start pose
  if (list.length > 0) {
    // no-op: the driver starts the first entry on the first update; callers may rt.step(0)
  }
  return handle;
}

/**
 * Row 20. Road scroll 2.4 s ease-in-out, vehicle drives off linear, then Trip door pop
 * (spring 0.5 s bounce .2). Reduced: static card with a 200 ms fade, door appears with it.
 */
export function tripCutscene(
  rt: MotionRuntime,
  o: {
    road: { tilePositionX: number };
    vehicle: Animatable;
    tripDoor: Animatable;
    card?: Animatable;
    roadDistance?: number;
    vehicleTravel?: number;
  },
): CutsceneHandle {
  const dist = o.roadDistance ?? 480;
  const travel = o.vehicleTravel ?? 320;
  const road0 = o.road.tilePositionX;
  const roadProxy = { x: road0, y: 0, alpha: 1, scaleX: 1, scaleY: 1 };
  return cutscene(rt)
    .step('drive', (r) =>
      allHandles([
        r.tween(
          roadProxy,
          { x: road0 + dist },
          {
            duration: DURATION.tripScroll,
            curve: CURVES.easeInOut,
            pixelSnap: true,
            onUpdate: () => {
              o.road.tilePositionX = roadProxy.x;
            },
          },
        ),
        r.tween(
          o.vehicle,
          { x: o.vehicle.x + travel },
          { duration: DURATION.tripScroll, curve: CURVES.linear },
        ),
      ]),
    )
    .step('door', (r) =>
      r.tween(
        o.tripDoor,
        { alpha: 1, scale: 1 },
        {
          duration: DURATION.tripDoorPop,
          curve: spring({ duration: 0.5, bounce: 0.2 }),
          from: { alpha: 0, scale: 0.6 },
        },
      ),
    )
    .fallback((r) => {
      o.tripDoor.alpha = 1;
      o.tripDoor.scaleX = 1;
      o.tripDoor.scaleY = 1;
      if (!o.card) return doneHandle();
      return r.tween(
        o.card,
        { alpha: 1 },
        { duration: DURATION.tripCardFade, curve: CURVES.easeOut, from: { alpha: 0 } },
      );
    })
    .play({ skippable: true });
}
