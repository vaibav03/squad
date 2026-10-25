// S4 group iMessage tag, S5 routing, S6 reply into the same group, S7 web mirror.
import { P } from '../lib/probes';
import { api, domThread, history, isBot, lastSeq, openGroupChat, say, waitBot, waitFor } from '../lib/hub';
import { im } from '../lib/fakes/client';
import { FACTS } from '../lib/fakes/content';
import { ROUTES } from '../lib/contract';
import { SPARE_CHAT, STRANGER, UNLISTED_CHAT } from '../lib/chats';
import { defaultSentinels } from '../lib/asserts';
import type { Asserts } from '../lib/asserts';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { bindGroup, dbRows, outboundTo } from './flows';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What already works on main: bind a group, tag the bot, attribution, allowlist and unbound-chat silence. */
async function s4Core(c: GateCtx, a: Asserts) {
  const { rhea } = c.world.users;
  const sq = await bindGroup(c.world);
  const token = rhea.token;
  const before = await lastSeq(token, sq.chatId);
  const sent = await im.say(sq.chat, rhea.phone, 'hey @cubbie what is due this week?');
  c.state.tagGuid = sent.last;
  const msg = await waitFor(async () =>
    (await history(token, sq.chatId)).find((m) => m.seq > before && m.text.includes('what is due this week')),
  );
  a.ok('tagged iMessage became a hub chat message', !!msg);
  if (msg) {
    c.state.tagHubMsgId = msg.id;
    a.ok('attributed to the right member (Rhea), not a raw handle', msg.sender.id === rhea.id || msg.sender.name === 'Rhea');
    a.noRawIds('hub message text', msg.text);
  }
  const msgs = (await history(token, sq.chatId)).filter((m) => m.text.includes('what is due this week'));
  a.eq('exactly one hub message for the tag', msgs.length, 1);

  const seq0 = await lastSeq(token, sq.chatId);
  await im.say(UNLISTED_CHAT, rhea.phone, '@cubbie are you there?');
  await im.say(SPARE_CHAT, rhea.phone, '@cubbie are you there?');
  await sleep(1200);
  a.eq('mention in an unbound or non-allowlisted chat posts nothing to the hub', await lastSeq(token, sq.chatId), seq0);
  a.eq('and nothing is sent back into those chats', (await im.sent(UNLISTED_CHAT)).sent.length + (await im.sent(SPARE_CHAT)).sent.length, 0);
}

export const S4: StepDef<GateCtx> = {
  id: 'S4',
  title: 'Group iMessage tagging @cubbie / @cubbi',
  needs: [P.imsync, P.mentions],
  realNeeds: ['apple'],
  preview: s4Core,
  fixture: async (c, a) => {
    await s4Core(c, a);
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    // alias @cubbi
    const before = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbi what is a z-score?');
    const aliasReply = await waitBot(rhea.token, sq.chatId, () => true, before);
    a.ok('@cubbi alias is recognised and answered', !!aliasReply);
    // xref row with the GUID and the hub id
    const xref = await dbRows('chat_msg_xref');
    const row = xref.find((r) => (r.external_guid ?? r.externalGuid) === c.state.tagGuid);
    a.ok('xref row stores the GUID', !!row);
    a.eq('xref maps the GUID to the hub message id', row?.hub_msg_id ?? row?.hubMsgId, c.state.tagHubMsgId);
    // unlinked handle in a bound group
    const seq0 = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, STRANGER, '@cubbie what is due this week?');
    await sleep(1200);
    a.eq('unlinked handle: nothing posted to the web thread', await lastSeq(rhea.token, sq.chatId), seq0);
    const out = (await im.sent(sq.chat)).sent.map((s) => s.text ?? '').slice(-1)[0] ?? '';
    a.ok('unlinked handle gets the link prompt only', /connect|link|code|squad/i.test(out) && !/due|homework/i.test(out));
  },
};

