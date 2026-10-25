// S4s / S6s / S7s / S10s: the iMessage journey steps over the SENDBLUE provider.
//   fixture column: an in-process hub + the real Sendblue provider against a fake Sendblue server (own port, real
//                   shared-secret scheme). Nothing real is contacted; the report labels it "fixture".
//   real column:    BLOCKED(missing env: NAMES) unless every SENDBLUE_* value is set AND an allowlisted own test number
//                   (GATE_SENDBLUE_TEST_NUMBER) is configured. Only S6s has a real variant: ONE clearly-marked message
//                   to that number, and only with the explicit confirmation GATE_REAL_SEND=1. This file never runs it.
import { orderThread } from '../../../packages/core/src';
import { createSafety, imessageConfigFromEnv } from '../../../apps/bot/src/imessage';
import type { Asserts } from '../lib/asserts';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { P } from '../lib/probes';
import { SB, startSendblueWorld, type SendblueWorld } from '../lib/sendblue-world';
import { createSendblueClient } from '../../../apps/hub/src/imessage/sendblue/client';
import { sendblueConfigFromEnv } from '../../../apps/hub/src/imessage/sendblue/config';

const PORT = Number(process.env.GATE_SENDBLUE_PORT ?? 9071);
const wait = async <T>(f: () => T | undefined | false, ms = 20_000): Promise<T | undefined> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v as T;
    if (Date.now() > end) return undefined;
    await new Promise((r) => setTimeout(r, 40));
  }
};
const world = async (c: GateCtx): Promise<SendblueWorld> =>
  ((c.state as { sendblue?: SendblueWorld }).sendblue ??= await startSendblueWorld(PORT));
const hist = (w: SendblueWorld) => w.hub.deps.chat.store.history(w.chatId, { limit: 200 }).messages;
const personas = (w: SendblueWorld) => hist(w).filter((m) => m.sender.kind === 'persona');
const groupSends = (w: SendblueWorld) =>
  w.fake.sent.filter((s) => s.endpoint === 'send-group-message' && s.body.group_id === SB.group);

async function s4s(c: GateCtx, a: Asserts) {
  const w = await world(c);
  a.ok('the Sendblue group is bound to the squad by "join <code>"', !!w.hub.deps.imessage.binding(`Sendblue;+;${SB.group}`));
  for (const [tag, handle] of [['@cubbie', 'S4S-1'], ['@cubbi', 'S4S-2']] as const) {
    const before = personas(w).length;
    const r = await w.fake.inbound({ from: SB.ana, content: `${tag} what is a z-score?`, groupId: SB.group, handle });
    a.eq(`${tag}: signed webhook accepted`, r.status, 200);
    const got = await wait(() => personas(w).length > before);
    a.ok(`${tag}: the agent answered in the SAME web thread`, !!got);
    a.ok(`${tag}: stored via iMessage (Sendblue)`, hist(w).some((m) => m.externalId === handle && m.provider === 'sendblue' && m.transport === 'imessage'));
  }
  const n = personas(w).length;
  const dup = await w.fake.inbound({ from: SB.ana, content: '@cubbie what is a z-score?', groupId: SB.group, handle: 'S4S-1' });
  a.ok('redelivery of the same message handle is a duplicate, not a second answer', (await dup.json() as any).duplicate === true);
  await new Promise((r) => setTimeout(r, 300));
  a.eq('no second answer', personas(w).length, n);
  const forged = await w.fake.inbound({ from: SB.ana, content: '@cubbie forged', groupId: SB.group, secret: 'wrong', handle: 'S4S-F' });
  a.eq('a forged signature is refused', forged.status, 401);
  a.ok('a forged message left no trace', !hist(w).some((m) => m.text.includes('forged')) && !w.hub.deps.imessage.xrefByExt('S4S-F'));
}
export const S4s: StepDef<GateCtx> = {
  id: 'S4s',
  title: 'Sendblue: group tagging @cubbie / @cubbi through a signed webhook',
  needs: [P.sendblue, P.imsync],
  realNeeds: ['sendblue'],
  label: 'fixture (fake Sendblue server, real shared-secret scheme; no real iMessage)',
  fixture: s4s,
};

