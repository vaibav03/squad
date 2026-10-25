import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryCodeSender, type CodeMessage, type CodeSender } from '../../src/code-sender';
import { startHub, type RunningHub } from '../../src/server';
import { FIXTURE, SECRET } from '../helpers';

let live: RunningHub[] = [];
afterEach(async () => {
  await Promise.all(live.map((h) => h.stop()));
  live = [];
});

// Fixture numbers only (555 test range); never real.
const PHONE = '(415) 555-0134';
const OTHER = '(415) 555-0177';

async function boot(over: Record<string, unknown> = {}, codeSender?: CodeSender) {
  const replayDir = mkdtempSync(join(tmpdir(), 'phone-replays-'));
  cpSync(FIXTURE, join(replayDir, 'sample.json'));
  const clock = { t: 1_800_000_000_000 };
  const memory = createMemoryCodeSender();
  const hub = await startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: SECRET,
      authSecret: 'auth-test',
      sessionSecret: 'session-secret-for-tests-0123456789abcdef',
      contactPepper: 'pepper',
      seed: false,
      sim: false,
      production: false,
      devLogin: true,
      logLevel: 'silent',
      replayDir,
      corsOrigins: ['http://localhost:5180'],
      ...over,
    },
    now: () => clock.t,
    codeSender: codeSender ?? memory,
  });
  live.push(hub);
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(hub.url + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  // Signs up with an email (so the account has no phone) and returns its session token.
  const signUp = async (email: string, name = 'Ana') => {
    const s = await call('POST', '/v1/auth/start', { name, email });
    const v = await call('POST', '/v1/auth/verify', {
      challengeId: s.json.challengeId,
      code: s.json.devCode ?? memory.last()?.code,
    });
    return { token: v.json.token as string, id: v.json.user.id as string };
  };
  return { hub, clock, call, signUp, memory };
}

