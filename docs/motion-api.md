# Motion API (workstream `motion`, spec 08)

Status: **v1 contract, published first; implementation follows on `ws/motion`.** Code against these signatures. Anything marked (stub) may be a no-op for a few hours but the signature will not change. Changes are announced in this file's changelog at the bottom.

Import paths (Phaser is NOT a dependency of the motion module; it is structurally typed so Phaser GameObjects/cameras satisfy it and tests/Motion Lab run without Phaser):

```ts
import { ... } from '@squad/village/motion';   // canvas side (subpath export added by motion)
import '@squad/web/motion/motion.css';          // DOM side tokens + transitions
import { ... } from '@squad/web/motion';        // DOM helpers (prefs attributes, flipIn)
```

`@squad/village/motion` re-exports everything in `packages/village/src/motion/index.ts`. village-world may additionally `export * from './motion'` from its index.

## 1. Model

A `MotionRuntime` is a deterministic, pausable animation clock owned by one Phaser scene (or the Motion Lab). The host calls `runtime.update(deltaMs)` from `Scene.update(time, delta)`. Nothing uses wall clocks, so tests and frame-stepping are exact. Every primitive:

- takes the runtime first, then the target(s), then options;
- reads `runtime.prefs` and picks the normal or reduced-motion variant at call time (row of the 08 table in each doc comment);
- returns a `MotionHandle` (`cancel()`, `skip()` jump to end state, `done`, `finished: Promise<void>`);
- only writes `x, y, alpha, scaleX, scaleY` (and optional `setReveal`, `setFrame`), always whole pixels for x/y when `pixelSnap` is true (default).

```ts
export interface Animatable {
  x: number;
  y: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  visible?: boolean;
}
export interface MotionHandle {
  readonly done: boolean;
  readonly finished: Promise<void>;
  cancel(): void;
  skip(): void;
}
export type Curve = (t: number) => number; // t in [0,1] -> [0,1] (spring may overshoot)
```

## 2. Tokens (row M-1)

```ts
export const CURVES: { linear: Curve; easeOut: Curve; easeInOut: Curve; easeDrawer: Curve };
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Curve; // exact endpoints 0 and 1
export function popCurve(opts?: { from?: number /*0.9*/; peak?: number /*1.05*/; bounce?: number /*0.1-0.3*/ }): Curve; // tween from `from` to 1
export function spring(opts?: { duration?: number; bounce?: number }): Curve; // default { duration: 0.5, bounce: 0.2 }
export const CSS_VARS: { '--ease-out': string; '--ease-in-out': string; '--ease-drawer': string };
export const DURATION: {
  // ms, straight from the 08 table
  stopWalk: 80;
  envelopePop: 180;
  handoff: 320;
  envelopeStagger: 60;
  bubbleIn: 160;
  bubbleOut: 120;
  conflictPop: 350;
  ringLoop: 1600;
  checkReveal: 200;
  opinionStagger: 80;
  rankSlide: 320;
  chairman: 240;
  cameraPan: 400;
  buildingFade: 200;
  buildingFadeReduced: 120;
  teleportFade: 120;
  dayNight: 20000;
  litWindowLoop: 4000;
  lanternLoop: 2000;
  tripScroll: 2400;
  tripDoorPop: 500;
  overlayMin: 200;
  overlayMax: 280;
};
export const WALK_FPS = 8;
export const IDLE_FPS = 2;
export function bubbleHoldMs(text: string): number; // max(1200, 1200 * chars / 20), words never leave early
```

Curve values are exactly: ease-out `(0.23,1,0.32,1)`, ease-in-out `(0.77,0,0.175,1)`, ease-drawer `(0.32,0.72,0,1)`. Nothing else exists; there is no ease-in.

## 3. Runtime, prefs, Calm mode, tab visibility (M-8)

