import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';

/** Composed art (docs/design asset set) the mesh view uses. Keys are prefixed `mv-` so they never collide. */
const C = 'assets/pixel/composed';
export const IMAGES: Record<string, string> = {
  'mv-hut-dark': `${C}/buildings/houses/house_hut_dark.png`,
  'mv-hut-lit': `${C}/buildings/houses/house_hut_lit.png`,
  'mv-sign': `${C}/buildings/houses/signboard_empty.png`,
  'mv-board': `${C}/ui/notice-board.png`,
  'mv-board-lit': `${C}/ui/notice-board-lit.png`,
  'mv-card-shared': `${C}/ui/card-shared.png`,
  'mv-card-hidden': `${C}/ui/card-hidden.png`,
  'mv-card-blocked': `${C}/ui/card-blocked.png`,
  'mv-card-pinned': `${C}/ui/card-pinned.png`,
  'mv-withheld': `${C}/ui/withheld-bar.png`,
  'mv-padlock': `${C}/ui/padlock.png`,
  'mv-padlock-open': `${C}/ui/padlock-open.png`,
  'mv-envelope': `${C}/ui/envelope.png`,
  'mv-check': `${C}/ui/check.png`,
  'mv-ring-ok': `${C}/ui/door-ring-ok.png`,
  'mv-alert': `${C}/ui/marker-alert.png`,
  'mv-bubble-wall': `${C}/ui/bubble-wall.png`,
  'mv-bubble-moon': `${C}/ui/bubble-moon.png`,
  'mv-tail-wall-l': `${C}/ui/bubble-wall-tail-left.png`,
  'mv-tail-wall-r': `${C}/ui/bubble-wall-tail-right.png`,
  'mv-camp-base': `${C}/fx/campfire-base.png`,
  'mv-camp-light': `${C}/fx/campfire-light.png`,
  'mv-stump': `${C}/props/stump.png`,
  'mv-bench': `${C}/props/bench.png`,
  'mv-lamp-halo': `${C}/props/lamp-halo.png`,
  'mv-emote-alert': `${C}/ui/emote-alert.png`,
};
export const SHEETS: Record<string, { path: string; w: number; h: number }> = {
  'mv-ring': { path: `${C}/ui/door-ring.png`, w: 32, h: 16 },
  'mv-env-pop': { path: `${C}/ui/envelope-pop.png`, w: 18, h: 14 },
  'mv-fire': { path: `${C}/fx/campfire-fire.png`, w: 16, h: 22 },
  'mv-sparks': { path: `${C}/fx/campfire-sparks.png`, w: 8, h: 12 },
  'mv-smoke': { path: `${C}/fx/chimney-smoke.png`, w: 24, h: 40 },
};
export const CAST_ATLAS = {
  key: 'characters',
  png: `${C}/characters/atlas.png`,
  json: `${C}/characters/atlas.json`,
};
export const FONT_URL = 'assets/fonts/jersey-10/Jersey10-Regular.ttf';

export function preloadMeshAssets(ctx: VillageContext, load: Phaser.Loader.LoaderPlugin): void {
  const has = (k: string) => ctx.assets.has(k) || ctx.scene.textures.exists(k);
  for (const [k, p] of Object.entries(IMAGES)) if (!has(k)) load.image(k, ctx.assets.url(p));
  for (const [k, s] of Object.entries(SHEETS)) {
    if (!has(k)) load.spritesheet(k, ctx.assets.url(s.path), { frameWidth: s.w, frameHeight: s.h });
  }
  if (!has(CAST_ATLAS.key)) load.atlas(CAST_ATLAS.key, ctx.assets.url(CAST_ATLAS.png), ctx.assets.url(CAST_ATLAS.json));
}

/** Pixel font (Jersey 10, OFL). Resolves when usable; failure falls back to monospace silently. */
export async function loadPixelFont(ctx: VillageContext): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  try {
    if (document.fonts.check('9px "Jersey 10"')) return;
    const f = new FontFace('Jersey 10', `url(${ctx.assets.url(FONT_URL)})`);
    await f.load();
    document.fonts.add(f);
  } catch (e) {
    ctx.log('pixel font unavailable, using fallback', e);
  }
}
