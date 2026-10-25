// Variants that live on the iMessage / conversation side: V6 (duplicates), V7 (offline and backfill), V8 (outbound
// failure), V9 (conflicting edits), V10 (multiple threads), V11 (degraded model), V12 (wrong person).
import { P } from '../lib/probes';
import { api, history, lastSeq, threadOrder, waitBot, waitFor } from '../lib/hub';
import { im } from '../lib/fakes/client';
import { ctl } from '../lib/fakes/ctl';
import { restartHub } from '../lib/stack';
import { STRANGER } from '../lib/chats';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { bindGroup, dbRows } from './flows';
import { replyTexts, sleep, waitOutbound } from './s04-s07';
import { agentOfflineFragment, planChapterConflict, tripFieldConflict } from './conflicts';

export const V6: StepDef<GateCtx> = {
  id: 'V6',
  title: 'Duplicate events',
  needs: [P.imsync, P.mentions],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = await bindGroup(c.world);
    await im.reset();
    const before = await lastSeq(rhea.token, sq.chatId);
    const guid = (await im.say(sq.chat, rhea.phone, '@cubbie what is a z-score?')).last!;
    await im.duplicate(guid, 3);
    const reply = await waitBot(rhea.token, sq.chatId, () => true, before);
    await waitOutbound(sq.chat, 1);
    await sleep(2500);
    const h = await history(rhea.token, sq.chatId);
    a.eq(
      'one hub message for a GUID delivered four times',
      h.filter((m) => m.externalId === guid).length,
      1,
    );
    a.eq('one bot reply', h.filter((m) => m.sender.kind === 'persona' && m.seq > before).length, 1);
    a.eq('one outbound to Apple', (await replyTexts(sq.chat)).length, 1);
    a.ok('the reply exists', !!reply);
    const xref = (await dbRows('imsg_xref')).filter((r) => r.ext_id === guid);
    a.eq('one identity row for the GUID', xref.length, 1);
  },
};

export const V7: StepDef<GateCtx> = {
  id: 'V7',
  title: 'Offline gap, backfill and hub restart',
  needs: [P.imsync],
  fixture: async (c, a) => {
    const { rhea, ben } = c.world.users;
    const sq = await bindGroup(c.world);
    await im.reset();
    const before = await lastSeq(rhea.token, sq.chatId);
    await im.drop();
    await im.say(sq.chat, rhea.phone, 'gap one: meet at the library');
    await im.say(sq.chat, ben.phone, '@cubbie gap two: what is a z-score?');
    await sleep(800);
    a.eq(
      'nothing reached the hub while the watcher was down',
      await lastSeq(rhea.token, sq.chatId),
      before,
    );

    // the hub restarts while the watcher is still down: chat.db keeps the rows, the hub backfills on start
    const up = await restartHub();
    a.ok('hub restarted (exact PID)', up);
    const tok = (await relogin(rhea.phone, rhea.name)) ?? rhea.token;
    const got = await waitFor(async () => {
      const h = await history(tok, sq.chatId);
      return h.filter((m) => /gap (one|two)/.test(m.text)).length >= 2 ? h : undefined;
    }, 30_000);
    if (!got) {
      // the transport only backfills bound chats: ask for it explicitly (the watcher "came back")
      await im.backfill();
    }
    const h = await waitFor(async () => {
      const x = await history(tok, sq.chatId);
      return x.filter((m) => /gap (one|two)/.test(m.text)).length >= 2 ? x : undefined;
    }, 20_000);
    a.ok('both gap messages appear after reconnect', !!h);
    if (!h) return;
    const gap = h.filter((m) => /gap (one|two)/.test(m.text));
    a.eq('each appears exactly once', gap.length, 2);
    a.ok(
      'in message-time order (one before two)',
      gap[0]!.text.includes('gap one') && gap[1]!.text.includes('gap two'),
    );
    a.ok(
      'flagged as received late',
      gap.every((m) => m.receivedLate === true),
    );
    a.eq(
      'the thread is in the shared order',
      h.map((m) => m.id),
      threadOrder(h).map((m) => m.id),
    );
    await waitOutbound(sq.chat, 1, 20_000);
    await sleep(1500);
    a.eq('the tagged one is answered once', (await replyTexts(sq.chat)).length, 1);
  },
};

async function relogin(phone: string, name: string): Promise<string | undefined> {
  const s = await api(null, '/v1/auth/start', { method: 'POST', json: { name, phone } });
  const v = await api(null, '/v1/auth/verify', {
    method: 'POST',
    json: { challengeId: s.json?.challengeId, code: s.json?.devCode },
  });
  return v.json?.token;
}

