import type { VillageEvent } from '@squad/core';
import { adaptUnknown } from './adapt';
import type { SceneCommand } from './commands';

/**
 * Adapter hook discovered by the world (docs/village-api.md, AdapterModule).
 * Malformed events are dropped here, never thrown into a scene. The only state is a small
 * callId -> student map (from call.start) so captions of someone else's call are dropped;
 * `adapt()` itself stays pure.
 */
export function createAdapter(opts: { me: string | undefined }): {
  adapt(e: VillageEvent): SceneCommand[];
} {
  const me = opts.me ?? '';
  const callStudent = new Map<string, string>();
  return {
    adapt: (e) => {
      const t = (e as { t?: unknown } | null)?.t;
      const callId = (e as { callId?: unknown } | null)?.callId;
      const student = (e as { student?: unknown } | null)?.student;
      if (typeof callId === 'string') {
        if (t === 'call.caption') {
          const owner = callStudent.get(callId);
          if (owner !== undefined && owner !== me) return [];
        }
      }
      const out = adaptUnknown(e, { me });
      if (
        t === 'call.start' &&
        typeof callId === 'string' &&
        typeof student === 'string' &&
        out.length
      )
        callStudent.set(callId, student);
      if (t === 'call.end' && typeof callId === 'string') callStudent.delete(callId);
      return out;
    },
  };
}

export default { createAdapter };
