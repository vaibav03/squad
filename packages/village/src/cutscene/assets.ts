import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';

const C = 'assets/pixel/composed';
const IMAGES: Record<string, string> = {
  'mv-road': `${C}/props/road-tile.png`,
  'mv-lamp': `${C}/props/lamp-post-lit.png`,
  'mv-lamp-halo': `${C}/props/lamp-halo.png`,
  'mv-van-cone': `${C}/props/van-cone.png`,
  'mv-bubble-wall': `${C}/ui/bubble-wall.png`,
};
const SHEETS: Record<string, { path: string; w: number; h: number }> = {
  'mv-van': { path: `${C}/props/van-luggage.png`, w: 64, h: 40 },
  'mv-trip-door': { path: `${C}/ui/trip-door.png`, w: 32, h: 40 },
};

export function preloadTripAssets(ctx: VillageContext, load: Phaser.Loader.LoaderPlugin): void {
  const has = (k: string) => ctx.scene.textures.exists(k);
  for (const [k, p] of Object.entries(IMAGES)) if (!has(k)) load.image(k, ctx.assets.url(p));
  for (const [k, s] of Object.entries(SHEETS)) {
    if (!has(k)) load.spritesheet(k, ctx.assets.url(s.path), { frameWidth: s.w, frameHeight: s.h });
  }
}
