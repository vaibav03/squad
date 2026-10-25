// STUB (replaced by the character+input sub-agent). Signatures are the contract.
import type Phaser from 'phaser';
import type { AssetSpec, CameraApi, Interactable, MotionTokens, PlayerApi, VillageBus, WorldLayout, WorldTime } from '../world/api';

export const ASSETS: AssetSpec[] = [];

export interface PlayerDeps {
  layout: WorldLayout;
  time: WorldTime;
  motion: MotionTokens;
  calm: () => boolean;
  registry: Phaser.Data.DataManager;
  bus: VillageBus;
}
export type PlayerImpl = PlayerApi & {
  /** Keyboard/drag intent: -1 left, 0 stop, 1 right. Constant speed, instant start, 80 ms ease-out stop. */
  setIntent(dir: -1 | 0 | 1): void;
  update(timeMs: number, deltaMs: number): void;
  destroy(): void;
};
export function createPlayer(_scene: Phaser.Scene, _d: PlayerDeps): PlayerImpl {
  throw new Error('createPlayer: stub');
}

export interface InputDeps {
  player: PlayerImpl;
  camera: Phaser.Cameras.Scene2D.Camera;
  layout: WorldLayout;
  interactables: { list(): Interactable[] };
  bus: VillageBus;
  /** DOM element that receives focus/keys (the canvas wrapper). */
  focusEl: HTMLElement;
}
export interface InputImpl {
  /** Enter/Esc/Tab/? handling, key capture released while an overlay is open (bus 'overlay' / 'overlayClosed'). */
  update(timeMs: number, deltaMs: number): void;
  destroy(): void;
}
export function createInput(_scene: Phaser.Scene, _d: InputDeps): InputImpl {
  return { update() {}, destroy() {} };
}