```ts
export interface MotionPrefs {
  readonly reduced: boolean;
  readonly calm: boolean;
  readonly effectiveReduced: boolean; /* reduced || calm */
}
export function createMotionPrefs(opts?: {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  matchMedia?: typeof window.matchMedia;
  storageKey?: string;
}): MotionPrefsStore;
export interface MotionPrefsStore extends MotionPrefs {
  setCalm(on: boolean): void; // HUD "Calm mode" toggle calls this; persisted (try/catch), default off
  setReducedOverride(v: boolean | null): void; // Motion Lab toggle; null = follow the OS media query
  subscribe(fn: (p: MotionPrefs) => void): () => void;
  dispose(): void;
}
export function getMotionPrefs(): MotionPrefsStore; // shared singleton for the page (DOM + canvas see the same value)

export class MotionRuntime {
  constructor(opts?: { prefs?: MotionPrefsStore; maxDeltaMs?: number /* default 100 */ });
  readonly prefs: MotionPrefsStore;
  readonly now: number; // ms of runtime time
  timeScale: number; // 1 default; Motion Lab uses 0.25
  paused: boolean;
  update(deltaMs: number): void; // clamps delta to maxDeltaMs; no-op while paused
  step(deltaMs: number): void; // exact advance, unclamped, ignores pause (tests, frame stepper)
  tween(target: Animatable, to: TweenTo, opts: TweenOpts): MotionHandle; // generic, see section 4
  after(ms: number, fn: () => void): MotionHandle;
  cancelAll(): void;
}
/** Pauses the runtime when the tab is hidden and resumes WITHOUT catching up (first delta after resume is dropped). Returns detach. */
export function pauseWhenHidden(runtime: MotionRuntime, doc?: Document): () => void;
/** For Phaser: also call game.loop.sleep()/wake() via callbacks. */
export function pauseWhenHiddenWith(opts: {
  runtime: MotionRuntime;
  onHide: () => void;
  onShow: () => void;
  doc?: Document;
}): () => void;
```

## 4. Tween helpers

```ts
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
  curve?: Curve /* default CURVES.easeOut */;
  delay?: number;
  from?: TweenTo;
  pixelSnap?: boolean;
  onUpdate?: (t: number) => void;
  onComplete?: () => void;
}
// MotionRuntime.tween(target, to, opts)
export function fadeIn(rt: MotionRuntime, t: Animatable, ms?: number): MotionHandle; // alpha 0->1, easeOut
export function fadeOut(rt: MotionRuntime, t: Animatable, ms?: number): MotionHandle;
export function enter(
  rt: MotionRuntime,
  t: Animatable,
  o?: { ms?: number; originFrom?: number /* default 0.95 */ },
): MotionHandle; // scale .95->1 + alpha, never from 0. Reduced: alpha only.
```

## 5. Walking (row 3) and frames (rows 3, 4)

```ts
export interface Walker extends Animatable {
  setFrame?(frameIndex: number): void;
  setFacing?(dir: 'left' | 'right' | 'up' | 'down'): void;
}
export function walkTo(
  rt: MotionRuntime,
  who: Walker,
  to: { x: number; y: number },
  o?: {
    speedPxPerSec?: number /* default 48 */;
    onArrive?: () => void;
    idleFrame?: number;
  },
): MotionHandle;
// Linear, instant start, whole pixels, 80 ms ease-out stop over the last stretch, 4-frame cycle at 8 fps (frames 0..3, idleFrame on stop).
// Reduced/Calm: fade out 60 ms, snap to target, fade in 60 ms (120 ms total), no frames.
export function walkFrame(elapsedMs: number): 0 | 1 | 2 | 3;
export function frameLoop(
  rt: MotionRuntime,
  setFrame: (i: number) => void,
  o: { frames: number; fps: number; reducedFrame?: number },
): MotionHandle; // idle breathing (2 @ 2fps), smoke, campfire. Reduced: single static frame.
```

## 6. Bubbles (rows 8, 12, 17)

```ts
export interface BubbleTarget extends Animatable {
  /* container whose ORIGIN is the speaker-side tail point */
}
export function showBubble(
  rt: MotionRuntime,
  b: BubbleTarget,
  o?: {
    text?: string;
    holdMs?: number /* default bubbleHoldMs(text) */;
    kind?: 'speech' | 'thought';
    onGone?: () => void;
  },
): BubbleHandle;
export interface BubbleHandle extends MotionHandle {
  dismiss(): void; /* 120 ms ease-out exit */
}
// In 160 ms ease-out scale .95->1 + alpha 0->1 about the tail origin; exit 120 ms ease-out. Reduced: alpha fade only, no scale. Text is NEVER animated; it is whole on frame 1.
export function bubbleSlots(count: number, cap?: number /* 12 */): number; // helper: how many may be visible at once
```

## 7. Envelopes and the commons (row 7)

```ts
export interface EnvelopeTarget extends Animatable {}
export function carryEnvelope(
  rt: MotionRuntime,
  o: {
    walker: Walker;
    envelope: EnvelopeTarget;
    from: Point;
    to: Point; /* door -> campfire */
    carryOffset?: Point;
    speedPxPerSec?: number;
    onArrive?: () => void;
  },
): MotionHandle;
// envelope pops in 180 ms easeOut at the door, rides above the walker, walker linear. Reduced: walker teleports (see walkTo), envelope fades at destination.
export function handOff(
  rt: MotionRuntime,
  o: {
    envelope: EnvelopeTarget;
    from: Point;
    to: Point;
    staggerIndex?: number;
    onDone?: () => void;
  },
): MotionHandle;
// 320 ms easeInOut glide, +60 ms * staggerIndex. Reduced: fade out at from, fade in at to.
export function pinAtFire(rt: MotionRuntime, env: EnvelopeTarget, at: Point): MotionHandle; // to-commons messages: pops in at the campfire, 180 ms
```

