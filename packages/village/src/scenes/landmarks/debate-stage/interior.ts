import { Raster } from '../../pixel/raster';
import { rng } from '../../pixel/rng';
import type { PaintOpts } from '../../contract';
import type { AssetLib } from '../../assets';
import { put } from '../../assets';
import { easeOut, progress } from '../../curves';
import { frameAt, lanternFrame, triangle, visibleBubbles } from '../../model/base';
import { isChair } from '../../council-hall/state';
import { bubbleChars } from '../../art/bubble';
import {
  EXPERT,
  dimmed,
  enterDrop,
  placeBubble,
  planksH,
  portraitFrame,
} from '../../art/landmark-a-kit';
import { MAX_LANTERNS, lecternOf, votesOf, type DebateStageState } from './state';
import { lanternArt, lanternLoop } from './exterior';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 122 };

/** Lectern centres (left, right) and the feet line on the stage boards. */
export const LECTERN_X = [50, 174] as const;
const FEET_Y = 112;
/** Cast: the two debaters (art faces right; the right one is flipped to face the stage). */
export const DEBATERS = ['council-chill', 'council-hard'] as const;
export const EXPERT_PERSONA = 'expert';
const LANTERN_TOP = 32;
const lanternAt = (i: number): number => Math.round(22 + i * 25.7);

const bgCache = new WeakMap<AssetLib, Raster>();

function background(A: AssetLib): Raster {
  const hit = bgCache.get(A);
  if (hit) return hit;
  const r = new Raster(INT_W, INT_H);
  // curtain wall with folds, a centre seam, bunched side drapes
  r.rect(0, 0, INT_W, 112, 'roof-wine');
  for (let x = 0; x < INT_W; x += 8) {
    r.vline(x + 3, 0, 112, 'roof-shade');
    r.vline(x + 4, 0, 112, 'roof-shade');
  }
  r.dither(0, 96, INT_W, 16, 'roof-shade', 0);
  r.vline(111, 12, 100, 'wood-dark');
  r.vline(112, 12, 100, 'roof-shade');
  for (const [x0, dir] of [
    [0, 1],
    [INT_W - 16, -1],
  ] as const) {
    r.rect(x0, 0, 16, 112, 'roof-shade');
    for (let y = 0; y < 112; y += 6) r.vline(x0 + (dir > 0 ? 4 : 11), y, 4, 'roof-wine');
    r.rect(x0 + (dir > 0 ? 12 : 0), 0, 4, 112, 'roof-wine');
    r.rect(x0, 70, 16, 2, 'glow'); // tie-back cord
    r.rect(x0 + (dir > 0 ? 12 : 1), 72, 3, 4, 'ember');
  }
  // roof underside: beams and a plank ceiling
  planksH(r, 0, 0, INT_W, 10, 'wood-dark', 'ink', undefined, 5, 40);
  r.rect(0, 10, INT_W, 3, 'wood');
  r.hline(0, 10, INT_W, 'wood-lit');
  r.hline(0, 12, INT_W, 'ink');
  for (let x = 6; x < INT_W; x += 28) r.rect(x, 0, 3, 10, 'wood');
  // bunting from the composed props
  put(r, A.image('prop.bunting-a'), 58, 31);
  put(r, A.image('prop.bunting-a'), 166, 31);
  put(r, A.image('prop.bunting-b'), 112, 26);
  // lantern rope
  r.hline(14, 30, 196, 'wood-dark');
  for (let x = 14; x < 210; x += 28) r.px(x, 31, 'wood-dark');
  // stage boards
  planksH(r, 0, 112, INT_W, 9, 'wood', 'wood-dark', 'wood-lit', 3, 46);
  r.hline(0, 112, INT_W, 'ink');
  r.rect(0, 120, INT_W, 3, 'wood-lit');
  r.hline(0, 122, INT_W, 'wood-dark');
  r.dither(0, 113, INT_W, 3, 'wood-dark', 0);
  // the audience: dark heads and shoulders against the stage lip
  r.rect(0, 123, INT_W, 5, 'ink');
  const rand = rng(23);
  for (let i = 0; i < 18; i++) {
    const x = 6 + i * 12 + Math.floor(rand() * 4);
    r.ellipse(x, 126, 4, 4, 'wood-dark');
    r.px(x - 2, 123, 'roof-shade');
    r.px(x - 1, 122, 'roof-shade');
  }
  // moderator block with a gavel and a brass bell
  r.rect(101, 104, 22, 16, 'wood');
  r.hline(101, 104, 22, 'wood-lit');
  r.vline(101, 104, 16, 'wood-lit');
  r.vline(122, 104, 16, 'wood-dark');
  r.hline(101, 119, 22, 'wood-dark');
  r.rect(105, 101, 7, 3, 'wood-dark');
  r.hline(105, 101, 7, 'wood-lit');
  r.line(114, 102, 118, 99, 'wood-lit');
  r.rect(115, 100, 5, 4, 'glow');
  r.px(116, 99, 'glow-core');
  bgCache.set(A, r);
  return r;
}

