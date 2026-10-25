// S8 collaborative trip, S9 shared study plan, S10 cross-surface sync. Real routes live in conflicts.ts (`R`).
// Both plans are started from the iMessage group (`@cubbie plan a trip ...`, `@cubbie study plan ...`) so the same message path is exercised that the web
// uses; every decision is then found again as one hub message id on the web DOM, in the hub DB and in the iMessage log.
import { defaultSentinels, type Asserts } from '../lib/asserts';
import { P } from '../lib/probes';
import { im } from '../lib/fakes/client';
import { api, domThread, history, isBot, openGroupChat, waitFor } from '../lib/hub';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { dbRows } from './flows';
import {
  MIDTERM_DAY,
  R,
  agentOfflineFragment,
  curPlan,
  curTrip,
  daysBetween,
  decide,
  ensureBound,
  fmtDate,
  getPlan,
  getTrip,
  imHas,
  imText,
  lastSeqOf,
  mirroredToIm,
  norm,
  openStream,
  openTripPage,
  people,
  sleep,
  today,
  tripToVoting,
  waitBotMsg,
  waitTrip,
  webThreadHas,
  type PlanV,
} from './conflicts';

const jsonOf = (row: { json?: unknown } | undefined): Record<string, unknown> | null => {
  try {
    return JSON.parse(String(row?.json ?? 'null'));
  } catch {
    return null;
  }
};

