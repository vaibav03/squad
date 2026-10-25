// Inbound Sendblue webhooks: POST /v1/webhooks/sendblue (receive + outbound status) and /v1/webhooks/sendblue/status
// (the per-message `status_callback`). PUBLIC, so the order is: rate limit -> size cap -> secret header -> raw body
// -> optional body HMAC -> only then JSON parsing and any side effect. Fails closed everywhere.
//
// Sendblue's documented scheme is a SHARED SECRET echoed in a request header (default `sb-signing-secret`, see
// docs/sendblue.md section 3), compared in constant time. It is not a body HMAC, so a second, optional layer is
// verified when present: `sb-body-signature: sha256=<hex HMAC-SHA256(secret, raw body)>` (for a signing proxy).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { clientIp, createLimiter, rateLimited } from '../../http';
import type { HubApp, HubDeps, HubEnv } from '../../types';
import type { SendblueConfig } from './config';
import { mapStatus, SbMessageSchema, type SbMessage } from './webhook-schema';
import type { SendblueRuntime } from './runtime';

export const WEBHOOK_MAX_BYTES = 256 * 1024;
const RATE_PER_MIN = 240;
const HANDLE_TIMEOUT_MS = 25_000;

/** Constant-time string equality that also hides the length (both sides hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export type VerifyResult = { ok: true } | { ok: false; status: 401 | 503; code: string };

/** Phase 1, before the body is read: the shared secret in the configured header. */
export function verifySecretHeader(
  header: (name: string) => string | undefined,
  cfg: Pick<SendblueConfig, 'webhookSecret' | 'secretHeader'>,
): VerifyResult {
  if (!cfg.webhookSecret) return { ok: false, status: 503, code: 'sendblue_not_configured' };
  const got = header(cfg.secretHeader);
  if (!got) return { ok: false, status: 401, code: 'missing_signature' };
  if (!safeEqual(got, cfg.webhookSecret)) return { ok: false, status: 401, code: 'bad_signature' };
  return { ok: true };
}

/** Phase 2, on the RAW body, before parsing: the optional body HMAC and timestamp headers. */
export function verifyRawBody(
  header: (name: string) => string | undefined,
  raw: string,
  cfg: Pick<SendblueConfig, 'webhookSecret' | 'replayWindowS'>,
  nowMs: number,
): VerifyResult {
  const sig = header('sb-body-signature');
  if (sig !== undefined) {
    const want = createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex');
    const got = sig.replace(/^sha256=/i, '').toLowerCase();
    if (!safeEqual(got, want)) return { ok: false, status: 401, code: 'bad_body_signature' };
  }
  const ts = header('sb-timestamp');
  if (ts !== undefined) {
    const n = Number(ts);
    const ms = Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Date.parse(ts);
    if (!Number.isFinite(ms) || Math.abs(nowMs - ms) > cfg.replayWindowS * 1000)
      return { ok: false, status: 401, code: 'stale_timestamp' };
  }
  return { ok: true };
}

const failBody = (code: string) => ({ error: { code } });

export function createSendblueWebhookRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const limit = createLimiter(deps.now);
  const now = deps.now;

  async function handle(c: import('hono').Context<HubEnv>, statusPath: boolean) {
    const rl = limit(`sb-hook:${clientIp(c)}`, RATE_PER_MIN, 60_000);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS);
    const len = Number(c.req.header('content-length'));
    if (Number.isFinite(len) && len > WEBHOOK_MAX_BYTES) return c.json(failBody('too_large'), 413);
    const rt = deps.sendblue;
    if (!rt) return c.json(failBody('sendblue_not_configured'), 503);
    const hdr = (n: string) => c.req.header(n);
    const v1 = verifySecretHeader(hdr, rt.cfg);
    if (!v1.ok) {
      rt.noteRejected(v1.code);
      return c.json(failBody(v1.code), v1.status);
    }
    const raw = await c.req.text().catch(() => '');
    if (raw.length > WEBHOOK_MAX_BYTES) return c.json(failBody('too_large'), 413);
    const v2 = verifyRawBody(hdr, raw, rt.cfg, now());
    if (!v2.ok) {
      rt.noteRejected(v2.code);
      return c.json(failBody(v2.code), v2.status);
    }
    // ---- verified: from here on the payload is parsed ----
    rt.store.setMeta('last_verified', now());
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json(failBody('invalid_json'), 400);
    }
    const parsed = SbMessageSchema.safeParse(json);
    if (!parsed.success) return c.json(failBody('invalid_payload'), 400);
    const p = parsed.data;
    const isStatus =
      p.is_outbound === true ||
      (statusPath && p.is_outbound !== false && mapStatus(p.status, p.error_code) !== undefined);
    return isStatus ? onStatus(rt, p) : onInbound(rt, p, c);
  }

  async function onInbound(rt: SendblueRuntime, p: SbMessage, c: import('hono').Context<HubEnv>) {
    if (!p.from_number) return c.json({ ok: true, ignored: 'no_sender' });
    // replay: a webhook whose own timestamp is outside the window
    const ts = Date.parse(p.date_updated ?? p.date_sent ?? '');
    if (Number.isFinite(ts) && Math.abs(now() - ts) > rt.cfg.replayWindowS * 1000) {
      rt.noteRejected('stale_timestamp');
      return c.json(failBody('stale_timestamp'), 401);
    }
    // replay / redelivery: Sendblue message_handle, persisted in the iMessage identity map (imsg_xref)
    if (deps.imessage.inboundDone(p.message_handle)) return c.json({ ok: true, duplicate: true });
    try {
      await Promise.race([
        rt.sdk.deliverInbound(p),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), HANDLE_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch {
      return c.json(failBody('handler_failed'), 500); // 5xx: Sendblue retries (up to 3 times)
    }
    rt.recordInboundIds(p);
    rt.store.setMeta('last_inbound', now());
    return c.json({ ok: true });
  }

  function onStatus(rt: SendblueRuntime, p: SbMessage) {
    const state = mapStatus(p.status, p.error_code);
    if (!state) return jsonOk({ ok: true, ignored: 'unknown_status' });
    const key = `st:${p.message_handle}:${(p.status ?? '').toUpperCase()}`;
    if (!rt.store.claimEvent(key, 'status', now())) return jsonOk({ ok: true, duplicate: true });
    const code =
      p.error_code != null && p.error_code !== 0 ? String(p.error_code) : (p.error_key ?? null);
    const t = rt.store.recordStatus(p.message_handle, state, code, now());
    rt.store.setMeta('last_status', now());
    rt.store.prune(now());
    if (t === 'ignore') return jsonOk({ ok: true, ignored: 'stale_status' });
    rt.applyReceipt(
      p.message_handle,
      state,
      state === 'failed' ? `sb:${code ?? 'error'}` : undefined,
    );
    return jsonOk({ ok: true });
  }
  const jsonOk = (b: Record<string, unknown>) => Response.json(b, { status: 200 });

  r.post('/v1/webhooks/sendblue', (c) => handle(c, false));
  r.post('/v1/webhooks/sendblue/status', (c) => handle(c, true));

  // hub-served, signed, expiring files for outbound `media_url`
  r.get('/v1/imessage/media/:tail', (c) => {
    const rl = limit(`sb-media:${clientIp(c)}`, 120, 60_000);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS);
    const f = deps.sendblue?.media.open(c.req.param('tail'));
    if (!f) return c.json(failBody('not_found'), 404);
    return new Response(f.stream, {
      headers: {
        'content-type': f.mime,
        'content-length': String(f.size),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });
  return r;
}
