import { Raster } from '../../pixel/raster';
import type { PaintOpts } from '../../contract';
import { put } from '../../assets';
import { lanternFrame, triangle } from '../../model/base';
import { dimmed, doorRing } from '../../art/landmark-a-kit';
import type { RoundTableState } from './state';

export const EXT_W = 124;
export const EXT_H = 94;
export const DOOR_X = 62;

/** Where the verdict lantern hangs: under the right eave, between the post and the map. */
const LANTERN = { x: 98, y: 42 };

/**
 * Exterior (124x94): the composed pavilion, wine roof over the table with next semester's map.
 * A council run lights the map; the verdict lantern hangs at the eave (red and flickering on a
 * dissent). Waiting-for-you rings the door.
 */
export function paintExterior(s: RoundTableState, o: PaintOpts, inSession: boolean): Raster {
  const A = o.assets;
  const r = new Raster(EXT_W, EXT_H);
  const open = s.access === 'open';
  const shut = s.access === 'locked';
  const base = A.image('landmark.round-table-pavilion', shut ? 'locked' : 'active');
  r.blit(open || shut ? base.r : dimmed(base.r), 0, 0);
  if (shut) return r;
  if (open && s.ring) doorRing(r, A, DOOR_X, EXT_H - 2, o.t, o.calm);
  if (open && s.lantern !== 'off') {
    const f = lanternFrame(s, o);
    const kind = s.lantern === 'flicker' ? 'dissent' : 'council';
    const n = s.lantern === 'flicker' ? f : o.calm ? 1 : Math.floor((o.t / 2000) * 3) % 3;
    r.vline(LANTERN.x, 36, LANTERN.y - 36, 'wood-dark');
    put(r, A.sheet(`ui.lantern-${kind}`, n), LANTERN.x, LANTERN.y);
    r.glow(
      LANTERN.x,
      LANTERN.y + 8,
      10,
      kind === 'dissent' ? 'alert' : 'violet',
      f === 0 ? 0.3 : 0.55,
      3,
    );
  }
  if (open && inSession) {
    // the table is in session: lamplight breathes over the map and the floor
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    r.glow(62, 52, 26, 'glow', 0.45 * a, 4);
    r.glow(62, 82, 40, 'glow', 0.14 * a, 3);
  }
  return r;
}
