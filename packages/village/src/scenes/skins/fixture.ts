import { Raster } from '../pixel/raster';
import { encodePng } from '../tools/png';
import { buildZip } from './zip';
import type { Recipe } from './types';

/** A solid-colour synthetic sheet. Test fixtures never contain pack art. */
export function solidSheet(
  w: number,
  h: number,
  rgb: [number, number, number],
  alpha = 255,
): Raster {
  const r = new Raster(w, h);
  for (let i = 0; i < w * h; i++) {
    r.data[i * 4] = rgb[0];
    r.data[i * 4 + 1] = rgb[1];
    r.data[i * 4 + 2] = rgb[2];
    r.data[i * 4 + 3] = alpha;
  }
  return r;
}

export const FIXTURE_RECIPE: Recipe = {
  id: 'fixture-chamber',
  scene: 'council-hall',
  title: 'Fixture',
  credit: 'World art: Modern Interiors by LimeZu',
  size: [224, 128],
  sheets: { a: 'fake/a_16x16.png', b: 'fake/sub/b_16x16.png' },
  sprites: {
    floor: { sheet: 'a', x: 0, y: 0, w: 16, h: 16 },
    tl: { sheet: 'b', x: 0, y: 0, w: 8, h: 16 },
    tm: { sheet: 'b', x: 8, y: 0, w: 8, h: 16 },
    tr: { sheet: 'b', x: 16, y: 0, w: 8, h: 16 },
  },
  layers: {
    bg: [
      { op: 'tile', sprite: 'floor', x: 0, y: 0, w: 224, h: 128 },
      { op: 'fill', x: 0, y: 0, w: 224, h: 4, color: '#102030', alpha: 0.5 },
    ],
    mid: [{ op: 'span', left: 'tl', mid: 'tm', right: 'tr', x: 64, y: 84, w: 96 }],
  },
  layout: {
    seats: [
      { x: 50, y: 103, flip: false },
      { x: 112, y: 121, flip: false },
      { x: 174, y: 103, flip: true },
    ],
    chair: { x: 112, y: 89 },
    rowX: [50, 112, 174],
    rowTip: 66,
    lantern: [112, 30],
    planSheet: [37, 4],
    floorRing: false,
    entry: { x: 112, y: 120 },
  },
};

/** Bytes of a synthetic pack (zip) that satisfies FIXTURE_RECIPE; `omit` drops files to test the error path. */
export function fixturePackZip(omit: string[] = []): Buffer {
  const files: Record<string, Buffer> = {
    'fake/a_16x16.png': encodePng(solidSheet(32, 32, [90, 40, 160])),
    'fake/sub/b_16x16.png': encodePng(solidSheet(24, 16, [210, 170, 90])),
  };
  for (const o of omit) delete files[o];
  return buildZip(files);
}
