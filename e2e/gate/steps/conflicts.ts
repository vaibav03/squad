// Shared helpers and the V9 fragments (conflicting edits, agent offline) for S8-S10 and the variant runs.
// The real routes live in `R` below (feature/trip-collab and feature/study-plan, as read from docs/trip-planning.md and
// docs/study-plan.md). They deliberately do NOT use lib/contract.ts: that file's /v1/trips/:id/vote style is invented.
// Every fragment is defensive: nothing throws, failures are recorded on the Asserts collector.
import { AGENT_URL, CTL, HUB } from '../lib/config';
import type { Asserts } from '../lib/asserts';
import type { GateCtx } from '../lib/ctx';
import { im, type WorldUser } from '../lib/fakes/client';
import { ASSIGNMENTS } from '../lib/fakes/content';
import { api, domThread, history, isBot, openGroupChat, waitFor, type HMsg } from '../lib/hub';
import { startAgent, stopAgent } from '../lib/stack';
import { dbRows, outboundTo } from './flows';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Real routes, web paths, data-testids and table names. Edit here when a branch lands with different names. */
export const R = {
  trips: '/v1/trips',
  tripsCurrent: '/v1/trips/current',
  trip: (id: string) => `/v1/trips/${id}`,
  tripOptions: (id: string) => `/v1/trips/${id}/options`,
  tripOption: (id: string, o: string) => `/v1/trips/${id}/options/${o}`,
  tripVote: (id: string) => `/v1/trips/${id}/vote`,
  tripConfirm: (id: string) => `/v1/trips/${id}/confirm`,
  tripContinue: (id: string) => `/v1/trips/${id}/continue`,
  tripRetry: (id: string) => `/v1/trips/${id}/retry`,
  tripCancel: (id: string) => `/v1/trips/${id}/cancel`,
  plans: '/v1/plans',
  plansCurrent: '/v1/plans/current',
  plan: (id: string) => `/v1/plans/${id}`,
  planRespond: (id: string) => `/v1/plans/${id}/respond`,
  planItem: (id: string, item: string) => `/v1/plans/${id}/items/${item}`,
  planResolve: (id: string, cid: string) => `/v1/plans/${id}/conflicts/${cid}/resolve`,
  planConfirm: (id: string) => `/v1/plans/${id}/confirm`,
  streamToken: '/v1/squad/stream-token',
  stream: '/v1/squad/stream',
  /** ASSUMED gate-hub control route that maps world users to the stack agents (see report). Failure is tolerated. */
  ctlTripAgents: '/ctl/trip/agents',
  web: {
    trip: (id: string) => `/squad/trips/${id}`,
    plan: '/squad/village?plan=1',
  },
  tid: {
    tripStatus: 'trip-status',
    tripMembers: 'trip-members',
    tripMember: (id: string) => `trip-member-${id}`,
    tripWaiting: 'trip-waiting',
    tripOption: (id: string) => `trip-option-${id}`,
    tripCelebration: 'trip-celebration',
    tripCutscene: 'trip-cutscene-link',
    planCountdown: 'plan-countdown',
    planStatus: 'plan-status',
    planItem: 'plan-item',
    planOwner: 'plan-owner',
    chatPlanCard: 'chat-plan-card',
    chatTyping: 'chat-typing',
  },
  tables: { trips: 'hub_trips', plans: 'hub_plans', xref: 'imsg_xref', out: 'imsg_out' },
} as const;

