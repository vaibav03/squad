import type { SceneModule } from '../world/api';
import { loadPixelFont, preloadMeshAssets } from './assets';
import { createMeshView } from './view';

/** Mesh view module (order 200): discovered by the world through `src/mesh-view/module.ts`. */
const mod: SceneModule = {
  id: 'mesh-view',
  order: 200,
  preload(ctx, load) {
    preloadMeshAssets(ctx, load);
    void loadPixelFont(ctx);
  },
  create(ctx) {
    return createMeshView(ctx);
  },
};
export default mod;