export const S5: StepDef<GateCtx> = {
  id: 'S5',
  title: 'Route to the correct live agent with the same grounded context',
  needs: [P.mentions, P.council, P.context],
  realNeeds: ['llm'],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    for (const [alias, persona] of [
      ['@tutor', 'tutor'],
      ['@planner', 'planner'],
    ] as const) {
      if (c.llm.llm === 'gemini' && !c.budget.allow(persona)) {
        a.note(`live budget/agent cap reached: ${persona} stays on the scripted model`);
        continue;
      }
      const before = await lastSeq(rhea.token, sq.chatId);
      await im.say(sq.chat, rhea.phone, `${alias} ${FACTS.cltQuestion}`);
      const reply = await waitBot(rhea.token, sq.chatId, () => true, before);
      a.ok(`${alias} reply arrived`, !!reply);
      if (!reply) continue;
      a.ok(`${alias} is answered by the ${persona} persona, not generic Cubbie`, reply.sender.id === persona || new RegExp(persona, 'i').test(reply.sender.name));
      const honest = c.llm.llm === 'fake' ? reply.demo === true : reply.demo !== true;
      a.ok(`${alias} mode label honest (demo=${reply.demo}, llm=${c.llm.llm})`, honest);
      if (c.llm.llm === 'fake') a.ok('fake answer says Demo in its text', /demo/i.test(reply.text) || reply.demo === true);
    }
    const r = await api(rhea.token, ROUTES.retrieve, { method: 'POST', json: { squadId: sq.id, query: FACTS.hw4Question } });
    const ids = ((r.json?.items ?? []) as { id: string }[]).map((i) => i.id).sort();
    a.ok('retrieve returns items', ids.length > 0);
    a.eq('the same retrieval call returns the same item ids as in S3', ids, c.state.answerItemIds ?? []);
  },
};

export const S6: StepDef<GateCtx> = {
  id: 'S6',
  title: 'Reply delivered into the same iMessage group',
  needs: [P.imsync, P.mentions],
  realNeeds: ['apple'],
  preview: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    await im.reset();
    const before = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbie what is a z-score?');
    const reply = await waitBot(rhea.token, sq.chatId, () => true, before);
    await sleep(800);
    a.ok('bot reply stored in the hub', !!reply);
    const out = (await im.sent()).sent.filter((s) => s.to === sq.chat);
    a.ok('reply mirrored to the same chat guid', out.length >= 1);
    a.ok('nothing mirrored to another chat', (await im.sent()).sent.every((s) => s.to === sq.chat));
  },
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    await im.reset();
    const before = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbie what is a z-score?');
    const reply = await waitBot(rhea.token, sq.chatId, () => true, before);
    await sleep(800);
    const sent = (await im.sent()).sent;
    const out = sent.filter((s) => s.to === sq.chat);
    a.eq('exactly one outbound per reply', out.length, 1);
    a.ok('every outbound went to the same chat guid', sent.every((s) => s.to === sq.chat));
    const text = out[0]?.text ?? '';
    a.ok('outbound text length <= 900', text.length <= 900);
    a.noLeak('iMessage outbound', text, defaultSentinels());
    a.noRawIds('iMessage outbound', text);
    const xref = (await dbRows('chat_msg_xref')).filter((r) => (r.direction ?? '') === 'out');
    a.ok('xref direction=out status=sent for the reply', xref.some((r) => (r.hub_msg_id ?? r.hubMsgId) === reply?.id && r.status === 'sent'));

    // failure then retry: persisted failed, labelled state on the web bubble, then delivered
    await im.failNext(1);
    const b2 = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbie one more question about z-scores');
    const r2 = await waitBot(rhea.token, sq.chatId, () => true, b2);
    await sleep(1500);
    const m2 = (await history(rhea.token, sq.chatId)).find((m) => m.id === r2?.id);
    a.ok('send failure persisted with a delivery state', !!m2?.delivery && ['failed', 'retrying', 'sent'].includes(m2.delivery.state));
    a.ok('a failed send is never shown as delivered while failed', m2?.delivery?.state !== 'sent' || (await im.sent(sq.chat)).receipts.some((r) => r.ok && r.text === (m2?.text ?? '')));
    if (c.actors.rhea) {
      await openGroupChat(c.actors.rhea, sq.chatId);
      await a.shot(c.actors.rhea.page, 'delivery-state');
    }
  },
};