// ---- minimal view shapes (packages/core/src/trip.ts and plan.ts) ----
export interface TripOpt {
  id: string;
  label: string;
  days?: number;
  perPerson?: number;
  rev?: number;
  droppedReason?: string;
}
export interface TripV {
  tripId: string;
  taskId: string;
  status: string;
  title: string;
  organizer: string | null;
  source: string | null;
  rev: number;
  options: TripOpt[];
  chosen: { optionId: string; dates: string | null } | null;
  myVote: string[] | null;
  voteProgress: { voted: number; of: number } | null;
  members: {
    id: string;
    name: string;
    agent: string;
    confirmed: boolean;
    declined: boolean;
    voted: boolean | null;
  }[];
  constraints: {
    state: string;
    note: string | null;
    waitingFor: { id: string; name: string; reason: string }[];
  };
  changes: { by: string; byName: string; summary: string; optionId?: string }[];
  can: Record<string, boolean>;
}
export interface PlanItemV {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  chapter?: string;
  date: string;
  durationMin: number;
  status: string;
  rev: number;
}
export interface PlanConflictV {
  id: string;
  itemId: string;
  status: string;
  theirs: { ownerId: string; date: string; durationMin: number; title: string };
  theirsBy: string;
  mine: { ownerId: string; date: string; durationMin: number; title: string };
  mineBy: string;
}
export interface PlanV {
  id: string;
  status: string;
  rev: number;
  examDate: string | null;
  examLabel: string;
  items: PlanItemV[];
  members: { id: string; name: string; optedIn: boolean; response: string }[];
  conflicts: PlanConflictV[];
  countdown: { days: number; words: string } | null;
  progress: { done: number; total: number; words: string };
  load: { memberId: string; name: string; items: number; minutes: number }[];
  availability: { squad: { date: string; free: number; total: number }[] | null };
}

// ---- who is who ----
export const people = (c: GateCtx) => [c.world.users.rhea, c.world.users.ben, c.world.users.cy];
export const byId = (c: GateCtx, id: string): WorldUser | undefined =>
  people(c).find((u) => u.id === id);
export const nameOf = (c: GateCtx, id: string) => byId(c, id)?.name ?? id;

// ---- trips ----
export async function curTrip(u: WorldUser): Promise<TripV | null> {
  const r = await api(u.token, R.tripsCurrent);
  return r.status === 200 ? (r.json?.trip ?? null) : null;
}
export async function getTrip(u: WorldUser, id: string): Promise<TripV | null> {
  const r = await api(u.token, R.trip(id));
  return r.status === 200 ? (r.json as TripV) : null;
}
export const waitTrip = (u: WorldUser, id: string, pred: (t: TripV) => boolean, ms = 40_000) =>
  waitFor(async () => {
    const t = await getTrip(u, id);
    return t && pred(t) ? t : undefined;
  }, ms);

/** Get an open trip into `voting`. The organizer continues without agents when they are not wired (noted). */
export async function tripToVoting(c: GateCtx, a: Asserts, tripId: string): Promise<TripV | null> {
  const any = c.world.users.rhea;
  let t = await waitTrip(
    any,
    tripId,
    (x) => x.status !== 'planning' || x.constraints.state === 'waiting',
    30_000,
  );
  if (t?.status === 'planning' && t.constraints.state === 'waiting') {
    const org = (t.organizer && byId(c, t.organizer)) || c.world.users.rhea;
    a.note(
      `trip constraints waiting (${t.constraints.waitingFor.map((w) => w.reason).join(',')}); organizer continued without agents`,
    );
    await api(org.token, R.tripContinue(tripId), { method: 'POST', json: {} });
  }
  t = await waitTrip(any, tripId, (x) => x.status === 'voting', 40_000);
  return t ?? (await getTrip(any, tripId));
}

/** An open (planning or voting) trip in the squad: reuse the current one or create a small one. */
export async function ensureOpenTrip(
  c: GateCtx,
  a: Asserts,
  destination = 'Tahoe',
): Promise<TripV | undefined> {
  const { rhea } = c.world.users;
  let t = await curTrip(rhea);
  if (!t || !['planning', 'voting'].includes(t.status)) {
    const r = await api(rhea.token, R.trips, { method: 'POST', json: { destination, month: 12 } });
    if (r.status !== 200) {
      a.fail('open a trip for the test', `POST trips -> ${r.status} ${r.json?.error?.code ?? ''}`);
      return undefined;
    }
    t = r.json.trip as TripV;
  }
  const v = await tripToVoting(c, a, t.tripId);
  if (!v || !['planning', 'voting'].includes(v.status)) {
    a.fail('trip is open for edits', `status ${v?.status}`);
    return undefined;
  }
  return v;
}

