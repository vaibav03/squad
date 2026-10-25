import { describe, expect, it } from 'vitest';
import { runLoad } from '../../scripts/load';

describe('load: 50 SSE clients', () => {
  it('every fast client gets every event once in order, slow clients are dropped, no leak', async () => {
    const r = await runLoad({ clients: 50, slow: 5, events: 300, ratePerSec: 1000 });
    expect(r).toMatchObject({ missing: 0, outOfOrder: 0, duplicates: 0, subscribersAfter: 0 });
    expect(r.slowDropped).toBe(r.slowClients);
    expect(r.heapGrowthMb).toBeLessThan(400);
    expect(r.p99Ms).toBeLessThan(1000);
  }, 60_000);
});
