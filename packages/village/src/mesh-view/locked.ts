import { PAL, hex } from './palette';

/**
 * Locked-building variant, generated from the composed house art so it always matches it:
 * everything remapped to the cool ramp (ink, sky-deep, hill-near, hill-mid, wall-shade) by luminance
 * (docs/design/DESIGN.md section 5). With `keepWarm` the lit window and door gap stay warm, so a
 * neighbour who is awake reads as "home, but private".
 */
const RAMP = [PAL.ink, PAL.skyDeep, PAL.hillNear, PAL.hillMid, PAL.wallShade].map((c) => {
  const n = hex(c);
  return {
    n,
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    l: lum((n >> 16) & 255, (n >> 8) & 255, n & 255),
  };
});
const WARM = [PAL.glowCore, PAL.glow, PAL.ember].map((c) => {
  const n = hex(c);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** `keepWarm`: warm pixels at x >= warmMinX stay (windows); the door slit on the left is dropped so locked doors read as shut. */
export function remapLocked(
  data: Uint8ClampedArray,
  keepWarm: boolean,
  width = 1,
  warmMinX = 0,
): void {
  const lmin = RAMP[0]!.l;
  const lmax = RAMP[RAMP.length - 1]!.l;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const x = (i / 4) % width;
    if (
      keepWarm &&
      x >= warmMinX &&
      WARM.some((w) => Math.abs(w[0] - r) + Math.abs(w[1] - g) + Math.abs(w[2] - b) < 40)
    )
      continue;
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
    createCanvas(
      key: string,
      w: number,
      h: number,
    ): {
      getContext(): CanvasRenderingContext2D;
      refresh(): unknown;
      setFilter(m: number): unknown;
    };
  };
}

export function ensureLocked(
  scene: LockedScene,
  from: string,
  to: string,
  keepWarm: boolean,
): boolean {
  if (scene.textures.exists(to)) return true;
  if (!scene.textures.exists(from)) return false;
  const img = scene.textures.get(from).getSourceImage();
  const tex = scene.textures.createCanvas(to, img.width, img.height);
  const cx = tex.getContext();
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, img.width, img.height);
  remapLocked(id.data, keepWarm, img.width, Math.floor(img.width * 0.7));
  cx.putImageData(id, 0, 0);
  tex.refresh();
  tex.setFilter(1);
  return true;
}

/**
 * The lit hut art leaves a 1 px warm slit down the arch door (light spilling through the gap). Next to a
 * standing agent it reads as a stray pole, so own-house art drops it: warm pixels left of `warmMinX`
 * take the colour of the pixel two to the left (the dark door).
 */
export function dropDoorSlit(data: Uint8ClampedArray, width: number, warmMinX: number): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const x = (i / 4) % width;
    if (x >= warmMinX || x < 2) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (WARM.some((w) => Math.abs(w[0] - r) + Math.abs(w[1] - g) + Math.abs(w[2] - b) < 40)) {
      const j = i - 8;
      data[i] = data[j]!;
      data[i + 1] = data[j + 1]!;
      data[i + 2] = data[j + 2]!;
    }
  }
}

export function ensureOwnLit(scene: LockedScene, from: string, to: string): boolean {
  if (scene.textures.exists(to)) return true;
  if (!scene.textures.exists(from)) return false;
  const img = scene.textures.get(from).getSourceImage();
  const tex = scene.textures.createCanvas(to, img.width, img.height);
  const cx = tex.getContext();
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, img.width, img.height);
  dropDoorSlit(id.data, img.width, Math.floor(img.width * 0.7));
  cx.putImageData(id, 0, 0);
  tex.refresh();
  tex.setFilter(1);
  return true;
}
