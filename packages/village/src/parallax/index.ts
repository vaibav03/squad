// STUB (replaced by the parallax+lighting sub-agent). Signatures are the contract.
import type Phaser from 'phaser';
import type { AssetApi, AssetSpec, Lighting, TimeMode, WorldLayout, WorldTime } from '../world/api';
import { DEPTH } from '../world/api';

export const ASSETS: AssetSpec[] = [];

export type WorldTimeImpl = WorldTime & { update(dtMs: number): void };
export function createWorldTime(opts: { mode?: TimeMode; now?: () => Date } = {}): WorldTimeImpl {
  let mode: TimeMode = opts.mode ?? 'night';
  return {
    get mode() { return mode; },
    set mode(m: TimeMode) { mode = m; },
    get nightness() { return 1; },
    get clockHours() { return 22; },
    setMode(m) { mode = m; },
    update() {},
  };
}

export type LightingImpl = Lighting & { update(timeMs: number, deltaMs: number): void; destroy(): void };
export function createLighting(_scene: Phaser.Scene, _time: WorldTime): LightingImpl {
  return {
    addGlow: () => ({ setIntensity() {}, setPosition() {}, destroy() {} }),
    update() {},
    destroy() {},
  };
}

export interface ParallaxDeps {
  layout: WorldLayout;
  time: WorldTime;
  assets: AssetApi;
  calm: () => boolean;
}
export function createParallax(scene: Phaser.Scene, _d: ParallaxDeps): { update(timeMs: number, deltaMs: number): void; destroy(): void } {
  const g = scene.add.rectangle(0, 0, 4000, 4000, 0x0b1d38).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.sky);
  return { update() {}, destroy() { g.destroy(); } };
}
