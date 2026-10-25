import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { AGENT_PORT, AGENT_URL, HUB, REPO, STUDENTS, TMP } from '../lib/env';
import { actor, api, apiLogin, expect, sseEvents, shot, test, type Actor } from '../lib/helpers';
import { baseEnv, waitFor } from '../lib/stack';

/**
 * J21: collaborative trip planning with four students on live agents (hub, web and agents on this stack).
 * One world, serial steps: create from the Trip page, agents check free days and budgets privately, a teammate
 * proposes an option, a stale edit is refused (no silent overwrite), secret ballot with votes cast on the page, by
 * "I vote 1" and by a numbered DM reply, confirm in chat and on the page, `trip.confirmed` exactly once, then an
 * offline agent that is named and resumed by Retry. The group chat carries a plain-text summary of every step.
 */
const J = 'j21-trip';
const GROUP = 'group:sq_demo';
const SENTINEL = /therapy/i; // Ana's private hard-no topic from the agent fixtures
const [ANA, BEN, CHI, DEV] = STUDENTS;

const tok: Record<string, string> = {};
const A = {} as Record<string, Actor>;

const j = async <T>(r: Response): Promise<T> => (await r.json()) as T;
interface Trip {
  tripId: string;
  taskId: string;
  status: string;
  title: string;
  rev: number;
  options: { id: string; label: string; rev?: number; perPerson?: number; droppedReason?: string }[];
  voteProgress: { voted: number; of: number } | null;
  myVote: string[] | null;
  chosen: { optionId: string } | null;
  members: { id: string; name: string; voted: boolean | null; confirmed: boolean; agent: string }[];
  constraints: { state: string; note: string | null; overlapDays: string[] | null; waitingFor: { id: string }[] };
  recommendation: { mode: string } | null;
}
const current = async (id: string) =>
  (await j<{ trip: Trip | null }>(await api(tok[id]!, '/v1/trips/current'))).trip;
const history = async (id: string, chatId: string) =>
  (
    await j<{ messages: { text: string }[] }>(
      await api(tok[id]!, `/v1/chat/history?chatId=${encodeURIComponent(chatId)}`),
    )
  ).messages.map((m) => m.text);
interface Card { type: string; question: string; options: string[]; status: string }
const dmCards = async (id: string) =>
  (
    await j<{ messages: { card?: Card }[] }>(
      await api(tok[id]!, `/v1/chat/history?chatId=${encodeURIComponent(`dm:${id}`)}`),
    )
  ).messages.flatMap((m) => (m.card?.type === 'confirm' ? [m.card] : []));
const say = (id: string, chatId: string, text: string) =>
  api(tok[id]!, '/v1/chat/send', { method: 'POST', json: { chatId, text } });
const until = async <T>(fn: () => Promise<T | undefined | false>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
};
const open = async (page: Page) => {
  await page.goto('/squad/trips');
  await expect(page.getByTestId('trip-constraints').or(page.getByTestId('trip-empty')).or(page.getByTestId('trip-another'))).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
};

/** Long-lived SSE reader for one student (until stop()). */
async function openStream(id: string) {
  const st = (
    await j<{ st: string }>(await api(tok[id]!, '/v1/squad/stream-token', { method: 'POST' }))
  ).st;
  const ctl = new AbortController();
  let buf = '';
  void (async () => {
    try {
      const r = await fetch(`${HUB}/v1/squad/stream?st=${encodeURIComponent(st)}`, { signal: ctl.signal });
      const rd = r.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value);
      }
    } catch {
      /* stopped */
    }
  })();
  return { events: () => sseEvents(buf), stop: () => ctl.abort() };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  await fetch(`${HUB}/__sim/squad/reset`, { method: 'POST' });
  for (const id of STUDENTS) tok[id] = await apiLogin(id);
  for (const id of STUDENTS) A[id] = await actor(browser, id);
});
test.afterAll(async () => {
  for (const a of Object.values(A)) await a.ctx.close();
});

test('J21.1 Plan another trip on the Trip page creates a shared trip; the group chat says so', async () => {
  test.setTimeout(120_000);
  const p = A[ANA]!.page;
  await p.goto('/squad/trips');
  await p.getByTestId('trip-another').getByTestId('trip-create-open').click();
  await p.getByLabel('Destination').fill('Cabo');
  await p.getByLabel('Month (optional)').selectOption('3');
  await p.getByRole('button', { name: 'Start planning' }).click();
  await expect(p.getByRole('heading', { name: 'Cabo in March' })).toBeVisible({ timeout: 30_000 });
  await shot(p, J, '1-created');
  const t = await until(async () => {
    const c = await current(BEN);
    return c?.title === 'Cabo in March' && c.status === 'voting' ? c : undefined;
  }, 'constraints done and voting open');
  expect(t.constraints.state).toBe('done');
  const chat = (await history(DEV, GROUP)).join('\n');
  expect(chat).toContain('started a trip plan for Cabo');
  expect(chat).toContain('Voting is open');
  expect(chat).not.toMatch(SENTINEL);
});

