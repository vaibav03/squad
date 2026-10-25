import type Phaser from 'phaser';
import type {
  AssetApi,
  AssetSpec,
  Lighting,
  TimeMode,
  WorldLayout,
  WorldTime,
  Glow,
} from '../world/api';
import { DEPTH, LOGICAL_H } from '../world/api';
import { clamp01, flicker, lerp, modeClockHours, targetNightness, tileOffset } from './math';
import { MOON_ALPHA, RAMPS, STAR_ALPHA } from './ramps';

const BG = 'assets/pixel/composed/backgrounds/';
const img = (key: string, file: string): AssetSpec => ({ type: 'image', key, path: BG + file });
// Keys are the manifest ids (assets/asset-manifest.json) so the manifest and this fallback list dedupe by key.
export const ASSETS: AssetSpec[] = [
  img('parallax.0_sky', '0_sky.png'),
  img('parallax.0_sky:dusk', '0_sky_dusk.png'),
  img('parallax.0_sky:dawn', '0_sky_dawn.png'),
  img('parallax.0_sky:day', '0_sky_day.png'),
  img('parallax.1_stars', '1_stars.png'),
  ...[0, 1, 2, 3].map((i) => img(`parallax.1_stars:twinkle_${i}`, `1_stars_twinkle_${i}.png`)),
  img('parallax.2_moon', '2_moon.png'),
  img('parallax.3_clouds_far', '3_clouds_far.png'),
  img('parallax.4_clouds_near', '4_clouds_near.png'),
  img('parallax.5_hills_far', '5_hills_far.png'),
  img('parallax.6_hills_mid', '6_hills_mid.png'),
  img('parallax.7_hills_near', '7_hills_near.png'),
  img('parallax.8_fenceline', '8_fenceline.png'),
  img('parallax.9_ground', '9_ground.png'),
  img('parallax.10_foreground', '10_foreground.png'),
  {
    type: 'image',
    key: 'landmark.windmill',
    path: 'assets/pixel/composed/buildings/windmill/windmill_lit.png',
  },
  {
    type: 'image',
    key: 'landmark.windmill:dark',
    path: 'assets/pixel/composed/buildings/windmill/windmill_dark.png',
  },
  {
    type: 'spritesheet',
    key: 'landmark.windmill.sails',
    path: 'assets/pixel/composed/buildings/windmill/windmill_sails_strip.png',
    frameWidth: 72,
    frameHeight: 72,
  },
];

/* ---------- world time ---------- */
export type WorldTimeImpl = WorldTime & {
  update(dtMs: number): void;
  setCalm(v: () => boolean): void;
};
export function createWorldTime(
  opts: { mode?: TimeMode; now?: () => Date; calm?: () => boolean } = {},
): WorldTimeImpl {
  const now = opts.now ?? (() => new Date());
  const real = () => {
    const d = now();
    return d.getHours() + d.getMinutes() / 60;
  };
  let calm = opts.calm ?? (() => false);
  let mode: TimeMode = opts.mode ?? 'night';
  let clock = modeClockHours(mode, real());
  let nightness = targetNightness(mode, clock);
  let from = nightness,
    to = nightness,
    elapsed = 1,
    dur = 1;
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const set = (m: TimeMode) => {
    mode = m;
    clock = modeClockHours(m, real());
    from = nightness;
    to = targetNightness(m, clock);
    elapsed = 0;
    dur = calm() ? 200 : 20000; // spec row 2: 20 s ease-in-out, snap with 200 ms fade when calm
  };
  return {
    get mode() {
      return mode;
    },
    set mode(m) {
      set(m);
    },
    get nightness() {
      return nightness;
    },
    get clockHours() {
      return clock % 24;
    },
    get twilight(): 'dusk' | 'dawn' {
      return mode === 'dawn' || (mode === 'auto' && clock % 24 < 12) ? 'dawn' : 'dusk';
    },
    setMode: set,
    setCalm(v) {
      calm = v;
    },
    update(dt) {
      clock += dt / 3_600_000;
      if (mode === 'auto') to = targetNightness('auto', clock);
      if (elapsed < dur) {
        elapsed = Math.min(dur, elapsed + dt);
        nightness = lerp(from, to, ease(elapsed / dur));
      } else nightness = to;
    },
  };
}