// ---- chat / iMessage surfaces ----
export const norm = (s: string) =>
  s
    .replace(/^🐻\s*Cubbie:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
export const groupHistory = (u: WorldUser, chatId: string, limit = 300) =>
  history(u.token, chatId, limit);
export const lastSeqOf = async (u: WorldUser, chatId: string) =>
  (await groupHistory(u, chatId)).reduce((n, m) => Math.max(n, m.seq), 0);

/** Bot messages after `after` whose text matches. */
export async function botSince(
  u: WorldUser,
  chatId: string,
  re: RegExp,
  after: number,
): Promise<HMsg[]> {
  return (await groupHistory(u, chatId)).filter(
    (m) => isBot(m) && m.seq > after && re.test(m.text),
  );
}
export const waitBotMsg = (u: WorldUser, chatId: string, re: RegExp, after: number, ms = 25_000) =>
  waitFor(async () => (await botSince(u, chatId, re, after))[0], ms);

/** Text the fake Apple received for the chat (join confirmation filtered out), joined. */
export async function imText(chat: string): Promise<string> {
  return (await outboundTo(chat)).map(norm).join('\n');
}
export const imHas = (chat: string, re: RegExp, ms = 10_000) =>
  waitFor(async () => {
    const t = await imText(chat);
    return re.test(t) ? t : undefined;
  }, ms);

/** Is this hub message's text in the iMessage log? (compares a normalised leading snippet) */
export async function mirroredToIm(chat: string, m: HMsg): Promise<boolean> {
  const snippet = norm(m.text).slice(0, 36);
  const all = await imText(chat);
  return snippet.length > 0 && all.includes(snippet);
}

export function decide(c: GateCtx, kind: string, m: HMsg | undefined): void {
  if (!m) return;
  const list = (c.state.decisions ??= []);
  if (!list.some((d) => d.id === m.id)) list.push({ kind, id: m.id });
  const texts = ((c.state.decisionTexts as Record<string, string> | undefined) ??= {});
  texts[m.id] = m.text;
}

/** Make sure the world's group chat is bound to squad A (S4 does this too; binding twice is harmless but noisy). */
export async function ensureBound(c: GateCtx): Promise<void> {
  const sq = c.world.squadA;
  const rows = await dbRows('chat_bindings');
  if (rows.some((r) => (r.chat_guid ?? r.chatGuid) === sq.chat)) return;
  await im.say(sq.chat, c.world.users.rhea.phone, `join ${sq.invite}`);
}

// ---- web ----
export async function openTripPage(
  c: GateCtx,
  a: Asserts,
  tripId: string,
  who: 'rhea' | 'ben' = 'rhea',
) {
  const actor = c.actors[who];
  if (!actor) {
    a.fail('web actor for trip page', 'not opened');
    return undefined;
  }
  await actor.page.goto(R.web.trip(tripId));
  await actor.page
    .locator(
      `[data-testid="${R.tid.tripStatus}"],[data-testid="trip-options"],[data-testid="trip-empty"]`,
    )
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined);
  return actor.page;
}
export async function webThreadHas(
  c: GateCtx,
  chatId: string,
  re: RegExp,
  ms = 15_000,
): Promise<string | undefined> {
  const actor = c.actors.rhea;
  if (!actor) return undefined;
  if (!(await openGroupChat(actor, chatId))) return undefined;
  return waitFor(async () => {
    const t = (await domThread(actor.page)).map((m) => m.text).join('\n');
    return re.test(t) ? t : undefined;
  }, ms);
}

// ---- SSE (village events such as trip.confirmed) ----
export async function openStream(token: string) {
  let buf = '';
  const ctl = new AbortController();
  const st = (await api(token, R.streamToken, { method: 'POST' })).json?.st as string | undefined;
  if (st)
    void (async () => {
      try {
        const r = await fetch(`${HUB}${R.stream}?st=${encodeURIComponent(st)}`, {
          signal: ctl.signal,
        });
        const rd = r.body?.getReader();
        const dec = new TextDecoder();
        while (rd) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value);
        }
      } catch {
        /* stopped */
      }
    })();
  return {
    ok: !!st,
    count: (event: string, needle: string) =>
      buf.split('\n\n').filter((b) => b.includes(`event: ${event}`) && b.includes(needle)).length,
    stop: () => ctl.abort(),
  };
}

