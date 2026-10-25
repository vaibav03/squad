import { describe, expect, it } from 'vitest';
import { PAL, hex } from './palette';
import { remapLocked } from './locked';

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const rgb = (c: string) => [(hex(c) >> 16) & 255, (hex(c) >> 8) & 255, hex(c) & 255] as const;

describe('remapLocked', () => {
  it('keeps transparency', () => {
    const d = px(200, 100, 50, 0);
    remapLocked(d, false);
    expect([...d]).toEqual([200, 100, 50, 0]);
  });
  it('maps everything onto the cool ramp', () => {
    const ramp = [PAL.ink, PAL.skyDeep, PAL.hillNear, PAL.hillMid, PAL.wallShade].map((c) =>
      rgb(c).join(','),
    );
    for (const c of [PAL.roofWine, PAL.wallLit, PAL.wood, PAL.glow, PAL.skinLt]) {
      const d = px(...rgb(c));
      remapLocked(d, false);
      expect(ramp).toContain([d[0], d[1], d[2]].join(','));
    }
  });
  it('keepWarm leaves lit windows warm', () => {
    const d = px(...rgb(PAL.glowCore));
    remapLocked(d, true);
    expect([d[0], d[1], d[2]]).toEqual([...rgb(PAL.glowCore)]);
  });
});
