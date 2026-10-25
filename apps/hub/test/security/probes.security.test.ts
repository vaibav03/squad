import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProbes, ALL } from '../../../../scripts/security/probes';
import type { RunningHub } from '../../src/server';
import { boot, login, SECRET } from '../helpers';

let hub: RunningHub;
const tokens = {} as { ana: string; ben: string; zed: string };

beforeAll(async () => {
  hub = await boot({ internalSecret: SECRET });
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed@demo.test' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  tokens.ana = await login(hub.url, 's_ana');
  tokens.ben = await login(hub.url, 's_ben');
  tokens.zed = await login(hub.url, 's_zed');
});
afterAll(() => hub.stop());

const ctx = () => ({
  url: hub.url,
  secret: SECRET,
  tokens,
  taskA: 'task_trip_cabo',
  tripA: 'trip_cabo',
});

describe('attack probes (regression for every fixed finding)', () => {
  for (const name of Object.keys(ALL))
    it(`probe ${name} finds nothing`, async () => {
      expect(await runProbes(ctx(), [name])).toEqual([]);
    }, 60_000);
});

describe('why the guards exist', () => {
  it('the bare ledger route leaks another squad shared rows (baseline; ledgerScope is the fix)', async () => {
    const rows = hub.deps.ledger.entries('task_trip_cabo', {
      studentId: 's_zed',
      squadId: 'sq_other',
      projector: false,
    });
    expect(rows.length).toBeGreaterThan(0); // the store is not squad-scoped
    const r = await fetch(`${hub.url}/v1/ledger/task_trip_cabo`, {
      headers: { authorization: `Bearer ${tokens.zed}` },
    });
    expect(r.status).toBe(404); // the middleware is
  });

  it('a peer in the same squad still reads the squad ledger', async () => {
    const r = await fetch(`${hub.url}/v1/ledger/task_trip_cabo`, {
      headers: { authorization: `Bearer ${tokens.ben}` },
    });
    expect(r.status).toBe(200);
  });
});
