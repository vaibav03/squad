import { postHubEnvelope, type PostEventOptions } from '@squad/core';
import type { HubPort } from '@squad/mesh';

/**
 * Owner-only channel to the hub (`x.ledger.private`, `x.trip.upsert`, `x.trip.limits`). The hub stores these privately and never streams them raw.
 * Each agent only knows its own student's raw values, so `limits` carries only the coordinator's own entry.
 */
export function createHubPort(opts: PostEventOptions = {}): HubPort {
  return {
    async ledgerPrivate(e) {
      try {
        await postHubEnvelope('x.ledger.private', e, opts);
      } catch {
        /* best effort */
      }
    },
    async tripLimits(e) {
      try {
        await postHubEnvelope('x.trip.limits', e, opts);
      } catch {
        /* best effort */
      }
    },
    async tripUpsert(rec) {
      try {
        await postHubEnvelope('x.trip.upsert', rec, opts);
      } catch {
        /* best effort */
      }
    },
  };
}
