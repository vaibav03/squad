import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listPersonas } from '../personas/index.js';
import {
  ANIM_FPS,
  ANIM_FRAMES,
  FEET_ANCHOR,
  FRAME_CELL,
  loadCastAtlas,
  loadFrames,
  phaserAnims,
  repoRoot,
  spritesDir,
  type AnimName,
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
function opaqueCount(
  png: ReturnType<typeof readPng>,
  x0: number,
  y0: number,
  w: number,
  h: number,
): number {
  let n = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) if (png.data[(y * png.width + x) * 4 + 3] === 255) n++;
  return n;
}

const ids = listPersonas().map((p) => p.id);

describe('cast atlas (format v2)', () => {
  it('assets exist (run pnpm --filter @squad/media build:sprites)', () => {
    expect(existsSync(join(spritesDir(), 'cast.json'))).toBe(true);
  });

  it.each(ids)('%s: strips, frames.json and portrait are valid and palette-locked', (id) => {
    const f = loadFrames(id);
    expect(f.id).toBe(id);
    expect(f.cell).toEqual(FRAME_CELL);
    expect(f.anchors.feet).toEqual(FEET_ANCHOR);
    expect(f.anchors.head.y).toBeLessThan(f.anchors.feet.y);
    for (const [name, r] of Object.entries(f.frames)) {
      expect(name).toMatch(/^(idle|walk|talk|sit|wave)\/\d$/);
      const png = readPng(join(spritesDir(), id, r.strip));
      expect(r.w).toBe(32);
      expect(r.h).toBe(32);
      expect(r.x + r.w, `${id}/${name} out of bounds`).toBeLessThanOrEqual(png.width);
      expect(r.y + r.h).toBeLessThanOrEqual(png.height);
      expect(opaqueCount(png, r.x, r.y, r.w, r.h), `${id}/${name} is empty`).toBeGreaterThan(40);
    }
    for (const a of Object.keys(ANIM_FPS) as AnimName[]) {
      const anim = f.anims[a]!;
      expect(anim, `${id} missing anim ${a}`).toBeDefined();
      expect(anim.frames).toHaveLength(ANIM_FRAMES[a]);
      expect(anim.frameRate).toBe(ANIM_FPS[a]);
      for (const n of anim.frames)
        expect(f.frames[n], `${id}: ${a} references missing ${n}`).toBeDefined();
    }
    for (const strip of new Set(Object.values(f.frames).map((r) => r.strip)))
      assertPaletteLocked(join(spritesDir(), id, strip));
    const port = readPng(join(spritesDir(), id, f.portrait));
    expect([port.width, port.height]).toEqual([32, 32]);
    assertPaletteLocked(join(spritesDir(), id, f.portrait));
    for (const s of [2, 3, 4]) {
      const up = readPng(join(spritesDir(), id, `portrait@${s}x.png`));
      expect([up.width, up.height]).toEqual([32 * s, 32 * s]);
    }
  });

  it('cast.json keys are exactly the union of <id>/<anim>/<n> + <id>/portrait, feet pivots, palette-locked image', () => {
    const atlas = loadCastAtlas();
    const want = new Set<string>();
    for (const id of ids) {
      const f = loadFrames(id);
      for (const n of Object.keys(f.frames)) want.add(`${id}/${n}`);
      want.add(`${id}/portrait`);
    }
    expect(new Set(Object.keys(atlas.frames))).toEqual(want);
    const png = readPng(join(spritesDir(), atlas.meta.image));
    expect([png.width, png.height]).toEqual([atlas.meta.size.w, atlas.meta.size.h]);
    for (const [k, fr] of Object.entries(atlas.frames)) {
      if (!k.endsWith('/portrait')) expect(fr.pivot).toEqual({ x: 0.5, y: 1 });
      expect(fr.frame.x + fr.frame.w).toBeLessThanOrEqual(png.width);
      expect(fr.frame.y + fr.frame.h).toBeLessThanOrEqual(png.height);
    }
    for (const id of ids) {
      for (const a of Object.keys(ANIM_FPS))
        for (const fr of atlas.animations[id]![a]!.frames)
          expect(atlas.frames[fr], fr).toBeDefined();
    }
    assertPaletteLocked(join(spritesDir(), atlas.meta.image));
  });

  it('phaserAnims is deterministic, keyed <id>/<anim>, and mirrors cast.json animations', () => {
    const atlas = loadCastAtlas();
    for (const id of ids) {
      const a = phaserAnims(id);
      expect(a).toEqual(phaserAnims(id));
      expect(a.map((x) => x.key).sort()).toEqual(
        Object.keys(ANIM_FPS)
          .map((n) => `${id}/${n}`)
          .sort(),
      );
      for (const anim of a) {
        const name = anim.key.split('/')[1]!;
        expect(anim.frames.map((f) => f.frame)).toEqual(atlas.animations[id]![name]!.frames);
      }
    }
  });
});