// ---- dates ----
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (x: string, y: string) =>
  Math.round((Date.parse(`${y}T00:00:00Z`) - Date.parse(`${x}T00:00:00Z`)) / 86_400_000);
/** The exam day as Canvas has it (the fake feed's midterm due date). */
export const MIDTERM_DAY = ASSIGNMENTS.find((x) => x.id === 'a_midterm')!.dueAt.slice(0, 10);

// ---- plans ----
export async function curPlan(u: WorldUser): Promise<PlanV | null> {
  const r = await api(u.token, R.plansCurrent);
  return r.status === 200 ? (r.json?.plan ?? null) : null;
}
export async function getPlan(u: WorldUser, id: string): Promise<PlanV | null> {
  const r = await api(u.token, R.plan(id));
  return r.status === 200 ? (r.json as PlanV) : null;
}
export const planPatch = (
  u: WorldUser,
  p: PlanV,
  item: PlanItemV,
  patch: Record<string, unknown>,
  baseRev = item.rev,
) => api(u.token, R.planItem(p.id, item.id), { method: 'PATCH', json: { baseRev, patch } });

export async function ensureProposedPlan(c: GateCtx, a: Asserts): Promise<PlanV | undefined> {
  const { rhea } = c.world.users;
  const cur = await curPlan(rhea);
  if (cur && ['proposed', 'active'].includes(cur.status)) return cur;
  const r = await api(rhea.token, R.plans, {
    method: 'POST',
    json: { examDate: MIDTERM_DAY, examLabel: 'Midterm exam' },
  });
  if (r.status !== 200) {
    a.fail(
      'create a study plan for the test',
      `POST plans -> ${r.status} ${r.json?.error?.code ?? ''}`,
    );
    return undefined;
  }
  return r.json.plan as PlanV;
}

