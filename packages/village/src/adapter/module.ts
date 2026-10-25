import type { VillageEvent } from '@squad/core';
import { adaptUnknown } from './adapt';
import type { SceneCommand } from './commands';

/**
 * Adapter hook discovered by the world (docs/village-api.md, AdapterModule).
 * Malformed events are dropped here, never thrown into a scene.
 */
export function createAdapter(opts: { me: string | undefined }): {
  adapt(e: VillageEvent): SceneCommand[];
} {
  return {
    adapt: (e) => adaptUnknown(e, { me: opts.me ?? '' }),
  };
}

export default { createAdapter };
