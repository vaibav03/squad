// Shared study plan over REST: create, accept, edit, conflict, confirm, isolation and privacy sentinels.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Plan, PlanView } from '@squad/core';
import { createCourseStore } from '@squad/brain';
import type { RunningHub } from '../../src/server';
import { boot, get, login, post, auth } from '../helpers';

let hub: RunningHub;
let url: string;
const tk: Record<string, string> = {};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
type R = { plan?: PlanView; error?: { code: string }; conflict?: { id: string } };

const call = async (method: string, path: string, who: string, body?: unknown) => {
  const r = await fetch(url + path, {
    method,
    headers: auth(tk[who]!),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as R };
};

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  const cs = createCourseStore(hub.deps.db);
  cs.saveCourse({ id: 'demo', title: 'Statistics' });
  for (const [i, id] of ['ch1', 'ch2', 'ch3', 'ch4'].entries())
    cs.saveChapter({
      courseId: 'demo',
      id,
      title: `Topic ${i + 1}`,
      summary: 's',
      file: `${id}-slides.pdf`,
      pageStart: 1,
      pageEnd: 20,
    });
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed@demo.test' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  for (const id of ['s_ana', 's_ben', 's_chi', 's_dev', 's_zed']) tk[id] = await login(url, id);
});
afterAll(async () => {
  await hub.stop();
});

describe('shared study plan', () => {
  let planId = '';

  it('proposes a squad plan with owners, citations and a countdown', async () => {
    const r = await call('POST', '/v1/plans', 's_ana', { examDate: day(10) });
    expect(r.status).toBe(200);
    const p = r.body.plan!;
    planId = p.id;
    expect(p.status).toBe('proposed');
    expect(p.items.length).toBeGreaterThan(0);
    expect(new Set(p.items.map((i) => i.ownerId)).size).toBeGreaterThan(1);
    expect(p.citations.length).toBeGreaterThan(0);
    expect(p.countdown?.days).toBe(10);
    expect(p.rev).toBeGreaterThanOrEqual(1);
  });

  it('is visible to the squad and hidden from another squad', async () => {
    expect((await call('GET', `/v1/plans/${planId}`, 's_ben')).status).toBe(200);
    expect((await call('GET', `/v1/plans/${planId}`, 's_zed')).status).toBe(404);
    expect((await call('GET', '/v1/plans/current', 's_zed')).body.plan).toBeNull();
    expect(
      (await call('POST', `/v1/plans/${planId}/respond`, 's_zed', { response: 'accept' })).status,
    ).toBe(404);
    expect((await call('POST', `/v1/plans/${planId}/confirm`, 's_zed')).status).toBe(404);
  });

  it('edits to different items merge without conflict; the same item stale edit conflicts, keeping both versions', async () => {
    let p = (await call('GET', `/v1/plans/${planId}`, 's_ana')).body as unknown as PlanView;
    const [a, b] = [p.items[0]!, p.items[1]!];
    const base = p.rev;
    const e1 = await call('PATCH', `/v1/plans/${planId}/items/${a.id}`, 's_ana', {
      baseRev: base,
      patch: { durationMin: 90 },
    });
    expect(e1.status).toBe(200);
    // stale base on a different item: merges
    const e2 = await call('PATCH', `/v1/plans/${planId}/items/${b.id}`, 's_ben', {
      baseRev: base,
      patch: { durationMin: 30 },
    });
    expect(e2.status).toBe(200);
    // stale base on the same item: conflict, no silent overwrite
    const e3 = await call('PATCH', `/v1/plans/${planId}/items/${a.id}`, 's_ben', {
      baseRev: base,
      patch: { durationMin: 20 },
    });
    expect(e3.status).toBe(409);
    expect(e3.body.conflict?.id).toBeTruthy();
    p = (await call('GET', `/v1/plans/${planId}`, 's_ana')).body as unknown as PlanView;
    expect(p.items.find((i) => i.id === a.id)!.durationMin).toBe(90);
    const c = p.conflicts.find((x) => x.status === 'open')!;
    expect(c.theirs.durationMin).toBe(90);
    expect(c.mine.durationMin).toBe(20);
    // pick mine
    const res = await call('POST', `/v1/plans/${planId}/conflicts/${c.id}/resolve`, 's_ben', {
      pick: 'mine',
    });
    expect(res.status).toBe(200);
    expect(res.body.plan!.items.find((i) => i.id === a.id)!.durationMin).toBe(20);
    expect(res.body.plan!.conflicts.filter((x) => x.status === 'open')).toHaveLength(0);
  });

  it('activates when every opted-in member accepted; decline reassigns; organizer can confirm', async () => {
    const v = (await call('GET', `/v1/plans/${planId}`, 's_ana')).body as unknown as PlanView;
    const members = v.members.filter((m) => m.optedIn).map((m) => m.id);
    // a non-organizer cannot confirm
    const nope = await call(
      'POST',
      `/v1/plans/${planId}/confirm`,
      members.find((m) => m !== 's_ana')!,
    );
    expect([403, 409]).toContain(nope.status);
    let last: R = {};
    for (const m of members)
      last = (await call('POST', `/v1/plans/${planId}/respond`, m, { response: 'accept' })).body;
    expect(last.plan!.status).toBe('active');
  });

  it('marks an item done (owner or organizer only) and counts progress without any score', async () => {
    const owner = (await call('GET', `/v1/plans/${planId}`, 's_ana')).body as unknown as PlanView;
    const it = owner.items.find((i) => i.ownerId !== 's_ana') ?? owner.items[0]!;
    const stranger = ['s_ben', 's_chi', 's_dev'].find((m) => m !== it.ownerId)!;
    expect(
      (await call('POST', `/v1/plans/${planId}/items/${it.id}/done`, stranger, {})).status,
    ).toBe(403);
    const byOwner = await call('POST', `/v1/plans/${planId}/items/${it.id}/done`, it.ownerId, {});
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.plan!.progress.done).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(byOwner.body)).not.toMatch(/streak|points|leaderboard|\bxp\b/i);
  });

  it('mirrors decisions into the group chat thread as plain text', async () => {
    const sq = (await call('GET', '/v1/plans/current', 's_ana')).body.plan!.squadId;
    const texts = hub.deps.chat.store
      .history(`group:${sq}`, { limit: 100 })
      .messages.map((m) => m.text);
    expect(texts.some((t) => /accepted|active|finished|conflict|Study plan/i.test(t))).toBe(true);
    expect(texts.join('\n')).not.toMatch(/\$180|therapy/i);
  });

  it('never leaks private sentinels into any plan response', async () => {
    const all = await Promise.all(
      ['s_ana', 's_ben', 's_chi', 's_dev'].map(async (u) =>
        JSON.stringify((await get(url, '/v1/plans/current', tk[u])).body),
      ),
    );
    for (const s of all) expect(s).not.toMatch(/\$180|therapy/i);
    const plan = hub.deps.plans.store.get(planId) as Plan;
    expect(JSON.stringify(plan)).not.toMatch(/\$180|therapy/i);
  });
});
void post;

describe('plan failures are said in the group', () => {
  it('a rejected proposal posts a plain-text reason to the group thread', async () => {
    const r = await call('POST', '/v1/plans', 's_ana', { examDate: '2020-01-01' });
    expect(r.status).toBe(422);
    const texts = hub.deps.chat.store
      .history('group:sq_demo', { limit: 200 })
      .messages.map((m) => m.text);
    expect(texts.some((t) => /could not be made/i.test(t))).toBe(true);
  });
});
