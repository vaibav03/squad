import { describe, expect, it } from 'vitest';
import { configProblem, imessageConfigFromEnv, type IMessageConfig } from './config';
import { FakeIMessageTransport } from './fake';
import { createIMessageGateway, type GatewayInbound } from './gateway';

const GROUP = 'iMessage;+;chat123';
const ME = '+15550000001';
const FRIEND = '+15550000002';

const cfg = (o: Partial<IMessageConfig> = {}): IMessageConfig => ({
  enabled: true,
  dryRun: false,
  allowedChats: [GROUP],
  allowedHandles: [ME],
  allowAll: false,
  ratePerMin: 5,
  ignoreHandles: [],
  ...o,
});

async function setup(o: Partial<IMessageConfig> = {}, now = { t: 1_000_000 }) {
  const sdk = new FakeIMessageTransport();
  const gw = createIMessageGateway({
    config: cfg(o),
    sdk,
    now: () => now.t,
    minGapMs: 0,
    sleep: async () => {},
  });
  const got: GatewayInbound[] = [];
  await gw.start((m) => void got.push(m));
  return { sdk, gw, got, now };
}

describe('config', () => {
  it('is OFF by default', () => {
    const c = imessageConfigFromEnv({});
    expect(c.enabled).toBe(false);
    expect(c.dryRun).toBe(false);
    expect(configProblem(c)).toMatch(/kill switch/);
  });
  it('enabled without an allowlist refuses to start (fail closed)', () => {
    const c = imessageConfigFromEnv({ IMESSAGE_ENABLED: '1' });
    expect(configProblem(c)).toMatch(/IMESSAGE_ALLOWED_CHATS/);
    expect(configProblem({ ...c, allowAll: true })).toBeUndefined();
  });
  it('parses lists and flags', () => {
    const c = imessageConfigFromEnv({
      IMESSAGE_ENABLED: '1',
      IMESSAGE_DRY_RUN: '1',
      IMESSAGE_ALLOWED_CHATS: 'a;+;1, b;+;2',
      IMESSAGE_ALLOWED_HANDLES: '+15551112222,me@icloud.com',
      IMESSAGE_RATE_PER_MIN: '3',
    });
    expect(c).toMatchObject({
      enabled: true,
      dryRun: true,
      allowedChats: ['a;+;1', 'b;+;2'],
      allowedHandles: ['+15551112222', 'me@icloud.com'],
      ratePerMin: 3,
    });
    expect(configProblem(c)).toBeUndefined();
  });
});

describe('kill switch', () => {
  it('IMESSAGE_ENABLED off: nothing is watched and nothing is sent', async () => {
    const { sdk, gw, got } = await setup({ enabled: false });
    expect(sdk.watching).toBe(false);
    await sdk.group(GROUP, ME, 'hello').catch(() => undefined);
    expect(got).toHaveLength(0);
    expect(await gw.send(GROUP, 'hi')).toBe('disabled');
    expect(sdk.sent).toHaveLength(0);
  });
});

describe('allowlist', () => {
  it('only allowed chats and handles are read', async () => {
    const { sdk, got, gw } = await setup();
    await sdk.group(GROUP, FRIEND, 'in my group'); // any sender inside an allowed chat
    await sdk.group('iMessage;+;other', ME, 'someone else chat');
    await sdk.dm(ME, 'dm from me');
    await sdk.dm(FRIEND, 'dm from a stranger');
    expect(got.map((m) => m.text)).toEqual(['in my group', 'dm from me']);
    expect(gw.drops.chat_not_allowed).toBe(1);
    expect(gw.drops.handle_not_allowed).toBe(1);
  });
  it('only allowed chats and handles are written to', async () => {
    const { sdk, gw } = await setup();
    expect(await gw.send(GROUP, 'ok')).toBe('sent');
    expect(await gw.send(ME, 'ok')).toBe('sent');
    expect(await gw.send('iMessage;+;other', 'no')).toBe('chat_not_allowed');
    expect(await gw.send(FRIEND, 'no')).toBe('handle_not_allowed');
    expect(await gw.send('stranger@icloud.com', 'no')).toBe('handle_not_allowed');
    expect(sdk.sent.map((s) => s.to)).toEqual([GROUP, ME]);
  });
  it('a handle matches in any phone format', async () => {
    const { gw, sdk } = await setup({ allowedHandles: ['+1 (555) 000-0001'] });
    expect(await gw.send('+15550000001', 'x')).toBe('sent');
    expect(sdk.sent).toHaveLength(1);
  });
  it('empty lists allow nothing, allowAll allows everything', async () => {
    const a = await setup({ allowedChats: [], allowedHandles: [] });
    expect(await a.gw.send(GROUP, 'x')).toBe('chat_not_allowed');
    const b = await setup({ allowedChats: [], allowedHandles: [], allowAll: true });
    expect(await b.gw.send(GROUP, 'x')).toBe('sent');
  });
});

