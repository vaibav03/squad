import type { SceneBundle } from './contract';

export * from './contract';
export * from './routing';
export * from './curves';

/** Every building in the village. Each family exports its bundles from its own module. */
export const BUNDLES: readonly SceneBundle<unknown>[] = [];
