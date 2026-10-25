import type Phaser from 'phaser';
import type { AssetSpec, Glow, Lighting, WorldLayout, WorldTime } from './api';
import { DEPTH, GROUND_Y } from './api';

const P = 'assets/pixel/composed/props/';
const names = [
  'tree-1',
  'tree-2',
  'tree-3',
  'tree-4',
  'tree-5',
  'tree-6',
  'pine-1',
  'pine-2',
  'lamp-post',
  'lamp-post-lit',
  'bush-1',
  'bush-2',
  'tuft-a',
  'tuft-b',
  'tuft-c',
  'tuft-d',
  'flower-1',
  'flower-2',
  'flower-3',
  'rock-big',
  'rock-small',
  'fence',
  'mailbox',
  'signpost-board',
  'signpost-arrow',
  'bench',
  'stump',
  'barrel',
  'crate-a',
];
export const ASSETS: AssetSpec[] = names.map((n) => ({
  type: 'image',
  key: `prop-${n}`,
  path: `${P}${n}.png`,
}));

/** Deterministic PRNG so every load (and every replay/screenshot) is identical. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Placement {
  key: string;
  x: number;
  y: number;
  depth: number;
  flip?: boolean;
  lamp?: boolean;
}

/** Pure: where ambient set dressing goes. Keeps clear of building footprints and leaves breathing room around doors. */
export function planDressing(layout: WorldLayout, seed = 7): Placement[] {
  const rnd = mulberry32(seed);
  const out: Placement[] = [];
  const clear = (x: number, pad: number) =>
    layout.slots.every((s) => s.kind === 'spawn' || Math.abs(x - s.x) > s.w / 2 + pad);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  // lamp posts: rhythm every ~230 px, placed in the gaps between slots
  for (let x = 40; x < layout.width - 20; x += 230) {
    let lx = x + Math.round((rnd() - 0.5) * 40);
    for (let tries = 0; tries < 12 && !clear(lx, 22); tries++) lx += 14;
    if (clear(lx, 22))
      out.push({ key: 'lamp-post-lit', x: lx, y: GROUND_Y - 4, depth: DEPTH.props, lamp: true });
  }
  // trees and pines behind the path, clustered, never in front of doors
  for (let x = 20; x < layout.width; x += 52 + Math.floor(rnd() * 70)) {
    if (!clear(x, 8) || rnd() < 0.3) continue;
    const key =
      rnd() < 0.28
        ? pick(['pine-1', 'pine-2'])
        : pick(['tree-1', 'tree-2', 'tree-3', 'tree-4', 'tree-5', 'tree-6']);
    out.push({
      key,
      x,
      y: 244 + Math.floor(rnd() * 4),
      depth: DEPTH.behindBuildings + 3,
      flip: rnd() < 0.5,
    });
  }
  // low dressing on the verge: bushes, tufts, flowers, rocks
  for (let x = 12; x < layout.width; x += 18 + Math.floor(rnd() * 34)) {
    const r = rnd();
    const key =
      r < 0.2
        ? pick(['bush-1', 'bush-2'])
        : r < 0.7
          ? pick(['tuft-a', 'tuft-d'])
          : r < 0.9
            ? pick(['flower-1', 'flower-2', 'flower-3'])
            : pick(['rock-small', 'rock-big']);
    if (out.some((o) => o.lamp && Math.abs(o.x - x) < 26)) continue;
    if (!clear(x, 4) && rnd() < 0.7) continue;
    out.push({
      key,
      x,
      y: 243 + Math.floor(rnd() * 5),
      depth: DEPTH.behindBuildings + 4,
      flip: rnd() < 0.5,
    });
  }
  return out.sort((a, b) => a.x - b.x);
}

export function createDressing(
  scene: Phaser.Scene,
  d: { layout: WorldLayout; time: WorldTime; lighting: Lighting; has: (k: string) => boolean },
) {
  const lamps: Array<{ img: Phaser.GameObjects.Image; glow: Glow }> = [];
  const objs: Phaser.GameObjects.Image[] = [];
  for (const p of planDressing(d.layout)) {
    const key = `prop.${p.key}`;
    if (!d.has(key)) continue;
    const img = scene.add
      .image(p.x, p.y, key)
      .setOrigin(0.5, 1)
      .setDepth(p.depth)
      .setFlipX(!!p.flip);
    objs.push(img);
    if (p.lamp)
      lamps.push({
        img,
        glow: d.lighting.addGlow({ x: p.x, y: p.y - 50, radius: 38, intensity: 0.8 }),
      });
  }
  let lit = true;
  return {
    update() {
      const nowLit = d.time.nightness > 0.45;
      if (nowLit === lit) return;
      lit = nowLit;
      for (const l of lamps) l.img.setTexture(lit ? 'prop.lamp-post-lit' : 'prop.lamp-post');
    },
    destroy() {
      objs.forEach((o) => o.destroy());
      lamps.forEach((l) => l.glow.destroy());
    },
  };
}
