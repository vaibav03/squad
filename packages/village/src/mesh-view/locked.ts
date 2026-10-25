import { PAL, hex } from './palette';

/**
 * Locked-building variant, generated from the composed house art so it always matches it:
 * everything remapped to the cool ramp (ink, sky-deep, hill-near, hill-mid, wall-shade) by luminance
 * (docs/design/DESIGN.md section 5). With `keepWarm` the lit window and door gap stay warm, so a
 * neighbour who is awake reads as "home, but private".
 */
const RAMP = [PAL.ink, PAL.skyDeep, PAL.hillNear, PAL.hillMid, PAL.wallShade].map((c) => {
  const n = hex(c);
  return { n, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, l: lum((n >> 16) & 255, (n >> 8) & 255, n & 255) };
});
const WARM = [PAL.glowCore, PAL.glow, PAL.ember].map((c) => {
  const n = hex(c);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function remapLocked(data: Uint8ClampedArray, keepWarm: boolean): void {
  const lmin = RAMP[0]!.l;
  const lmax = RAMP[RAMP.length - 1]!.l;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (keepWarm && WARM.some((w) => Math.abs(w[0] - r) + Math.abs(w[1] - g) + Math.abs(w[2] - b) < 40)) continue;
    // source art spans ink..wall-lit; stretch its luminance onto the cool ramp
    const t = Math.min(1, Math.max(0, lum(r, g, b) / 200));
    const target = lmin + t * (lmax - lmin);
    let best = RAMP[0]!;
    for (const c of RAMP) if (Math.abs(c.l - target) < Math.abs(best.l - target)) best = c;
    data[i] = best.r;
    data[i + 1] = best.g;
    data[i + 2] = best.b;
  }
}

export interface LockedScene {
  textures: {
    exists(key: string): boolean;
    get(key: string): { getSourceImage(): CanvasImageSource & { width: number; height: number } };
    createCanvas(key: string, w: number, h: number): { getContext(): CanvasRenderingContext2D; refresh(): unknown; setFilter(m: number): unknown };
  };
}

export function ensureLocked(scene: LockedScene, from: string, to: string, keepWarm: boolean): boolean {
  if (scene.textures.exists(to)) return true;
  if (!scene.textures.exists(from)) return false;
  const img = scene.textures.get(from).getSourceImage();
  const tex = scene.textures.createCanvas(to, img.width, img.height);
  const cx = tex.getContext();
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, img.width, img.height);
  remapLocked(id.data, keepWarm);
  cx.putImageData(id, 0, 0);
  tex.refresh();
  tex.setFilter(1);
  return true;
}
