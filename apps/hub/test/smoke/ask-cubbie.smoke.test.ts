// "Ask Nook": an imported item attached to a chat message is verified by the hub, answered from with real-vs-fixture
// citations, never leaks a private calendar event to the squad, and the same imports seed a persisted, cited study plan.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage, type PlanView } from '@squad/core';
import { hashExternalAccount, normalizeItem } from '@squad/brain';
import type { SourceKind } from '@squad/core';
import { attachChatEngine } from '../../src/chat/engine';
import { contextServiceFor } from '../../src/context/service';
import { createPlanStore } from '../../src/plans/store';
import { SQUAD_ID } from '../../src/cast';
import type { RunningHub } from '../../src/server';
import { boot, login, post, auth } from '../helpers';

let hub: RunningHub;
let url: string;
let ana: string;
let ben: string;
const DAY = 86_400_000;

function add(owner: string, kind: SourceKind, id: string, title: string, extra: object, text: string) {
  const store = contextServiceFor(hub.deps).store;
  const cid = `c_${owner}`;
  if (!store.connection(cid))
    store.upsertConnection({
      id: cid,
      ownerId: owner,
      provider: 'canvas',
      mode: 'fixture',
      variant: 'session',
      accountHash: hashExternalAccount('p', 'canvas', owner),
      scopes: [],
      status: 'live',
      degraded: false,
      statusNote: null,
      createdAt: Date.now(),
      lastSyncAt: null,
      expiresAt: null,
    });
  const { source, pieces } = normalizeItem(
    { ownerId: owner, connectionId: cid, provider: 'canvas', mode: 'fixture', now: Date.now() },
    { externalId: id, kind, title, courseId: 'c1', url: null, modifiedAt: null, ...extra },
    { text },
  );
  store.upsertSource(source, pieces);
  return source;
}

const msgs = (chatId: string): ChatMessage[] =>
  hub.deps.chat.store.since(0, [chatId]).map((m) => ChatMessageSchema.parse(m));

async function sendAndWait(tok: string, chatId: string, text: string, context?: object[]) {
  const before = msgs(chatId).length;
  const r = await post(url, '/v1/chat/send', { chatId, text, ...(context ? { context } : {}) }, tok);
  if (r.status !== 202) return { status: r.status, body: r.body, replies: [] as ChatMessage[] };
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - t0 < 15_000) {
    await new Promise((res) => setTimeout(res, 250));
    const n = msgs(chatId).filter((m) => m.sender.kind === 'persona').length;
    if (n >= 1 && n === last) {
      if (++stable >= 2) break;
    } else stable = 0;
    last = n;
  }
  return {
    status: 202,
    body: r.body,
    replies: msgs(chatId).slice(before).filter((m) => m.sender.kind === 'persona'),
  };
}

let essay: ReturnType<typeof add>;
let therapy: ReturnType<typeof add>;
let benPriv: ReturnType<typeof add>;

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  await attachChatEngine(hub, { real: null, env: {}, envFile: false, noProbe: true });
  ana = await login(url, 's_ana');
  ben = await login(url, 's_ben');
  essay = add(
    's_ana',
    'canvas_assignment',
    'a_essay',
    'Essay 2: Normal distribution report',
    { dueAt: Date.now() + 5 * DAY },
    'Course: Statistics 101\nWrite a two page report on the empirical rule. Submit as PDF.',
  );
  therapy = add(
    's_ana',
    'gcal_event',
    'e_therapy',
    'therapy $180 copay',
    { startsAt: Date.now() + 2 * DAY, endsAt: Date.now() + 2 * DAY + 3_600_000 },
    'therapy $180 copay with Dr Rowe',
  );
  benPriv = add('s_ben', 'canvas_assignment', 'b_priv', 'Ben private note', {}, 'Ben private text');
}, 60_000);
afterAll(async () => {
  await hub.stop();
});