/* ---------- lighting ---------- */
export type LightingImpl = Lighting & {
  update(timeMs: number, deltaMs: number): void;
  destroy(): void;
};
const GLOW_KEY = 'sqv-glow';
function ensureGlowTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(GLOW_KEY)) return;
  const size = 64;
  const tex = scene.textures.createCanvas(GLOW_KEY, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,240,168,1)');
  g.addColorStop(0.25, 'rgba(255,200,87,0.55)');
  g.addColorStop(0.6, 'rgba(240,138,58,0.16)');
  g.addColorStop(1, 'rgba(240,138,58,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
  tex.setFilter(1); // LINEAR: the glow is a soft light, not pixel art
}
export function createLighting(
  scene: Phaser.Scene,
  time: WorldTime,
  calm: () => boolean = () => false,
): LightingImpl {
  ensureGlowTexture(scene);
  const MAX = 40;
  const glows: Array<{
    img: Phaser.GameObjects.Image;
    intensity: number;
    flick: boolean;
    phase: number;
  }> = [];
  return {
    addGlow({ x, y, radius, color = 0xffc857, intensity = 1, flicker: fl = true }): Glow {
      const img = scene.add
        .image(Math.round(x), Math.round(y), GLOW_KEY)
        .setBlendMode(1 /* ADD */)
        .setDepth(DEPTH.lighting)
        .setTint(color)
        .setScale(radius / 32)
        .setAlpha(0);
      const rec = { img, intensity, flick: fl, phase: Math.random() };
      if (glows.length >= MAX) glows.shift()?.img.destroy();
      glows.push(rec);
      return {
        setIntensity: (v) => {
          rec.intensity = clamp01(v);
        },
        setPosition: (nx, ny) => img.setPosition(Math.round(nx), Math.round(ny)),
        destroy: () => {
          img.destroy();
          const i = glows.indexOf(rec);
          if (i >= 0) glows.splice(i, 1);
        },
      };
    },
    update(t) {
      const n = time.nightness;
      for (const g of glows)
        g.img.setAlpha(g.intensity * n * (g.flick && !calm() ? flicker(t, g.phase) : 1) * 0.85);
    },
    destroy() {
      glows.splice(0).forEach((g) => g.img.destroy());
    },
  };
}

/* ---------- parallax ---------- */
export interface ParallaxDeps {
  layout: WorldLayout;
  time: WorldTime;
  assets: AssetApi;
  calm: () => boolean;
}
interface LayerDef {
  name: string;
  factor: number;
  depth: number;
  y: number;
  h: number;
  drift?: number;
}
// Factors from assets/pixel/composed/backgrounds/provenance.json. y/h: art rows in world coordinates (layer set is 270 tall).
const LAYERS: LayerDef[] = [
  {
    name: '3_clouds_far',
    factor: 0.1,
    depth: DEPTH.parallaxBack + 2,
    y: 0,
    h: LOGICAL_H,
    drift: 1,
  },
  {
    name: '4_clouds_near',
    factor: 0.2,
    depth: DEPTH.parallaxBack + 3,
    y: 0,
    h: LOGICAL_H,
    drift: 1.6,
  },
  { name: '5_hills_far', factor: 0.3, depth: DEPTH.parallaxBack + 4, y: 0, h: LOGICAL_H },
  { name: '6_hills_mid', factor: 0.45, depth: DEPTH.parallaxMid, y: 0, h: LOGICAL_H },
  { name: '7_hills_near', factor: 0.6, depth: DEPTH.parallaxMid + 1, y: 0, h: LOGICAL_H },
  { name: '8_fenceline', factor: 0.9, depth: DEPTH.behindBuildings, y: 0, h: LOGICAL_H },
  { name: '9_ground', factor: 1, depth: DEPTH.behindBuildings + 2, y: 240, h: 30 },
  { name: '10_foreground', factor: 1.2, depth: DEPTH.foreground, y: 0, h: LOGICAL_H },
];

