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

export const SPEC: ExtSpec = { id: 'landmark.exam-oracle', doorX: 31, mx: 8, mt: 20 };
export const EXT_W = 63 + 2 * SPEC.mx;
export const EXT_H = 131 + SPEC.mt;
export const DOOR_X = SPEC.doorX + SPEC.mx;

/** Window slits (sprite coordinates) that take the violet starlight. */
const SLITS = [
  [23, 66],
  [40, 91],
] as const;

/** Exterior (79x151): composed tower + the glowing crystal eye, its orbiting dots, violet slits. */
export function paintExterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const { r, door, ox, oy } = exteriorBase(s, o, SPEC);
  const a = o.assets;
  if (look.awake) {
    const pulse = o.calm ? 0.5 : triangle(o.t, 3000);
    const cx = ox + 31;
    const cy = oy - 9;
    // crystal eye: violet shell, pale iris, glow-core pupil
    r.ellipse(cx, cy, 4, 4, 'violet');
    r.ellipse(cx, cy, 2, 2, 'cloud-hi');
    r.px(cx, cy, 'glow-core');
    r.px(cx - 3, cy - 1, 'cloud-hi');
    r.glow(cx, cy, 9 + Math.round(pulse * 2), 'violet', 0.35 + 0.25 * pulse, 3);
    r.glow(cx, cy, 4, 'glow-core', 0.25 + 0.25 * pulse, 2);
    // three dots orbit the crystal (6 s); fixed positions in calm
    for (let i = 0; i < 3; i++) {
      const ang = (o.calm ? 0.6 : (o.t / 6000) * Math.PI * 2) + (i * Math.PI * 2) / 3;
      const px = cx + Math.round(Math.cos(ang) * 11);
      const py = cy + Math.round(Math.sin(ang) * 3);
      r.px(px, py, i === 0 ? 'glow-core' : 'cloud-hi');
    }
  }
  if (look.lit) {
    const k = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    for (const [x, y] of SLITS) lightPool(r, ox + x, oy + y, 8, 8, 'violet', 0.45 * k, 3);
    lightPool(r, door.x, door.y - 14, 9, 14, 'violet', 0.3 * k, 3);
  }
  if (look.awake && (s.occupant === 'waiting' || s.occupant === 'in_call')) {
    const f = a.frame(
      'chairman',
      s.occupant === 'waiting' ? 'wave' : 'talk',
      o.calm ? 0 : Math.floor(o.t / 250) % 2,
    );
    put(r, f, ox + 60, door.y - 1, { flipX: true });
  }
  if (s.ring && look.awake) doorRing(r, a, door.x, door.y - 1, o);
  if (look.awake && visibleBubbles(s, o).length > 0) chatDots(r, a, ox + 54, oy + 4, o);
  return r;
}
