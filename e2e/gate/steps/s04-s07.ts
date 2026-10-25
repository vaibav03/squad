// S4 group iMessage tag, S5 route to the addressed live agent, S6 reply into the same group, S7 web mirror.
// Contract: docs/imessage.md (feature/imessage-sync) and docs/agent-aliases.md (feature/typed-mentions).
import { P } from '../lib/probes';
import {
  api,
  domThread,
  history,
  isBot,
  lastSeq,
  openGroupChat,
  say,
  threadOrder,
  waitBot,
  waitFor,
} from '../lib/hub';
import type { HMsg } from '../lib/hub';
import { im } from '../lib/fakes/client';
import { ctl } from '../lib/fakes/ctl';
import { FACTS } from '../lib/fakes/content';
import { SPARE_CHAT, STRANGER, UNLISTED_CHAT } from '../lib/chats';
import { defaultSentinels } from '../lib/asserts';
import type { Asserts } from '../lib/asserts';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { bindGroup, dbRows } from './flows';
import { citationKeys } from '../lib/cites';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Texts "Apple" received for a chat that are not the join/unlink housekeeping replies. */
export async function replyTexts(chat: string): Promise<string[]> {
  const r = await im.sent(chat);
  return r.sent
    .map((s) => s.text ?? '')
    .filter((t) => !/^(Linked|Unlinked|Done|Joined|Welcome)/i.test(t));
}

/** Waits until Apple has received at least `n` outbound texts for `chat` (the hub drains its queue every second). */
export async function waitOutbound(chat: string, n = 1, ms = 15_000): Promise<string[]> {
  return (
    (await waitFor(
      async () => ((await replyTexts(chat)).length >= n ? await replyTexts(chat) : undefined),
      ms,
    )) ?? []
  );
}

const personaPrefix = /^(?:\S+ )?(?:Cubbie|Tutor|Planner|Skeptic|Examiner|Chair): /u;

