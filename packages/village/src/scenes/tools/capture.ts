import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Raster } from '../pixel/raster';
import { drawText, textWidth } from '../pixel/font';
import { nightBackdrop } from '../art/backdrop';
import { paintShot } from '../testkit';
import type { SceneBundle } from '../contract';
import { encodePng } from './png';

/** Compose one frame: exteriors sit on the shared night backdrop, interiors on ink. */
export function frameFor(bundle: SceneBundle, shotIdx: number, sampleIdx: number): Raster {
  const shot = bundle.shots[shotIdx]!;
  const t = shot.sample[sampleIdx]!;
  const sprite = paintShot(bundle.def, shot, t);
  if (shot.view === 'interior') {
    const f = new Raster(sprite.w + 8, sprite.h + 8);
    f.rect(0, 0, f.w, f.h, 'ink');
    f.blit(sprite, 4, 4);
    return f;
  }
  const w = sprite.w + 56;
  const h = sprite.h + 34;
  const groundY = h - 14;
  const f = nightBackdrop(w, h, groundY);
  f.blit(sprite, Math.round((w - sprite.w) / 2), groundY + 4 - sprite.h + 0);
  return f;
}

/** Writes docs/design/shots/<ws>/<scene>-<shot>.png: a labelled strip of its samples at `scale`. */
export function captureBundle(bundle: SceneBundle, outDir: string, scale = 4): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  bundle.shots.forEach((shot, si) => {
    const frames = shot.sample.map((_, i) => frameFor(bundle, si, i));
    const gap = 3;
    const label = 9;
    const w = frames.reduce((a, f) => a + f.w, 0) + gap * (frames.length + 1);
    const h = Math.max(...frames.map((f) => f.h)) + label + gap;
    const sheet = new Raster(w, h);
    sheet.rect(0, 0, w, h, 'ink');
    let x = gap;
    frames.forEach((f, i) => {
      sheet.blit(f, x, label);
      const tag = `${shot.name} ${shot.sample[i]}MS`;
      drawText(sheet, x, 2, tag.toUpperCase(), 'cloud-lo');
      x += f.w + gap;
    });
    void textWidth;
    const file = join(outDir, `${bundle.def.id}-${shot.name}.png`);
    writeFileSync(file, encodePng(sheet.scaled(scale)));
    written.push(file);
  });
  return written;
}