// =====================================================================================================================
// S8
// =====================================================================================================================
async function s8(c: GateCtx, a: Asserts) {
  const { rhea, ben, cy } = c.world.users;
  const sq = c.world.squadA;
  await ensureBound(c);

  // 1. created from the group chat. NB: the parser needs "to <destination>"; "Dec 12-15" alone has no destination.
  const seq0 = await lastSeqOf(rhea, sq.chatId);
  await im.say(sq.chat, rhea.phone, '@cubbie plan a trip to Cabo in December');
  const trip = await waitFor(async () => {
    const t = await curTrip(rhea);
    return t && /Cabo/.test(t.title) ? t : undefined;
  });
  if (!a.ok('@cubbie plan a trip in the group created a trip', !!trip)) return;
  const tripId = trip!.tripId;
  c.state.tripId = tripId;
  a.eq('organizer is the asker (Rhea)', trip!.organizer, rhea.id);
  a.eq('trip was created from chat', trip!.source, 'chat');
  a.ok('trip id is not a hard-coded demo id', /^trip_/.test(tripId) && tripId !== 'trip_cabo');
  for (const u of [ben, cy]) {
    const v = await getTrip(u, tripId);
    a.ok(`${u.name} sees the same trip id (stable)`, v?.tripId === tripId && v.taskId === tripId);
  }

  // 2. card with a link on web, readable text in iMessage
  const created = await waitBotMsg(rhea, sq.chatId, /started a trip plan for Cabo/, seq0);
  a.ok('hub chat carries the trip card text', !!created);
  a.ok(
    'card links to the trip page',
    !!created && created.text.includes(R.web.trip(tripId)),
    created?.text.slice(0, 80),
  );
  decide(c, 'trip.created', created);
  const web = await webThreadHas(c, sq.chatId, new RegExp(`Cabo[\\s\\S]*${R.web.trip(tripId)}`));
  a.ok('web thread shows the trip text with its link', !!web);
  const im1 = await imHas(sq.chat, /started a trip plan for Cabo/);
  a.ok('iMessage carries the trip as readable text', !!im1);
  a.noRawIds('iMessage trip text', (im1 ?? '').split(R.web.trip(tripId)).join('the trip page'));
  a.ok('iMessage text is plain (no markdown)', !/[*_`#]{2,}|\]\(/.test(im1 ?? ''));
  a.noLeak('iMessage trip text', im1 ?? '');

  // 3. voting opens, per-member state chips on the page
  const voting = await tripToVoting(c, a, tripId);
  if (!a.ok('voting is open', voting?.status === 'voting', `status ${voting?.status}`)) return;
  const page = await openTripPage(c, a, tripId);
  if (page) {
    const chips = await page.locator('[data-testid^="trip-member-"]').count();
    a.eq('per-member state chips (one per squad member)', chips, 3);
    await a.shot(page, 'trip-voting');
  }

  // 4. three members vote; votes are private
  const live = voting!.options.filter((o) => !o.droppedReason).map((o) => o.id);
  a.ok('at least two live options', live.length >= 2, `${live.length} live`);
  const rankings = new Map<string, string[]>([
    [rhea.id, live],
    [ben.id, [...live].reverse()],
    [cy.id, [...live.slice(1), live[0]!]],
  ]);
  const benRanking = JSON.stringify(rankings.get(ben.id));
  const order = [rhea, ben, cy];
  for (const [i, u] of order.entries()) {
    const since = await lastSeqOf(rhea, sq.chatId);
    const cur = await getTrip(u, tripId);
    const r = await api(u.token, R.tripVote(tripId), {
      method: 'POST',
      json: { ranking: rankings.get(u.id), ...(cur ? { baseRev: cur.rev } : {}) },
    });
    a.eq(`${u.name} vote accepted`, r.status, 200);
    const msg = await waitBotMsg(rhea, sq.chatId, /vote came in|Voting closed/, since);
    a.ok(
      `${u.name}'s vote is announced in the group (no ranking)`,
      !!msg && !msg.text.includes(benRanking),
    );
    decide(c, 'trip.vote', msg);
    if (i === 0) {
      const asBen = await getTrip(ben, tripId);
      a.ok('another member sees no ranking of mine', asBen?.myVote === null);
      a.ok(
        'participation hidden below 3 voters',
        asBen?.voteProgress === null &&
          asBen.members.filter((m) => m.id !== ben.id).every((m) => m.voted === null),
      );
    }
    if (i === 1) {
      const asCy = await getTrip(cy, tripId);
      a.ok(
        'counts still hidden at 2 voters',
        asCy?.voteProgress === null &&
          asCy.members.filter((m) => m.id !== cy.id).every((m) => m.voted === null),
      );
      const rheaView = await api(rhea.token, R.trip(tripId));
      a.ok("Ben's ranking is not in Rhea's trip payload", !rheaView.text.includes(benRanking));
    }
  }
  const stored = jsonOf(
    (await dbRows(R.tables.trips)).find((r) => (r.trip_id ?? r.tripId) === tripId),
  );
  const votes = (stored?.votes ?? []) as { student: string; ranking: string[] }[];
  a.eq('per-member vote rows (3 distinct voters)', new Set(votes.map((v) => v.student)).size, 3);
  a.ok(
    "each stored row is that member's own ranking",
    votes.every((v) => JSON.stringify(v.ranking) === JSON.stringify(rankings.get(v.student))),
  );
  const closed = await waitTrip(rhea, tripId, (t) => t.status === 'confirming', 20_000);
  a.ok(
    'voting closed once everyone voted (confirming)',
    !!closed?.chosen,
    `status ${closed?.status}`,
  );
  const rb = c.actors.rhea?.bodies.join('\n') ?? '';
  a.ok("Ben's ranking never appears in Rhea's browser payloads", !rb.includes(benRanking));

  // 5. confirm once, from three places
  const stream = await openStream(rhea.token);
  const optionId = closed?.chosen?.optionId;
  const confirmWith = async (label: string, how: () => Promise<unknown>, re: RegExp) => {
    const since = await lastSeqOf(rhea, sq.chatId);
    await how();
    const msg = await waitBotMsg(rhea, sq.chatId, re, since);
    a.ok(`${label} confirmation is announced`, !!msg);
    decide(c, 'trip.confirm', msg);
  };
  await confirmWith(
    'Rhea (API)',
    () => api(rhea.token, R.tripConfirm(tripId), { method: 'POST', json: { yes: true, optionId } }),
    /Rhea confirmed|Trip confirmed by all/,
  );
  await confirmWith(
    'Ben (iMessage "confirm")',
    () => im.say(sq.chat, ben.phone, 'confirm'),
    /Ben confirmed|Trip confirmed by all/,
  );
  a.eq('two of three is not a trip', (await getTrip(rhea, tripId))?.status, 'confirming');
  await confirmWith(
    'Cy (API)',
    () => api(cy.token, R.tripConfirm(tripId), { method: 'POST', json: { yes: true, optionId } }),
    /Trip confirmed by all/,
  );
  const repeat = await api(cy.token, R.tripConfirm(tripId), {
    method: 'POST',
    json: { yes: true, optionId },
  });
  a.eq('a repeated confirm is harmless', repeat.status, 200);
  await sleep(1500);
  const done = await getTrip(rhea, tripId);
  a.eq('trip is confirmed', done?.status, 'confirmed');
  a.eq(
    '"Trip confirmed" is said exactly once',
    (await history(rhea.token, sq.chatId, 100)).filter(
      (m) => isBot(m) && /Trip confirmed by all/.test(m.text),
    ).length,
    1,
  );
  a.ok(
    'trip.confirmed reached the village stream exactly once',
    !stream.ok || stream.count('trip.confirmed', tripId) === 1,
    `count ${stream.count('trip.confirmed', tripId)}`,
  );
  stream.stop();
  a.ok('iMessage says the trip is confirmed', !!(await imHas(sq.chat, /Trip confirmed by all/)));

  // 6. cutscene deep link
  const pg = await openTripPage(c, a, tripId);
  if (pg) {
    const link = pg.getByTestId(R.tid.tripCutscene);
    const href = (await link.getAttribute('href', { timeout: 15_000 }).catch(() => null)) ?? '';
    a.ok(
      'confirmed page offers the cutscene deep link',
      href.includes('cutscene=trip') && href.includes(done?.taskId ?? '\u0000'),
      href,
    );
    if (href) {
      await pg.goto(href);
      await pg.waitForLoadState('domcontentloaded').catch(() => undefined);
      a.ok('cutscene deep link opens the village', pg.url().includes('cutscene=trip'), pg.url());
    }
    await a.shot(pg, 'trip-cutscene');
  }

  // 7. privacy
  const hist = (await history(rhea.token, sq.chatId, 100)).map((m) => m.text).join('\n');
  a.noLeak('group chat (trip)', hist);
  a.noLeak('iMessage (trip)', await imText(sq.chat));
  a.noLeak("Rhea's browser payloads (trip)", rb, defaultSentinels());

  // 8. an agent stops mid-way
  await agentOfflineFragment(c, a);
}