/** What already works on main: bind a group, tag the bot, attribution, allowlist and unbound-chat silence. */
async function s4Core(c: GateCtx, a: Asserts) {
  const { rhea } = c.world.users;
  const sq = await bindGroup(c.world);
  const token = rhea.token;
  const before = await lastSeq(token, sq.chatId);
  const sent = await im.say(sq.chat, rhea.phone, 'hey @cubbie what is due this week?');
  c.state.tagGuid = sent.last;
  const msg = await waitFor(async () =>
    (await history(token, sq.chatId)).find(
      (m) => m.seq > before && m.text.includes('what is due this week'),
    ),
  );
  a.ok('tagged iMessage became a hub chat message', !!msg);
  if (msg) {
    c.state.tagHubMsgId = msg.id;
    a.ok(
      'attributed to the right member (Rhea), not a raw handle',
      msg.sender.id === rhea.id && msg.sender.name === 'Rhea',
    );
    a.noRawIds('hub message text', msg.text);
  }
  const msgs = (await history(token, sq.chatId)).filter((m) =>
    m.text.includes('what is due this week'),
  );
  a.eq('exactly one hub message for the tag', msgs.length, 1);

  const seq0 = await lastSeq(token, sq.chatId);
  await im.say(UNLISTED_CHAT, rhea.phone, '@cubbie are you there?');
  await sleep(1200);
  a.eq(
    'a mention in a chat that is not on the allowlist posts nothing to the hub',
    await lastSeq(token, sq.chatId),
    seq0,
  );
  a.eq('and nothing is sent back into it', (await im.sent(UNLISTED_CHAT)).sent.length, 0);
  await im.say(SPARE_CHAT, rhea.phone, '@cubbie are you there?');
  await sleep(1200);
  a.eq(
    'a mention in an allowlisted but unbound chat posts nothing to the squad thread',
    await lastSeq(token, sq.chatId),
    seq0,
  );
  const spare = (await im.sent(SPARE_CHAT)).sent.map((s) => s.text ?? '').join('\n');
  a.ok('the unbound chat only gets the join hint', spare === '' || /join/i.test(spare));
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
    const tag = (await history(rhea.token, sq.chatId)).find((m) => m.id === c.state.tagHubMsgId);
    a.eq('message carries transport=imessage', tag?.transport, 'imessage');
    a.eq('message carries the Apple GUID as externalId', tag?.externalId, c.state.tagGuid);
    a.ok('senderLabel is the member name, never a number', tag?.senderLabel === 'Rhea');

    // @cubbi alias is the same agent
    const before = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbi what is a z-score?');
    const aliasReply = await waitBot(rhea.token, sq.chatId, () => true, before);
    a.ok('@cubbi alias is recognised and answered', !!aliasReply);
    a.eq('@cubbi is answered by Cubbie', aliasReply?.sender.id, 'cubbie');

    // identity map: GUID -> hub message id
    const xref = await dbRows('imsg_xref');
    const row = xref.find((r) => r.ext_id === c.state.tagGuid);
    a.ok('xref row stores the GUID', !!row);
    a.eq('xref direction is in', row?.direction, 'in');
    a.eq('xref maps the GUID to the hub message id', row?.message_id, c.state.tagHubMsgId);
    a.ok(
      'xref never stores a raw handle (hash only)',
      !JSON.stringify(xref).includes(rhea.phone.replace('+', '')),
    );

    // a handle nobody linked
    const seq0 = await lastSeq(rhea.token, sq.chatId);
    await im.reset();
    await im.say(sq.chat, STRANGER, '@cubbie what is due this week?');
    const prompt = (await waitOutbound(sq.chat, 1, 8000)).join('\n');
    a.ok(
      'unlinked handle gets the link prompt only',
      /cannot match|sign up|account/i.test(prompt) && !/due|homework/i.test(prompt),
    );
    a.eq('and nothing is posted to the web thread', await lastSeq(rhea.token, sq.chatId), seq0);
    a.noRawIds('link prompt', prompt);

    // a non-mention from the same stranger is shown read-only under a masked label, never routed
    await im.say(sq.chat, STRANGER, 'anyone have the slides?');
    const ctxMsg = await waitFor(async () =>
      (await history(rhea.token, sq.chatId)).find((m) => m.text === 'anyone have the slides?'),
    );
    a.ok(
      'unlinked chatter is shown as read-only context',
      !!ctxMsg && ctxMsg.sender.kind === 'system',
    );
    a.ok(
      'under a masked label, never the number',
      !!ctxMsg && !/5559990000/.test(JSON.stringify(ctxMsg)),
    );
    a.ok(
      'and the bot does not answer it',
      !(await history(rhea.token, sq.chatId)).some((m) => isBot(m) && m.seq > (ctxMsg?.seq ?? 0)),
    );
  },
};

