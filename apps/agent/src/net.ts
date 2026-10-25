import { postEvent, type VillageEvent } from '@squad/core';
import type { AgentMessage } from '@squad/core';
import type { Emitter, Net, WireReply } from '@squad/mesh';
import { z } from 'zod';

const ReplySchema = z.object({
  taskId: z.string(),
  state: z.enum(['submitted', 'working', 'input-required', 'completed', 'failed', 'canceled']),
  message: z.unknown().optional(),
  error: z.string().optional(),
});

/** HTTP transport between agents. Offline or slow peers reject (the runtime maps that to offline/timeout). */
export function createHttpNet(
  peers: Record<string, string>,
  timeoutMs = 5000,
  f: typeof fetch = fetch,
): Net {
  return {
    async send(to: string, msg: AgentMessage): Promise<WireReply> {
      const base = peers[to];
      if (!base) throw new Error('unknown peer');
      const res = await f(`${base.replace(/\/+$/, '')}/a2a`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = ReplySchema.parse(await res.json());
      return parsed as WireReply;
    },
  };
}

/** Emits to the hub through core's single helper; never throws. */
export function createHubEmitter(opts: Parameters<typeof postEvent>[1] = {}): Emitter {
  return {
    async emit(e: VillageEvent) {
      try {
        await postEvent(e, opts);
      } catch {
        /* an invalid event is a programming error, but must not take the agent down */
      }
    },
  };
}
