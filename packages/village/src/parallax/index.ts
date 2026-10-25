import type Phaser from 'phaser';
import type { AssetApi, AssetSpec, Lighting, TimeMode, WorldLayout, WorldTime, Glow } from '../world/api';
import { DEPTH, LOGICAL_H } from '../world/api';
import { clamp01, flicker, lerp, modeClockHours, targetNightness, tileOffset, twinkle } from './math';

const GV = 'assets/pixel/backgrounds/generated-village/';
const names = ['0_sky', '1_stars', '2_moon', '3_clouds', '4_hills_far', '5_hills_mid', '6_windmill', '8_hills_near', '9_trees', '10_fence', '11_ground'] as const;
export const ASSETS: AssetSpec[] = [
  ...names.map((n) => ({ type: 'image' as const, key: `bg-night-${n}`, path: `${GV}night_${n}.png` })),
  ...names.filter((n) => !['1_stars', '2_moon'].includes(n)).map((n) => ({ type: 'image' as const, key: `bg-day-${n}`, path: `${GV}day_${n}.png` })),
  { type: 'image', key: 'bg-day-2_sun', path: `${GV}day_2_sun.png` },
];

/* ---------- world time ---------- */
export type WorldTimeImpl = WorldTime & { update(dtMs: number): void; setCalm(v: () => boolean): void };
export function createWorldTime(opts: { mode?: TimeMode; now?: () => Date; calm?: () => boolean } = {}): WorldTimeImpl {
  const now = opts.now ?? (() => new Date());
  const real = () => { const d = now(); return d.getHours() + d.getMinutes() / 60; };
  let calm = opts.calm ?? (() => false);
  let mode: TimeMode = opts.mode ?? 'night';
  let clock = modeClockHours(mode, real());
  let nightness = targetNightness(mode, clock);
  let from = nightness, to = nightness, elapsed = 1, dur = 1;
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const set = (m: TimeMode) => {
    mode = m;
    clock = modeClockHours(m, real());
    from = nightness; to = targetNightness(m, clock); elapsed = 0;
    dur = calm() ? 200 : 20000; // spec row 2: 20 s ease-in-out, snap with 200 ms fade when calm
  };
  return {
    get mode() { return mode; },
    set mode(m) { set(m); },
    get nightness() { return nightness; },
    get clockHours() { return clock % 24; },
    setMode: set,
    setCalm(v) { calm = v; },
    update(dt) {
      clock += dt / 3_600_000;
      if (mode === 'auto') to = targetNightness('auto', clock);
      if (elapsed < dur) { elapsed = Math.min(dur, elapsed + dt); nightness = lerp(from, to, ease(elapsed / dur)); } else nightness = to;
    },
  };
}

/* ---------- lighting ---------- */
export type LightingImpl = Lighting & { update(timeMs: number, deltaMs: number): void; destroy(): void };
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
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  tex.refresh();
  tex.setFilter(1); // LINEAR: the glow is a soft light, not pixel art
}
export function createLighting(scene: Phaser.Scene, time: WorldTime, calm: () => boolean = () => false): LightingImpl {
  ensureGlowTexture(scene);
  const MAX = 40;
  const glows: Array<{ img: Phaser.GameObjects.Image; intensity: number; flick: boolean; phase: number }> = [];
  return {
    addGlow({ x, y, radius, color = 0xffc857, intensity = 1, flicker: fl = true }): Glow {
      const img = scene.add.image(Math.round(x), Math.round(y), GLOW_KEY).setBlendMode(1 /* ADD */).setDepth(DEPTH.lighting).setTint(color).setScale(radius / 32).setAlpha(0);
      const rec = { img, intensity, flick: fl, phase: Math.random() };
      if (glows.length >= MAX) glows.shift()?.img.destroy();
      glows.push(rec);
      return {
        setIntensity: (v) => { rec.intensity = clamp01(v); },
        setPosition: (nx, ny) => img.setPosition(Math.round(nx), Math.round(ny)),
        destroy: () => { img.destroy(); const i = glows.indexOf(rec); if (i >= 0) glows.splice(i, 1); },
      };
    },
    update(t) {
      const n = time.nightness;
      for (const g of glows) g.img.setAlpha(g.intensity * n * (g.flick && !calm() ? flicker(t, g.phase) : 1) * 0.85);
    },
    destroy() { glows.splice(0).forEach((g) => g.img.destroy()); },
  };
}