test('J21.2 agents shared only free days: the page shows overlap and a labelled recommendation, no calendars', async () => {
  const p = A[BEN]!.page;
  await open(p);
  await expect(p.getByTestId('trip-overlap')).toContainText('Free days for everyone');
  await expect(p.getByTestId('trip-rec-mode')).toHaveText(/live|demo|degraded|Live|Demo|Degraded/i);
  await expect(p.getByText(/hub did not answer/i)).toHaveCount(0);
  await shot(p, J, '2-overlap-and-reco');
  const body = await p.locator('body').innerText();
  expect(body).not.toMatch(SENTINEL);
});

test('J21.3 a teammate proposes an option on the page', async () => {
  const p = A[BEN]!.page;
  await open(p);
  const form = p.getByTestId('trip-propose-form');
  await form.getByLabel('Where').fill('Tahoe');
  await form.getByLabel('Days (optional)').fill('2');
  await form.getByLabel('Cost per person (optional)').fill('90');
  await form.getByRole('button', { name: 'Add option' }).click();
  await until(async () => (await current(ANA))?.options.some((o) => o.label === 'Tahoe'), 'Tahoe visible to Ana');
  expect((await history(ANA, GROUP)).join('\n')).toMatch(/Ben proposed Tahoe/);
});

test('J21.4 two members edit the same option at once: one wins, the other is told (409), nothing is silently overwritten', async () => {
  const t = (await current(ANA))!;
  const opt = t.options.find((o) => o.label === 'Tahoe')!;
  const edit = (id: string, perPerson: number, baseRev: number, replace = false) =>
    api(tok[id]!, `/v1/trips/${t.tripId}/options/${opt.id}`, {
      method: 'PATCH',
      json: { baseRev, perPerson, ...(replace ? { replace: true } : {}) },
    });
  const rev = opt.rev!;
  const first = await edit(BEN, 110, rev);
  expect(first.status).toBe(200);
  const second = await edit(ANA, 95, rev);
  expect(second.status).toBe(409);
  const body = await j<{ error: { code: string }; conflict: { rev: number; change: { byName: string } | null } }>(second);
  expect(body.error.code).toBe('conflict');
  expect(body.conflict.change?.byName).toBe('Ben');
  expect((await current(ANA))!.options.find((o) => o.id === opt.id)!.perPerson).toBe(110);
  // Chi opens the page: the change log is visible and honest
  const log = (await history(CHI, GROUP)).join('\n');
  expect(log).toMatch(/Ben changed Tahoe/);
  const replaced = await edit(ANA, 95, body.conflict.rev, true);
  expect(replaced.status).toBe(200);
  expect((await current(ANA))!.options.find((o) => o.id === opt.id)!.perPerson).toBe(95);
});

test('J21.5 secret ballot: counts hidden below 3, votes by page, "I vote 1" and a numbered DM reply', async () => {
  test.setTimeout(120_000);
  const t0 = (await current(ANA))!;
  const live = t0.options.filter((o) => !o.droppedReason);
  expect(live.length, 'at least two options survive the private limits').toBeGreaterThanOrEqual(2);
  // Ana on the page
  const pa = A[ANA]!.page;
  await open(pa);
  await expect(pa.getByTestId('trip-vote')).toBeVisible();
  await pa.getByTestId('trip-submit-vote').click();
  await until(async () => (await current(ANA))?.myVote, 'Ana vote stored');
  // Ben types it in his DM with Cubbie (stays private)
  await say(BEN, `dm:${BEN}`, 'I vote 1');
  await until(async () => (await current(BEN))?.myVote, 'Ben vote stored');
  // Two voters: Chi sees no counts, no participation, no rankings
  const chi = (await current(CHI))!;
  expect(chi.voteProgress).toBeNull();
  expect(chi.members.filter((m) => m.id !== CHI).every((m) => m.voted === null)).toBe(true);
  const pc = A[CHI]!.page;
  await open(pc);
  await expect(pc.getByTestId('trip-vote-progress')).toHaveCount(0);
  await expect(pc.getByTestId('trip-vote-note')).toContainText('Counts appear once 3 members have voted');
  await shot(pc, J, '5-ballot-hidden');
  // Chi answers the numbered vote card Cubbie put in the DM
  const card = await until(
    async () => (await dmCards(CHI)).find((c) => /Trip vote: where to\?/.test(c.question) && c.status === 'pending'),
    'vote card in Chi DM',
  );
  expect(card.options.length).toBeGreaterThanOrEqual(2); // answered by number below
  await say(CHI, `dm:${CHI}`, '1');
  await until(async () => (await current(ANA))?.voteProgress, 'counts appear at 3 voters');
  expect((await current(ANA))!.voteProgress).toMatchObject({ voted: 3, of: 4 });
  // Dev votes on the page last: voting closes on the 4th ballot
  const pd = A[DEV]!.page;
  await open(pd);
  await pd.getByTestId('trip-submit-vote').click();
  const t = await until(async () => {
    const c = await current(ANA);
    return c?.status === 'confirming' ? c : undefined;
  }, 'voting closed -> confirming');
  expect(t.chosen).not.toBeNull();
  expect((await history(ANA, GROUP)).join('\n')).toContain('Voting closed');
  // nobody's ranking is in anybody else's payloads
  for (const id of [ANA, CHI, DEV]) expect(A[id]!.bodies.join('\n')).not.toMatch(/"ranking"/);
});