export const S7: StepDef<GateCtx> = {
  id: 'S7',
  title: 'Web chat shows the complete ordered conversation (and mirrors back)',
  needs: [P.imsync, P.blankShell, P.floatingChat, P.mentions],
  fixture: async (c, a) => {
    const { rhea, ben } = c.world.users;
    const sq = c.world.squadA;
    // duplicates must not duplicate
    const guid = (await im.say(sq.chat, rhea.phone, 'duplicate delivery check')).last!;
    await im.duplicate(guid, 3);
    await sleep(800);
    const hist = await history(rhea.token, sq.chatId);
    a.eq('one hub message after 3 duplicate GUID deliveries', hist.filter((m) => m.text === 'duplicate delivery check').length, 1);
    a.ordered('ids unique and seq strictly increasing', hist);

    const pr = c.actors.rhea;
    const pb = c.actors.ben;
    if (!pr || !pb) return a.fail('web actors', 'not opened');
    a.ok('Rhea opens the group chat', await openGroupChat(pr, sq.chatId));
    a.ok('Ben opens the group chat', await openGroupChat(pb, sq.chatId));
    const dr = await domThread(pr.page);
    const db = await domThread(pb.page);
    a.eq('Rhea and Ben see the same ordered message ids', dr.map((m) => m.id), db.map((m) => m.id));
    a.ok('DOM message ids unique', new Set(dr.map((m) => m.id)).size === dr.length);
    const viaTag = pr.page.locator('[data-testid="chat-message"]', { hasText: 'duplicate delivery check' });
    a.ok('iMessage-origin message carries a "via iMessage" tag', /via iMessage/i.test(await viaTag.first().innerText().catch(() => '')));
    a.ok('bot replies attributed to a persona', (await pr.page.locator('[data-testid="chat-message"][data-sender-id]').evaluateAll((els) => els.some((e) => e.getAttribute('data-sender-id') === 'cubbie'))));
    const thread = dr.map((m) => m.text).join('\n');
    a.noRawIds('web thread', thread);
    a.noLeak('web thread', thread);
    a.modeBadge('web thread', thread, c.llm.llm);
    await a.shot(pr.page, 'web-mirror-rhea');

    // web reply, web-only by default
    await im.reset();
    await say(pb.page, 'web only: see you at the library');
    await sleep(1200);
    a.eq('a web message stays out of the iMessage group by default', (await im.sent(sq.chat)).sent.filter((s) => /library/.test(s.text ?? '')).length, 0);
    a.ok('the bubble says it is web-only', /web only|only in squad|not sent to iMessage/i.test(await pb.page.locator('[data-testid="chat-message"]', { hasText: 'see you at the library' }).first().innerText().catch(() => '')));
    // opt in per message
    const toggle = pb.page.getByTestId('chat-also-imessage');
    if (await toggle.count()) {
      await toggle.check();
      await say(pb.page, 'also to the group: bring snacks');
      await sleep(1500);
      const t = (await im.sent(sq.chat)).sent.map((s) => s.text ?? '').find((x) => /bring snacks/.test(x)) ?? '';
      a.ok('opted-in web message posts as "Ben (via Squad):"', t.startsWith('Ben (via Squad):'));
    } else a.fail('"Also post to iMessage group" control', 'testid chat-also-imessage not found');
    await a.shot(pb.page, 'web-mirror-ben');
    void isBot;
    void ben;
  },
};
