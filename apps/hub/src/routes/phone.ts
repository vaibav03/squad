// Link a verified phone to the CURRENT account (docs/accounts-api.md "Phone linking"). Unlike /v1/auth/*, this never
// mints or swaps a session: it proves the signed-in person holds the number, then maps its handle hash (the same
// hash the iMessage bridge looks up) to this account. The raw number is never stored; the code is stored only hashed.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { maskContact, normalizePhone } from '@squad/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth';
import { createConsoleCodeSender } from '../code-sender';
import { clientIp, createLimiter, rateLimited, readBody } from '../http';
import { runMigrations } from '../store/migrate';
import type { HubApp, HubDeps, HubEnv } from '../types';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_TRIES = 5;
const HOUR = 3_600_000;

const StartBody = z.strictObject({ phone: z.string().trim().min(7).max(32) });
const VerifyBody = z.strictObject({
  challengeId: z.string().min(1).max(80),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
});

export type PhoneDelivery = 'dev' | 'imessage' | 'unavailable';

export function createPhoneRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const user = requireUser(deps);
  const limit = createLimiter(deps.now);
  const devCodes = (deps.config.devLogin && !deps.config.production) || !!deps.config.demoCode;
  const consoleSender = createConsoleCodeSender(deps.log);
  runMigrations(deps.db, 'phone', [
    {
      id: 1,
      name: 'phone link challenges',
      sql: `
CREATE TABLE IF NOT EXISTS acct_phone_challenges(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, phone_hash TEXT NOT NULL, hint TEXT NOT NULL,
  code_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  resend_after INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS acct_phone_challenges_hash ON acct_phone_challenges(phone_hash, created_at);
CREATE INDEX IF NOT EXISTS acct_phone_challenges_user ON acct_phone_challenges(user_id, created_at);`,
    },
  ]);
  const codeHash = (id: string, code: string) =>
    createHmac('sha256', deps.config.sessionSecret)
      .update(`phone-code:${id}:${code}`)
      .digest('hex');

  const digits = (v: string) => v.replace(/\D/g, '');
  /** Same rule the bot uses: matching ignores formatting. */
  const allowlisted = (normalized: string): boolean => {
    if (deps.config.imessageAllowAll) return true;
    return deps.config.imessageAllowedHandles.some(
      (h) => !h.includes('@') && digits(h).length >= 7 && digits(h) === digits(normalized),
    );
  };

  r.post('/v1/me/phone/start', user, async (c) => {
    const uid = c.get('user').id;
    const ip = limit(`phone-start-ip:${clientIp(c)}`, 20, HOUR);
    if (!ip.ok) return rateLimited(c, ip.retryAfterS);
    const me = limit(`phone-start:${uid}`, 5, HOUR);
    if (!me.ok) return rateLimited(c, me.retryAfterS);
    const b = await readBody(c, StartBody);
    if (!b.ok) return b.res;
    const raw = b.data.phone;
    // E.164 only: an explicit "+" country code, or a 10 digit / 11 digit 1xxx US number.
    const normalized = normalizePhone(raw);
    if (!normalized || digits(raw).length < 10)
      return c.json(
        {
          error: { code: 'invalid_request', message: 'Enter a valid phone number with area code.' },
        },
        400,
      );
    const hash = deps.accounts.hashContact('phone', normalized);
    const hint = maskContact('phone', normalized);
    const t = deps.now();

    // Another account already owns this number (signup contact or verified link): never reassign it.
    const owner =
      (
        deps.db.prepare('SELECT id FROM acct_users WHERE contact_hash=?').get(hash) as
          { id: string } | undefined
      )?.id ?? deps.imessage.linkedUser(hash);
    if (owner && owner !== uid)
      return c.json(
        { error: { code: 'phone_in_use', message: 'That number is linked to another account.' } },
        409,
      );
    if (owner === uid)
      return c.json({ ok: true, alreadyLinked: true, to: hint, delivery: 'none' as const });

    const recent = deps.db
      .prepare(
        'SELECT created_at FROM acct_phone_challenges WHERE phone_hash=? AND created_at>? ORDER BY created_at',
      )
      .all(hash, t - HOUR) as { created_at: number }[];
    if (recent.length >= 5)
      return rateLimited(c, Math.ceil(((recent[0]?.created_at ?? t) + HOUR - t) / 1000));
    const last = deps.db
      .prepare(
        'SELECT resend_after FROM acct_phone_challenges WHERE user_id=? AND consumed=0 ORDER BY created_at DESC LIMIT 1',
      )
      .get(uid) as { resend_after: number } | undefined;
    if (last && t < last.resend_after)
      return rateLimited(c, Math.ceil((last.resend_after - t) / 1000));

    // Honest delivery channel.
    const imsgConfigured = deps.config.codeSender === 'imessage' && !!deps.config.imessageSendUrl;
    const canImessage =
      imsgConfigured && typeof deps.codeSender.sendStrict === 'function' && allowlisted(normalized);
    let reason = '';
    if (!canImessage)
      reason = !imsgConfigured
        ? 'the iMessage bridge is not configured on this hub'
        : 'this number is not on the iMessage allowlist';
    if (!canImessage && !devCodes)
      return c.json({
        ok: false,
        delivery: 'unavailable' as PhoneDelivery,
        deliveryLabel: 'Code delivery unavailable',
        message: `code delivery unavailable: ${reason}`,
        to: hint,
      });

    const code = deps.config.demoCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = `pc_${randomBytes(12).toString('hex')}`;
    let delivery: PhoneDelivery = 'dev';
    const msg = { channel: 'phone' as const, to: normalized, hint, code };
    if (canImessage) {
      const sent = await deps.codeSender.sendStrict!(msg);
      if (sent) delivery = 'imessage';
      else if (!devCodes)
        return c.json({
          ok: false,
          delivery: 'unavailable' as PhoneDelivery,
          deliveryLabel: 'Code delivery unavailable',
          message: 'code delivery unavailable: the iMessage bridge did not accept the message',
          to: hint,
        });
    }
    if (delivery === 'dev') {
      // Dev: show the code to the signed-in person. Never iMessage a non-allowlisted handle.
      await (deps.codeSender.name === 'imessage' ? consoleSender : deps.codeSender).send(msg);
    }
    deps.db
      .prepare(
        'INSERT INTO acct_phone_challenges(id,user_id,phone_hash,hint,code_hash,created_at,expires_at,resend_after) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(id, uid, hash, hint, codeHash(id, code), t, t + CODE_TTL_MS, t + RESEND_MS);
    return c.json({
      ok: true,
      challengeId: id,
      to: hint,
      expiresAt: t + CODE_TTL_MS,
      resendAfter: t + RESEND_MS,
      delivery,
      deliveryLabel:
        delivery === 'imessage'
          ? 'Code sent by iMessage'
          : deps.config.demoCode
            ? 'Demo code shown here (no SMS is sent)'
            : 'Code shown here (dev)',
      ...(delivery === 'dev'
        ? { devCode: code, devCodeLabel: 'Dev code (HUB_DEV_LOGIN): not sent to your phone' }
        : {}),
    });
  });

  r.post('/v1/me/phone/verify', user, async (c) => {
    const uid = c.get('user').id;
    const rl = limit(`phone-verify:${uid}`, 30, HOUR);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS);
    const b = await readBody(c, VerifyBody);
    if (!b.ok) return b.res;
    const row = deps.db
      .prepare('SELECT * FROM acct_phone_challenges WHERE id=? AND user_id=?')
      .get(b.data.challengeId, uid) as
      | {
          id: string;
          phone_hash: string;
          hint: string;
          code_hash: string;
          expires_at: number;
          tries: number;
          consumed: number;
        }
      | undefined;
    const err = (
      status: 400 | 404 | 410 | 429,
      code: string,
      message: string,
      triesLeft?: number,
    ) =>
      c.json(
        { error: { code, message, ...(triesLeft !== undefined ? { triesLeft } : {}) } },
        status,
      );
    if (!row || row.consumed) return err(404, 'not_found', 'That request expired. Start again.');
    if (deps.now() > row.expires_at)
      return err(410, 'code_expired', 'That code expired. Ask for a new one.');
    if (row.tries >= MAX_TRIES)
      return err(429, 'too_many_attempts', 'Too many tries. Ask for a new code.');
    const want = Buffer.from(row.code_hash);
    const got = Buffer.from(codeHash(row.id, b.data.code));
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      deps.db.prepare('UPDATE acct_phone_challenges SET tries=tries+1 WHERE id=?').run(row.id);
      const left = MAX_TRIES - (row.tries + 1);
      return left <= 0
        ? err(429, 'too_many_attempts', 'Too many tries. Ask for a new code.')
        : err(400, 'code_invalid', 'That code is not right.', left);
    }
    const taken = deps.imessage.linkedUser(row.phone_hash);
    const signup = (
      deps.db.prepare('SELECT id FROM acct_users WHERE contact_hash=?').get(row.phone_hash) as
        { id: string } | undefined
    )?.id;
    if ((taken && taken !== uid) || (signup && signup !== uid))
      return err(400, 'phone_in_use', 'That number is linked to another account.');
    deps.db.prepare('UPDATE acct_phone_challenges SET consumed=1 WHERE id=?').run(row.id);
    deps.imessage.link(row.phone_hash, uid, row.hint);
    deps.log.info('phone.linked', { user: uid, to: row.hint });
    return c.json({ ok: true, verified: true, hint: row.hint });
  });

  return r;
}
