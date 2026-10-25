import type { Raster } from '../../pixel/raster';
import { put } from '../../assets';
import { triangle, visibleBubbles } from '../../model/base';
import type { PaintOpts } from '../../contract';
import {
  chatDots,
  doorRing,
  exteriorBase,
  lightPool,
  lookOf,
  type ExtSpec,
  type LbState,
} from '../../art/landmark-b-kit';

export const SPEC: ExtSpec = { id: 'landmark.rubric-courthouse', doorX: 61, mx: 8, mt: 16 };
export const EXT_W = 123 + 2 * SPEC.mx;
export const EXT_H = 101 + SPEC.mt;
export const DOOR_X = SPEC.doorX + SPEC.mx;

/** Window centres (sprite coordinates) for the warm gold light against the cool stone. */
const WINDOWS = [26, 44, 79, 97] as const;

/** Exterior (139x117): composed courthouse; warm window pools, the judge on the steps, door ring. */
export function paintExterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const { r, door, ox, oy } = exteriorBase(s, o, SPEC);
  const a = o.assets;
  if (look.lit) {
    const k = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    for (const wx of WINDOWS) lightPool(r, ox + wx, oy + 64, 8, 12, 'glow', 0.4 * k, 3);
    lightPool(r, door.x, door.y - 14, 10, 16, 'glow', 0.35 * k, 3);
  }
  if (look.awake && (s.occupant === 'waiting' || s.occupant === 'in_call')) {
    const f = a.frame(
      'mediator',
      s.occupant === 'waiting' ? 'wave' : 'talk',
      o.calm ? 0 : Math.floor(o.t / 250) % 2,
    );
    put(r, f, ox + 112, door.y - 1, { flipX: true });
  }
  if (s.ring && look.awake) doorRing(r, a, door.x, door.y - 1, o);
  if (look.awake && visibleBubbles(s, o).length > 0) chatDots(r, a, door.x, oy + 6, o);
  return r;
}