export const S5: StepDef<GateCtx> = {
  id: 'S5',
  title: 'Route to the correct live agent with the same grounded context',
  needs: [P.mentions, P.a2a, P.context],
  realNeeds: ['llm'],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    const keysByPersona: Record<string, string[]> = {};
    for (const [alias, persona, name] of [
      ['@tutor', 'tutor', 'Tutor'],
      ['@planner', 'planner', 'Planner'],
    ] as const) {
      if (c.llm.llm === 'gemini' && !c.budget.allow(persona)) {
        a.note(`live budget/agent cap reached: ${persona} stays on the scripted model`);
        continue;
      }
      const before = await lastSeq(rhea.token, sq.chatId);
      await im.say(sq.chat, rhea.phone, `${alias} ${FACTS.hw4Question}`);
      const reply = await waitBot(rhea.token, sq.chatId, () => true, before, 60_000);
      a.ok(`${alias} reply arrived`, !!reply);
      if (!reply) continue;
      a.ok(
        `${alias} is answered by the ${persona} persona, not generic Cubbie`,
        reply.sender.id === persona && reply.sender.name === name,
      );
      a.ok(`${alias} text is not prefixed twice`, !/^(\S+ )?\w+: (\S+ )?\w+: /u.test(reply.text));
      const honest = c.llm.llm === 'fake' ? reply.demo === true : reply.demo !== true;
      a.ok(`${alias} mode label honest (demo=${reply.demo}, llm=${c.llm.llm})`, honest);
      keysByPersona[persona] = citationKeys(reply.citations);
      a.ok(`${alias} answer is grounded: it carries citations`, reply.citations.length >= 1);
      a.noLeak(`${alias} answer`, reply.text);
      a.noRawIds(`${alias} answer`, reply.text);
    }
    // the same retrieval: the grounded sources behind the persona answers are the ones S3 cited
    const s3 = (c.state.answerItemIds ?? []) as string[];
    for (const [persona, keys] of Object.entries(keysByPersona))
      a.ok(
        `${persona} cites the same sources as S3 (${s3.length} source(s))`,
        s3.length > 0 && s3.every((k) => keys.includes(k)),
        `got ${keys.length} key(s)`,
      );

    // the addressed agent is the one that works: the inspector state names the skill (typed-mentions contract)
    const st = (await api(null, '/v1/status')).json;
    a.ok(
      'status says honestly which model answers',
      st?.llm === c.llm.llm || (c.llm.llm === 'fake' && st?.demo === true),
    );
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
    const out = await waitOutbound(sq.chat, 1, 8000);
    a.ok('bot reply stored in the hub', !!reply);
    a.ok('reply mirrored to the same chat guid', out.length >= 1);
    a.ok(
      'nothing mirrored to another chat',
      (await im.sent()).sent.every((s) => s.to === sq.chat),
    );
  },
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    await im.reset();
    const before = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbie what is a z-score?');
    const reply = await waitBot(rhea.token, sq.chatId, () => true, before);
    const texts = await waitOutbound(sq.chat, 1);
    await sleep(800);
    const sent = (await im.sent()).sent;
    const out = sent.filter((s) => s.to === sq.chat);
    a.eq('exactly one outbound per reply', out.length, 1);
    a.ok(
      'every outbound went to the same chat guid',
      sent.every((s) => s.to === sq.chat),
    );
    const text = texts[0] ?? '';
    a.ok('outbound text length <= 900', text.length <= 900);
    a.ok('outbound is prefixed with the persona name', personaPrefix.test(text));
    a.noLeak('iMessage outbound', text, defaultSentinels());
    a.noRawIds('iMessage outbound', text);
    const xref = (await dbRows('imsg_xref')).filter((r) => r.direction === 'out');
    a.ok(
      'xref direction=out status=sent for the reply',
      xref.some((r) => r.message_id === reply?.id && r.status === 'sent'),
    );
    const m1 = (await history(rhea.token, sq.chatId)).find((m) => m.id === reply?.id);
    a.eq('the web message says it was sent to iMessage', m1?.deliveryState?.state, 'sent');
    // a receipt upgrades sent -> delivered (transports that have receipts)
    const guid = (out[0] as { guid?: string }).guid;
    if (guid) {
      await ctl.receipt(guid, 'delivered');
      const d = await waitFor(
        async () =>
          (await history(rhea.token, sq.chatId)).find(
            (m) => m.id === reply?.id && m.deliveryState?.state === 'delivered',
          ),
        6000,
      );
      a.ok('a delivery receipt shows as delivered', !!d);
    } else a.note('transport reported no GUID: receipts not exercised');

    // failure then retry: queued with a retry label, never "sent" while failing, then sent exactly once
    await im.reset();
    await im.failNext(2);
    const b2 = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbie one more question about z-scores');
    const r2 = await waitBot(rhea.token, sq.chatId, () => true, b2);
    const pending = await waitFor(
      async () =>
        (await history(rhea.token, sq.chatId)).find(
          (m) => m.id === r2?.id && m.deliveryState && m.deliveryState.state !== 'sent',
        ),
      8000,
    );
    a.ok(
      'a failing send is shown as queued or failed, never as sent',
      !!pending && ['queued', 'failed'].includes(pending.deliveryState!.state),
    );
    a.ok(
      'and the label says so in words',
      !!pending?.deliveryState?.label && !/^sent/i.test(pending.deliveryState.label),
    );
    a.eq('nothing reached Apple while it was failing', (await replyTexts(sq.chat)).length, 0);
    await ctl.advance(5_000);
    const done = await waitFor(
      async () =>
        (await history(rhea.token, sq.chatId)).find(
          (m) => m.id === r2?.id && m.deliveryState?.state === 'sent',
        ),
      15_000,
    );
    a.ok('after the retry the message is sent', !!done);
    a.eq('and delivered to Apple exactly once', (await replyTexts(sq.chat)).length, 1);
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
    const { rhea } = c.world.users;
    const sq = c.world.squadA;
    // duplicates must not duplicate
    const guid = (await im.say(sq.chat, rhea.phone, 'duplicate delivery check')).last!;
    await im.duplicate(guid, 3);
    await sleep(800);
    const hist = await history(rhea.token, sq.chatId);
    a.eq(
      'one hub message after 3 duplicate GUID deliveries',
      hist.filter((m) => m.text === 'duplicate delivery check').length,
      1,
    );
    a.ordered('ids unique and seq strictly increasing', hist);
    a.eq(
      'the hub thread is in the shared order (message time, then sequence)',
      hist.map((m) => m.id),
      threadOrder(hist).map((m) => m.id),
    );

    const pr = c.actors.rhea;
    const pb = c.actors.ben;
    if (!pr || !pb) return a.fail('web actors', 'not opened');
    a.ok('Rhea opens the group chat', await openGroupChat(pr, sq.chatId));
    a.ok('Ben opens the group chat', await openGroupChat(pb, sq.chatId));
    await sleep(1500);
    const dr = await domThread(pr.page);
    const db = await domThread(pb.page);
    a.eq(
      'Rhea and Ben see the same ordered message ids',
      dr.map((m) => m.id),
      db.map((m) => m.id),
    );
    a.ok('DOM message ids unique', new Set(dr.map((m) => m.id)).size === dr.length);
    const full = await history(rhea.token, sq.chatId);
    a.eq(
      'the web thread is the complete hub thread, in order',
      dr.map((m) => m.id),
      threadOrder(full).map((m) => m.id),
    );
    const viaTag = pr.page.locator('[data-testid="chat-message"]', {
      hasText: 'duplicate delivery check',
    });
    a.ok(
      'iMessage-origin message carries a "via iMessage" tag',
      /via iMessage/i.test(
        await viaTag
          .first()
          .innerText()
          .catch(() => ''),
      ),
    );
    a.ok(
      'bot replies are attributed to a persona',
      (await pr.page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').count()) > 0,
    );
    const thread = dr.map((m) => m.text).join('\n');
    a.noRawIds('web thread', thread);
    a.noLeak('web thread', thread);
    const demoLabels = await pr.page.getByTestId('chat-demo-label').count();
    if (c.llm.llm === 'fake')
      a.ok(
        'Demo label visible on bot replies while the model is the stand-in',
        demoLabels > 0,
        'status is fake but no Demo label',
      );
    else a.eq('no Demo label while the model is real', demoLabels, 0);
    await a.shot(pr.page, 'web-mirror-rhea');

    // web reply: stays on the web unless it mentions an agent (default mirror rule bot_and_mentions)
    await im.reset();
    await say(pb.page, 'web only: see you at the library');
    await sleep(1500);
    a.eq(
      'a plain web message stays out of the iMessage group',
      (await replyTexts(sq.chat)).filter((t) => /library/.test(t)).length,
      0,
    );
    const plain = (await history(rhea.token, sq.chatId)).find((m) =>
      /see you at the library/.test(m.text),
    );
    a.eq('and its delivery state says web_only', plain?.deliveryState?.state, 'web_only');
    a.ok(
      'the bubble says it is web-only',
      /web only|not sent to iMessage/i.test(
        await pb.page
          .locator('[data-testid="chat-message"]', { hasText: 'see you at the library' })
          .first()
          .innerText()
          .catch(() => ''),
      ),
    );
    await say(pb.page, '@cubbie bring snacks to the library');
    const t = (await waitOutbound(sq.chat, 1, 15_000)).find((x) => /bring snacks/.test(x)) ?? '';
    a.ok(
      'a web message that tags an agent posts as "Ben (via Squad): ..."',
      t.startsWith('Ben (via Squad): '),
    );
    await sleep(800);
    a.eq(
      'and does not bounce back as a second web message',
      (await history(rhea.token, sq.chatId)).filter(
        (m) => /bring snacks/.test(m.text) && m.sender.kind === 'student',
      ).length,
      1,
    );
    await a.shot(pb.page, 'web-mirror-ben');
  },
};

export type { HMsg };
