// Phaser-free entry (`@squad/village/sources`). Must never import phaser or touch window at import time.
export type { VillageSource } from '@squad/core';
export const VILLAGE_SOURCES_ENTRY = true;
export { createLiveSource, snapshotToEvents } from './live';
export type {
  LiveSource,
  LiveSourceOptions,
  LiveStatus,
  SquadSnapshot,
  EventSourceLike,
} from './live';
export { createReplaySource, loadReplay } from './replay';
export type { ReplaySource, ReplaySourceOptions, ReplayStatus, ReplaySpeed } from './replay';
export type { Clock, EventMeta, SourceLogger, Unsubscribe } from './types';
export { systemClock } from './types';