## 8. State markers (rows 9 to 13)

```ts
export function conflictMarker(
  rt: MotionRuntime,
  marker: Animatable & { setTint?(rgb: number): void },
  o?: { tint?: number /* red, default 0xC8442F */ },
): MotionHandle;
// one pop from scale 0.9 (never lower) via `popCurve` (spring shape, bounce 0.1-0.3, peak ~1.05, settles on 1), 0.35 s, tint holds, NO shake. Reduced: static marker at scale 1 alpha 1, tint set.
export function waitingRing(
  rt: MotionRuntime,
  ring: Animatable,
  o?: { onStaticLabel?: (show: boolean) => void },
): RingHandle;
export interface RingHandle extends MotionHandle {
  stop(fadeMs?: number): void;
}
// scale 1->1.15 + alpha .6->0, 1.6 s loop easeOut. Reduced: static ring (scale 1, alpha .6) and onStaticLabel(true) so the host shows the "waiting" label.
export function ringToCheck(
  rt: MotionRuntime,
  o: {
    ring: Animatable;
    check: Revealable & Animatable;
    lock?: { setFrame(i: number): void; openFrame: number };
  },
): MotionHandle;
export interface Revealable {
  setReveal(progress: number): void;
} // host maps to a mask / crop; 0 hidden, 1 fully drawn
// 200 ms easeOut reveal, lock frame swaps at 50%. Reduced: instant swap.
export function confirmTick(rt: MotionRuntime, tick: Animatable & Revealable): MotionHandle;
export function councilOpinions(rt: MotionRuntime, bubbles: BubbleTarget[]): MotionHandle; // thought bubbles, 80 ms stagger, independent
export function councilRank(
  rt: MotionRuntime,
  moves: Array<{ bubble: BubbleTarget; to: Point }>,
): MotionHandle; // slide 320 ms easeInOut. Reduced: fade in order.
export function chairmanVerdict(rt: MotionRuntime, bubble: BubbleTarget): MotionHandle; // 240 ms easeOut
export function lanternFlicker(
  rt: MotionRuntime,
  lantern: Animatable & { setFrame?(i: number): void },
): RingHandle; // 3 frames over 2 s, easeInOut alpha. Reduced: steady red.
export function litWindow(rt: MotionRuntime, win: Animatable): RingHandle; // alpha .85<->1, 4 s loop easeInOut. Reduced: steady lit (alpha 1).
export interface Point {
  x: number;
  y: number;
}
```

## 9. Ambient world (rows 1, 2)

```ts
export function parallaxStep(
  layers: Array<{ scrollFactor: number; tile: { tilePositionX: number } }>,
  cameraScrollX: number,
): void; // pure; reduced does not stop this, only drift below does
export function cloudDrift(
  rt: MotionRuntime,
  cloud: { tilePositionX: number },
  o?: { pxPerSec?: number /* 1 */ },
): MotionHandle; // linear. Reduced: no drift
export function dayNight(
  rt: MotionRuntime,
  tint: { setTint(rgb: number): void; get?: () => number },
  o: { from: number; to: number; at?: 'dusk' | 'dawn' },
): MotionHandle; // 20 s easeInOut colour lerp. Reduced: 200 ms crossfade snap
export function lerpColor(a: number, b: number, t: number): number;
```

## 10. Camera and buildings (rows 14, 15)

```ts
export interface CameraLike {
  scrollX: number;
  scrollY: number;
}
export function cameraPan(
  rt: MotionRuntime,
  cam: CameraLike,
  to: { x: number; y: number },
  o?: { skipOn?: () => boolean; onDone?: () => void },
): MotionHandle;
// 400 ms easeInOut, skippable via handle.skip() (call on any key/tap). Reduced: jump cut. Never applied to keyboard walking (no camera lag on input).
export function buildingTransition(
  rt: MotionRuntime,
  o: {
    direction: 'enter' | 'leave';
    overlay: Animatable /* black/ink fade plane */;
    onMidpoint?: () => void;
  },
): MotionHandle;
// 200 ms easeOut fade (overlay alpha 0->1, onMidpoint swaps the scene, 1->0). Reduced: 120 ms.
```

DOM twin: `buildingFadeClass` in section 12 uses the same durations.

## 11. Speaking state (row 17)

