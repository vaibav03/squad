import type { VillageEvent } from '@squad/core';
import type { Raster } from './pixel/raster';

/**
 * Scene contract for the buildings half of the village. Everything here is Phaser-free: a scene is
 * a pure state machine (`mapEvent` -> `SceneCommand[]` -> `reduce`) plus a pure painter. The
 * village-world loader wraps a `SceneDef` into its own SceneModule (see `phaser/` adapter).
 */

export type SceneKind = 'chapter-house' | 'council-hall' | 'landmark';

export type LandmarkId =
  | 'debate-stage'
  | 'round-table'
  | 'feynman-porch'
  | 'panic-booth'
  | 'oral-hut'
  | 'rubric-courthouse'
  | 'exam-oracle'
  | 'devils-ta';

export type SceneId = 'chapter-house' | 'council-hall' | LandmarkId;

export type View = 'exterior' | 'interior';

/** open = usable; dim = visible but quiet; locked = shuttered until its first relevant event. */
export type Access = 'locked' | 'dim' | 'open';

export type Occupant = 'idle' | 'studying' | 'in_call' | 'waiting';

export type BubbleStyle = 'thought' | 'speech' | 'dissent' | 'announce' | 'caption';

export interface BubbleSpec {
  /** Stable key (member id, 'chair', 'expert', npc id). One live bubble per key. */
  who: string;
  /** Text exactly as the event carried it. Never anything withheld. */
  text: string;
  style: BubbleStyle;
  /** Stagger index: 80 ms steps between simultaneous opinions (08 row 12). */
  order?: number;
}

export type ChalkMark = 'none' | 'tick' | 'cross';

export type SceneCommand =
  | { c: 'setAccess'; access: Access }
  | { c: 'setOccupant'; state: Occupant; who?: string }
  | { c: 'setWindow'; lit: boolean }
  | { c: 'setGlow'; level: number } // mastery glow 0..1 (chapter houses)
  | { c: 'setSign'; text: string }
  | { c: 'setRing'; on: boolean } // waiting-for-yes ring at the door
  | { c: 'bubble'; bubble: BubbleSpec }
  | { c: 'clearBubble'; who: string }
  | { c: 'clearBubbles' }
  | { c: 'rank'; by: string; order: readonly string[] } // bubbles slide to rank slots
  | { c: 'verdict'; chair: string; text: string; dissenter?: string }
  | { c: 'lantern'; mode: 'off' | 'steady' | 'flicker' }
  | { c: 'chalk'; text: string; mark: ChalkMark }
  | { c: 'portrait'; on: boolean } // call portrait animating (speaking)
  | { c: 'night'; on: boolean }; // booth glow etc., derived from the clock

export interface SceneCtx {
  /** Which student the viewer is (`cast.me`); mastery is owner-only. */
  viewer: string;
  /** Local hour 0..23 for night-gated glows (Panic Line). */
  hour: number;
  /** Squad size; under 3 hides aggregates (00). Chapter-weak-spot glow is aggregate. */
  squadSize: number;
}

/** Everything a painter needs to make a frame besides state. */
export interface PaintOpts {
  /** ms on the scene clock; frames are a pure function of (state, view, t). */
  t: number;
  /** Calm mode or prefers-reduced-motion: steady lights, no bob, fades only. */
  calm: boolean;
}

export interface Anchor {
  x: number;
  y: number;
}

export interface SceneSize {
  w: number;
  h: number;
}

export interface SceneDef<S = unknown> {
  id: SceneId;
  kind: SceneKind;
  /** Human title for signs, the accessible list and focus labels. */
  title: string;
  exterior: SceneSize;
  interior: SceneSize;
  /** Door / entry point in exterior pixel coordinates (feet on the ground line). */
  door: Anchor;
  /** Where the player stands when the interior opens, interior pixel coordinates. */
  entry: Anchor;
  init(opts?: { instance?: string; title?: string }): S;
  /** True when this event belongs to this instance of the scene (pure). */
  handles(e: VillageEvent, state: S, ctx: SceneCtx): boolean;
  /** Pure: event -> commands. No clocks, no randomness. */
  mapEvent(e: VillageEvent, state: S, ctx: SceneCtx): SceneCommand[];
  /** Pure: apply one command at scene time `at` (ms). */
  reduce(state: S, cmd: SceneCommand, at: number): S;
  paint(state: S, view: View, o: PaintOpts): Raster;
  /** One plain sentence for the accessible list and screen readers. */
  describe(state: S): string;
  /** Enter / exit hooks the world calls around view changes (state is returned, not mutated). */
  onEnter?(state: S, at: number): S;
  onExit?(state: S, at: number): S;
}

/** Feed an event through a scene: handles -> mapEvent -> reduce. Returns the new state. */
export function step<S>(def: SceneDef<S>, state: S, e: VillageEvent, ctx: SceneCtx, at: number): S {
  if (!def.handles(e, state, ctx)) return state;
  let s = state;
  for (const cmd of def.mapEvent(e, s, ctx)) s = def.reduce(s, cmd, at);
  return s;
}

/** A scripted moment for frame capture and tests: events at times, then paint at sample times. */
export interface ShotDef {
  name: string;
  view: View;
  script: ReadonlyArray<{ at: number; event: VillageEvent }>;
  /** Scene-clock times (ms) to paint after applying every event with `at <= sample`. */
  sample: readonly number[];
  ctx?: Partial<SceneCtx>;
  calm?: boolean;
  instance?: string;
  title?: string;
}

export interface SceneBundle<S = unknown> {
  def: SceneDef<S>;
  shots: readonly ShotDef[];
}

export const DEFAULT_CTX: SceneCtx = { viewer: 's_ana', hour: 23, squadSize: 4 };
