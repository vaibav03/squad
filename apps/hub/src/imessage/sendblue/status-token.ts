// Per-send proof for Sendblue's `status_callback`. Sendblue calls that URL WITHOUT the account `sb-signing-secret`
// header, so each callback URL we hand out carries `?t=<sendId>.<expSec>.<hmac>` where
// hmac = HMAC-SHA256(secret, 'status:' + sendId + ':' + expSec), truncated. It is only ever accepted by the status
// route (the domain prefix 'status:' makes it useless anywhere else) and only until it expires.
import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './webhook';

export const STATUS_TOKEN_TTL_S = 24 * 3600;
const MAC_HEX = 32;
const mac = (secret: string, sendId: string, exp: number) =>
  createHmac('sha256', secret).update(`status:${sendId}:${exp}`).digest('hex').slice(0, MAC_HEX);

export function newSendId(): string {
  return randomBytes(8).toString('hex');
}

export function signStatusToken(secret: string, sendId: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + STATUS_TOKEN_TTL_S;
  return `${sendId}.${exp}.${mac(secret, sendId, exp)}`;
}

export function verifyStatusToken(
  secret: string,
  token: string | undefined,
  nowMs: number,
): { ok: true; sendId: string } | { ok: false } {
  if (!secret || !token || token.length > 120) return { ok: false };
  const m = /^([0-9a-f]{8,32})\.(\d{1,12})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return { ok: false };
  const [, sendId, expS, got] = m as unknown as [string, string, string, string];
  const exp = Number(expS);
  if (!safeEqual(got, mac(secret, sendId, exp))) return { ok: false };
  if (nowMs / 1000 > exp) return { ok: false };
  return { ok: true, sendId };
}