export const S8: StepDef<GateCtx> = {
  id: 'S8',
  title: 'Conversation continues into a collaborative trip plan',
  needs: [P.trip, P.mentions, P.imsync],
  label: 'fixture (demo labelled)',
  fixture: s8,
};

// =====================================================================================================================
// S9
// =====================================================================================================================
async function s9(c: GateCtx, a: Asserts) {
  const { rhea, ben, cy } = c.world.users;
  const sq = c.world.squadA;
  await ensureBound(c);
  const seq0 = await lastSeqOf(rhea, sq.chatId);
  const mark0 = (await imText(sq.chat)).length;

  // 1. from chat, using the Canvas due date of the midterm as the exam day
  await im.say(sq.chat, rhea.phone, `@cubbie study plan for the midterm on ${MIDTERM_DAY}`);
  const proposed = await waitFor(
    async () =>
      (await history(rhea.token, sq.chatId, 100)).find(
        (m) => isBot(m) && m.seq > seq0 && m.card?.type === 'plan',
      ),
    60_000,
  );
  if (!proposed) {
    const said = (await history(rhea.token, sq.chatId, 100))
      .filter((m) => isBot(m) && m.seq > seq0)
      .map((m) => m.text.slice(0, 140));
    return a.fail('a plan card reached the group', `bot said: ${said.join(' | ') || 'nothing'}`);
  }
  a.ok(
    'a progress line came before the card',
    (await history(rhea.token, sq.chatId, 100)).some(
      (m) => isBot(m) && m.seq > seq0 && m.seq < proposed.seq && /on it|building/i.test(m.text),
    ),
  );
  const planId = String(proposed.card?.planId ?? '');
  c.state.planId = planId;
  a.ok('card carries the plan id', planId.length > 0);
  decide(c, 'plan.proposed', proposed);

  // 2. the persisted object
  const plan = await getPlan(rhea, planId);
  if (!a.ok('plan is readable by id', !!plan)) return;
  const p = plan as PlanV;
  a.eq('status is proposed', p.status, 'proposed');
  a.ok('plan has a rev', p.rev >= 1, `rev ${p.rev}`);
  for (const u of [ben, cy])
    a.eq(`${u.name} sees the same plan id`, (await curPlan(u))?.id, planId);
  const row = (await dbRows(R.tables.plans)).find((r) => r.id === planId);
  a.ok('plan row is persisted', !!row);
  a.eq('persisted rev equals the API rev', jsonOf(row)?.rev, p.rev);
  a.eq('plan belongs to this squad', row?.squad_id, sq.id);

  // 3. countdown from the Canvas due date
  const sameYear = !!p.examDate && p.examDate === MIDTERM_DAY;
  a.ok(
    'exam date is the Canvas midterm due day',
    sameYear,
    `plan ${p.examDate} vs canvas ${MIDTERM_DAY}`,
  );
  if (p.examDate)
    a.eq('countdown matches the due date', p.countdown?.days, daysBetween(today(), p.examDate));
  const words = p.countdown?.words ?? '';

  // 4. owners per chapter, per-member load
  const ids = new Set(p.members.map((m) => m.id));
  a.ok(
    'every item has an owner who is a member',
    p.items.length > 0 && p.items.every((i) => ids.has(i.ownerId)),
  );
  a.ok('work is shared (at least two owners)', new Set(p.items.map((i) => i.ownerId)).size >= 2);
  a.ok('item ids are unique', new Set(p.items.map((i) => i.id)).size === p.items.length);
  a.eq('three members on the plan', p.members.length, 3);
  const owned = (pl: PlanV, id: string) => pl.items.filter((i) => i.ownerId === id).length;

  // 5. page and iMessage summary agree
  const imProposal = (await imText(sq.chat)).slice(mark0);
  a.ok('iMessage carries the plan summary', /proposed a study plan/.test(imProposal));
  a.ok(
    'iMessage countdown matches the page',
    words.length > 0 && imProposal.includes(words),
    words,
  );
  a.ok('iMessage names the exam day', !!p.examDate && imProposal.includes(fmtDate(p.examDate)));
  for (const m of p.members) {
    const line = imProposal.split('\n').find((l) => l.startsWith(`${m.name}:`)) ?? '';
    a.eq(
      `iMessage lists ${m.name}'s ${owned(p, m.id)} items`,
      (line.match(/\(/g) ?? []).length,
      owned(p, m.id),
    );
  }
  const actor = c.actors.rhea;
  if (actor) {
    await actor.page.goto(R.web.plan);
    const cd = await actor.page
      .getByTestId(R.tid.planCountdown)
      .innerText({ timeout: 20_000 })
      .catch(() => '');
    a.ok(
      'web countdown shows the same days',
      !!p.countdown && cd.includes(String(p.countdown.days)),
      cd,
    );
    const owners = await actor.page
      .getByTestId(R.tid.planOwner)
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText));
    for (const m of p.members)
      a.eq(
        `web panel shows ${m.name} on ${owned(p, m.id)} items`,
        owners.filter((o) => o.includes(m.name)).length,
        owned(p, m.id),
      );
    await a.shot(actor.page, 'plan-proposed');
    await openCardOnChat(c, a, sq.chatId);
  } else a.fail('web actor', 'not opened');

  // 6. acceptances: Ben on the API, Cy from iMessage
  const accept = async (label: string, how: () => Promise<unknown>) => {
    const since = await lastSeqOf(rhea, sq.chatId);
    await how();
    const msg = await waitBotMsg(rhea, sq.chatId, /accepted the plan/, since);
    a.ok(`${label} acceptance is announced`, !!msg);
    decide(c, 'plan.accept', msg);
  };
  await accept('Ben (API)', () =>
    api(ben.token, R.planRespond(planId), { method: 'POST', json: { response: 'accept' } }),
  );
  await accept('Cy (iMessage)', () => im.say(sq.chat, cy.phone, '@cubbie plan 1'));
  const active = await waitFor(
    async () =>
      (await getPlan(rhea, planId))?.status === 'active' ? await getPlan(rhea, planId) : undefined,
    15_000,
  );
  a.ok('plan is active after everyone accepted', !!active);
  a.ok(
    'acceptances are tracked per member',
    !!active && active.members.every((m) => m.response === 'accepted'),
  );

  // 7. a swap (owner change) by the organizer
  const item = (active ?? p).items.find((i) => i.ownerId === rhea.id) ?? (active ?? p).items[0]!;
  const newOwner = people(c).find((u) => u.id !== item.ownerId)!;
  const since = await lastSeqOf(rhea, sq.chatId);
  const sw = await api(rhea.token, R.planItem(planId, item.id), {
    method: 'PATCH',
    json: { baseRev: item.rev, patch: { ownerId: newOwner.id } },
  });
  a.eq('owner swap accepted', sw.status, 200);
  const swMsg = await waitBotMsg(rhea, sq.chatId, /updated ".+":/, since);
  a.ok('swap is announced in the group', !!swMsg);
  decide(c, 'plan.swap', swMsg);
  const after = await getPlan(rhea, planId);
  a.ok(
    'rev increased and persisted',
    !!after &&
      after.rev > (active ?? p).rev &&
      jsonOf((await dbRows(R.tables.plans)).find((r) => r.id === planId))?.rev === after.rev,
  );

  // 8. privacy and honest mastery
  const body = JSON.stringify(after);
  a.noLeak('plan view', body);
  a.noLeak(
    'group chat (plan)',
    (await history(rhea.token, sq.chatId, 100)).map((m) => m.text).join('\n'),
  );
  a.noLeak('iMessage (plan)', await imText(sq.chat));
  a.noLeak("Rhea's browser payloads (plan)", c.actors.rhea?.bodies.join('\n') ?? '');
  a.ok(
    'squad availability is aggregate only (counts, never who)',
    after?.availability.squad === null ||
      after?.availability.squad.every((d) => Object.keys(d).sort().join() === 'date,free,total') ===
        true,
  );
  a.ok('no mastery numbers in the shared plan payload', !/"mastery"|"box"/.test(body));
  a.note(
    'mastery hidden for squads under 3 members is not exercised: the world squad has 3 members',
  );
}

