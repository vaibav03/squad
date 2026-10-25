/**
 * Public contracts of the village world (docs/village-api.md). Type-only: safe to import anywhere,
 * never pulls Phaser at runtime. Other village workstreams (scenes, mesh-view, cutscene, a11y,
 * adapter, overlay-bridge) build against exactly this file.
 */
import type Phaser from 'phaser';
import type { AgentId, StudentId, VillageEvent, VillageSource } from '@squad/core';

/* ---------- coordinate system ---------- */
/**
 * Art layer set height (docs/design/DESIGN.md section 2). World y runs 0 (sky) .. 270 (bottom). The camera is
 * BOTTOM-anchored: the view is `viewH <= 270` px tall and shows y in [270 - viewH, 270], so short windows crop the
 * top of the sky and tall phones show all of it. Width varies with the container (195 on a 390 px phone at 2x,
 * 426 at 1280x720 at 3x).
 */
export const LOGICAL_H = 270;
/** Tile and grid unit. Every sprite position is a whole logical pixel. */
export const TILE = 16;
/** World is one horizontal strip, logical px. Left=0..850, Mid=850..1760, Right=1760..2800. */
export const WORLD_W = 2800;
/** y where actors' feet and building bases sit (walkable path; the grass edge/fence line is y=240). */
export const GROUND_Y = 250;

/** Draw order. Use these, never raw numbers. Within a band, add (y) or small ints. */
export const DEPTH = {
  sky: 0,
  parallaxBack: 10, // sky, stars, moon, clouds, far hills
  parallaxMid: 20, // mid hills, windmill, far tree line
  behindBuildings: 30, // distant props, fences behind houses
  buildings: 40, // houses, landmarks (anchor at feet, origin (0.5,1))
  props: 50, // signboards, lamps, campfire, notice board, doors
  actors: 60, // player and NPCs (player is actors+1)
  actorFx: 70, // bubbles, markers, rings, envelopes
  foreground: 80, // near trees, fence, grass in front of actors
  lighting: 90, // night tint / glow additive overlays
  worldUi: 100, // world-space UI (signboard text, door prompts)
} as const;
export type DepthBand = keyof typeof DEPTH;

export type SlotKind =
  | 'chapter-house'
  | 'council-hall'
  | 'landmark'
  | 'commons'
  | 'notice-board'
  | 'student-home'
  | 'road'
  | 'spawn';
/** A named, hand-placed anchor in the world. Scenes render into slots; they do not invent x positions. */
export interface LayoutSlot {
  id: string; // stable id, e.g. 'chapter-1', 'council-hall', 'debate-stage', 'home-s_ana'
  kind: SlotKind;
  x: number; // centre x, whole px
  w: number; // footprint width px (collision / spacing)
  region: 'left' | 'mid' | 'right';
  door?: { x: number }; // x where an agent or the player stands to "enter"
  label: string; // human name (a11y list, signboards)
}
export interface WorldLayout {
  width: number;
  height: number;
  groundY: number;
  slots: readonly LayoutSlot[];
  slot(id: string): LayoutSlot; // throws on unknown id
  slotsOfKind(kind: SlotKind): LayoutSlot[];
  cameraPresets: Record<'left' | 'mid' | 'right', number>; // centre x per preset
}

/* ---------- time / lighting ---------- */
export type TimeMode = 'night' | 'dusk' | 'dawn' | 'day' | 'auto';
export interface WorldTime {
  mode: TimeMode;
  /** 0 = full day, 1 = full night. Eased; scenes read it every frame to dim windows/props. */
  readonly nightness: number;
  /** Hours 0..24 shown by the HUD clock. */
  readonly clockHours: number;
  /** Which twilight sky applies while nightness is between 0 and 1. */
  readonly twilight: 'dusk' | 'dawn';
  setMode(mode: TimeMode): void;
}
/** Warm window light: scenes call this for every lit window / lamp so glow reacts to nightness. */
export interface Lighting {
  /** Add a soft additive glow sprite at (x,y); returns a handle whose alpha follows nightness. */
  addGlow(opts: { x: number; y: number; radius: number; color?: number; intensity?: number; flicker?: boolean }): Glow;
}
export interface Glow {
  setIntensity(v: number): void; // 0..1, multiplied by nightness
  setPosition(x: number, y: number): void;
  destroy(): void;
}

