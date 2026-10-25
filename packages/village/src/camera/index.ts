// STUB (replaced by the camera+HUD sub-agent). Signatures are the contract.
import type Phaser from 'phaser';
import type { AgentRegistry, CameraApi, MotionTokens, PlayerApi, VillageBus, WorldLayout, WorldTime } from '../world/api';

export interface CameraDeps {
  layout: WorldLayout;
  player: Pick<PlayerApi, 'x'>;
  bus: VillageBus;
  motion: MotionTokens;
  calm: () => boolean;
  registry: Phaser.Data.DataManager;
}
export type CameraImpl = CameraApi & { update(timeMs: number, deltaMs: number): void; destroy(): void };
export function createCamera(_scene: Phaser.Scene, _d: CameraDeps): CameraImpl {
  throw new Error('createCamera: stub');
}
