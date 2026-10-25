// TODO(shared): dedupe into @squad/world-shared (source: ws/village-mesh packages/village/src/sources/; interior only needs the VillageSource type)
// Phaser-free entry. Source implementations (live SSE, replay) live in packages/village (ws/village-mesh,
// src/sources). They are world-agnostic and should move to a shared package; until then hosts pass any
// `VillageSource` straight in, and this file offers a tiny in-memory one for the dev harness and tests.
import type { VillageEvent, VillageSource } from '@squad/core';

export type { VillageSource } from '@squad/core';

export interface ManualSource extends VillageSource {
  emit(e: VillageEvent): void;
}

export function createManualSource(): ManualSource {
  const subs = new Set<(e: VillageEvent) => void>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    emit(e) {
      for (const fn of [...subs]) fn(e);
    },
  };
}
