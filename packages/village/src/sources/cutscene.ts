import type { VillageEvent, VillageSource } from '@squad/core';
import type { EventMeta } from './types';

/**
 * For the web host: `/squad/village?cutscene=trip&task=<id>` is opened after `trip.confirmed` already passed on
 * the stream. Wrap the source and every new subscriber first receives one synthetic `trip.confirmed`, which the
 * cutscene module plays once per taskId (sessionStorage guard) and skips on later loads.
 *
 *   const source = withTripCutscene(liveSource, { taskId, squadId });
 *   mountVillage({ parent, source, ... });
 */
export function withTripCutscene(
  source: VillageSource,
  o: { taskId: string; squadId: string },
): VillageSource {
  return {
    subscribe(fn: (e: VillageEvent, meta?: EventMeta) => void) {
      fn(
        { t: 'trip.confirmed', taskId: o.taskId, squadId: o.squadId },
        { id: `synthetic:trip:${o.taskId}` },
      );
      return source.subscribe(fn);
    },
  };
}

/** Parse `?cutscene=trip&task=<id>[&squad=<id>]`. Returns undefined unless both cutscene=trip and a task id exist. */
export function tripCutsceneFromQuery(
  search: string,
): { taskId: string; squadId: string } | undefined {
  const q = new URLSearchParams(search);
  if (q.get('cutscene') !== 'trip') return undefined;
  const taskId = q.get('task');
  if (!taskId) return undefined;
  return { taskId, squadId: q.get('squad') ?? 'squad' };
}
