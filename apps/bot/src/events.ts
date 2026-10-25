import { VillageEventSchema, findLeak, postEvent, type VillageEvent } from '@squad/core';
import type { EventPublisher, Logger } from './types';
import { nullLogger } from './log';

export interface PublisherOptions {
  post?: typeof postEvent;
  log?: Logger;
  baseUrl?: string;
  secret?: string;
  /** extra sentinel strings that must never appear in any event (tests plant them) */
  sentinels?: readonly string[];
}

/**
 * Defense in depth on top of core's strict schemas: a ledger.entry may only say `withheld: 'hidden'`,
 * and (when configured) no sentinel string may appear anywhere in an event.
 */
export function guardEvent(e: VillageEvent, sentinels: readonly string[] = []): string | undefined {
  if (e.t === 'ledger.entry' && e.withheld !== undefined && e.withheld !== 'hidden') {
    return 'ledger.entry carries a withheld value';
  }
  if (sentinels.length) {
    const leak = findLeak(e, sentinels);
    if (leak) return 'event contains a withheld sentinel';
  }
  return undefined;
}

export function createEventPublisher(opts: PublisherOptions = {}): EventPublisher {
  const post = opts.post ?? postEvent;
  const log = opts.log ?? nullLogger;
  return {
    async publish(e) {
      const parsed = VillageEventSchema.safeParse(e);
      if (!parsed.success) {
        log.error(
          { t: (e as { t?: string }).t, issues: parsed.error.issues.length },
          'invalid event dropped',
        );
        return;
      }
      const blocked = guardEvent(parsed.data, opts.sentinels);
      if (blocked) {
        log.error({ t: parsed.data.t, reason: blocked }, 'event blocked by privacy guard');
        return;
      }
      try {
        const r = await post(parsed.data, { baseUrl: opts.baseUrl, secret: opts.secret });
        if (!r.ok)
          log.warn({ t: parsed.data.t, status: r.status, attempts: r.attempts }, 'hub post failed');
      } catch (err) {
        log.error({ t: parsed.data.t, err: (err as Error).message }, 'event post threw');
      }
    },
  };
}

export type RecordingPublisher = EventPublisher & { events: VillageEvent[] };

/** Collects validated events in memory (tests, the CLI recorder). */
export function recordingPublisher(sentinels: readonly string[] = []): RecordingPublisher {
  const events: VillageEvent[] = [];
  return {
    events,
    async publish(e) {
      const p = VillageEventSchema.parse(e);
      const blocked = guardEvent(p, sentinels);
      if (blocked) throw new Error(blocked);
      events.push(p);
    },
  };
}

export function teePublisher(...pubs: EventPublisher[]): EventPublisher {
  return {
    async publish(e) {
      await Promise.all(pubs.map((p) => p.publish(e)));
    },
  };
}