/* ---------- agents (feeds HUD chips, a11y list, adapter) ---------- */
export type AgentState = 'idle' | 'studying' | 'in_call' | 'waiting_for_student';
export interface AgentInfo {
  id: AgentId;
  name: string;
  kind: 'student' | 'expert' | 'council' | 'dean' | 'mediator';
  slotId?: string; // where this agent lives
  portraitKey?: string; // texture key of a small portrait/face (optional)
  state: AgentState;
  /** Hide from HUD chips if true (e.g. neighbours the viewer should not see as chips). */
  hidden?: boolean;
}
export interface AgentRegistry {
  register(info: Omit<AgentInfo, 'state'> & { state?: AgentState }): void;
  setState(id: AgentId, state: AgentState): void;
  get(id: AgentId): AgentInfo | undefined;
  list(): AgentInfo[];
}

/* ---------- interaction ---------- */
export interface Interactable {
  id: string;
  x: number; // centre x
  radius: number; // px; player within radius can press Enter / tap the prompt
  label: string; // "Open Council Hall", "Join call" (a11y + prompt)
  enabled?: () => boolean;
  onActivate(): void;
}

/* ---------- player ---------- */
export interface PlayerApi {
  readonly x: number;
  readonly facing: 'left' | 'right';
  readonly isWalking: boolean;
  /** Walk at constant speed to x (clamped to the world). Resolves on arrival; rejects/resolves false if superseded. */
  walkTo(x: number, opts?: { stopWithin?: number }): Promise<boolean>;
  /** Instant move (spawn, return from interior). */
  teleport(x: number): void;
  /** Input locked while an overlay or cutscene is open. Counted: lock twice, unlock twice. */
  lockInput(): () => void;
  /** Sprite for scenes that need to attach things (read-only use). */
  readonly sprite: Phaser.GameObjects.Sprite;
}

/* ---------- camera ---------- */
export type CameraMode = 'follow' | 'left' | 'mid' | 'right' | 'zoom';
export interface CameraApi {
  setMode(mode: CameraMode): void;
  readonly mode: CameraMode;
  /** Pan to x (400 ms ease-in-out) then hold; returns to follow after `holdMs` if given. Skippable. */
  panTo(x: number, opts?: { holdMs?: number }): Promise<void>;
}

/* ---------- events between world modules ---------- */
export interface SceneCommand {
  /** e.g. 'showBubble', 'setGlow', 'walkTo', 'spawnEnvelope', 'ring', 'openOverlay' (list: docs/village-events.md) */
  type: string;
  [key: string]: unknown;
}
export type OverlayEvent =
  | { type: 'openCall'; agent: AgentId; callId: string }
  | { type: 'openQuiz'; quizId: string; chapter: string }
  | { type: 'openLedger'; taskId: string }
  | { type: 'openConfirm'; taskId: string; question: string }
  | { type: 'focusAgent'; agent: AgentId }
  | { type: 'closeOverlay' };

export interface VillageBusEvents {
  command: SceneCommand; // adapter output, fanned out to every module
  villageEvent: VillageEvent; // raw event (a11y live region, HUD)
  agentState: { id: AgentId; state: AgentState };
  overlay: OverlayEvent; // forwarded to opts.onOverlay by the world
  overlayClosed: void; // host tells the world an overlay closed -> unlock input, refocus
  enter: { slotId: string }; // player entered a building/interior
  leave: { slotId: string };
  calm: boolean;
  cameraMode: CameraMode;
  tripDoor: { visible: boolean };
  announce: string; // polite live-region text
}
export interface VillageBus {
  on<K extends keyof VillageBusEvents>(k: K, fn: (p: VillageBusEvents[K]) => void): () => void;
  emit<K extends keyof VillageBusEvents>(k: K, p: VillageBusEvents[K]): void;
}