function lectern(r: Raster, cx: number): void {
  r.rect(cx - 12, 109, 25, 11, 'wood');
  r.vline(cx - 12, 109, 11, 'wood-lit');
  r.vline(cx + 12, 109, 11, 'wood-dark');
  r.rect(cx - 8, 111, 17, 7, 'wood-dark');
  r.frame(cx - 8, 111, 17, 7, 'wood-lit');
  r.hline(cx - 11, 119, 23, 'wood-dark');
  r.poly(
    [
      [cx - 14, 104],
      [cx + 14, 104],
      [cx + 12, 109],
      [cx - 12, 109],
    ],
    'wood-lit',
  );
  r.hline(cx - 14, 104, 29, 'glow');
  r.hline(cx - 12, 109, 25, 'wood-dark');
  r.rect(cx - 7, 103, 8, 1, 'wall-lit'); // notes
  r.rect(cx + 4, 103, 4, 1, 'wall-mid');
}

/** Interior (224x128): the stage seen from the audience; debaters at two lecterns, lanterns vote. */
export function paintInterior(s: DebateStageState, o: PaintOpts): Raster {
  const A = o.assets;
  const open = s.access === 'open';
  const shut = s.access === 'locked';
  const r = (open ? background(A) : dimmed(background(A))).clone();
  const bubbles = visibleBubbles(s, o);

  // lanterns on the rope
  const votes = open ? votesOf(s) : 0;
  const flick = s.lantern === 'flicker';
  const f = lanternFrame(s, o);
  for (let i = 0; i < MAX_LANTERNS; i++) {
    const age = s.rank ? o.t - s.rank.since - (o.calm ? 0 : i * 80) : -1;
    const lit = i < votes && age >= 0;
    const kind = flick && lit ? 'dissent' : 'council';
    const n = lit ? (flick ? (f + i) % 3 : lanternLoop(o.t, o.calm, i)) : 1;
    const x = lanternAt(i);
    r.vline(x, 31, LANTERN_TOP - 31, 'wood-dark');
    put(r, lanternArt(A, kind, n, lit), x, LANTERN_TOP);
    if (lit) r.glow(x, LANTERN_TOP + 8, 11, kind === 'dissent' ? 'alert' : 'violet', 0.55, 3);
  }

  // debaters behind their lecterns; whoever has a live speech bubble talks
  for (let side = 0; side < 2; side++) {
    const cx = LECTERN_X[side]!;
    const who = s.debaters[side];
    const talking = open && bubbles.some((v) => v.b.who === who && v.b.style !== 'announce');
    const a = talking
      ? A.frame(DEBATERS[side]!, 'talk', frameAt(o.t, 8, o.calm))
      : A.frame(DEBATERS[side]!, 'idle', frameAt(o.t, 2, o.calm));
    put(r, a, cx, FEET_Y, { flipX: side === 1 });
    lectern(r, cx);
  }
  if (open) {
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    r.glow(112, 108, 84, 'glow', 0.14 * a, 3);
    for (const cx of LECTERN_X) r.glow(cx, 96, 24, 'glow', 0.14 * a, 3);
  }
  if (shut) {
    r.rect(0, 70, INT_W, 6, 'wood');
    r.hline(0, 70, INT_W, 'wood-lit');
    r.line(0, 76, INT_W - 1, 71, 'wood-lit');
  }

  if (s.portrait && open) {
    const talking = bubbles.some((v) => v.b.who === EXPERT);
    r.blit(portraitFrame(A, EXPERT_PERSONA, talking, frameAt(o.t, 8, o.calm)), 101, 50);
  }

  const headTop = FEET_Y - 30;
  const debaterCount = bubbles.filter(
    (v) => v.b.who !== EXPERT && !isChair(v.b.who) && v.b.style !== 'announce',
  ).length;
  for (const v of bubbles) {
    const w = v.b.who;
    const drop = enterDrop(v, o.calm);
    if (v.b.style === 'announce') continue;
    if (w === EXPERT) {
      placeBubble(r, v.b.text, v.b.style, 112, 98 + drop, v.alpha, { maxChars: 30, maxLines: 3 });
    } else if (isChair(w)) {
      placeBubble(r, v.b.text, v.b.style, 112, 98 + drop, v.alpha, { maxChars: 30, maxLines: 3 });
    } else {
      const side = lecternOf(s.debaters, w);
      placeBubble(r, v.b.text, v.b.style, LECTERN_X[side]!, headTop + drop, v.alpha, {
        maxChars: bubbleChars(debaterCount, 24, 30),
        maxLines: 3,
      });
    }
  }
  paintVerdict(r, s, o);
  return r;
}

function paintVerdict(r: Raster, s: DebateStageState, o: PaintOpts): void {
  const v = s.verdict;
  if (!v) return;
  const age = o.t - v.since;
  if (age < 0 || age > 8000 + 120) return;
  const enter = o.calm ? 1 : easeOut(progress(o.t, v.since, 240));
  const exit = age > 8000 ? 1 - (age - 8000) / 120 : 1;
  placeBubble(r, v.text, 'announce', 112, 98, Math.max(0, Math.min(enter, exit)), {
    maxChars: 30,
    maxLines: 4,
  });
}
