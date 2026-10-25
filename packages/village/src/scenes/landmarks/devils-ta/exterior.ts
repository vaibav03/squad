import type { Raster } from '../../pixel/raster';
import { put } from '../../assets';
import { triangle, visibleBubbles } from '../../model/base';
import type { PaintOpts } from '../../contract';
import {
  chatDots,
  doorRing,
  exteriorBase,
  hornsOn,
  lightPool,
  lookOf,
  type ExtSpec,
  type LbState,
} from '../../art/landmark-b-kit';

export const SPEC: ExtSpec = { id: 'landmark.devils-ta-cave', doorX: 68, mx: 8, mt: 14 };
export const EXT_W = 134 + 2 * SPEC.mx;
export const EXT_H = 97 + SPEC.mt;
export const DOOR_X = SPEC.doorX + SPEC.mx;

/** Eye pairs in the dark of the cave mouth (sprite coordinates): [x, y]. */
const EYES = [
  [57, 70],
  [78, 62],
  [82, 76],
] as const;

/** A pitchfork stuck in the ground (1x): wood shaft, three iron prongs. */
function pitchfork(r: Raster, x: number, groundY: number, awake: boolean): void {
  r.vline(x, groundY - 20, 20, awake ? 'wood-lit' : 'wood');
  r.hline(x - 3, groundY - 24, 7, awake ? 'wall-lit' : 'wall-shade');
  for (const px of [x - 3, x, x + 3])
    r.vline(px, groundY - 27, 4, awake ? 'wall-lit' : 'wall-shade');
  r.px(x, groundY - 28, 'wall-lit');
}

/** Exterior (150x111): composed cave; ember and violet eyes in the dark, pitchfork, horned peak. */
export function paintExterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const { r, door, ox, oy } = exteriorBase(s, o, SPEC);
  const a = o.assets;
  pitchfork(r, ox + 120, door.y, look.awake);
  if (look.lit) {
    const k = o.calm ? 1 : triangle(o.t, 3000);
    // eyes blink shut once per cycle (never faster than 1 Hz); steady in calm
    const closed = !o.calm && Math.floor(o.t / 200) % 15 === 0;
    EYES.forEach(([x, y], i) => {
      if (closed && i === 1) return;
      const col = i === 0 ? 'violet' : 'ember';
      r.px(ox + x, oy + y, col);
      r.px(ox + x + 3, oy + y, col);
      r.glow(ox + x + 1, oy + y, 5, col, 0.3 + 0.2 * k, 2);
    });
    lightPool(r, door.x, door.y - 12, 12, 14, 'ember', 0.35 * (0.8 + 0.2 * k), 3);
  }
  if (look.awake && (s.occupant === 'waiting' || s.occupant === 'in_call')) {
    const f = a.frame(
      'ta',
      s.occupant === 'waiting' ? 'wave' : 'talk',
      o.calm ? 0 : Math.floor(o.t / 250) % 2,
    );
    put(r, f, ox + 100, door.y - 1, { flipX: true });
    hornsOn(r, f, ox + 100, door.y - 1, true);
  }
  if (s.ring && look.awake) doorRing(r, a, door.x, door.y - 1, o);
  if (look.awake && visibleBubbles(s, o).length > 0) chatDots(r, a, door.x, oy + 2, o);
  return r;
}