/* ---------- loader ---------- */
export interface AssetApi {
  /** True once a texture/atlas key from the manifest is loaded. */
  has(key: string): boolean;
  /** Public URL for a repo-relative asset path ('assets/pixel/...'), honouring opts.assetBase. */
  url(repoPath: string): string;
}

/* ---------- context handed to every module ---------- */
export interface VillageContext {
  game: Phaser.Game;
  /** The persistent world scene. Add game objects here. */
  scene: Phaser.Scene;
  layout: WorldLayout;
  depth: typeof DEPTH;
  time: WorldTime;
  lighting: Lighting;
  agents: AgentRegistry;
  player: PlayerApi;
  camera: CameraApi;
  assets: AssetApi;
  bus: VillageBus;
  /** Register something the player can activate with Enter / tap. Returns unregister. */
  interactables: { register(i: Interactable): () => void; list(): Interactable[] };
  /** Persistent key/value (player x, calm, camera mode). Survives interior launch. */
  registry: Phaser.Data.DataManager;
  me: StudentId | undefined; // the viewing student, from the replay cast or opts
  /** reduced motion (OS) OR Calm toggle. Read live; also fires bus 'calm'. */
  readonly calm: boolean;
  /** Motion tokens (curves). Provided by the motion lead's src/motion; stubbed until it lands. */
  motion: MotionTokens;
  log(msg: string, extra?: unknown): void;
}
export interface MotionTokens {
  easeOut(t: number): number;
  easeInOut(t: number): number;
  easeDrawer(t: number): number;
}

/** What other leads implement. Put `export default module` (or an array) in `src/<dir>/module.ts`. */
export interface SceneModule {
  id: string;
  /** Lower runs first. world=0, scenes=100, mesh-view=200, cutscene=300. */
  order?: number;
  /** Queue extra assets (prefer the manifest; use this only for module-private files). */
  preload?(ctx: VillageContext, load: Phaser.Loader.LoaderPlugin): void;
  create(ctx: VillageContext): ModuleInstance | void;
}
export interface ModuleInstance {
  update?(timeMs: number, deltaMs: number): void;
  /** Called for every SceneCommand after the adapter ran. Ignore unknown types. */
  onCommand?(cmd: SceneCommand): void;
  destroy?(): void;
}

/** Optional adapter hook (village-mesh): src/adapter/module.ts default-exports this factory. */
export interface AdapterModule {
  createAdapter(opts: { me: StudentId | undefined }): { adapt(e: VillageEvent): SceneCommand[] };
}

/* ---------- mountVillage ---------- */
export interface MountOptions {
  /** Container element. The canvas, HUD and a11y host are created inside it. */
  parent: HTMLElement;
  source: VillageSource;
  onOverlay?: (e: OverlayEvent) => void;
  /** Base URL where repo `assets/` is served. Default '/assets'. */
  assetBase?: string;
  me?: StudentId;
  time?: TimeMode; // default 'night'
  calm?: boolean; // initial Calm mode
  /** Which module ids to skip (tests). */
  skipModules?: string[];
  /** Show the HUD (default true). */
  hud?: boolean;
}
export interface VillageHandle {
  destroy(): void;
  setCamera(mode: CameraMode): void;
  setCalm(v: boolean): void;
  /** Host calls this when a React overlay closed (unlocks input, refocuses canvas). */
  overlayClosed(): void;
  /** Resolves when the first frame has rendered; rejects if boot failed. */
  ready: Promise<void>;
  /** Test/screenshot hooks. */
  debug: { game(): Phaser.Game | undefined; ctx(): VillageContext | undefined; fps(): number };
}

/* ---------- module-owned asset specs ---------- */
/** Repo-relative asset a world part needs. Boot queues every `ASSETS` list (parallax, character, hud, ...). */
export type AssetSpec =
  | { type: 'image'; key: string; path: string }
  | { type: 'spritesheet'; key: string; path: string; frameWidth: number; frameHeight: number; endFrame?: number }
  | { type: 'atlas'; key: string; path: string; atlasPath: string };