```ts
export interface SpeakingTarget {
  sprite: Animatable & { setFrame?(i: number): void };
  glow?: Animatable;
  portrait?: Animatable;
}
export function speaking(rt: MotionRuntime, t: SpeakingTarget): SpeakingHandle;
export interface SpeakingHandle extends MotionHandle {
  setSpeaking(on: boolean): void;
  setAmplitude(a: number /* 0..1 */): void; /* smoothed; glow alpha only */
}
// Driven by call.caption (village-mesh calls setSpeaking(true) on a caption, false after the hold). 2-frame swap at 8 fps, 2 px bob, glow opacity follows smoothed amplitude. Reduced: glow only, no bob, no frame swap.
export function smoothAmplitude(prev: number, next: number, dtMs: number): number; // pure, exponential, tau 80 ms
```

## 12. Cutscene sequencer (row 20, M-7)

```ts
export function cutscene(rt: MotionRuntime): CutsceneBuilder;
export interface CutsceneBuilder {
  step(name: string, run: (rt: MotionRuntime) => MotionHandle | Promise<void>): CutsceneBuilder;
  parallel(name: string, runs: Array<(rt: MotionRuntime) => MotionHandle>): CutsceneBuilder;
  wait(ms: number): CutsceneBuilder;
  fallback(run: (rt: MotionRuntime) => MotionHandle): CutsceneBuilder; // used instead of all steps when prefs.effectiveReduced (e.g. static card + 200 ms fade)
  play(o?: { skippable?: boolean; onSkip?: () => void; onDone?: () => void }): CutsceneHandle;
}
export interface CutsceneHandle extends MotionHandle {
  readonly currentStep: string | null;
  skipOnKey(target: EventTarget): () => void; /* any key skips; returns detach */
}
export function tripCutscene(
  rt: MotionRuntime,
  o: {
    road: { tilePositionX: number };
    vehicle: Animatable;
    tripDoor: Animatable;
    card?: Animatable;
  },
): CutsceneHandle;
// road scroll 2.4 s easeInOut, vehicle drives off linear, then Trip door pop 0.5 s from scale 0.9 via `popCurve` (peak ~1.05). Reduced: static card, 200 ms fade. Plays once (caller guards), any key skips.
```

## 13. DOM side (`@squad/web/motion`)

```css
/* motion.css: custom properties + classes. Only transform/opacity (clip-path for .m-check). No transition: all. */
:root { --ease-out: cubic-bezier(0.23,1,0.32,1); --ease-in-out: cubic-bezier(0.77,0,0.175,1); --ease-drawer: cubic-bezier(0.32,0.72,0,1);
        --dur-press: 100ms; --dur-chip: 150ms; --dur-panel: 240ms; }
.m-panel      /* overlay: @starting-style translateY(8px)+opacity, 200-280 ms ease-drawer, exit mirrors; reduced: opacity only */
.m-press      /* buttons: scale(.97) on :active 100-160 ms ease-out; hover only inside (hover:hover) and (pointer:fine) */
.m-chip       /* HUD chip color/opacity 150 ms ease */
.m-badge      /* Replay/Live badge opacity 150 ms ease */
.m-check      /* clip-path inset reveal 200 ms ease-out */
.m-fade       /* building enter/leave DOM fade 200 ms ease-out, 120 ms reduced */
```

Reduced motion applies on `@media (prefers-reduced-motion: reduce)` AND on `[data-calm="true"]` (set on `<html>` by `bindMotionPrefsToDom`).

```ts
export function bindMotionPrefsToDom(root?: HTMLElement, prefs?: MotionPrefsStore): () => void; // sets data-calm / data-reduced-motion on <html>
export function setCalmMode(on: boolean): void; // shortcut for getMotionPrefs().setCalm(on)
export const calmModeStore: {
  get(): boolean;
  set(on: boolean): void;
  subscribe(fn: () => void): () => void;
};
export function createUseCalmMode(useSyncExternalStore): () => [boolean, (on: boolean) => void]; // web-shell wraps this as useCalmMode()
```

## 14. Motion Lab

Route `/__motion` in apps/web-host, registered from `apps/web-host/src/lab/motion/index.ts` with one registration line in the web-shell lab registry. Every primitive above has a looped entry at 1x and 0.25x, a reduced-motion toggle, and a frame stepper.

## Changelog
- v1.2: pops start at scale 0.9 (popCurve, peak ~1.05); dayNight honors `at`; buildingTransition passes `direction` to onMidpoint; a new walkTo cancels the previous walkTo on the same walker.

- v1.1: useCalmMode is a factory (createUseCalmMode) + calmModeStore (no react dep); extras: teleport(), DURATION.dayNightReduced/tripCardFade, tripCutscene opts card/roadDistance/vehicleTravel; DOM vars are --m-ease-_/--m-dur-_ falling back to tokens.css --ease-*; loops settle to rest if Calm turns on mid-run; bubble hold is never shorter than bubbleHoldMs.
- v1 (initial publish): all signatures above. Phaser objects satisfy `Animatable`/`CameraLike` structurally; no `phaser` import in the motion module.