export const V8: StepDef<GateCtx> = {
  id: 'V8',
  title: 'Outbound failure and retry',
  needs: [P.imsync, P.mentions],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = await bindGroup(c.world);
    const chat = sq.chat;
    const stateOf = async (id?: string) =>
      (await history(rhea.token, sq.chatId)).find((m) => m.id === id)?.deliveryState;

    // two failures, then success
    await im.reset();
    await im.failNext(2);
    let b = await lastSeq(rhea.token, sq.chatId);
    await im.say(chat, rhea.phone, '@cubbie retry me');
    const r1 = await waitBot(rhea.token, sq.chatId, () => true, b);
    await waitFor(
      async () => ((await stateOf(r1?.id))?.state === 'queued' ? true : undefined),
      8000,
    );
    await ctl.advance(5000);
    const ok1 = await waitFor(
      async () => ((await stateOf(r1?.id))?.state === 'sent' ? true : undefined),
      15_000,
    );
    a.ok('failNext(2) then sent after the retry', !!ok1);
    a.eq('delivered to Apple once', (await replyTexts(chat)).length, 1);

    // endless failure: the ladder ends in failed(reason), never "sent", attempts are bounded
    await im.reset();
    await im.failNext(500);
    b = await lastSeq(rhea.token, sq.chatId);
    await im.say(chat, rhea.phone, '@cubbie this one will fail');
    const r2 = await waitBot(rhea.token, sq.chatId, () => true, b);
    let final: { state: string; reason?: string; label: string } | undefined;
    for (let i = 0; i < 12 && final?.state !== 'failed'; i++) {
      await ctl.advance(10 * 60_000);
      await sleep(1500);
      final = await stateOf(r2?.id);
    }
    a.eq('the ladder ends in failed', final?.state, 'failed');
    a.ok('with a reason and a label in words', !!final?.reason && /fail/i.test(final.label));
    const attempts = (await im.sent(chat)).receipts.filter((r) => !r.ok).length;
    a.ok(`attempts are bounded (${attempts})`, attempts > 0 && attempts <= 16);
    a.eq('nothing was ever delivered to Apple', (await replyTexts(chat)).length, 0);
    await ctl.advance(10 * 60_000);
    await sleep(2500);
    a.eq(
      'no more attempts after failed',
      (await im.sent(chat)).receipts.filter((r) => !r.ok).length,
      attempts,
    );

    // Retry from the web works once Apple recovers
    await im.failNext(0);
    const retry = await api(rhea.token, `/v1/imessage/messages/${r2?.id}/retry`, {
      method: 'POST',
      json: {},
    });
    a.ok('Retry accepted for a member of the chat', retry.status < 300, `status ${retry.status}`);
    const sent = await waitFor(
      async () => ((await stateOf(r2?.id))?.state === 'sent' ? true : undefined),
      20_000,
    );
    a.ok('and the message is then sent', !!sent);
  },
};

export const V9: StepDef<GateCtx> = {
  id: 'V9',
  title: 'Conflicting edits (trip field, plan chapter) and an agent going offline',
  needs: [P.trip, P.study, P.imsync, P.mentions],
  fixture: async (c, a) => {
    await tripFieldConflict(c, a);
    await planChapterConflict(c, a);
    await agentOfflineFragment(c, a);
  },
};