// =====================================================================================================================
// V9: two members edit the same trip field at once
// =====================================================================================================================
export async function tripFieldConflict(c: GateCtx, a: Asserts): Promise<void> {
  const { rhea, ben, cy } = c.world.users;
  const chatId = c.world.squadA.chatId;
  const chat = c.world.squadA.chat;
  const t0 = await ensureOpenTrip(c, a);
  if (!t0) return;
  const id = t0.tripId;
  const tag = Math.random().toString(36).slice(2, 5);

  // two options, proposed by two different members
  const add = async (u: WorldUser, label: string, perPerson: number) =>
    api(u.token, R.tripOptions(id), { method: 'POST', json: { label, days: 2, perPerson } });
  const rA = await add(ben, `Lakeside ${tag}`, 90);
  const rB = await add(cy, `Cabin ${tag}`, 120);
  a.ok(
    'members can propose options',
    rA.status === 200 && rB.status === 200,
    `${rA.status}/${rB.status}`,
  );
  let t = await getTrip(rhea, id);
  const optA = t?.options.find((o) => o.label === `Lakeside ${tag}`);
  const optB = t?.options.find((o) => o.label === `Cabin ${tag}`);
  if (!t || !optA || !optB)
    return a.fail('proposed options are visible', 'options missing from the view');

  const seq0 = await lastSeqOf(rhea, chatId);

  // same option, same baseRev, at the same moment
  const baseRev = optA.rev ?? 1;
  const edit = (u: WorldUser, optId: string, body: Record<string, unknown>) =>
    api(u.token, R.tripOption(id, optId), { method: 'PATCH', json: body });
  const [eR, eB] = await Promise.all([
    edit(rhea, optA.id, { baseRev, perPerson: 95 }),
    edit(ben, optA.id, { baseRev, perPerson: 110 }),
  ]);
  const statuses = [eR.status, eB.status].sort();
  a.eq('same-option race: exactly one edit lands and one gets 409', statuses, [200, 409]);
  const winner = eR.status === 200 ? { u: rhea, value: 95 } : { u: ben, value: 110 };
  const loser =
    eR.status === 200 ? { u: ben, value: 110, res: eB } : { u: rhea, value: 95, res: eR };
  const body = loser.res.json;
  a.eq('409 carries the conflict code', body?.error?.code, 'conflict');
  a.eq('409 names who changed it (their version)', body?.conflict?.change?.byName, winner.u.name);
  a.eq('409 returns the current option (theirs)', body?.conflict?.option?.perPerson, winner.value);
  t = await getTrip(rhea, id);
  a.eq(
    'nothing is silently overwritten: the winner stays',
    t?.options.find((o) => o.id === optA.id)?.perPerson,
    winner.value,
  );

  // different options never conflict, even concurrently
  const tb = t?.options.find((o) => o.id === optB.id);
  const ta = t?.options.find((o) => o.id === optA.id);
  const [m1, m2] = await Promise.all([
    edit(rhea, optB.id, { baseRev: tb?.rev ?? 1, days: 3 }),
    edit(ben, optA.id, { baseRev: ta?.rev ?? 1, days: 3 }),
  ]);
  a.eq('edits to different options merge (both 200)', [m1.status, m2.status], [200, 200]);
  // The doc says different FIELDS merge as well; the service checks per option. Record what really happens.
  const staleSameOption = await edit(cy, optB.id, { baseRev: tb?.rev ?? 1, perPerson: 125 });
  a.note(
    `same option, different field with a stale baseRev answered ${staleSameOption.status} (docs say merge, code checks per option)`,
  );

  // votes never conflict (per-member rows), fired together with no baseRev
  const live = (await getTrip(rhea, id))?.options.filter((o) => !o.droppedReason) ?? [];
  if ((await getTrip(rhea, id))?.status === 'voting' && live.length >= 2) {
    const ids = live.map((o) => o.id);
    const [v1, v2] = await Promise.all([
      api(rhea.token, R.tripVote(id), { method: 'POST', json: { ranking: ids } }),
      api(ben.token, R.tripVote(id), { method: 'POST', json: { ranking: [...ids].reverse() } }),
    ]);
    a.eq('simultaneous votes never conflict', [v1.status, v2.status], [200, 200]);
  } else a.note('trip not in voting: the simultaneous-vote check was skipped');

  // loser chooses "Replace with mine" (replace: true, stale baseRev)
  const rep = await edit(loser.u, optA.id, { baseRev, perPerson: loser.value, replace: true });
  a.eq('"Replace with mine" lands', rep.status, 200);
  t = await getTrip(rhea, id);
  const finalValue = t?.options.find((o) => o.id === optA.id)?.perPerson;
  a.eq('final value is the replacement', finalValue, loser.value);

  // both outcomes are logged in the chat, on both surfaces
  const winnerRe = new RegExp(`${winner.u.name} changed Lakeside ${tag}`);
  const replRe = new RegExp(`${loser.u.name} changed Lakeside ${tag}.*replaced a newer change`);
  const winMsg = await waitBotMsg(rhea, chatId, winnerRe, seq0);
  const repMsg = await waitBotMsg(rhea, chatId, replRe, seq0);
  a.ok('hub chat logs the winning change', !!winMsg);
  a.ok('hub chat logs the replacement as "replaced a newer change"', !!repMsg);
  decide(c, 'trip.edit', winMsg);
  decide(c, 'trip.edit', repMsg);
  a.ok(
    'web thread shows both outcomes',
    !!(await webThreadHas(c, chatId, replRe)) && !!(await webThreadHas(c, chatId, winnerRe)),
  );
  const im1 = await imHas(chat, replRe);
  a.ok('iMessage shows the replacement', !!im1);
  a.ok('iMessage shows the winning change', winnerRe.test(await imText(chat)));

  // final state is identical on the web page and in the iMessage summary
  const page = await openTripPage(c, a, id);
  if (page) {
    const row = await page
      .getByTestId(R.tid.tripOption(optA.id))
      .innerText()
      .catch(() => '');
    a.ok('web option row shows the final price', row.includes(`$${finalValue}`), row.slice(0, 80));
  }
  const last = ((await imText(chat)).match(
    new RegExp(`changed Lakeside ${tag}[^\\n]*replaced a newer change`),
  ) ?? [''])[0];
  a.ok(
    'iMessage summary shows the same final price',
    last.includes(`$${finalValue}`),
    last.slice(0, 120),
  );
  a.noLeak('trip conflict iMessage text', await imText(chat));
}