const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
/** Bakes `tint` over the opaque pixels of a layer once at boot (ramps.json: normal blend, clipped to the layer). */
function bakeTinted(
  scene: Phaser.Scene,
  srcKey: string,
  dstKey: string,
  color: number,
  alpha: number,
): boolean {
  if (scene.textures.exists(dstKey) || !scene.textures.exists(srcKey))
    return scene.textures.exists(dstKey);
  const src = scene.textures.get(srcKey).getSourceImage() as CanvasImageSource & {
    width: number;
    height: number;
  };
  const tex = scene.textures.createCanvas(dstKey, src.width, src.height);
  if (!tex) return false;
  const ctx = tex.getContext();
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillRect(0, 0, src.width, src.height);
  tex.refresh();
  tex.setFilter(0); // NEAREST
  return true;
}

/** Crossfade weights (docs/design/DESIGN.md 5): night is the base; twilight tint peaks at nightness 0.5; day fades in below. */
export function variantWeights(n: number): { twilight: number; day: number } {
  const t = clamp01(1 - Math.abs(n - 0.5) / 0.5);
  const day = clamp01(1 - n / 0.5);
  return { twilight: t, day };
}

export function createParallax(scene: Phaser.Scene, d: ParallaxDeps) {
  const cam = scene.cameras.main;
  type Overlay = { ts: Phaser.GameObjects.TileSprite; kind: 'dusk' | 'dawn' | 'day' };
  type Item = { def: LayerDef; base: Phaser.GameObjects.TileSprite; overlays: Overlay[] };
  const items: Item[] = [];
  const all: Phaser.GameObjects.GameObject[] = [];
  const mkTile = (key: string, def: LayerDef, depth = def.depth) => {
    const ts = scene.add
      .tileSprite(0, def.y, cam.width, def.h, key)
      .setOrigin(0)
      .setScrollFactor(0, 1)
      .setDepth(depth);
    all.push(ts);
    return ts;
  };

  // sky: four ready-made ramps
  const skyDef: LayerDef = { name: 'sky', factor: 0, depth: DEPTH.sky, y: 0, h: LOGICAL_H };
  const sky = d.assets.has('parallax.0_sky')
    ? {
        base: mkTile('parallax.0_sky', skyDef),
        dusk: mkTile('parallax.0_sky:dusk', skyDef),
        dawn: mkTile('parallax.0_sky:dawn', skyDef),
        day: mkTile('parallax.0_sky:day', skyDef, DEPTH.sky + 0.1),
      }
    : undefined;

  // stars (twinkle frames) and moon (screen-anchored, upper left like the reference)
  const stars = d.assets.has('parallax.1_stars')
    ? mkTile('parallax.1_stars', {
        name: 'stars',
        factor: 0.02,
        depth: DEPTH.parallaxBack,
        y: 0,
        h: LOGICAL_H,
      })
    : undefined;
  const moon = d.assets.has('parallax.2_moon')
    ? scene.add
        .image(0, 0, 'parallax.2_moon')
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.parallaxBack + 1)
    : undefined;
  if (moon) all.push(moon);

  for (const def of LAYERS) {
    const key = `parallax.${def.name}`;
    if (!d.assets.has(key)) continue;
    const base = mkTile(key, def);
    const overlays: Overlay[] = [];
    const ramp = RAMPS[def.name] ?? {};
    for (const kind of ['dusk', 'dawn', 'day'] as const) {
      const r = ramp[kind];
      if (!r) continue;
      const tk = `${key}-${kind}`;
      if (bakeTinted(scene, key, tk, r.color, r.alpha))
        overlays.push({ ts: mkTile(tk, def, def.depth + 0.01), kind });
    }
    items.push({ def, base, overlays });
  }

  // windmill on the near hills (84 px tower, 8-frame sail strip pivoting on the hub at (21,25))
  const mills: Array<{ body: Phaser.GameObjects.Image; sails: Phaser.GameObjects.Image }> = [];
  if (d.assets.has('landmark.windmill') && d.assets.has('landmark.windmill.sails')) {
    for (const lx of [520, 1650]) {
      const base = 214; // stands on the near-hill ridge
      const body = scene.add
        .image(lx, base, 'landmark.windmill')
        .setOrigin(0.5, 1)
        .setScrollFactor(0.6, 1)
        .setDepth(DEPTH.parallaxMid + 1.5);
      const sails = scene.add
        .image(lx, base - 58, 'landmark.windmill.sails', 0)
        .setOrigin(0.5)
        .setScrollFactor(0.6, 1)
        .setDepth(DEPTH.parallaxMid + 1.6);
      mills.push({ body, sails });
      all.push(body, sails);
    }
  }
  let lastW = cam.width;
  return {
    update(t: number) {
      const n = d.time.nightness;
      const calm = d.calm();
      const w = cam.width;
      const resized = w !== lastW;
      lastW = w;
      const { twilight, day } = variantWeights(n);
      const tw = d.time.twilight;
      if (sky) {
        for (const ts of [sky.base, sky.dusk, sky.dawn, sky.day])
          if (resized) ts.setSize(w, LOGICAL_H);
        sky.dusk.setAlpha(tw === 'dusk' ? twilight : 0);
        sky.dawn.setAlpha(tw === 'dawn' ? twilight : 0);
        sky.day.setAlpha(day);
      }
      if (stars) {
        if (resized) stars.setSize(w, LOGICAL_H);
        const twAlpha = tw === 'dusk' ? STAR_ALPHA.dusk : STAR_ALPHA.dawn;
        stars.setAlpha(n >= 0.5 ? twAlpha + (1 - twAlpha) * (n - 0.5) * 2 : twAlpha * n * 2);
        stars.setTexture(
          calm ? 'parallax.1_stars' : `parallax.1_stars:twinkle_${Math.floor(t / 400) % 4}`,
        );
        stars.tilePositionX = tileOffset(cam.scrollX, 0.02, 0, 480);
      }
      if (moon) {
        moon.setPosition(Math.round(w * 0.2), 56);
        const ta = tw === 'dusk' ? MOON_ALPHA.dusk : MOON_ALPHA.dawn;
        moon.setAlpha(n >= 0.5 ? ta + (1 - ta) * (n - 0.5) * 2 : ta * n * 2);
      }
      const sailFrame = calm ? 0 : Math.floor(t / 220) % 8;
      for (const m of mills) {
        m.sails.setFrame(sailFrame);
        m.body.setTexture(
          n > 0.45
            ? 'landmark.windmill'
            : d.assets.has('landmark.windmill:dark')
              ? 'landmark.windmill:dark'
              : 'landmark.windmill',
        );
      }
      for (const it of items) {
        const drift = it.def.drift && !calm ? (t / 1000) * it.def.drift : 0;
        const x = tileOffset(cam.scrollX, it.def.factor, drift, 480);
        if (resized) it.base.setSize(w, it.def.h);
        it.base.tilePositionX = x;
        for (const o of it.overlays) {
          if (resized) o.ts.setSize(w, it.def.h);
          o.ts.tilePositionX = x;
          o.ts.setAlpha(o.kind === 'day' ? day : o.kind === tw ? twilight : 0);
        }
      }
    },
    destroy() {
      all.forEach((o) => o.destroy());
    },
  };
}
