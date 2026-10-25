import { actor, api, apiLogin, expect, shot, test, blocked } from '../lib/helpers';
import { GROUP, say } from '../lib/chat';
import { openChatPastGate } from '../lib/sendblue-fixture';
import { HUB } from '../lib/env';
import { startFakeSendblue, type FakeSendblue } from '../../apps/hub/src/imessage/sendblue/fake-sendblue';
import {
  SB_ANA,
  SB_API_SECRET_FOR_FAKE,
  SB_FAKE_PORT,
  SB_GROUP,
  SB_KEY,
  SB_WEBHOOK_SECRET,
} from '../lib/sendblue-fixture';

// J34: Sendblue iMessage transport in FIXTURE mode. The hub runs IMESSAGE_PROVIDER=sendblue (stack started with
// E2E_SENDBLUE=1) against a fake Sendblue server on its own port: no real network, no real message.
// Shows: header states, delivery badge queued -> sent -> delivered -> read and failed + retry, an inbound webhook
// message in the SAME web thread with "via iMessage (Sendblue)", and the unconfigured state with the env names.
const J = 'j34-sendblue';
const NAMES = ['SENDBLUE_API_KEY', 'SENDBLUE_API_SECRET', 'SENDBLUE_FROM_NUMBER', 'SENDBLUE_WEBHOOK_SECRET'];
test.describe.configure({ mode: 'serial' });

let fake: FakeSendblue;
test.beforeAll(async () => {
  const st = await (await fetch(`${HUB}/health`)).ok;
  if (!st) blocked('no hub');
  fake = await startFakeSendblue({
    apiKey: SB_KEY,
    apiSecret: SB_API_SECRET_FOR_FAKE,
    webhookSecret: SB_WEBHOOK_SECRET,
    port: SB_FAKE_PORT,
    post: (path, init) => fetch(`${HUB}${path}`, init),
  });
});
test.afterAll(async () => {
  await fake?.close();
});

const bubble = (page: import('@playwright/test').Page, text: string) =>
  page.locator('[data-testid="chat-message"]', { hasText: text });

test('J34 sendblue is wired in this stack (fixture): else blocked, never faked', async () => {
  const tok = await apiLogin('s_ana');
  const r = await api(tok, '/v1/imessage/status');
  const j = (await r.json()) as { provider?: string };
  if (j.provider !== 'sendblue') blocked('stack not started with E2E_SENDBLUE=1 (IMESSAGE_PROVIDER=sendblue)');
});

test('J34 header: unconfigured, not-yet-bound, degraded, dry-run and fixture states', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await openChatPastGate(ana, GROUP);
  const ind = ana.page.getByTestId('chat-imessage-indicator').first();
  // real hub: Sendblue is configured with fixtures and no group is bound yet
  await expect(ind).toContainText(/Sendblue: connected to no group yet, last inbound never, last status never, 0 queued/, { timeout: 20_000 });
  await shot(ana.page, J, 'header-connected-unbound');
  const bridge = (state: string, label: string, extra: object = {}) => ({
    enabled: true,
    provider: 'sendblue',
    mode: 'live',
    transport: 'ok',
    queued: 0,
    bridge: { provider: 'sendblue', state, label, queued: 0, ...extra },
  });
  const cases: [string, object, RegExp, string][] = [
    [
      'not_configured',
      { enabled: false, provider: 'sendblue', bridge: { provider: 'sendblue', state: 'not_configured', label: `Sendblue: not configured (set ${NAMES.join(', ')})`, missingEnv: NAMES } },
      /Sendblue: not configured \(set SENDBLUE_API_KEY, SENDBLUE_API_SECRET, SENDBLUE_FROM_NUMBER, SENDBLUE_WEBHOOK_SECRET\)/,
      'not_connected',
    ],
    ['degraded', bridge('degraded', 'degraded: 3 sends in a row failed'), /degraded: 3 sends in a row failed/, 'degraded'],
    ['dry_run', bridge('dry_run', 'Dry run, not sent'), /Dry run, not sent/, 'dry_run'],
    ['fixture', bridge('fixture', 'Fixture transport (no real iMessage)'), /Fixture transport \(no real iMessage\)/, 'fixture'],
    [
      'connected',
      bridge('connected', 'Sendblue: connected to Squad, last inbound 2m ago, last status 1m ago, 1 queued'),
      /Sendblue: connected to Squad, last inbound 2m ago, last status 1m ago, 1 queued/,
      'connected',
    ],
  ];
  for (const [name, body, text, state] of cases) {
    await ana.page.route('**/v1/imessage/status', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
    );
    await ana.page.reload();
    const i = ana.page.getByTestId('chat-imessage-indicator').first();
    await expect(i, name).toContainText(text, { timeout: 20_000 });
    await expect(i).toHaveAttribute('data-state', state);
    await shot(ana.page, J, `header-${name}`);
    await ana.page.unroute('**/v1/imessage/status');
  }
  // the unconfigured Connections card names every missing env var and the webhook URL
  await ana.page.route('**/v1/imessage/setup', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'sendblue', missingEnv: NAMES, webhookUrl: `${HUB}/v1/webhooks/sendblue`, statusUrl: `${HUB}/v1/webhooks/sendblue/status`, secretHeader: 'sb-signing-secret' }),
    }),
  );
  await ana.page.goto('/squad/connections#imessage');
  const missing = ana.page.getByTestId('connections-sendblue-missing');
  await expect(missing).toBeVisible({ timeout: 20_000 });
  for (const n of NAMES) await expect(missing).toContainText(n);
  await expect(ana.page.getByTestId('connections-sendblue-webhook')).toContainText('/v1/webhooks/sendblue');
  await expect(ana.page.getByTestId('connections-sendblue-tunnel')).toBeVisible();
  await shot(ana.page, J, 'connections-unconfigured');
  await ana.ctx.close();
});

