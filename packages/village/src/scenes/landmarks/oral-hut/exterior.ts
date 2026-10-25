import type { Raster } from '../../pixel/raster';
import { put } from '../../assets';
import { visibleBubbles } from '../../model/base';
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
import { triangle } from '../../model/base';

export const SPEC: ExtSpec = { id: 'landmark.oral-exam-hut', doorX: 42, mx: 8, mt: 16 };
export const EXT_W = 73 + 2 * SPEC.mx;
export const EXT_H = 77 + SPEC.mt;
export const DOOR_X = SPEC.doorX + SPEC.mx;

/** Exterior (89x93): composed hut + chimney smoke, the examiner at the door, cold lamp light. */
export function paintExterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const { r, door, ox, oy } = exteriorBase(s, o, SPEC);
  const a = o.assets;
  if (look.awake) {
    // chimney smoke, 8 frames at 5 fps (frozen in calm)
    const n = o.calm ? 3 : Math.floor((o.t / 1000) * 5);
    put(r, a.sheet('fx.chimney-smoke', n), ox + 54, oy + 3, { alpha: 0.9 });
  }
  if (look.lit) {
    // the strict lamp is cold: a pale halo on the open door, never warm
    const k = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    lightPool(r, door.x, door.y - 2, 16, 3, 'cloud-hi', 0.5 * k, 3);
  }
  if (look.awake && (s.occupant === 'waiting' || s.occupant === 'in_call')) {
    // the examiner steps out beside the door, stopwatch in hand
    const f = a.frame(
      'examiner',
      s.occupant === 'waiting' ? 'wave' : 'talk',
      o.calm ? 0 : Math.floor(o.t / 250) % 2,
    );
    put(r, f, ox + 66, door.y - 1, { flipX: true });
  }
  if (s.ring && look.awake) doorRing(r, a, door.x, door.y - 2, o);
  if (look.awake && visibleBubbles(s, o).length > 0) chatDots(r, a, door.x, oy + 12, o);
  return r;
}