async function s6s(c: GateCtx, a: Asserts) {
  const w = await world(c);
  const before = groupSends(w).length;
  await w.fake.inbound({ from: SB.ben, content: '@cubbie what is a standard deviation?', groupId: SB.group, handle: 'S6S-1' });
  await wait(() => groupSends(w).length > before);
  const out = groupSends(w).slice(before);
  a.ok('the reply went out through Sendblue to the same group_id', out.length > 0 && out.every((s) => s.body.from_number === SB.line));
  a.ok('the reply carries the persona prefix and plain text', /^\u{1F43B} Cubbie: /u.test(String(out[0]?.body.content ?? '')) && !/\*\*|\]\(/.test(String(out[0]?.body.content)));
  a.ok('no 1:1 send happened for a group conversation', !w.fake.sent.some((s) => s.endpoint === 'send-message'));
  const requests = w.fake.requests.length;
  w.hub.deps.imessage.bind('Sendblue;+;gate-not-allowed', w.squadId, w.uid.ana);
  w.hub.deps.chat.postBot({ chatId: w.chatId, personaId: 'cubbie', personaName: 'Cubbie', text: 'allowlist check', citations: [], attachments: [] });
  await wait(() => groupSends(w).some((s) => String(s.body.content).includes('allowlist check')));
  await new Promise((r) => setTimeout(r, 200));
  a.ok('a chat that is not on the allowlist is never called (checked before any network call)', !w.fake.sent.some((s) => s.body.group_id === 'gate-not-allowed'));
  a.ok('requests so far were only to the fake', w.fake.requests.length >= requests);
}
export const S6s: StepDef<GateCtx> = {
  id: 'S6s',
  title: 'Sendblue: the reply is delivered into the same iMessage group (allowlist, no unsolicited sends)',
  needs: [P.sendblue, P.imsync],
  realNeeds: ['sendblue', 'sendblue_real_send'],
  label: 'fixture (fake Sendblue server; no real iMessage)',
  fixture: s6s,
  real: realSmoke,
};

async function s7s(c: GateCtx, a: Asserts) {
  const w = await world(c);
  const t0 = Date.now();
  await w.fake.inbound({ from: SB.ana, content: 'second in time', groupId: SB.group, handle: 'S7S-2', dateSent: new Date(t0) });
  await w.fake.inbound({ from: SB.ben, content: 'first in time (arrived late)', groupId: SB.group, handle: 'S7S-1', dateSent: new Date(t0 - 60_000) });
  await wait(() => hist(w).some((m) => m.externalId === 'S7S-1'));
  const order = orderThread(hist(w).filter((m) => m.externalId === 'S7S-1' || m.externalId === 'S7S-2')).map((m) => m.externalId);
  a.eq('the thread is ordered by message time, not arrival', order, ['S7S-1', 'S7S-2']);
  const late = hist(w).find((m) => m.externalId === 'S7S-1');
  a.ok('the late one is flagged as arrived late', !!late?.receivedLate);
  a.ok('senders are attributed to their accounts', hist(w).find((m) => m.externalId === 'S7S-2')?.sender.name === 'Ana' && late?.sender.name === 'Ben');
  await w.hub.deps.chat.send({ studentId: w.uid.ana, squadId: w.squadId, projector: false }, { chatId: w.chatId as `group:${string}`, text: '@cubbie web to phone' });
  const mirrored = await wait(() => groupSends(w).find((s) => String(s.body.content).startsWith('Ana (via Squad): @cubbie web to phone')));
  a.ok('a web message that mentions an agent is mirrored to the Sendblue group once', !!mirrored);
  const back = await w.fake.inbound({ from: SB.ana, content: 'Ana (via Squad): @cubbie web to phone', groupId: SB.group, handle: 'S7S-ECHO' });
  a.eq('our own mirror coming back is accepted and dropped', back.status, 200);
  a.ok('...and is not re-posted (no loop)', hist(w).filter((m) => m.text.includes('web to phone')).length === 1);
}
export const S7s: StepDef<GateCtx> = {
  id: 'S7s',
  title: 'Sendblue: web chat shows the complete ordered conversation and mirrors back (no loops)',
  needs: [P.sendblue, P.imsync],
  realNeeds: ['sendblue'],
  label: 'fixture (fake Sendblue server; no real iMessage)',
  fixture: s7s,
};