describe('context-ref endpoint', () => {
  it('returns a verified ref for the owner and refuses a private source of someone else', async () => {
    const r = await fetch(`${url}/v1/chat/context-ref?sourceId=${encodeURIComponent(essay.id)}`, {
      headers: auth(ana),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ref: { title: string; provenance: string; courseName: string } };
    expect(j.ref).toMatchObject({
      title: 'Essay 2: Normal distribution report',
      provenance: 'fixture',
      courseName: 'Statistics 101',
    });
    const other = await fetch(`${url}/v1/chat/context-ref?sourceId=${encodeURIComponent(benPriv.id)}`, {
      headers: auth(ana),
    });
    expect(other.status).toBe(404);
  });

  it('a calendar event is redacted in the group view', async () => {
    const r = await fetch(`${url}/v1/chat/context-ref?sourceId=${encodeURIComponent(therapy.id)}`, {
      headers: auth(ana),
    });
    const j = (await r.json()) as { ref: { title: string }; groupView: { title: string } };
    expect(j.ref.title).toContain('therapy');
    expect(JSON.stringify(j.groupView)).not.toMatch(/therapy|\$180/);
  });
});

describe('send with context', () => {
  it('DM: stores the verified ref (forged fields ignored) and the answer cites the item with provenance', async () => {
    const out = await sendAndWait(ana, 'dm:s_ana', '@cubbie what should I focus on for this?', [
      {
        sourceId: essay.id,
        kind: 'canvas_assignment',
        title: 'FORGED TITLE',
        provenance: 'real',
        provider: 'canvas',
      },
    ]);
    expect(out.status).toBe(202);
    const sent = msgs('dm:s_ana').find((m) => m.sender.kind === 'student' && m.context)!;
    expect(sent.context![0]).toMatchObject({
      title: 'Essay 2: Normal distribution report',
      provenance: 'fixture',
    });
    expect(JSON.stringify(sent)).not.toContain('FORGED');
    const reply = out.replies.at(-1)!;
    expect(reply.text).toMatch(/Essay 2/);
    expect(reply.text).toMatch(/due/i);
    expect(reply.citations[0]!.source).toMatchObject({
      id: essay.id,
      provenance: 'fixture',
      courseName: 'Statistics 101',
    });
    expect(reply.provenance).toMatchObject({ kind: 'grounded', mode: 'demo' });
    expect(reply.provenance!.label).toMatch(/demo data/);
    // the source viewer opens the verified snippet
    const q = new URLSearchParams({
      id: essay.id,
      kind: 'canvas_assignment',
      anchor: reply.citations[0]!.source!.anchor ?? '',
      quote: reply.citations[0]!.quote ?? '',
    });
    const sv = await fetch(`${url}/v1/context/source?${q}`, { headers: auth(ana) });
    const svj = (await sv.json()) as { ok: boolean; quoteVerified: boolean; provenance: string };
    expect(svj).toMatchObject({ ok: true, provenance: 'fixture' });
  });

  it('@cubbi alias in the group answers from the attached context', async () => {
    const out = await sendAndWait(ana, `group:${SQUAD_ID}`, '@cubbi how do I start this?', [
      { sourceId: essay.id, kind: 'canvas_assignment', title: 'x', provenance: 'fixture', provider: 'canvas' },
    ]);
    expect(out.replies.at(-1)!.citations[0]!.source!.id).toBe(essay.id);
  });

  it("another student's private source is refused", async () => {
    const r = await post(url, '/v1/chat/send', {
      chatId: 'dm:s_ana',
      text: '@cubbie summarise',
      context: [{ sourceId: benPriv.id, kind: 'canvas_assignment', title: 'x', provenance: 'real', provider: 'canvas' }],
    }, ana);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).toContain('context_unreadable');
  });

  it('privacy: a private calendar event attached in the group never shows its title or $180 to the squad', async () => {
    const out = await sendAndWait(ana, `group:${SQUAD_ID}`, '@cubbie am I free then?', [
      { sourceId: therapy.id, kind: 'gcal_event', title: 'x', provenance: 'fixture', provider: 'google' },
    ]);
    const group = msgs(`group:${SQUAD_ID}`);
    expect(JSON.stringify(group)).not.toMatch(/therapy|\$180|Rowe/i);
    expect(out.replies.length).toBeGreaterThan(0);
    // Ben cannot read it through any chat path
    const benView = await (await fetch(`${url}/v1/chat/history?chatId=group:${SQUAD_ID}&limit=100`, { headers: auth(ben) })).text();
    expect(benView).not.toMatch(/therapy|\$180/i);
    // the owner gets the details in their DM
    expect(JSON.stringify(msgs('dm:s_ana'))).toMatch(/therapy/);
  });
});

