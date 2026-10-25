import type { VillageSource } from '@squad/core';
import type { OverlayEvent } from '@squad/village';

/**
 * World registry for the host page. A "world" is anything that renders the squad's VillageEvents into a canvas and
 * talks to React only through the overlay bridge: it calls `onOverlay(OverlayEvent)` to ask for a DOM overlay and the
 * host calls `overlayClosed()` when that overlay is gone. The side-view village and the top-down interior campus
 * (`@squad/interior`) both fit this shape, so the host page never names either one.
 */
export interface WorldMountOptions {
  parent: HTMLElement;
  source: VillageSource;
  me?: string;
  calm?: boolean;
  onOverlay: (e: OverlayEvent) => void;
}
export interface WorldHandle {
  destroy(): void;
  /** The overlay requested through `onOverlay` was dismissed (unlocks world input, refocuses the canvas). */
  overlayClosed(): void;
  ready: Promise<void>;
  setCalm?(v: boolean): void;
}
export type WorldMount = (o: WorldMountOptions) => WorldHandle;
/** Loaded lazily so Phaser (or any engine) stays out of the main bundle. */
export type WorldLoader = () => Promise<WorldMount>;

const registry = new Map<string, WorldLoader>();
export const DEFAULT_WORLD = 'village';

export function registerWorld(id: string, loader: WorldLoader): void {
  registry.set(id, loader);
}
export const worldIds = (): string[] => [...registry.keys()];
export function loadWorld(id: string): Promise<WorldMount> {
  const loader = registry.get(id) ?? registry.get(DEFAULT_WORLD);
  if (!loader) return Promise.reject(new Error('No world is registered.'));
  return loader();
}

registerWorld('village', async () => {
  const { mountVillage } = await import('@squad/village');
  return (o) =>
    mountVillage({
      parent: o.parent,
      source: o.source,
      me: o.me,
      calm: o.calm,
      onOverlay: o.onOverlay,
    });
});

// The interior campus registers itself the same way once @squad/interior lands:
//   registerWorld('interior', async () => (await import('@squad/interior')).mountInterior);
