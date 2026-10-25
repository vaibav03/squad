import type { VillageEvent, VillageSource } from '@squad/core';
import type { EventMeta } from './types';

/**
 * For the web host: `/squad/village?cutscene=trip&task=<id>` is opened after `trip.confirmed` already passed on
 * the stream. Wrap the source and every subscriber receives one synthetic `trip.confirmed`, which the cutscene
 * module plays once per taskId (sessionStorage guard) and skips on later loads.
 *
 * The URL is only a hint: the hub is the authority on whether a trip is confirmed. Pass `verify` (for example a
 * check of GET /v1/trips/:id `status === 'confirmed'`, or the snapshot) and the synthetic event is emitted only
 * after it resolves true; a false result or a rejection emits nothing. The check runs once; subscribers that
 * join before or after it settles each get the event exactly once. Without `verify` the event is emitted
 * immediately and unconditionally (a forged URL can then trigger the cutscene, so hosts should pass `verify`).
 *
 *   const source = withTripCutscene(liveSource, { taskId, squadId, verify });
 *   mountVillage({ parent, source, ... });
 */
export function withTripCutscene(
  source: VillageSource,
  o: { taskId: string; squadId: string; verify?: () => Promise<boolean> },
): VillageSource {
  const synthetic = (): [VillageEvent, EventMeta] => [
    { t: 'trip.confirmed', taskId: o.taskId, squadId: o.squadId },
    { id: `synthetic:trip:${o.taskId}` },
  ];
  if (!o.verify) {
    return {
      subscribe(fn: (e: VillageEvent, meta?: EventMeta) => void) {
        fn(...synthetic());
        return source.subscribe(fn);
      },
    };
  }
  const verify = o.verify;
  type Fn = (e: VillageEvent, meta?: EventMeta) => void;
  let result: 'pending' | 'yes' | 'no' | 'unstarted' = 'unstarted';
  const waiting = new Set<Fn>();
  const run = () => {
    result = 'pending';
    let p: Promise<boolean>;
    try {
      p = Promise.resolve(verify());
    } catch {
      p = Promise.resolve(false);
    }
    void p
      .then(
        (ok) => ok === true,
        () => false,
      )
      .then((ok) => {
        result = ok ? 'yes' : 'no';
        const fns = [...waiting];
        waiting.clear();
        if (ok) for (const fn of fns) fn(...synthetic());
      });
  };
  return {
    subscribe(fn: Fn) {
      if (result === 'unstarted') run();
      if (result === 'yes') fn(...synthetic());
      else if (result === 'pending') waiting.add(fn);
      const un = source.subscribe(fn);
      return () => {
        waiting.delete(fn);
        un();
      };
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