test('J21.6 confirm in chat and on the page; trip.confirmed fires exactly once; cutscene link', async () => {
  test.setTimeout(120_000);
  const t = (await current(ANA))!;
  const sse = await openStream(ANA);
  await say(ANA, GROUP, 'confirm');
  const pb = A[BEN]!.page;
  await open(pb);
  await pb.getByTestId('trip-confirm-yes').click();
  await until(async () => (await current(BEN))?.members.find((m) => m.id === BEN)?.confirmed, 'Ben confirmed');
  expect((await current(ANA))!.status).toBe('confirming'); // two of four is not a trip
  await say(CHI, `dm:${CHI}`, 'confirm');
  expect((await api(tok[DEV]!, `/v1/trips/${t.tripId}/confirm`, { method: 'POST', json: { yes: true } })).status).toBe(200);
  await api(tok[DEV]!, `/v1/trips/${t.tripId}/confirm`, { method: 'POST', json: { yes: true } }); // repeat is harmless
  await until(async () => (await current(ANA))?.status === 'confirmed', 'trip confirmed');
  await new Promise((r) => setTimeout(r, 1500));
  const confirmed = sse.events().filter((e) => e.event === 'trip.confirmed' && e.data.includes(t.taskId));
  expect(confirmed, 'trip.confirmed exactly once on the stream').toHaveLength(1);
  sse.stop();
  expect((await history(DEV, GROUP)).join('\n')).toContain('Trip confirmed by all 4');
  // Ben had the page open: it hands off to the village cutscene once; otherwise the page shows the link.
  await expect
    .poll(async () => pb.url().includes('cutscene=trip') || (await pb.getByTestId('trip-cutscene-link').isVisible().catch(() => false)), {
      timeout: 20_000,
    })
    .toBe(true);
  await shot(pb, J, '6-confirmed');
});

test('J21.7 privacy sweep: no private limit reached another student or the group chat', async () => {
  for (const id of [BEN, CHI, DEV]) {
    expect(A[id]!.bodies.join('\n'), `${id} payloads`).not.toMatch(SENTINEL);
  }
  expect((await history(BEN, GROUP)).join('\n')).not.toMatch(SENTINEL);
});

test('J21.8 an offline agent is named, the trip waits, Retry resumes it once the agent is back', async () => {
  test.setTimeout(240_000);
  const pidsFile = path.join(TMP, 'stack.pids');
  const pids = JSON.parse(fs.readFileSync(pidsFile, 'utf8')) as Record<string, number>;
  const chiPid = pids[CHI]!;
  process.kill(-chiPid, 'SIGTERM'); // exact process group recorded by this stack, never a pattern
  await until(async () => !(await fetch(`${AGENT_URL(CHI)}/healthz`).then((r) => r.ok).catch(() => false)), 'Chi agent down', 20_000);
  const made = await api(tok[ANA]!, '/v1/trips', { method: 'POST', json: { destination: 'Tokyo', month: 4 } });
  expect(made.status).toBe(200);
  const t = await until(async () => {
    const c = await current(ANA);
    return c?.constraints.state === 'waiting' ? c : undefined;
  }, 'waiting on Chi', 40_000);
  expect(t.constraints.note).toMatch(/Chi's agent is offline, trip waits for Chi/);
  expect(t.members.find((m) => m.id === CHI)?.agent).toBe('offline');
  const p = A[ANA]!.page;
  await open(p);
  await expect(p.getByTestId('trip-waiting')).toContainText("Chi's agent is offline, trip waits for Chi");
  await expect(p.getByTestId('trip-retry')).toBeVisible();
  await shot(p, J, '8-offline');
  expect((await history(DEV, GROUP)).join('\n')).toMatch(/offline, trip waits for Chi/);
  // bring Chi's agent back (same env as the stack) and record the new pid so teardown can stop it
  const log = fs.openSync(path.join(TMP, `agent-${CHI}.log`), 'a');
  const peers = STUDENTS.map((id) => `${id}=${AGENT_URL(id)}`).join(',');
  const child = spawn('pnpm', ['--filter', '@squad/agent', 'start'], {
    cwd: REPO,
    env: { ...baseEnv(), AGENT_ID: CHI, PORT: String(AGENT_PORT(CHI)), PEERS: peers, FAKE_LLM: '1', CONFIRM_MODE: 'scripted' },
    stdio: ['ignore', log, log],
    detached: true,
  });
  child.unref();
  fs.writeFileSync(pidsFile, JSON.stringify({ ...pids, [CHI]: child.pid }));
  expect(await waitFor(`${AGENT_URL(CHI)}/healthz`, 60_000), 'Chi agent is back').toBe(true);
  await p.getByTestId('trip-retry').click();
  await until(async () => (await current(ANA))?.status === 'voting', 'retry resumed the check', 90_000);
  expect((await current(ANA))!.constraints.state).toBe('done');
});