describe('dry run', () => {
  it('logs what would be sent and never sends', async () => {
    const { sdk, gw } = await setup({ dryRun: true });
    expect(await gw.send(GROUP, 'would go out')).toBe('dry_run');
    expect(sdk.sent).toHaveLength(0);
    expect(gw.outbox).toMatchObject([
      { to: GROUP, kind: 'group', text: 'would go out', dryRun: true },
    ]);
  });
  it('still reads inbound so the flow can be rehearsed', async () => {
    const { sdk, got } = await setup({ dryRun: true });
    await sdk.dm(ME, 'hello');
    expect(got).toHaveLength(1);
  });
});

describe('dedupe and loop protection', () => {
  it('drops a repeated message guid', async () => {
    const { sdk, got, gw } = await setup();
    await sdk.group(GROUP, ME, 'once', { id: 'G1' });
    await sdk.group(GROUP, ME, 'once', { id: 'G1' });
    expect(got).toHaveLength(1);
    expect(gw.drops.duplicate).toBe(1);
  });
  it('ignores its own messages, reactions and non-text', async () => {
    const { sdk, got } = await setup();
    await sdk.group(GROUP, ME, 'mine', { fromMe: true });
    await sdk.group(GROUP, ME, 'liked', { reaction: { kind: 'like' } });
    await sdk.group(GROUP, ME, 'x', { kind: 'sticker' });
    expect(got).toHaveLength(0);
  });
  it('ignores a message that carries our own persona prefix (another bot or an echo)', async () => {
    const { sdk, got, gw } = await setup();
    await sdk.group(GROUP, FRIEND, '\u{1F43B} Nook: hello there');
    await sdk.group(GROUP, FRIEND, '\u{1F916} HelperBot: beep');
    expect(got).toHaveLength(0);
    expect(gw.drops.bot_prefix).toBe(2);
  });
  it('drops the echo of what we just sent, from any sender, for a minute only', async () => {
    const { sdk, got, gw, now } = await setup();
    await gw.send(GROUP, 'Same words');
    await sdk.group(GROUP, FRIEND, 'Same words');
    expect(got).toHaveLength(0);
    now.t += 61_000;
    await sdk.group(GROUP, FRIEND, 'Same words');
    expect(got).toHaveLength(1);
  });
  it('ignores handles on IMESSAGE_IGNORE_HANDLES', async () => {
    const { sdk, got } = await setup({ ignoreHandles: [FRIEND] });
    await sdk.group(GROUP, FRIEND, 'hi');
    expect(got).toHaveLength(0);
  });
  it('mutes a sender that floods (a bot ping-pong), then forgives', async () => {
    const { sdk, got, now } = await setup();
    for (let i = 0; i < 15; i++) await sdk.group(GROUP, FRIEND, `spam ${i}`);
    expect(got.length).toBe(8);
    now.t += 6 * 60_000;
    await sdk.group(GROUP, FRIEND, 'back');
    expect(got.at(-1)?.text).toBe('back');
  });
});

describe('outbound rate limit and splitting', () => {
  it('limits outbound per chat per minute and recovers', async () => {
    const { sdk, gw, now } = await setup({ ratePerMin: 3 });
    const out: string[] = [];
    for (let i = 0; i < 5; i++) out.push(await gw.send(GROUP, `m${i}`));
    expect(out).toEqual(['sent', 'sent', 'sent', 'rate_limited', 'rate_limited']);
    expect(sdk.sent).toHaveLength(3);
    expect(await gw.send(ME, 'other chat is independent')).toBe('sent');
    now.t += 61_000;
    expect(await gw.send(GROUP, 'again')).toBe('sent');
  });
  it('splits long text into iMessage-sized parts, in order', async () => {
    const { sdk, gw } = await setup({ ratePerMin: 50 });
    const text = Array.from({ length: 80 }, (_, i) => `Sentence ${i} goes here.`).join(' ');
    expect(await gw.send(GROUP, text)).toBe('sent');
    expect(sdk.sent.length).toBeGreaterThan(1);
    for (const s of sdk.sent) expect(s.text!.length).toBeLessThanOrEqual(900);
    expect(sdk.sent.map((s) => s.text).join(' ')).toBe(text);
  });
  it('retries once, then reports failure without throwing', async () => {
    const { sdk, gw } = await setup();
    sdk.failSends = 1;
    expect(await gw.send(GROUP, 'retry me')).toBe('sent');
    sdk.failSends = 2;
    expect(await gw.send(GROUP, 'hopeless')).toBe('failed');
  });
});

describe('guarded sdk for the standalone transport', () => {
  it('applies the allowlist and dry run to raw sends', async () => {
    const { sdk, gw } = await setup({ dryRun: true });
    const g = gw.guardedSdk();
    await g.send({ to: GROUP, text: 'x' });
    expect(sdk.sent).toHaveLength(0);
    expect(gw.outbox).toHaveLength(1);
  });
  it('raw sends to a chat that is not allowed are dropped silently', async () => {
    const { sdk, gw } = await setup();
    await gw.guardedSdk().send({ to: 'iMessage;+;nope', text: 'x' });
    expect(sdk.sent).toHaveLength(0);
  });
});