describe('study plan seeded from imports persists', () => {
  it('shared item becomes a cited plan item; reload from the same db keeps it; badge is the honest demo one', async () => {
    contextServiceFor(hub.deps).store.share(essay.id, SQUAD_ID);
    const exam = new Date(Date.now() + 12 * DAY).toISOString().slice(0, 10);
    const r = await fetch(`${url}/v1/plans`, { method: 'POST', headers: auth(ana), body: JSON.stringify({ examDate: exam }) });
    expect(r.status).toBe(200);
    const plan = ((await r.json()) as { plan: PlanView }).plan;
    const item = plan.items.find((i) => i.sources.some((s) => s.source?.id === essay.id));
    expect(item, 'a plan item cites the imported assignment').toBeTruthy();
    expect(plan.generator.mode).not.toBe('live'); // no model key here: never presented as live
    // "reload": a fresh store over the same database
    const again = createPlanStore(hub.deps.db).get(plan.id)!;
    expect(again.items.some((i) => i.sources.some((s) => s.source?.id === essay.id))).toBe(true);
    expect(again.generator.mode).toBe(plan.generator.mode);
    const cur = await fetch(`${url}/v1/plans/current`, { headers: auth(ana) });
    expect(((await cur.json()) as { plan: PlanView }).plan.id).toBe(plan.id);
  });
});

describe('due windows and relevance in chat answers', () => {
  it('"what is due from Canvas this week" lists the next 7 days with course names and exact dates; later items only under "Next after this week"', async () => {
    add('s_chi', 'canvas_assignment', 'w1', 'seed', {}, 'seed'); // another student's data never appears
    const soon = add(
      's_ana',
      'canvas_assignment',
      'w_soon',
      'HIST 140 Reading response 2',
      { dueAt: Date.now() + 2 * DAY },
      'Course: HIST 140: World History\nWrite a one page response.',
    );
    add(
      's_ana',
      'canvas_assignment',
      'w_later',
      'HIST 140 Term paper',
      { dueAt: Date.now() + 12 * DAY },
      'Course: HIST 140: World History\nTen pages.',
    );
    const out = await sendAndWait(
      ana,
      'dm:s_ana',
      '@cubbie what is due from Canvas this week? Include course names and exact due dates.',
    );
    const reply = out.replies.map((m) => m.text).join('\n');
    expect(reply).toContain('HIST 140 Reading response 2 (HIST 140: World History)');
    expect(reply).toMatch(/due \w+day, \w+ \d+, \d+:\d\d (AM|PM) UTC/);
    const [thisWeek, after] = reply.split('Next after this week:');
    expect(thisWeek).not.toContain('Term paper');
    expect(after ?? '').toContain('Term paper');
    const chips = out.replies.flatMap((m) => m.citations);
    expect(chips.some((c) => c.source?.id === soon.id && c.source.courseName === 'HIST 140: World History')).toBe(true);
    expect(chips.some((c) => /Term paper/.test(c.label))).toBe(true);
  });

  it('nothing in the window: says so, names the next item, offers the follow-up; the follow-up lists later items', async () => {
    const out = await sendAndWait(ana, 'dm:s_ana', '@cubbie what is due tomorrow?');
    const t = out.replies.map((m) => m.text).join('\n');
    expect(t).toMatch(/Nothing due tomorrow/);
    expect(t).toContain('what is due after this week');
    const later = await sendAndWait(ana, 'dm:s_ana', '@cubbie what is due after this week?');
    expect(later.replies.map((m) => m.text).join('\n')).toContain('Term paper');
  });

  it('a question the sources do not cover gets no evidence chip for an unrelated source', async () => {
    add(
      's_ana',
      'canvas_assignment',
      'h215',
      'HIST 215 Reading response: Atlantic trade',
      {},
      'Course: HIST 215\nWrite a reading response on the Atlantic trade essays.',
    );
    const out = await sendAndWait(ana, 'dm:s_ana', '@cubbie what are the HIST 140 discussion board details for week nine?');
    const r = out.replies.at(-1)!;
    expect(r.text).not.toMatch(/Atlantic trade essays/);
    for (const c of r.citations) expect(c.source?.relation).toBe('related');
    if (r.citations.length) expect(r.provenance).toMatchObject({ kind: 'no_sources', sources: 0 });
  });
});
