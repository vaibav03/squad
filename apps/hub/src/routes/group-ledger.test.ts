import { GroupLedgerResponseSchema, type Plan } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { signToken } from '../auth';

const SECRET = 'gl-test';
const tok = (sub: string) => signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }).token;

function setup() {
  const hub = createHub({
    config: { seed: false, sim: false, authSecret: SECRET, logLevel: 'silent' },
  });
  const d = hub.deps.directory;
  for (const [id, name] of [['s_ana', 'Ana'], ['s_ben', 'Ben'], ['s_zed', 'Zed']] as const)
    d.upsertStudent({ id, name, handle: id });
  d.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana', 's_ben'] });
  d.upsertSquad({ id: 'sq2', name: 'sq2', members: ['s_zed'] });
  const plan = {
    id: 'p1', squadId: 'sq', courseId: 'c', title: 'Stats exam', status: 'active', organizerId: 's_ana',
    examDate: null, examLabel: '', rev: 1, items: [], members: [], conflicts: [], citations: [],
    generator: { mode: 'demo', source: 'Fixture planner', note: '', kind: 'fallback' },
    createdAt: 1, updatedAt: 3,
    log: [
      { ts: 1000, by: 's_ana', text: 'plan proposed' },
      { ts: 2000, by: 's_ben', text: 'accepted' },
      { ts: 3000, by: 's_ben', text: 'edited ch6 review' },
    ],
  } as unknown as Plan;
  hub.deps.plans.store.save(plan);
  const get = (path: string, sub: string) =>
    hub.app.request(path, { headers: { authorization: `Bearer ${tok(sub)}` } });
  return { get };
}

describe('GET /v1/groups/:groupId/ledger', () => {
  it('lists the group ledger newest first with honest mode', async () => {
    const { get } = setup();
    const res = await get('/v1/groups/group:sq/ledger', 's_ben');
    expect(res.status).toBe(200);
    const body = GroupLedgerResponseSchema.parse(await res.json());
    expect(body.entries.map((e) => e.kind)).toEqual(['edit', 'vote', 'plan_created']);
    expect(body.entries[0]!.text).toContain('Ben');
    expect(body.entries.every((e) => e.mode === 'demo')).toBe(true);
  });
  it('is 404 for another squad and 401 without a token', async () => {
    const { get } = setup();
    expect((await get('/v1/groups/group:sq/ledger', 's_zed')).status).toBe(404);
    expect((await get('/v1/groups/group:nope/ledger', 's_ana')).status).toBe(404);
  });
});
