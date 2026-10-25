/**
 * Public contracts of the interior engine. Type-only: safe to import anywhere, never pulls Phaser at runtime.
 * `mountInterior` mirrors `mountVillage` (packages/village) so hosts can swap one for the other.
 */
import type Phaser from 'phaser';
import type { AgentId, StudentId, VillageSource } from '@squad/core';

export const TILE = 16;

/** Same overlay vocabulary as the village host (docs/specs/09-game-scenes.md, 'Overlay panels'). */
export type OverlayEvent =
  | { type: 'openCall'; agent: AgentId; callId: string }
  | { type: 'openQuiz'; quizId: string; chapter: string }
  | { type: 'openLedger'; taskId: string }
  | { type: 'openConfirm'; taskId: string; question: string }
  | { type: 'focusAgent'; agent: AgentId }
  | { type: 'closeOverlay'; which?: 'call' | 'quiz' | 'ledger' | 'confirm' };

export type CameraMode = 'follow' | 'room';

export interface MountOptions {
  /** Container element. Canvas, HUD and a11y host are created inside it. */
  parent: HTMLElement;
  source: VillageSource;
  onOverlay?: (e: OverlayEvent) => void;
  /** Base URL where repo `assets/` is served. Default '/assets'. */
  assetBase?: string;
  /** Map id from the asset manifest. Default 'demo'. */
  map?: string;
  me?: StudentId;
  calm?: boolean;
  camera?: CameraMode;
  /** Show the HUD (room chip and interaction prompt). Default true. */
  hud?: boolean;
  /** Seed for NPC idle wandering so replays and screenshots are stable. Default 1. */
  seed?: number;
}

export interface InteriorHandle {
  destroy(): void;
  setCalm(v: boolean): void;
  /** Host calls this when a React overlay closed (unlocks input, refocuses the canvas). */
  overlayClosed(): void;
  setCamera(mode: CameraMode): void;
  /** Resolves when the first frame has rendered; rejects if boot failed. */
  ready: Promise<void>;
  /** Test and screenshot hooks. */
  debug: {
    game(): Phaser.Game | undefined;
    world(): InteriorWorldDebug | undefined;
    fps(): number;
  };
}

/** What tests and the screenshot script may poke. */
export interface InteriorWorldDebug {
  player: { x: number; y: number; room: string | undefined; walkTo(x: number, y: number): boolean };
  npcs: { id: string; x: number; y: number; room: string | undefined; moving: boolean }[];
  rooms: string[];
  doors: { id: string; locked: boolean }[];
  setDoorLocked(id: string, locked: boolean): void;
  teleport(x: number, y: number): void;
  sendNpc(id: string, target: string): boolean;
  spawnNpc(id: string): void;
  setCamera(mode: CameraMode): void;
  overlays: OverlayEvent[];
}
