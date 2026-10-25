import { Raster } from '../../pixel/raster';
import { drawTextCentered } from '../../pixel/font';
import type { PaintOpts } from '../../contract';
import { put, type AssetInfo } from '../../assets';
import { lanternFrame } from '../../model/base';
import { dimmed, doorRing } from '../../art/landmark-a-kit';
import { MAX_LANTERNS, votesOf, type DebateStageState } from './state';

export const EXT_W = 197;
export const EXT_H = 145;
export const DOOR_X = 98;

/** Lantern i hangs under the bunting; centres span the curtain. */
export const lanternX = (i: number): number => Math.round(46 + i * 15.4);
export const LANTERN_TOP = 60;

/** One frame (0..2) of a lantern sprite; the cold copy for unlit lanterns. */
export function lanternArt(
  A: PaintOpts['assets'],
  kind: 'council' | 'dissent',
  n: number,
  lit: boolean,
): AssetInfo {
  const a = A.sheet(`ui.lantern-${kind}`, n);
  return lit ? a : { ...a, r: dimmed(a.r) };
}

/** Frame index of the 3-frame, 2 s lantern loop (steady middle frame in calm). */
export function lanternLoop(t: number, calm: boolean, phase = 0): number {
  return calm ? 1 : (Math.floor((t / 2000) * 3) + phase) % 3;
}

/**
 * Exterior (197x145): the composed open-air stage. Eight lanterns hang under the bunting and one
 * lights per ranked option (80 ms stagger); a split verdict flickers the red dissent lanterns.
 */
export function paintExterior(s: DebateStageState, o: PaintOpts): Raster {
  const A = o.assets;
  const r = new Raster(EXT_W, EXT_H);
  const open = s.access === 'open';
  const shut = s.access === 'locked';
  const base = A.image('landmark.debate-stage', shut ? 'locked' : 'active');
  r.blit(open || shut ? base.r : dimmed(base.r), 0, 0);
  // sign plate: cover the placeholder dashes, then the name
  const plate = r.get(84, 4);
  if (plate[3] > 0) {
    r.rect(80, 7, 40, 3, 'roof-shade');
    r.rect(80, 3, 40, 12, 'roof-shade');
  }
  drawTextCentered(r, 100, 6, 'DEBATE', open ? 'glow-core' : shut ? 'wall-shade' : 'wall-mid');
  if (shut) return r;
  if (open && s.ring) doorRing(r, A, DOOR_X, EXT_H - 2, o.t, o.calm);

  const votes = open ? votesOf(s) : 0;
  const flick = s.lantern === 'flicker';
  const f = lanternFrame(s, o);
  for (let i = 0; i < MAX_LANTERNS; i++) {
    const age = s.rank ? o.t - s.rank.since - (o.calm ? 0 : i * 80) : -1;
    const lit = i < votes && age >= 0;
    const kind = flick && lit ? 'dissent' : 'council';
    const n = lit ? (flick ? (f + i) % 3 : lanternLoop(o.t, o.calm, i)) : 1;
    put(r, lanternArt(A, kind, n, lit), lanternX(i), LANTERN_TOP);
    if (lit)
      r.glow(lanternX(i), LANTERN_TOP + 8, 9, kind === 'dissent' ? 'alert' : 'violet', 0.5, 3);
  }
  return r;
}
