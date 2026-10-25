import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listPersonas } from '../personas/index.js';
import {
  ANCHORS,
  FRAME_CELL,
  ORIGIN_Y,
  loadCastAtlas,
  loadFrames,
  phaserAnims,
  repoRoot,
  spritesDir,
} from './index.js';
import { readPng } from './png.js';

const palette = new Set(
  Object.values(
    JSON.parse(readFileSync(join(repoRoot(), 'docs/design/palette.json'), 'utf8')) as Record<
      string,
      string
    >,
  ).map((h) => h.toLowerCase().replace('#', '')),
);
const hex = (d: Uint8Array, i: number): string =>
  [d[i]!, d[i + 1]!, d[i + 2]!].map((n) => n.toString(16).padStart(2, '0')).join('');

function assertPaletteLocked(path: string): void {
  const png = readPng(path);
  const bad = new Set<string>();
  for (let i = 0; i < png.width * png.height; i++) {
    const a = png.data[i * 4 + 3]!;
    if (a !== 0 && a !== 255) bad.add(`alpha${a}`);
    else if (a === 255 && !palette.has(hex(png.data, i * 4))) bad.add(hex(png.data, i * 4));
  }
  expect([...bad], `${path} has off-palette pixels`).toEqual([]);
}

const ids = listPersonas().map((p) => p.id);
const NAME = /^(idle|walk|talk)_(r|f)_\d$/;

describe('cast atlas', () => {
  it('has a sprites dir with assets (run build_cast.py)', () => {
    expect(existsSync(join(spritesDir(), 'cast.json')), 'assets/sprites/cast.json missing').toBe(
      true,
    );
  });

  it.each(ids)('%s: per-persona atlas is valid, in bounds and palette-locked', (id) => {
    const f = loadFrames(id);
    expect(f.id).toBe(id);
    expect(f.cell).toEqual(FRAME_CELL);
    expect(f.anchors).toEqual(ANCHORS);
    const sheet = join(spritesDir(), id, f.image);
    const png = readPng(sheet);
    for (const [name, r] of Object.entries(f.frames)) {
      expect(name).toMatch(NAME);
      expect(r.w).toBe(24);
      expect(r.h).toBe(24);
      expect(r.x + r.w, `${id}/${name} x out of bounds`).toBeLessThanOrEqual(png.width);
      expect(r.y + r.h).toBeLessThanOrEqual(png.height);
      // never an empty frame
      let opaque = 0;
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++)
          if (png.data[(y * png.width + x) * 4 + 3] === 255) opaque++;
      expect(opaque, `${id}/${name} is empty`).toBeGreaterThan(30);
    }
    for (const [anim, a] of Object.entries(f.anims)) {
      expect(anim).toMatch(/^(idle|walk|talk)_(r|f)$/);
      for (const n of a.frames)
        expect(f.frames[n], `${id}: anim ${anim} references missing ${n}`).toBeDefined();
    }
    expect(f.anims.walk_r!.frames).toHaveLength(4);
    expect(f.anims.talk_f!.frames).toHaveLength(2);
    expect(f.anims.idle_r!.frames).toHaveLength(2);
    assertPaletteLocked(sheet);
  });

  it('cast.json keys are the union of <id>/<frame> with feet pivots, and the image is palette-locked', () => {
    const atlas = loadCastAtlas();
    const want = new Set<string>();
    for (const id of ids)
      for (const n of Object.keys(loadFrames(id).frames)) want.add(`${id}/${n}`);
    expect(new Set(Object.keys(atlas.frames))).toEqual(want);
    const png = readPng(join(spritesDir(), atlas.meta.image));
    expect([png.width, png.height]).toEqual([atlas.meta.size.w, atlas.meta.size.h]);
    for (const fr of Object.values(atlas.frames)) {
      expect(fr.pivot.x).toBe(0.5);
      expect(fr.pivot.y).toBeCloseTo(ORIGIN_Y, 3);
      expect(fr.frame.x + fr.frame.w).toBeLessThanOrEqual(png.width);
      expect(fr.frame.y + fr.frame.h).toBeLessThanOrEqual(png.height);
    }
    assertPaletteLocked(join(spritesDir(), atlas.meta.image));
  });

  it('phaserAnims is deterministic and addresses cast.json frames', () => {
    const atlas = loadCastAtlas();
    for (const id of ids) {
      const a = phaserAnims(id);
      expect(a).toEqual(phaserAnims(id));
      expect(a.map((x) => x.key)).toContain(`${id}/walk_r`);
      for (const anim of a)
        for (const fr of anim.frames) expect(atlas.frames[fr.frame], fr.frame).toBeDefined();
    }
  });
});