// =====================================================================================================================
// V9: two members edit the same plan chapter (owner) at once
// =====================================================================================================================
export async function planChapterConflict(c: GateCtx, a: Asserts): Promise<void> {
  const { rhea, ben, cy } = c.world.users;
  const chatId = c.world.squadA.chatId;
  const chat = c.world.squadA.chat;
  const p0 = await ensureProposedPlan(c, a);
  if (!p0) return;
  const id = p0.id;
  const items = p0.items;
  if (items.length < 3)
    return a.fail('plan has at least 3 items for the conflict test', `has ${items.length}`);
  const item1 = items[0]!;
  const item2 = items[1]!;
  const item3 = items[2]!;
  const others = people(c).filter((u) => u.id !== item1.ownerId);
  const [toRhea, toBen] = others as [WorldUser, WorldUser];
  const seq0 = await lastSeqOf(rhea, chatId);

  // one item, same baseRev, two different owners, at once
  const baseRev = item1.rev;
  const asRhea = planPatch(rhea, p0, item1, { ownerId: toRhea.id }, baseRev);
  const asBen = planPatch(ben, p0, item1, { ownerId: toBen.id }, baseRev);
  const [eR, eB] = await Promise.all([asRhea, asBen]);
  a.eq(
    'same-chapter race: exactly one edit lands and one gets 409',
    [eR.status, eB.status].sort(),
    [200, 409],
  );
  const loserRes = eR.status === 409 ? eR : eB;
  const winTarget = eR.status === 200 ? toRhea : toBen;
  const loseTarget = eR.status === 200 ? toBen : toRhea;
  a.eq('409 carries the conflict code', loserRes.json?.error?.code, 'conflict');
  const cf = loserRes.json?.conflict as PlanConflictV | undefined;
  a.ok(
    'conflict record keeps both versions',
    !!cf && cf.theirs?.ownerId === winTarget.id && cf.mine?.ownerId === loseTarget.id,
    JSON.stringify(cf)?.slice(0, 160),
  );
  a.eq('conflict is open until someone picks', cf?.status, 'open');
  let p = await getPlan(rhea, id);
  a.eq(
    'the winner stays on the item',
    p?.items.find((i) => i.id === item1.id)?.ownerId,
    winTarget.id,
  );
  a.ok(
    'the plan lists the conflict for every member',
    (await getPlan(cy, id))?.conflicts.some((x) => x.id === cf?.id) === true,
  );

  // other items merge, even with the stale plan rev
  const stale = p0.rev;
  const [m1, m2] = await Promise.all([
    planPatch(rhea, p0, item2, { durationMin: item2.durationMin + 10 }, stale),
    planPatch(ben, p0, item3, { durationMin: item3.durationMin + 10 }, stale),
  ]);
  a.eq('edits to other items merge (both 200)', [m1.status, m2.status], [200, 200]);

  // a second edit to the conflicted item is refused while the conflict is open
  const blocked = await planPatch(
    cy,
    p0,
    item1,
    { durationMin: 30 },
    (await getPlan(cy, id))?.rev ?? baseRev,
  );
  a.eq(
    'further edits are refused while the conflict is open',
    blocked.json?.error?.code,
    'conflict_open',
  );

  // acceptances are per member and never conflict
  const pending = (await getPlan(rhea, id))?.members.filter((m) => m.response === 'pending') ?? [];
  if (pending.length >= 2) {
    const rs = await Promise.all(
      pending
        .slice(0, 2)
        .map((m) =>
          api(byId(c, m.id)!.token, R.planRespond(id), {
            method: 'POST',
            json: { response: 'accept' },
          }),
        ),
    );
    a.eq(
      'simultaneous acceptances never conflict',
      rs.map((r) => r.status),
      [200, 200],
    );
  } else a.note('fewer than two members pending: the simultaneous-accept check was skipped');

  // a member picks the losing version
  const pick = await api(cy.token, R.planResolve(id, cf?.id ?? 'none'), {
    method: 'POST',
    json: { pick: 'mine' },
  });
  a.eq('picking a version resolves the conflict', pick.status, 200);
  p = await getPlan(rhea, id);
  const final = p?.items.find((i) => i.id === item1.id);
  a.eq('the picked version is applied', final?.ownerId, loseTarget.id);
  a.ok('the conflict is closed', p?.conflicts.find((x) => x.id === cf?.id)?.status === 'resolved');

  // both outcomes in chat on both surfaces
  const cRe = /Edit conflict on/;
  const sRe = /settled the conflict on/;
  const cMsg = await waitBotMsg(rhea, chatId, cRe, seq0);
  const sMsg = await waitBotMsg(rhea, chatId, sRe, seq0);
  a.ok('hub chat logs the conflict', !!cMsg);
  a.ok('hub chat logs the pick', !!sMsg);
  decide(c, 'plan.conflict', cMsg);
  decide(c, 'plan.conflict', sMsg);
  a.ok(
    'web thread shows both',
    !!(await webThreadHas(c, chatId, cRe)) && !!(await webThreadHas(c, chatId, sRe)),
  );
  a.ok('iMessage shows the conflict', !!(await imHas(chat, cRe)));
  a.ok('iMessage shows the pick', !!(await imHas(chat, sRe)));

  // final state identical on the web panel and in the iMessage summary
  const label = final?.chapter ?? final?.title ?? '';
  const entry = `${label} (${fmtDate(final?.date ?? '')})`;
  const mark = (await imText(chat)).length;
  await im.say(chat, rhea.phone, '@cubbie show plan');
  const summary = await waitFor(async () => {
    const t = (await imText(chat)).slice(mark);
    return /Study plan/.test(t) ? t : undefined;
  }, 20_000);
  a.ok('iMessage "show plan" answers', !!summary);
  const ownerLine =
    (summary ?? '').split('\n').find((l) => l.startsWith(`${loseTarget.name}:`)) ?? '';
  a.ok(
    'iMessage summary lists the item under the picked owner',
    ownerLine.includes(entry),
    `${ownerLine.slice(0, 100)} / want ${entry}`,
  );
  const wrong = (summary ?? '')
    .split('\n')
    .filter((l) => !l.startsWith(`${loseTarget.name}:`) && l.includes(entry));
  a.eq('and under nobody else', wrong.length, 0);
  const actor = c.actors.rhea;
  if (actor) {
    await actor.page.goto(R.web.plan);
    await actor.page
      .getByTestId(R.tid.planItem)
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    const rows = await actor.page
      .getByTestId(R.tid.planItem)
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText));
    const row = rows.find((t) => t.includes(final?.title ?? '\u0000'));
    a.ok(
      'web panel shows the item under the picked owner',
      !!row && row.includes(loseTarget.name),
      (row ?? 'row not found').slice(0, 100),
    );
  } else a.fail('web actor for plan panel', 'not opened');
  a.noLeak('plan conflict iMessage text', await imText(chat));
}

