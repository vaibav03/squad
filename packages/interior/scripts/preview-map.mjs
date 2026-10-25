#!/usr/bin/env node
// Standalone (no Phaser) renderer that composites demo.json the way the engine will:
//   ground, wall, furniture, then props + doors + characters y-sorted by their base, then overhead.
// usage: node preview-map.mjs <outPrefix[.png]> [--unlocked | --locked-council] [--closed] [--no-chars]
//                              [--crop=x,y,w,h (tiles)] [--scale=3] [--map=path] [--nolabels]
// writes <outPrefix>-1x.png and <outPrefix>-<scale>x.png (default scale 3).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pix, decodePNG } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) =>
  (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const outArg = args.find((a) => !a.startsWith('--'));
if (!outArg) {
  console.error('usage: preview-map.mjs <outPrefix> [flags]');
  process.exit(1);
}
const outPrefix = outArg.replace(/\.png$/, '');
const mapPath = resolve(opt('map', resolve(ROOT, 'assets/interior/maps/demo.json')));
const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const ts = map.tilesets[0];
const tilesImg = decodePNG(resolve(dirname(mapPath), ts.image));
const propsJson = JSON.parse(
  readFileSync(resolve(ROOT, 'assets/interior/placeholder/props.json'), 'utf8'),
).props;
const propsImg = decodePNG(resolve(ROOT, 'assets/interior/placeholder/props.png'));
const W = map.width,
  H = map.height,
  T = map.tilewidth;
const layer = (n) => map.layers.find((l) => l.name === n);

const canvas = new Pix(W * T, H * T);
canvas.rect(0, 0, canvas.w, canvas.h, [7, 15, 31, 255]);
const drawTiles = (name) => {
  const l = layer(name);
  l.data.forEach((g, i) => {
    if (!g) return;
    const t = g - ts.firstgid;
    canvas.blit(
      tilesImg,
      (i % W) * T,
      Math.floor(i / W) * T,
      (t % ts.columns) * T,
      Math.floor(t / ts.columns) * T,
      T,
      T,
    );
  });
};
['ground', 'wall', 'furniture'].forEach(drawTiles);

// y-sorted list
const sorted = [];
const drawProp = (name, x, bottom) => {
  const p = propsJson[name];
  if (!p) throw new Error(`no prop ${name}`);
  sorted.push({
    base: bottom,
    order: sorted.length,
    draw: () => canvas.blit(propsImg, x, bottom - p.h, p.x, p.y, p.w, p.h),
  });
};
for (const o of layer('props').objects) drawProp(o.name, o.x, o.y);
const council = flag('--unlocked') ? 'open' : 'locked';
for (const d of layer('doors').objects) {
  const pr = Object.fromEntries(d.properties.map((p) => [p.name, p.value]));
  const state = flag('--closed') ? (pr.locked ? 'locked' : 'closed') : pr.locked ? council : 'open';
  drawProp(`${pr.prop}.${state}`, pr.spriteX, pr.spriteY);
}
if (!flag('--no-chars')) {
  const chars = ['Boy', 'Cavegirl', 'Knight', 'EggGirl', 'Inspector', 'Hunter', 'Child'];
  layer('spawns').objects.forEach((o, i) => {
    const sheet = decodePNG(
      resolve(
        ROOT,
        `assets/pixel/characters/ninja-adventure-npcs-16px/${chars[i % chars.length]}/SpriteSheet.png`,
      ),
    );
    const x = o.x - 8;
    const bottom = o.y + 8;
    sorted.push({
      base: bottom,
      order: sorted.length,
      draw: () => canvas.blit(sheet, x, bottom - 16, 0, 0, 16, 16),
    });
  });
}
sorted.sort((a, b) => a.base - b.base || a.order - b.order).forEach((s) => s.draw());
drawTiles('overhead');

// crop + write
let view = canvas;
const crop = opt('crop', '');
if (crop) {
  const [cx, cy, cw, ch] = crop.split(',').map((n) => +n * T);
  view = new Pix(cw, ch);
  view.blit(canvas, 0, 0, cx, cy, cw, ch);
}
const scale = +opt('scale', 3);
view.save(`${outPrefix}-1x.png`);
view.scaled(scale).save(`${outPrefix}-${scale}x.png`);
console.log(`preview ${view.w}x${view.h} -> ${outPrefix}-1x.png, ${outPrefix}-${scale}x.png`);
