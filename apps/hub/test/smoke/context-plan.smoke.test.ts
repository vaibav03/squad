// Imported Classroom / Canvas due dates seed the squad study plan: titled and cited only when the owner shared the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanView } from '@squad/core';
import { createCourseStore, hashExternalAccount, normalizeItem } from '@squad/brain';
import type { RunningHub } from '../../src/server';
import { contextServiceFor } from '../../src/context/service';
import { SQUAD_ID } from '../../src/cast';
import { boot, login, auth } from '../helpers';

let hub: RunningHub;
let tok = '';
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

function addDue(owner: string, id: string, title: string, dueInDays: number) {
  const store = contextServiceFor(hub.deps).store;
  if (!store.connection(`g_${owner}`))
    store.upsertConnection({
      id: `g_${owner}`,
      ownerId: owner,
      provider: 'google',
      mode: 'fixture',
      variant: 'oauth',
      accountHash: hashExternalAccount('p', 'google', owner),
      scopes: [],
      status: 'live',
      degraded: false,
      statusNote: null,
      createdAt: Date.now(),
      lastSyncAt: null,
      expiresAt: null,
    });
  const { source, pieces } = normalizeItem(
    {
      ownerId: owner,
      connectionId: `g_${owner}`,
      provider: 'google',
      mode: 'fixture',
      now: Date.now(),
    },
    {
      externalId: id,
      kind: 'classroom_item',
      title,
      courseId: 'g1',
      url: null,
      modifiedAt: null,
      dueAt: Date.now() + dueInDays * DAY,
    },
    { text: `${title}: submit through Classroom.` },
  );
  store.upsertSource(source, pieces);
  return source;
}

beforeAll(async () => {
  hub = await boot();
  const cs = createCourseStore(hub.deps.db);
  cs.saveCourse({ id: 'demo', title: 'Statistics' });
  for (const [i, id] of ['ch1', 'ch2'].entries())
    cs.saveChapter({
      courseId: 'demo',
      id,
      title: `Topic ${i + 1}`,
      summary: 's',
      file: `${id}.pdf`,
      pageStart: 1,
      pageEnd: 9,
    });
  tok = await login(hub.url, 's_ana');
});
afterAll(async () => {
  await hub.stop();
});

describe('due dates seed the plan', () => {
  it('a shared Classroom item becomes a cited prep item; a private one is date-only and uncited', async () => {
    const shared = addDue('s_ana', 'k_shared', 'Stats Project Proposal', 6);
    addDue('s_ben', 'k_private', 'Private Counseling Paperwork', 7);
    contextServiceFor(hub.deps).store.share(shared.id, SQUAD_ID);
    const r = await fetch(`${hub.url}/v1/plans`, {
      method: 'POST',
      headers: auth(tok),
      body: JSON.stringify({ examDate: day(12) }),
    });
    expect(r.status).toBe(200);
    const plan = ((await r.json()) as { plan: PlanView }).plan;
    const prep = plan.items.find((i) => i.title === 'Prep: Stats Project Proposal')!;
    expect(prep).toBeTruthy();
    expect(prep.ownerId).toBe('s_ana');
    expect(prep.date <= day(6)).toBe(true);
    expect(prep.sources[0]!.source).toMatchObject({ kind: 'classroom_item', id: shared.id });
    expect(plan.citations.some((c) => c.source?.id === shared.id)).toBe(true);
    const priv = plan.items.find(
      (i) => i.ownerId === 's_ben' && /Prep for a deadline/.test(i.title),
    )!;
    expect(priv).toBeTruthy();
    expect(priv.sources[0]!.source).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain('Counseling');
  });
});