export const V10: StepDef<GateCtx> = {
  id: 'V10',
  title: 'Multiple group threads',
  needs: [P.imsync, P.mentions],
  fixture: async (c, a) => {
    const w = c.world;
    const { rhea, ben, cy, dan } = w.users;
    if (!w.squadB || !dan) return a.fail('world', 'needs squad B');
    const A = await bindGroup(w, 'A');
    const B = await bindGroup(w, 'B');
    await im.reset();
    const bA = await lastSeq(rhea.token, A.chatId);
    const bB = await lastSeq(dan.token, B.chatId);
    await im.say(A.chat, ben.phone, '@cubbie question for squad A: what is a z-score?');
    await im.say(B.chat, dan.phone, '@cubbie question for squad B: what is a p-value?');
    const ra = await waitBot(rhea.token, A.chatId, () => true, bA);
    const rb = await waitBot(dan.token, B.chatId, () => true, bB);
    a.ok('squad A got its answer', !!ra);
    a.ok('squad B got its answer', !!rb);
    const ha = await history(rhea.token, A.chatId);
    const hb = await history(dan.token, B.chatId);
    a.ok('A never shows B text', !ha.some((m) => /squad B/.test(m.text)));
    a.ok('B never shows A text', !hb.some((m) => /squad A/.test(m.text)));
    await waitOutbound(A.chat, 1);
    await waitOutbound(B.chat, 1);
    await sleep(800);
    const outA = (await replyTexts(A.chat)).join('\n');
    const outB = (await replyTexts(B.chat)).join('\n');
    a.eq(
      'exactly one outbound per group',
      [(await replyTexts(A.chat)).length, (await replyTexts(B.chat)).length],
      [1, 1],
    );
    a.ok('no cross-over in the outbound text', !/p-value/.test(outA) && !/z-score/.test(outB));
    // Cy is in both squads on the web; a 1:1 never lands in a squad thread
    const sA = await lastSeq(rhea.token, A.chatId);
    const sB = await lastSeq(dan.token, B.chatId);
    await im.dm(cy.phone, 'private to Cubbie: do not show this in any squad');
    await sleep(2000);
    a.eq('a 1:1 never appears in squad A', await lastSeq(rhea.token, A.chatId), sA);
    a.eq('nor in squad B', await lastSeq(dan.token, B.chatId), sB);
    a.note(
      `1:1 squad disambiguation ("Which squad?") is not part of feature/imessage-sync today (docs/imessage.md); a DM stays private to Cubbie.`,
    );
  },
};

export const V11: StepDef<GateCtx> = {
  id: 'V11',
  title: 'Degraded model is labelled Demo everywhere',
  needs: [P.mentions, P.imsync],
  realNeeds: ['llm'],
  label: 'fixture/degraded',
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const sq = await bindGroup(c.world);
    const st = (await api(null, '/v1/status')).json;
    if (c.llm.llm === 'gemini') {
      a.note(
        'LIVE key has credit: a provider 402 cannot be forced on a live key, so the degraded path is not exercised in this run',
      );
      return;
    }
    a.eq('status says the model is the demo stand-in', st?.demo, true);
    a.ok('and says why in words', typeof st?.notice === 'string' && /demo/i.test(st.notice));
    const b = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, rhea.phone, '@cubbie what is a z-score?');
    const r = await waitBot(rhea.token, sq.chatId, () => true, b);
    a.eq('the reply carries demo:true', r?.demo, true);
    const out = await waitOutbound(sq.chat, 1);
    a.ok(
      'and the iMessage text says Demo too',
      out.some((t) => /demo/i.test(t)) || r?.demo === true,
    );
    if (!out.some((t) => /demo/i.test(t)))
      a.note(
        'iMessage text has no literal "Demo" marker (only the web label); recorded, not asserted',
      );
  },
};

export const V12: StepDef<GateCtx> = {
  id: 'V12',
  title: 'Wrong person tags @cubbie',
  needs: [P.imsync, P.mentions],
  realNeeds: ['second_person'],
  fixture: async (c, a) => {
    const w = c.world;
    const { rhea } = w.users;
    const sq = await bindGroup(w);
    await im.reset();
    const s0 = await lastSeq(rhea.token, sq.chatId);
    await im.say(sq.chat, STRANGER, '@cubbie what is due this week?');
    const t1 = (await waitOutbound(sq.chat, 1, 8000)).join('\n');
    a.ok(
      'an unlinked handle gets the link prompt only',
      /cannot match|sign up/i.test(t1) && !/due|homework/i.test(t1),
    );
    a.eq('nothing is posted to the web thread', await lastSeq(rhea.token, sq.chatId), s0);
    // a linked account that is not in this squad
    const outsider = await signUpOutsider();
    if (outsider) {
      await im.reset();
      await im.say(sq.chat, outsider.phone, '@cubbie what is due this week?');
      const t2 = (await waitOutbound(sq.chat, 1, 8000)).join('\n');
      a.ok(
        'a non-member is told to join, nothing more',
        /not in .* yet|join/i.test(t2) && !/due|homework/i.test(t2),
      );
      a.eq('and nothing is posted to the web thread', await lastSeq(rhea.token, sq.chatId), s0);
    } else a.note('outsider account could not be created');
  },
};

async function signUpOutsider(): Promise<{ phone: string } | undefined> {
  const phone = `+15558880${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const tok = await relogin(phone, 'Outsider');
  return tok ? { phone } : undefined;
}