// =====================================================================================================================
// An agent stops mid-way: web says "agent offline", iMessage gets a notice, the trip stays open and is never confirmed
// =====================================================================================================================
export async function agentOfflineFragment(
  c: GateCtx,
  a: Asserts,
  opts: { agent?: string; who?: 'ben' | 'cy' } = {},
): Promise<void> {
  const agent = opts.agent ?? 's_ben';
  const absent = c.world.users[opts.who ?? 'ben'];
  const { rhea } = c.world.users;
  const chatId = c.world.squadA.chatId;
  const chat = c.world.squadA.chat;

  // one active trip per squad: close whatever is open first
  const open = await curTrip(rhea);
  if (open && ['planning', 'voting', 'confirming'].includes(open.status))
    await api(rhea.token, R.tripCancel(open.tripId), { method: 'POST', json: {} });

  // best effort: tell the gate hub which agent belongs to which world user (route is an assumption)
  const map = Object.fromEntries(
    people(c).map((u, i) => [u.id, AGENT_URL(['s_ana', 's_ben', 's_chi'][i]!)] as const),
  );
  await fetch(`${CTL}${R.ctlTripAgents}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map }),
  }).catch(() => undefined);

  stopAgent(agent);
  const down = await waitFor(
    async () =>
      !(await fetch(`${AGENT_URL(agent)}/healthz`)
        .then((r) => r.ok)
        .catch(() => false)),
    20_000,
    500,
  );
  a.ok(`agent ${agent} is down`, !!down);

  const seq0 = await lastSeqOf(rhea, chatId);
  const made = await api(rhea.token, R.trips, {
    method: 'POST',
    json: { destination: 'Tokyo', month: 4 },
  });
  let tripId = '';
  try {
    a.eq('trip is created while an agent is down', made.status, 200);
    tripId = made.json?.trip?.tripId ?? '';
    if (!tripId) return;
    const t = await waitTrip(rhea, tripId, (x) => x.constraints.state === 'waiting', 45_000);
    a.ok('constraints wait for the missing agent', !!t, 'state never became waiting');
    const m = t?.members.find((x) => x.id === absent.id);
    a.eq(`${absent.name}'s agent is reported offline (not "no agent")`, m?.agent, 'offline');
    a.ok(
      'the wait names the member',
      !!t?.constraints.waitingFor.some((w) => w.id === absent.id),
      JSON.stringify(t?.constraints.waitingFor),
    );
    a.ok(
      'note says the agent is offline',
      /offline/i.test(t?.constraints.note ?? ''),
      t?.constraints.note ?? '',
    );
    a.eq('trip stays open (planning), not voting or confirmed', t?.status, 'planning');

    // web: chip and waiting banner
    const page = await openTripPage(c, a, tripId);
    if (page) {
      const wait = await page
        .getByTestId('trip-waiting')
        .innerText({ timeout: 10_000 })
        .catch(() => '');
      a.ok(
        'web shows "agent is offline, trip waits for <name>"',
        new RegExp(`agent is offline.*${absent.name}`, 'i').test(wait),
        wait.slice(0, 100),
      );
      const chip = await page
        .locator(`[data-testid="${R.tid.tripMember(absent.id)}"]`)
        .innerText()
        .catch(() => '');
      a.ok('web member chip says "Agent offline"', /agent offline/i.test(chip), chip.slice(0, 80));
      await a.shot(page, 'trip-agent-offline');
    }

    // chat: one notice, mirrored to iMessage
    const note = await waitBotMsg(rhea, chatId, /offline, trip waits for/i, seq0);
    a.ok('hub chat posts the offline notice', !!note);
    decide(c, 'failure.agent-offline', note);
    const txt = await imHas(chat, /offline, trip waits for/i);
    a.ok('iMessage receives the offline notice', !!txt);
    a.ok(
      'notice names the member and not a raw id',
      new RegExp(absent.name).test(txt ?? '') && !/\bs_[a-z]{2,}\b/.test(txt ?? ''),
    );

    // never confirmed while the agent is away
    await sleep(2500);
    const again = await getTrip(rhea, tripId);
    a.eq('still not confirmed after waiting', again?.status === 'confirmed', false);
    const row = (await dbRows(R.tables.trips)).find((r) => (r.trip_id ?? r.tripId) === tripId);
    const stored = row ? (JSON.parse(String(row.json)) as { status?: string }) : undefined;
    a.ok('stored trip is not confirmed', !!stored && stored.status !== 'confirmed', stored?.status);
    const early = await api(rhea.token, R.tripConfirm(tripId), {
      method: 'POST',
      json: { yes: true },
    });
    a.eq('confirm before voting closes is refused (409)', early.status, 409);
    a.eq(
      'no "Trip confirmed" message for this trip',
      (await botSince(rhea, chatId, /Trip confirmed by all/, seq0)).length,
      0,
    );
  } finally {
    const up = await startAgent(agent).catch(() => false);
    a.ok(`agent ${agent} restarted`, up);
    if (tripId) {
      if (up) {
        await api(rhea.token, R.tripRetry(tripId), { method: 'POST', json: {} });
        const resumed = await waitTrip(
          rhea,
          tripId,
          (x) => x.status === 'voting' || x.constraints.state === 'done',
          90_000,
        );
        a.ok('Retry resumes the trip once the agent is back', !!resumed);
      }
      await api(rhea.token, R.tripCancel(tripId), { method: 'POST', json: {} });
    }
  }
}