describe('phone linking', () => {
  it('start (dev code) then verify links the phone to the current account without swapping the session', async () => {
    const { call, signUp, hub } = await boot();
    const a = await signUp('ana@example.com');
    expect((await call('GET', '/v1/me', undefined, a.token)).json.phoneVerified).toBe(false);
    const s = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    expect(s.status).toBe(200);
    expect(s.json.delivery).toBe('dev');
    expect(s.json.deliveryLabel).toBe('Code shown here (dev)');
    expect(s.json.devCodeLabel).toMatch(/dev code/i);
    expect(s.json.to).toMatch(/0134$/);
    expect(JSON.stringify(s.json)).not.toContain('5550134');
    const v = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: s.json.challengeId, code: s.json.devCode },
      a.token,
    );
    expect(v.status).toBe(200);
    expect(v.json.verified).toBe(true);
    expect(v.json.token).toBeUndefined(); // no session minted
    const me = await call('GET', '/v1/me', undefined, a.token);
    expect(me.json.user.id).toBe(a.id);
    expect(me.json.phoneVerified).toBe(true);
    const links = await call('GET', '/v1/imessage/link', undefined, a.token);
    expect(links.json.links).toHaveLength(1);
    // the bridge's handle-hash lookup now resolves this handle to the account
    const hash = hub.deps.accounts.hashContact('phone', '+14155550134');
    expect(hub.deps.imessage.linkedUser(hash)).toBe(a.id);
  });

  it('rejects a wrong code, counts tries, and locks after 5', async () => {
    const { call, signUp } = await boot();
    const a = await signUp('ana@example.com');
    const s = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    const wrong = s.json.devCode === '000000' ? '111111' : '000000';
    const w = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: s.json.challengeId, code: wrong },
      a.token,
    );
    expect(w.status).toBe(400);
    expect(w.json.error.code).toBe('code_invalid');
    expect(w.json.error.triesLeft).toBe(4);
    for (let i = 0; i < 3; i++)
      await call(
        'POST',
        '/v1/me/phone/verify',
        { challengeId: s.json.challengeId, code: wrong },
        a.token,
      );
    const last = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: s.json.challengeId, code: wrong },
      a.token,
    );
    expect(last.status).toBe(429);
    const good = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: s.json.challengeId, code: s.json.devCode },
      a.token,
    );
    expect(good.status).toBe(429);
    expect((await call('GET', '/v1/me', undefined, a.token)).json.phoneVerified).toBe(false);
  });

  it('expires after 10 minutes', async () => {
    const { call, signUp, clock } = await boot();
    const a = await signUp('ana@example.com');
    const s = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    clock.t += 10 * 60 * 1000 + 1000;
    const v = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: s.json.challengeId, code: s.json.devCode },
      a.token,
    );
    expect(v.status).toBe(410);
    expect(v.json.error.code).toBe('code_expired');
  });

  it('normalises E.164, rejects junk, and rate limits restarts', async () => {
    const { call, signUp, clock } = await boot();
    const a = await signUp('ana@example.com');
    expect((await call('POST', '/v1/me/phone/start', { phone: '12' }, a.token)).status).toBe(400);
    expect((await call('POST', '/v1/me/phone/start', { phone: 'abc' }, a.token)).status).toBe(400);
    expect(
      (await call('POST', '/v1/me/phone/start', { phone: '+1 415 555 0134' }, a.token)).status,
    ).toBe(200);
    // resend cooldown
    const quick = await call('POST', '/v1/me/phone/start', { phone: '4155550134' }, a.token);
    expect(quick.status).toBe(429);
    expect(quick.json.error.retryAfterS).toBeGreaterThan(0);
    // hourly cap per account
    let limited = false;
    for (let i = 0; i < 6 && !limited; i++) {
      clock.t += 31_000;
      const r = await call('POST', '/v1/me/phone/start', { phone: '4155550134' }, a.token);
      limited = r.status === 429;
    }
    expect(limited).toBe(true);
  });

  it('never stores the raw number or the plain code', async () => {
    const { call, signUp, hub } = await boot();
    const a = await signUp('ana@example.com');
    const s = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: s.json.challengeId, code: s.json.devCode },
      a.token,
    );
    const dump = JSON.stringify([
      hub.deps.db.prepare('SELECT * FROM acct_phone_challenges').all(),
      hub.deps.db.prepare('SELECT * FROM imsg_links').all(),
    ]);
    expect(dump).not.toContain('5550134');
    expect(dump).not.toContain(s.json.devCode);
    expect(dump).toContain('0134'); // last-4 hint only
  });

  it('isolates accounts: a number linked elsewhere cannot be claimed, and a challenge is not usable by another account', async () => {
    const { call, signUp } = await boot();
    const a = await signUp('ana@example.com');
    const b = await signUp('ben@example.com', 'Ben');
    const sa = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    // B cannot verify A's challenge
    const steal = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: sa.json.challengeId, code: sa.json.devCode },
      b.token,
    );
    expect(steal.status).toBe(404);
    await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: sa.json.challengeId, code: sa.json.devCode },
      a.token,
    );
    // B cannot start for A's number
    const sb = await call('POST', '/v1/me/phone/start', { phone: PHONE }, b.token);
    expect(sb.status).toBe(409);
    expect((await call('GET', '/v1/me', undefined, b.token)).json.phoneVerified).toBe(false);
    expect((await call('GET', '/v1/imessage/link', undefined, b.token)).json.links).toHaveLength(0);
    // unauthenticated is refused
    expect((await call('POST', '/v1/me/phone/start', { phone: OTHER })).status).toBe(401);
  });

  it('without dev mode and without the bridge: honest "code delivery unavailable", no challenge', async () => {
    const { call, signUp, hub } = await boot({ devLogin: false });
    const a = await signUp('ana@example.com');
    const s = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    expect(s.status).toBe(200);
    expect(s.json.ok).toBe(false);
    expect(s.json.delivery).toBe('unavailable');
    expect(s.json.message).toMatch(/^code delivery unavailable: /);
    expect(s.json.challengeId).toBeUndefined();
    expect(hub.deps.db.prepare('SELECT * FROM acct_phone_challenges').all()).toHaveLength(0);
  });

  it('delivers by iMessage only when the handle is on the allowlist', async () => {
    const sent: CodeMessage[] = [];
    const sender: CodeSender = {
      name: 'imessage',
      async send() {},
      async sendStrict(m) {
        sent.push(m);
        return true;
      },
    };
    const { call, signUp } = await boot(
      {
        codeSender: 'imessage',
        imessageSendUrl: 'http://127.0.0.1:1/send',
        imessageAllowedHandles: ['+1 (415) 555-0134'],
        devLogin: true,
      },
      sender,
    );
    const a = await signUp('ana@example.com');
    const ok = await call('POST', '/v1/me/phone/start', { phone: PHONE }, a.token);
    expect(ok.json.delivery).toBe('imessage');
    expect(ok.json.deliveryLabel).toBe('Code sent by iMessage');
    expect(ok.json.devCode).toBeUndefined();
    expect(sent).toHaveLength(1);
    const v = await call(
      'POST',
      '/v1/me/phone/verify',
      { challengeId: ok.json.challengeId, code: sent[0]!.code },
      a.token,
    );
    expect(v.json.verified).toBe(true);
    // not allowlisted: nothing is sent; dev shows the code here instead
    const b = await signUp('ben@example.com', 'Ben');
    const off = await call('POST', '/v1/me/phone/start', { phone: OTHER }, b.token);
    expect(off.json.delivery).toBe('dev');
    expect(sent).toHaveLength(1);
  });
});