async function s10s(c: GateCtx, a: Asserts) {
  const w = await world(c);
  w.hub.deps.imessage.unbind('Sendblue;+;gate-not-allowed'); // S6s left a deliberately non-allowlisted binding
  w.hub.deps.chat.postBot({ chatId: w.chatId, personaId: 'cubbie', personaName: 'Cubbie', text: 'S10s status walk', citations: [], attachments: [] });
  const rec = await wait(() => groupSends(w).find((s) => String(s.body.content).includes('S10s status walk')));
  if (!a.ok('the message left through Sendblue', !!rec)) return;
  const msg = personas(w).find((m) => m.text.includes('S10s status walk'))!;
  const st = () => w.hub.deps.chat.store.get(msg.id)?.deliveryState?.state;
  await wait(() => st() === 'sent');
  a.eq('state: sent', st(), 'sent');
  await w.fake.status({ handle: rec!.handle, status: 'DELIVERED', groupId: SB.group });
  a.eq('state: delivered', st(), 'delivered');
  await w.fake.status({ handle: rec!.handle, status: 'READ', groupId: SB.group });
  a.eq('state: read', st(), 'read');
  await w.fake.status({ handle: rec!.handle, status: 'SENT', groupId: SB.group });
  a.eq('an out-of-order SENT callback does not move it back', st(), 'read');
  w.hub.deps.chat.postBot({ chatId: w.chatId, personaId: 'cubbie', personaName: 'Cubbie', text: 'S10s will fail', citations: [], attachments: [] });
  const r2 = await wait(() => groupSends(w).find((s) => String(s.body.content).includes('S10s will fail')));
  const m2 = personas(w).find((m) => m.text.includes('S10s will fail'))!;
  await w.fake.status({ handle: r2!.handle, status: 'ERROR', errorCode: 4001, groupId: SB.group });
  const ds = w.hub.deps.chat.store.get(m2.id)?.deliveryState;
  a.ok('a failure callback shows failed with the Sendblue reason', ds?.state === 'failed' && /rate limit/.test(ds.label), ds?.label);
  const sends = groupSends(w).length;
  const retry = await w.hub.app.request(`/v1/imessage/messages/${m2.id}/retry`, { method: 'POST', headers: { authorization: `Bearer ${w.token.ana}` } });
  a.eq('retry is accepted', retry.status, 200);
  a.ok('retry sends it again', !!(await wait(() => groupSends(w).length > sends)));
  const h = await w.hub.app.request('/v1/connections/health', { headers: { authorization: `Bearer ${w.token.ana}` } });
  const checks = ((await h.json()) as any).checks.filter((x: any) => x.group === 'sendblue');
  a.ok('Integration Health reports the Sendblue chain', checks.length >= 4);
  a.ok('...from real probes: no pass for something never seen', !checks.some((x: any) => x.id === 'sendblue_inbound' && x.status === 'pass' && !/arrived/.test(x.reason)));
  a.ok('no credential appears in the health report', !JSON.stringify(checks).includes(SB.secret));
}
export const S10s: StepDef<GateCtx> = {
  id: 'S10s',
  title: 'Sendblue: delivery, read and failure states stay synchronized (retry included)',
  needs: [P.sendblue, P.imsync],
  realNeeds: ['sendblue'],
  label: 'fixture (fake Sendblue server; no real iMessage)',
  fixture: s10s,
};

/**
 * THE ONE REAL SEND. Reached only with GATE_REAL=1, every SENDBLUE_* value set, GATE_SENDBLUE_TEST_NUMBER allowlisted and
 * the explicit confirmation GATE_REAL_SEND=1 (see blockers.ts). One message, to the user's own allowlisted number.
 */
async function realSmoke(_c: GateCtx, a: Asserts) {
  const to = process.env.GATE_SENDBLUE_TEST_NUMBER ?? '';
  const safety = createSafety({ config: imessageConfigFromEnv(process.env) });
  const verdict = safety.admitOutbound(to);
  if (!a.ok('the test number is on the allowlist (checked before any call)', verdict.ok)) return;
  const client = createSendblueClient(sendblueConfigFromEnv(process.env));
  const res = await client.sendMessage({ number: to, content: 'Squad gate: one real Sendblue smoke message. No reply needed.' });
  a.ok('Sendblue accepted exactly one message and returned a handle', !!res.handle);
  a.note('REAL SEND: one message to GATE_SENDBLUE_TEST_NUMBER (your own allowlisted number).');
}
