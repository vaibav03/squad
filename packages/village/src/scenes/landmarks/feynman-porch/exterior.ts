import { Raster } from '../../pixel/raster';
import type { PaintOpts } from '../../contract';
import { put } from '../../assets';
import { dimmed, doorRing } from '../../art/landmark-a-kit';
import type { FeynmanPorchState } from './state';

/** Room above the cottage for the chimney smoke. */
const TOP = 24;
export const EXT_W = 114;
export const EXT_H = 91 + TOP;
export const DOOR_X = 67;
const CHIMNEY = { x: 99, y: TOP + 1 };

/**
 * Exterior (114x115): the composed porch cottage. Open: amber windows and lantern, smoke from the
 * chimney (steady in calm). Waiting-for-you rings the door.
 */
export function paintExterior(s: FeynmanPorchState, o: PaintOpts): Raster {
  const A = o.assets;
  const r = new Raster(EXT_W, EXT_H);
  const open = s.access === 'open';
  const shut = s.access === 'locked';
  const base = A.image('landmark.feynman-porch', shut ? 'locked' : 'active');
  r.blit(open || shut ? base.r : dimmed(base.r), 0, TOP);
  if (shut) return r;
  if (open) {
    const n = o.calm ? 2 : Math.floor(o.t / 200) % 8;
    put(r, A.sheet('fx.chimney-smoke', n), CHIMNEY.x, CHIMNEY.y);
    if (s.ring) doorRing(r, A, DOOR_X, EXT_H - 2, o.t, o.calm);
    // lamplight spilling from the porch lantern and the front window (steady)
    r.glow(38, TOP + 52, 16, 'glow', 0.3, 3);
    r.glow(95, TOP + 58, 14, 'glow', 0.3, 3);
  }
  return r;
}
