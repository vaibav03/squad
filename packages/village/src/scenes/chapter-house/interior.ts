import { Raster } from '../pixel/raster';
import { drawText, textWidth } from '../pixel/font';
import type { PaintOpts } from '../contract';
import { put } from '../assets';
import { bubble } from '../art/bubble';
import { frameAt, glowNow, triangle, visibleBubbles, type BaseState } from '../model/base';
import { dimmed, swapped } from './exterior';
import { splitLabel, styleFor } from './style';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 60, y: 112 } as const;

const FLOOR = 112;
const CHAIR = { x: 111, y: FLOOR } as const;
const DESK = { x: 170, y: FLOOR } as const;
const LAMP = { x: 143, y: 72 } as const;

/** Quiz states take the classroom: the chalkboard carries the chapter and a tick or a cross. */
export function isQuiz(s: BaseState): boolean {
  return s.chalk.text !== '' || s.chalk.mark !== 'none';
}

function tint(r: Raster, a: number): void {
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) r.px(x, y, 'sky-deep', a);
}

function slate(r: Raster, o: PaintOpts, s: BaseState): void {
  // the composed board is 72x45 at x76..147,y19..63: wipe the sample chalk, write ours
  r.rect(76, 19, 72, 45, 'leaf-dark');
  r.dither(76, 19, 72, 3, 'leaf-lit', 0);
  const label = splitLabel(s.chalk.text || s.title);
  label.forEach((ln, i) => {
    const t = ln.slice(0, 8);
    drawText(r, 112 - Math.floor(textWidth(t) / 2), 26 + i * 8, t, 'wall-lit');
  });
  const ul = Math.max(...label.map((l) => textWidth(l.slice(0, 8))));
  r.hline(112 - (ul >> 1), 24 + label.length * 8 + 1, ul, 'cloud-lo');
  if (s.chalk.mark === 'tick') put(r, o.assets.image('prop.chalk-tick'), 112, 58);
  else if (s.chalk.mark === 'cross') put(r, o.assets.image('prop.chalk-cross'), 112, 58);
  else {
    r.hline(88, 54, 20, 'cloud-lo');
    r.hline(88, 58, 12, 'cloud-lo');
    r.hline(116, 54, 8, 'glow');
  }
}

/** Interior (224x128): study (desk, lamp, window) or the classroom for quiz moments. */
export function paintInterior(s: BaseState, o: PaintOpts): Raster {
  const A = o.assets;
  const st = styleFor(s.instance);
  const quiz = isQuiz(s);
  const open = s.access === 'open';
  const awake = open && s.occupant !== 'idle';
  const room = A.image(quiz ? 'interior.classroom' : 'interior.study').r;
  const r = new Raster(INT_W, INT_H);
  r.blit(room, 0, 0);
  if (quiz) slate(r, o, s);

  // the expert
  const at = quiz ? DESK : CHAIR;
  let anim = 'sit';
  let n = frameAt(o.t, 2, o.calm);
  let bob = 0;
  if (quiz) anim = 'idle';
  if (open && s.occupant === 'in_call') {
    anim = !o.calm && o.t - s.occupantSince < 1400 ? 'wave' : 'talk';
    n = frameAt(o.t, 8, o.calm);
    if (s.portrait && !o.calm) bob = Math.round(2 * triangle(o.t, 640));
  } else if (open && s.occupant === 'waiting') {
    anim = 'wave';
    n = frameAt(o.t, 2, o.calm);
  }
  const f = A.frame('expert', anim, n);
  put(r, { ...f, r: swapped(f.r, `x${st.look}`, st.shirt, 0) }, at.x, at.y - bob, { flipX: quiz });
  if (!open) tint(r, s.access === 'locked' ? 0.55 : 0.4);
  else if (!awake) tint(r, 0.22);

  // lamp light and the mastery lanterns
  if (open) {
    const flick = o.calm ? 1 : 0.92 + 0.08 * triangle(o.t, 4000);
    const lamp = quiz ? { x: 193, y: 30 } : LAMP;
    r.glow(lamp.x, lamp.y, 26, 'glow', (awake ? 0.5 : 0.25) * flick, 4);
  }
  const lit = !open ? -1 : Math.max(0, Math.min(5, Math.round(glowNow(s, o) * 5)));
  for (let i = 0; i < (lit < 0 ? 0 : 5); i++) {
    const x = 112 + (i - 2) * 13 - (quiz ? 0 : 6);
    const on = i < lit;
    const fr = A.sheet(
      'ui.lantern-street',
      on ? (o.calm ? 1 : (Math.floor(o.t / 330) + i) % 3) : 0,
    );
    put(r, on ? fr : { ...fr, r: dimmed(fr.r) }, x, 0, { alpha: on ? 1 : 0.8 });
    if (on) r.glow(x, 9, 8, 'glow', 0.3, 3);
  }
  if (open && s.occupant === 'idle') {
    const z = A.sheet('ui.zzz', o.calm ? 1 : Math.floor(o.t / 500) % 3);
    put(r, z, at.x + 6, at.y - 30);
  }
  if (s.portrait && open) {
    const a = o.calm ? 0.45 : 0.28 + 0.3 * triangle(o.t, 1100);
    r.ring(at.x, at.y - 15 - bob, 12, 14, 'glow', a);
  }

  for (const bv of visibleBubbles(s, o)) {
    const art = bubble(bv.b.text, bv.b.style, 22, 3);
    const bx = Math.max(4, Math.min(INT_W - 4 - art.r.w, Math.round(at.x - art.tail.x)));
    const by = Math.max(4, at.y - 31 - art.tail.y);
    r.blit(art.r, bx, by, { alpha: bv.alpha });
  }
  return r;
}
