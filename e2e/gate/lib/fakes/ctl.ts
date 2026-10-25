// Extra gate-hub control calls (clock skew for the outbound retry ladder, delivery receipts).
import { CTL } from '../config';

async function post(p: string, body: unknown = {}): Promise<any> {
  const r = await fetch(`${CTL}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

export const ctl = {
  /** A fresh world (default) or the journey singleton (agent-backed, survives a hub restart). */
  world: (
    opts: { kind?: 'fresh' | 'journey'; b?: boolean; relogin?: boolean } = {},
  ): Promise<any> => post('/ctl/world', opts),
  /** Moves the iMessage bridge clock forward so the next retry/expiry rung is due. */
  advance: (ms: number): Promise<{ skewMs: number }> => post('/ctl/clock/advance', { ms }),
  /** A delivery receipt from "Apple" for an outbound GUID (`out-N`). */
  receipt: (guid: string, state: 'delivered' | 'failed' = 'delivered', reason?: string) =>
    post('/ctl/im/receipt', { guid, state, ...(reason ? { reason } : {}) }),
};