async function openCardOnChat(c: GateCtx, a: Asserts, chatId: string) {
  const actor = c.actors.rhea;
  if (!actor) return;
  await webThreadHas(c, chatId, /proposed a study plan/);
  const card = actor.page.getByTestId(R.tid.chatPlanCard).first();
  a.ok(
    'web chat shows the plan card with an Open plan link',
    (await card
      .getByRole('link', { name: /open plan/i })
      .count()
      .catch(() => 0)) > 0,
  );
}

export const S9: StepDef<GateCtx> = {
  id: 'S9',
  title: '... and a shared study plan',
  needs: [P.study, P.mentions, P.imsync, P.context],
  label: 'fixture (demo labelled)',
  fixture: s9,
};

// =====================================================================================================================
// S10
// =====================================================================================================================
async function s10(c: GateCtx, a: Asserts) {
  const { rhea } = c.world.users;
  const sq = c.world.squadA;
  const decisions = (c.state.decisions ??= []);
  const kinds = new Set(decisions.map((d) => d.kind));
  for (const k of ['trip.vote', 'trip.confirm', 'plan.accept', 'plan.swap'])
    a.ok(
      `S8/S9 recorded a ${k} decision`,
      kinds.has(k),
      `have: ${[...kinds].join(', ') || 'none'}`,
    );

  // a failure, said in the group: an edit to an item nobody has
  const since = await lastSeqOf(rhea, sq.chatId);
  await api(rhea.token, '/v1/chat/send', {
    method: 'POST',
    json: { chatId: sq.chatId, text: '@cubbie plan 3 nosuchchapter to ben' },
  });
  const failure = await waitBotMsg(
    rhea,
    sq.chatId,
    /could not find|could not read|no plan/i,
    since,
    30_000,
  );
  a.ok('a failed plan edit is said in the group', !!failure);
  decide(c, 'failure.plan-edit', failure);
  await sleep(1500);

  // vantage 1: hub (history API and DB)
  const hub = await history(rhea.token, sq.chatId, 400);
  const hubIds = hub.map((m) => m.id);
  a.ok('hub message ids are unique', new Set(hubIds).size === hubIds.length);
  const xref = await dbRows(R.tables.xref);
  const outRows = await dbRows(R.tables.out);
  // vantage 2: web DOM
  const actor = c.actors.rhea;
  let dom: { id: string; text: string }[] = [];
  if (actor) {
    a.ok('Rhea opens the group chat', await openGroupChat(actor, sq.chatId));
    await sleep(1500);
    dom = await domThread(actor.page);
    a.ok('DOM message ids are unique', new Set(dom.map((m) => m.id)).size === dom.length);
    a.eq(
      'no stuck typing/thinking indicator at the end',
      await actor.page.getByTestId(R.tid.chatTyping).count(),
      0,
    );
    a.noLeak('web thread', dom.map((m) => m.text).join('\n'));
    a.noRawIds(
      'web thread',
      dom.map((m) => m.text.split(/\/squad\/trips\/\S+/).join('')).join('\n'),
    );
  } else a.fail('web actor', 'not opened');
  // vantage 3: FakeIMessageTransport
  const imAll = await imText(sq.chat);
  a.noLeak('iMessage log', imAll);
  a.noRawIds('iMessage log', imAll.split(/\/squad\/trips\/\S+/).join(''));

  const texts = (c.state.decisionTexts ?? {}) as Record<string, string>;
  for (const d of decisions) {
    const m = hub.find((x) => x.id === d.id);
    const label = `${d.kind} ${d.id}`;
    a.ok(`${label}: in the hub`, !!m);
    if (!m) continue;
    a.ok(
      `${label}: on the web with the same id`,
      dom.some((x) => x.id === d.id),
      `dom has ${dom.length} messages`,
    );
    const ox = outRows.filter((r) => (r.message_id ?? r.messageId) === d.id);
    const xr = xref.filter((r) => (r.message_id ?? r.messageId) === d.id && r.direction === 'out');
    a.ok(
      `${label}: queued and sent to iMessage under the same id`,
      ox.some((r) => ['sent', 'delivered'].includes(String(r.state))) ||
        xr.some((r) => r.status === 'sent'),
    );
    a.ok(`${label}: readable text in the iMessage log`, await mirroredToIm(sq.chat, m));
    a.ok(
      `${label}: web and iMessage say the same thing`,
      norm(m.text) === norm(texts[d.id] ?? m.text),
    );
  }

  // object ids: one trip, one plan, canonical everywhere
  const tripId = String(c.state.tripId ?? '');
  const planId = String(c.state.planId ?? '');
  const trip = tripId ? await getTrip(rhea, tripId) : null;
  const plan = planId ? await getPlan(rhea, planId) : null;
  a.ok(
    'trip id is stable and present in the trip card text',
    !!tripId && hub.some((m) => m.text.includes(R.web.trip(tripId))),
  );
  a.ok(
    'plan id is stable on the plan card',
    !!planId && hub.some((m) => m.card?.planId === planId),
  );
  const tripRow = jsonOf(
    (await dbRows(R.tables.trips)).find((r) => (r.trip_id ?? r.tripId) === tripId),
  );
  const planRow = jsonOf((await dbRows(R.tables.plans)).find((r) => r.id === planId));
  a.eq('trip status agrees: API vs DB', trip?.status, tripRow?.status);
  a.eq('plan status agrees: API vs DB', plan?.status, planRow?.status);
  a.eq('plan rev agrees: API vs DB', plan?.rev, planRow?.rev);
  if (trip?.status === 'confirmed') {
    a.ok('web page agrees the trip is confirmed', await tripShows(c, a, tripId));
    a.ok('iMessage agrees the trip is confirmed', /Trip confirmed by all/.test(imAll));
  }
  if (plan?.status === 'active') {
    a.ok('iMessage agrees the plan is active', /plan is active|Study plan \(active\)/.test(imAll));
    if (actor) {
      await actor.page.goto(R.web.plan);
      const st = await actor.page
        .getByTestId(R.tid.planStatus)
        .innerText({ timeout: 20_000 })
        .catch(() => '');
      a.ok('web panel agrees the plan is active', /active/i.test(st), st);
    }
  }

  // failures and agent activity appear on both surfaces (the offline notice was recorded by S8)
  const offline = decisions.find((d) => d.kind === 'failure.agent-offline');
  a.ok('agent offline notice was recorded', !!offline);
  a.ok('agent offline notice reads as text in iMessage', /offline, trip waits for/i.test(imAll));
  a.ok(
    'agent offline notice is on the web thread',
    dom.some((x) => /offline, trip waits for/i.test(x.text)),
  );
  a.note('live typing/thinking is transient with the scripted model; only "not stuck" is asserted');
}

async function tripShows(c: GateCtx, a: Asserts, tripId: string): Promise<boolean> {
  const page = await openTripPage(c, a, tripId);
  if (!page) return false;
  return (
    (await page
      .getByTestId(R.tid.tripCelebration)
      .count()
      .catch(() => 0)) > 0
  );
}

export const S10: StepDef<GateCtx> = {
  id: 'S10',
  title: 'Decisions, updates, failures and agent activity stay synchronized in web and iMessage',
  needs: [P.trip, P.study, P.imsync],
  label: 'fixture (demo labelled)',
  fixture: s10,
};