/* ---------- parallax ---------- */
export interface ParallaxDeps { layout: WorldLayout; time: WorldTime; assets: AssetApi; calm: () => boolean }
interface Layer { name: string; factor: number; depth: number; drift?: number; twinkle?: boolean; fixedMoon?: boolean; /** unique feature: placed as images at these layer-space x offsets instead of tiled */ at?: number[] }
// Back to front. Factors per spec 08 row 1 (0.05 sky .. 0.6 near hills), ground and fence move 1:1 with the world.
const LAYERS: Layer[] = [
  { name: '0_sky', factor: 0, depth: DEPTH.sky },
  { name: '1_stars', factor: 0.02, depth: DEPTH.parallaxBack, twinkle: true },
  { name: '2_moon', factor: 0.04, depth: DEPTH.parallaxBack + 1, fixedMoon: true },
  { name: '2_sun', factor: 0.04, depth: DEPTH.parallaxBack + 1, fixedMoon: true },
  { name: '3_clouds', factor: 0.1, depth: DEPTH.parallaxBack + 2, drift: 1 },
  { name: '4_hills_far', factor: 0.2, depth: DEPTH.parallaxBack + 3 },
  { name: '5_hills_mid', factor: 0.35, depth: DEPTH.parallaxMid },
  { name: '6_windmill', factor: 0.35, depth: DEPTH.parallaxMid + 1, at: [260, 900] },
  { name: '8_hills_near', factor: 0.5, depth: DEPTH.parallaxMid + 2 },
  { name: '9_trees', factor: 0.6, depth: DEPTH.behindBuildings },
  { name: '10_fence', factor: 1, depth: DEPTH.behindBuildings + 1 },
  { name: '11_ground', factor: 1, depth: DEPTH.behindBuildings + 2 },
];

export function createParallax(scene: Phaser.Scene, d: ParallaxDeps) {
  type Tile = Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image;
  type Sprite = { l: Layer; night?: Tile[]; day?: Tile[]; baseAlpha: number };
  const sprites: Sprite[] = [];
  const cam = scene.cameras.main;
  const mk = (key: string, l: Layer): Tile[] | undefined => {
    if (!d.assets.has(key)) return undefined;
    if (l.fixedMoon) return [scene.add.image(0, 0, key).setOrigin(0).setScrollFactor(0).setDepth(l.depth)];
    if (l.at) return l.at.map((x) => scene.add.image(x, 0, key).setOrigin(0).setScrollFactor(l.factor, 0).setDepth(l.depth));
    return [scene.add.tileSprite(0, 0, cam.width, LOGICAL_H, key).setOrigin(0).setScrollFactor(0).setDepth(l.depth)];
  };
  for (const l of LAYERS) {
    const day = mk(`bg-day-${l.name}`, l); // created first: night fades in on top
    const night = mk(`bg-night-${l.name}`, l);
    if (night || day) sprites.push({ l, night, day, baseAlpha: 1 });
  }
  // Dusk/dawn warmth: one screen-space wash, only visible between day and night.
  const wash = scene.add.rectangle(0, 0, cam.width, LOGICAL_H, 0xf08a3a, 0).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.lighting - 1);
  let lastW = cam.width;
  return {
    update(t: number) {
      const n = d.time.nightness;
      const calm = d.calm();
      const w = cam.width;
      const resized = w !== lastW;
      lastW = w;
      wash.setSize(w, LOGICAL_H).setAlpha(Math.max(0, 1 - Math.abs(n - 0.5) * 2.6) * 0.16);
      for (const s of sprites) {
        const drift = s.l.drift && !calm ? (t / 1000) * s.l.drift : 0;
        const x = tileOffset(cam.scrollX, s.l.factor, drift);
        for (const ts of [...(s.night ?? []), ...(s.day ?? [])]) {
          if (!('tilePositionX' in ts)) continue;
          if (resized) ts.setSize(w, LOGICAL_H);
          ts.tilePositionX = x;
        }
        const pair = !!(s.night && s.day);
        const dayA = pair ? 1 : 1 - n;
        const nightA = pair ? n : s.l.fixedMoon || s.l.twinkle ? n : 1;
        s.day?.forEach((o) => o.setAlpha(dayA));
        s.night?.forEach((o) => o.setAlpha(s.l.twinkle ? n * (calm ? 1 : twinkle(t, 5200)) : nightA));
      }
    },
    destroy() { sprites.forEach((s) => { s.night?.forEach((o) => o.destroy()); s.day?.forEach((o) => o.destroy()); }); wash.destroy(); },
  };
}
