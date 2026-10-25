#!/usr/bin/env node
// Generates the placeholder interior art (deterministic, no randomness without fixed seeds):
//   assets/interior/placeholder/tileset.png + tileset.json   (16x16 terrain tiles, 16 columns)
//   assets/interior/placeholder/props.png + props.json       (furniture / decor atlas)
//   assets/interior/placeholder/palette.json, docs/design/palette-interiors.json
//   assets/interior/placeholder/_contact.png                 (contact sheet of every tile and prop)
// Original CC0 pixel art, no third-party pixels. The licensed pack replaces it later via the same names.
//
// ---------------------------------------------------------------- NAMING / CONVENTIONS (see also tiles.mjs, props.mjs)
// Tiled gid = tileset index + 1. Wall = 3 rows: wall.cap.* / wall.face.hi.* / wall.face.* (lower, above floor).
// Prop foot = blocking footprint in sprite pixels (tile-aligned in map space, bottom of the sprite).
// foot w=h=0 means "non-blocking decor / wall-hung".
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pix, hex } from './lib/png.mjs';
import { buildTiles } from './lib/tiles.mjs';
import { buildProps } from './lib/props.mjs';
import { drawContact } from './lib/contact.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../../..');
const OUT = resolve(ROOT, 'assets/interior/placeholder');

// ---------------------------------------------------------------- PALETTE (48 colours, daylight interiors)
// Soft, slightly desaturated warm palette (cream/tan floors, warm wood, muted teal and pastel accents,
// dark brown-purple outlines). Warm roughly 60 / cool 40. Every opaque pixel in tileset/props uses
// exactly these colours; soft shadows are translucent `line`-ish ink veils on top.
export const PALETTE = {
  // outlines
  line: '#3b2a3a',
  'line-soft': '#5a4254',
  // wood (warm)
  'wood-hi': '#e3b57e',
  'wood-lit': '#cb925e',
  'wood-mid': '#a9744c',
  wood: '#8b5c44',
  'wood-dark': '#5f3f40',
  'wood-deep': '#43292f',
  // cream / tan floors and paper
  'cream-hi': '#fcf3da',
  cream: '#f1e2bb',
  'cream-mid': '#e0c997',
  tan: '#c8ab78',
  'tan-dark': '#a58a5d',
  // neutral plaster / stone trim
  'trim-hi': '#f8f1e3',
  trim: '#e7ddca',
  'trim-sh': '#c6baa6',
  'trim-dk': '#9a8c82',
  // room accent families: commons peach, classroom teal, library moss, council plum
  'peach-hi': '#f6d6b2',
  peach: '#eab990',
  'peach-sh': '#d09b78',
  'teal-hi': '#a6d8cc',
  teal: '#62b4ac',
  'teal-sh': '#418c8e',
  'teal-dk': '#2d6872',
  'moss-hi': '#a4bf82',
  moss: '#789a66',
  'moss-sh': '#567a55',
  'plum-hi': '#c0a8d6',
  plum: '#9680ba',
  'plum-sh': '#6f5c98',
  'plum-dk': '#4d4072',
  // foliage
  'leaf-hi': '#92d07e',
  leaf: '#5eab6a',
  'leaf-dk': '#3d7c59',
  'leaf-line': '#25503f',
  // pastel primaries for toys / cloth
  red: '#d9625c',
  yellow: '#f3c352',
  blue: '#5b90d1',
  orange: '#e98a4b',
  // lamps, windows, carpet, chalkboard
  'glow-hi': '#fff4bc',
  glow: '#ffd674',
  sky: '#a0d5ef',
  'sky-hi': '#dbf1f9',
  wine: '#8c3b57',
  'wine-hi': '#b25c75',
  'wine-dk': '#5f2742',
  board: '#305f5d',
  'board-lit': '#427c76',
};
if (Object.keys(PALETTE).length > 48) throw new Error('palette over budget');
export const C = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hex(v)]));

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};

export function main() {
  // ------------------------------------------------ tileset
  const tiles = buildTiles(C);
  const COLS = 16;
  const rows = Math.ceil(tiles.length / COLS);
  const sheet = new Pix(COLS * 16, rows * 16);
  const index = {};
  tiles.forEach((t, i) => {
    if (index[t.name] !== undefined) throw new Error(`duplicate tile ${t.name}`);
    index[t.name] = i;
    sheet.blit(t.pix, (i % COLS) * 16, Math.floor(i / COLS) * 16);
  });
  sheet.save(resolve(OUT, 'tileset.png'));
  write(
    resolve(OUT, 'tileset.json'),
    JSON.stringify(
      {
        name: 'placeholder-interior',
        tileSize: 16,
        image: 'tileset.png',
        columns: COLS,
        imageWidth: sheet.w,
        imageHeight: sheet.h,
        tileCount: tiles.length,
        tiles: index,
      },
      null,
      1,
    ) + '\n',
  );

  // ------------------------------------------------ props
  const props = buildProps(C);
  // shelf pack (rows), 1px gutter-free but aligned on 2px so nothing bleeds when sampled
  const ATLAS_W = 512;
  let x = 0,
    y = 0,
    rowH = 0;
  const placed = [];
  for (const pr of props) {
    if (x + pr.pix.w > ATLAS_W) {
      x = 0;
      y += rowH + 2;
      rowH = 0;
    }
    placed.push({ ...pr, x, y });
    x += pr.pix.w + 2;
    rowH = Math.max(rowH, pr.pix.h);
  }
  const atlasH = Math.max(16, y + rowH);
  const atlas = new Pix(ATLAS_W, atlasH);
  const propJson = {};
  for (const pr of placed) {
    atlas.blit(pr.pix, pr.x, pr.y);
    const { w, h } = pr.pix;
    const f = pr.foot;
    if (f.w % 16 || f.h % 16 || f.x % 16 || (f.w && (f.x + f.w > w || f.y + f.h !== h)))
      throw new Error(`bad foot for ${pr.name}`);
    propJson[pr.name] = { x: pr.x, y: pr.y, w, h, foot: f, tall: !!pr.tall };
  }
  atlas.save(resolve(OUT, 'props.png'));
  write(
    resolve(OUT, 'props.json'),
    JSON.stringify(
      {
        name: 'placeholder-interior-props',
        image: 'props.png',
        imageWidth: ATLAS_W,
        imageHeight: atlasH,
        props: propJson,
        notes: props.notes ?? {},
      },
      null,
      1,
    ) + '\n',
  );

  // ------------------------------------------------ palette docs
  const pal =
    JSON.stringify(
      {
        name: 'interiors-placeholder',
        count: Object.keys(PALETTE).length,
        note: 'Daylight interior palette used by gen-tileset.mjs (soft warm, ~60/40 warm/cool). Source of truth for placeholder art.',
        colors: PALETTE,
      },
      null,
      1,
    ) + '\n';
  write(resolve(OUT, 'palette.json'), pal);
  write(resolve(ROOT, 'docs/design/palette-interiors.json'), pal);

  // ------------------------------------------------ contact sheet
  drawContact(resolve(OUT, '_contact.png'), { tiles, tileSheet: sheet, index, placed, atlas, C });
  console.log(
    `tileset: ${tiles.length} tiles (${sheet.w}x${sheet.h}), props: ${placed.length} (${ATLAS_W}x${atlasH})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