test('J34 link the number, bind the Sendblue group, and an inbound @cubbie lands in the same web thread', async ({ browser }) => {
  const tok = await apiLogin('s_ana');
  // a real account whose sign-up phone is the phone that texts the Sendblue line (the hash recognises it)
  const post = (path: string, json: unknown, token?: string) =>
    api(token ?? null, path, { method: 'POST', json });
  const started = (await (await post('/v1/auth/start', { name: 'Fran', phone: SB_ANA })).json()) as { challengeId: string; devCode?: string };
  if (!started.devCode) blocked('hub is not in dev-login mode: cannot create the fixture account');
  const verified = (await (await post('/v1/auth/verify', { challengeId: started.challengeId, code: started.devCode })).json()) as { token: string };
  const inv = await post('/v1/squads/sq_demo/invites', { maxUses: null }, tok);
  expect(inv.status, 'the squad owner can create an invite').toBeLessThan(300);
  const inviteCode = ((await inv.json()) as { invite: { code: string } }).invite.code;
  const joined = await post('/v1/invites/join', { code: inviteCode }, verified.token);
  expect(joined.status).toBeLessThan(300);
  await fake.inbound({ from: SB_ANA, content: `join ${inviteCode}`, groupId: SB_GROUP });
  await expect
    .poll(() => fake.sent.some((s) => s.endpoint === 'send-group-message' && /linked to/i.test(String(s.body.content))), { timeout: 20_000 })
    .toBe(true);

  const ana = await actor(browser, 's_ana');
  await openChatPastGate(ana, GROUP);
  await fake.inbound({ from: SB_ANA, content: 'hello from my phone e2e-inbound', groupId: SB_GROUP });
  const m = bubble(ana.page, 'e2e-inbound');
  await expect(m).toBeVisible({ timeout: 25_000 });
  await expect(m.getByTestId('chat-source-label')).toHaveText('via iMessage (Sendblue)');
  // the header now names the bound squad, with last inbound
  await ana.page.reload();
  await expect(ana.page.getByTestId('chat-imessage-indicator').first()).toContainText(/Sendblue: connected to .+, last inbound .+, last status .+, \d+ queued/, { timeout: 25_000 });
  await shot(ana.page, J, 'inbound-same-thread');
  // @cubbie from the phone: the answer shows in the same web thread and is mirrored out through Sendblue
  const before = fake.sent.filter((s) => s.endpoint === 'send-group-message').length;
  await fake.inbound({ from: SB_ANA, content: '@cubbie what is a z-score? e2e-ask', groupId: SB_GROUP });
  await expect(bubble(ana.page, 'e2e-ask')).toBeVisible({ timeout: 25_000 });
  await expect
    .poll(() => fake.sent.filter((s) => s.endpoint === 'send-group-message').length, { timeout: 60_000 })
    .toBeGreaterThan(before);
  await expect(ana.page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').last()).toBeVisible({ timeout: 60_000 });
  await shot(ana.page, J, 'answer-same-thread');
  await ana.ctx.close();
});

test('J34 delivery badge: queued -> sent -> delivered -> read, and failed + retry', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await openChatPastGate(ana, GROUP);
  const sent = () => fake.sent.filter((s) => s.endpoint === 'send-group-message');
  // a web message that mentions an agent is mirrored to the bound Sendblue group
  const n0 = sent().length;
  await say(ana.page, '@cubbie e2e-delivery what is a p-value?');
  const msg = bubble(ana.page, 'e2e-delivery').first();
  await expect(msg).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sent().length, { timeout: 30_000 }).toBeGreaterThan(n0);
  const rec = sent().find((s) => String(s.body.content).includes('e2e-delivery'))!;
  const badge = msg.locator('.sqs__state');
  await expect(badge).toHaveAttribute('data-state', /queued|sent/, { timeout: 15_000 });
  await expect(badge).toHaveAttribute('data-state', 'sent', { timeout: 15_000 });
  await shot(ana.page, J, 'badge-sent');
  await fake.status({ handle: rec.handle, status: 'DELIVERED', groupId: SB_GROUP });
  await expect(badge).toHaveAttribute('data-state', 'delivered', { timeout: 15_000 });
  await expect(badge).toHaveText('Delivered');
  await shot(ana.page, J, 'badge-delivered');
  await fake.status({ handle: rec.handle, status: 'READ', groupId: SB_GROUP });
  await expect(badge).toHaveAttribute('data-state', 'read', { timeout: 15_000 });
  await expect(badge).toHaveText('Read');
  await shot(ana.page, J, 'badge-read');
  // out of order: a late SENT never moves it back
  await fake.status({ handle: rec.handle, status: 'SENT', groupId: SB_GROUP });
  await expect(badge).toHaveAttribute('data-state', 'read');

  // failure, then retry
  const n1 = sent().length;
  await say(ana.page, '@cubbie e2e-failure what is variance?');
  const msg2 = bubble(ana.page, 'e2e-failure').first();
  await expect.poll(() => sent().length, { timeout: 30_000 }).toBeGreaterThan(n1);
  const rec2 = sent().find((s) => String(s.body.content).includes('e2e-failure'))!;
  await fake.status({ handle: rec2.handle, status: 'ERROR', errorCode: 4001, groupId: SB_GROUP });
  const badge2 = msg2.locator('.sqs__state');
  await expect(badge2).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
  await expect(badge2).toContainText('Sendblue rate limit exceeded (4001)');
  await shot(ana.page, J, 'badge-failed');
  const n2 = sent().length;
  await badge2.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => sent().length, { timeout: 30_000 }).toBeGreaterThan(n2);
  await expect(badge2).toHaveAttribute('data-state', 'sent', { timeout: 20_000 });
  await shot(ana.page, J, 'badge-retried');
  await ana.ctx.close();
});

test('J34 a forged webhook is refused and nothing appears; secrets are not in anything the browser got', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await openChatPastGate(ana, GROUP);
  const r = await fake.inbound({ from: SB_ANA, content: 'forged e2e-forged', groupId: SB_GROUP, secret: 'not-the-secret' });
  expect(r.status).toBe(401);
  await ana.page.waitForTimeout(1500);
  await expect(bubble(ana.page, 'e2e-forged')).toHaveCount(0);
  const blob = [...ana.bodies, ...ana.assets].join('\n');
  for (const s of ['e2e-sendblue-secret', SB_WEBHOOK_SECRET, SB_KEY]) expect(blob).not.toContain(s);
  const tok = await apiLogin('s_ana');
  const health = await (await api(tok, '/v1/connections/health')).text();
  expect(health).toContain('sendblue_outbound');
  for (const s of ['e2e-sendblue-secret', SB_WEBHOOK_SECRET]) expect(health).not.toContain(s);
  await ana.ctx.close();
});
