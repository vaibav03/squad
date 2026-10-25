import { Raster } from '../../pixel/raster';
import type { PaintOpts } from '../../contract';
import { put } from '../../assets';
import { dimmed, doorRing } from '../../art/landmark-a-kit';
import { boothGlows, type PanicBoothState } from './state';

export const EXT_W = 33;
export const EXT_H = 60;
export const DOOR_X = 16;

/**
 * Exterior (33x60): the composed phone booth. 'off' by day, 'glow' at night and while Step Diff
 * runs or a call is up (the glow art carries its own light spill), 'locked' when out of service.
 */
export function paintExterior(s: PanicBoothState, o: PaintOpts): Raster {
  const A = o.assets;
  const r = new Raster(EXT_W, EXT_H);
  const open = s.access === 'open';
  const glow = boothGlows(s);
  const variant = s.access === 'locked' ? 'locked' : glow ? 'glow' : 'off';
  const base = A.image('landmark.panic-booth', variant);
  const art = open || variant === 'locked' ? base : { ...base, r: dimmed(base.r) };
  // all variants share the booth; the glow art is 5 px wider and brings its own anchor
  put(r, art, DOOR_X, EXT_H - 1);
  if (variant === 'locked') return r;
  if (open && s.ring) doorRing(r, A, DOOR_X, EXT_H - 2, o.t, o.calm);
  return r;
}
