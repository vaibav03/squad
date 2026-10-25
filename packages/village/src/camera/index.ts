import type Phaser from 'phaser';
import type {
  CameraApi,
  CameraMode,
  MotionTokens,
  PlayerApi,
  VillageBus,
  WorldLayout,
} from '../world/api';
import { BLEND_MS, blend, clampCenter, scrollForCenter, scrollYBottom } from './math';
import { LOGICAL_H } from '../world/api';

export interface CameraDeps {
  layout: WorldLayout;
  player: Pick<PlayerApi, 'x' | 'isWalking'>;
  bus: VillageBus;
  motion: MotionTokens;
  calm: () => boolean;
  registry: Phaser.Data.DataManager;
}
export type CameraImpl = CameraApi & {
  update(timeMs: number, deltaMs: number): void;
  destroy(): void;
};

export function createCamera(scene: Phaser.Scene, d: CameraDeps): CameraImpl {
  const cam = scene.cameras.main;
  cam.setRoundPixels(true);
  cam.removeBounds(); // we clamp ourselves (x) and bottom-anchor (y)
  let mode: CameraMode = (d.registry.get('cameraMode') as CameraMode | undefined) ?? 'follow';
  let fixedCenter: number | null = null; // preset / panTo target
  let returnMode: CameraMode = 'follow';
  let from = 0,
    elapsed = BLEND_MS,
    started = false;
  let panDone: (() => void) | null = null;
  let holdLeft = 0;
  let walkedAtSet = 0;

  // Zoom is an integer step of the canvas CSS scale handled by boot (3x -> 4x), not a fractional Phaser camera zoom.
  const zoom = () => 1;
  const liveCenter = () => fixedCenter ?? d.player.x;
  const targetScroll = () =>
    scrollForCenter(clampCenter(liveCenter(), cam.width, zoom(), d.layout.width), cam.width);

  const begin = () => {
    from = cam.scrollX;
    elapsed = d.calm() ? BLEND_MS : 0; // calm: jump cut
  };
  const api: CameraImpl = {
    get mode() {
      return mode;
    },
    setMode(m) {
      if (m === mode && fixedCenter === null) return;
      finishPan();
      mode = m;
      cam.setZoom(zoom());
      fixedCenter = m === 'left' || m === 'mid' || m === 'right' ? d.layout.cameraPresets[m] : null;
      walkedAtSet = d.player.x;
      d.registry.set('cameraMode', m);
      d.bus.emit('cameraMode', m);
      begin();
      started = true;
    },
    panTo(x, opts) {
      finishPan();
      returnMode = mode;
      fixedCenter = x;
      begin();
      started = true;
      holdLeft = opts?.holdMs ?? 0;
      return new Promise<void>((res) => {
        panDone = res;
      });
    },
    update(_t, dt) {
      if (started) {
        // Preset or pan target is held until the player starts walking again, then we glide back to follow.
        if (
          (mode === 'left' || mode === 'mid' || mode === 'right') &&
          Math.abs(d.player.x - walkedAtSet) > 3 &&
          d.player.isWalking
        ) {
          api.setMode('follow');
        }
        const settled = elapsed >= BLEND_MS;
        elapsed = Math.min(BLEND_MS, elapsed + Math.min(dt, 50));
        const target = targetScroll();
        const k = blend(elapsed, d.motion.easeInOut);
        const sx =
          fixedCenter === null && settled ? target : Math.round(from + (target - from) * k);
        cam.setScroll(sx, scrollYBottom(cam.height, zoom(), LOGICAL_H));
        if (panDone && elapsed >= BLEND_MS) {
          holdLeft -= dt;
          if (holdLeft <= 0) {
            const r = panDone;
            panDone = null;
            fixedCenter = null;
            mode = returnMode;
            r();
            begin();
          }
        }
      } else {
        started = true;
        cam.setZoom(zoom());
        cam.setScroll(targetScroll(), scrollYBottom(cam.height, zoom(), LOGICAL_H));
        elapsed = BLEND_MS;
      }
    },
    destroy() {
      finishPan();
    },
  };
  function finishPan() {
    if (panDone) {
      const r = panDone;
      panDone = null;
      r();
    }
  }
  if (mode === 'left' || mode === 'mid' || mode === 'right')
    fixedCenter = d.layout.cameraPresets[mode];
  cam.setZoom(zoom());
  cam.setScroll(targetScroll(), scrollYBottom(cam.height, zoom(), LOGICAL_H));
  started = true;
  elapsed = BLEND_MS;
  walkedAtSet = d.player.x;
  from = cam.scrollX;
  return api;
}
