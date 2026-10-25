// Account side of linking a handle (docs/imessage.md): the bot texts an unknown number a short code; the signed-in
// student enters it here, and that number is from then on that account.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth';
import { createLimiter, readBody } from '../http';
import { MIRROR_MODES } from './store';
import { bridgeState, healthReport, safetyView } from './sendblue/health';
import { attachIMessage, FIXTURE_CHAT, type IMessageHandle } from './wire';
import { sendblueConfigFromEnv, missingSendblueEnv } from './sendblue/config';
import type { HubApp, HubDeps, HubEnv } from '../types';

const LinkBody = z.strictObject({ code: z.string().trim().min(4).max(12) });
const SettingsBody = z
  .strictObject({
    mirror: z.enum(MIRROR_MODES as [string, ...string[]]).optional(),
    showUnlinked: z.boolean().optional(),
  })
  .refine((b) => b.mirror !== undefined || b.showUnlinked !== undefined);

const demoHandles = new WeakMap<object, IMessageHandle>();

export function createImessageRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const user = requireUser(deps);
  const limit = createLimiter(deps.now);

  r.get('/v1/imessage/link', user, (c) =>
    c.json({
      links: deps.imessage
        .linksOf(c.get('user').id)
        .map((l) => ({ hint: l.hint, linkedAt: l.linkedAt })),
    }),
  );

  r.post('/v1/imessage/link', user, async (c) => {
    const uid = c.get('user').id;
    const rl = limit(`imsg-link:${uid}`, 10, 3_600_000);
    if (!rl.ok)
      return c.json({ error: { code: 'rate_limited', retryAfterS: rl.retryAfterS } }, 429);
    const b = await readBody(c, LinkBody);
    if (!b.ok) return b.res;
    const res = deps.imessage.consumeLinkCode(b.data.code);
    if (!res.ok)
      return c.json({ error: { code: res.error } }, res.error === 'code_expired' ? 410 : 404);
    deps.imessage.link(res.handleHash, uid, res.hint);
    return c.json({ ok: true, hint: res.hint });
  });

  r.delete('/v1/imessage/link', user, (c) =>
    c.json({ ok: true, removed: deps.imessage.unlinkUser(c.get('user').id) }),
  );

  // ---- sync (docs/imessage.md section 8) ----
  /** Can this viewer see (and so retry) this message? Group: squad members. DM: its owner. */
  const canSee = (uid: string, chatId: string): boolean =>
    chatId.startsWith('dm:')
      ? chatId === `dm:${uid}`
      : (deps.directory.squad(chatId.slice(6))?.members.includes(uid) ?? false);

  r.post('/v1/imessage/messages/:id/retry', user, (c) => {
    const uid = c.get('user').id;
    const m = deps.chat.store.get(c.req.param('id'));
    if (!m || !canSee(uid, m.chatId)) return c.json({ error: { code: 'not_found' } }, 404);
    if (!deps.imessageSync) return c.json({ error: { code: 'imessage_off' } }, 409);
    const retried = deps.imessageSync.retry(m.id);
    void deps.imessageSync.drain();
    return c.json({ ok: true, retried });
  });

  /**
   * What the chat header, the Connections card and the plan panel show. Honest: `fixture` marks a scripted transport,
   * `killSwitch` an off bridge. Per squad: how many iMessage groups are bound (never their ids) and the last sync.
   */
  r.get('/v1/imessage/status', user, async (c) => {
    const uid = c.get('user').id;
    const sync = deps.imessageSync;
    const st = sync ? await sync.status() : undefined;
    const squads = deps.directory.squadsOf(uid).map((squadId) => {
      const bindings = deps.imessage.bindingsOf(squadId);
      const cursors = bindings.map((b) => deps.imessage.cursor(b.chatGuid)?.lastTs ?? 0);
      const last = Math.max(0, st?.lastOkAt ?? 0, ...cursors);
      return {
        squadId,
        name: deps.directory.squad(squadId)?.name ?? squadId,
        bound: bindings.length,
        lastSyncAt: last > 0 ? last : null,
        mirror: deps.imessage.syncSettings(squadId).mirror,
      };
    });
    const bridge = bridgeState(deps);
    if (!st || !sync)
      return c.json({
        enabled: false,
        mode: 'off',
        killSwitch: true,
        squads,
        lastSyncAt: null,
        provider: bridge.provider,
        bridge,
      });
    const mode = st.fixture ? 'fixture' : st.dryRun ? 'dry_run' : 'live';
    return c.json({
      enabled: true,
      mode,
      killSwitch: false,
      dryRun: st.dryRun,
      fixture: st.fixture,
      transport: st.transport,
      ...(st.transport === 'degraded'
        ? {
            degradedReason: st.watcherDown
              ? 'the Messages watcher stopped'
              : 'sends to Messages are failing',
          }
        : {}),
      queued: st.queued,
      failed: st.failed,
      watcherDown: st.watcherDown,
      lastSyncAt: squads.reduce<number | null>(
        (a, s) => (s.lastSyncAt && (!a || s.lastSyncAt > a) ? s.lastSyncAt : a),
        null,
      ),
      squads,
      provider: bridge.provider,
      bridge,
    });
  });

  // Integration health for the iMessage provider (consumed by the shared Integration Health page). Never sends.
  r.get('/v1/imessage/health', user, async (c) => c.json(await healthReport(deps)));

  // The Connections card: exact missing env names, the webhook URL to paste, the allowlist instructions.
  r.get('/v1/imessage/setup', user, (c) => {
    const cfg = sendblueConfigFromEnv(deps.imessageInfo?.env ?? process.env, deps.config.baseUrl);
    return c.json({
      provider: bridgeState(deps).provider,
      missingEnv: missingSendblueEnv(cfg),
      webhookUrl: `${cfg.publicUrl || deps.config.baseUrl}/v1/webhooks/sendblue`,
      statusUrl: `${cfg.publicUrl || deps.config.baseUrl}/v1/webhooks/sendblue/status`,
      secretHeader: cfg.secretHeader,
      safety: safetyView(deps.imessageInfo?.env ?? process.env),
    });
  });

  // ---- Demo/Fixture bridge (docs/sendblue.md section 9): the whole loop locally, no credentials, nothing real sent ----
  const demoAllowed = () => !deps.config.production && process.env.IMESSAGE_DEMO !== '0';
  const demoOn = () => deps.imessageInfo?.provider === 'fake' && !!deps.imessageInfo.demo;
  r.get('/v1/imessage/demo', user, (c) =>
    c.json({
      available: demoAllowed(),
      on: demoOn(),
      ...(deps.imessageInfo && !demoOn() ? { blockedBy: 'another_bridge_running' } : {}),
      ...(!demoAllowed() ? { blockedBy: 'production' } : {}),
      label: 'Demo bridge: fixture transport, nothing leaves this machine',
    }),
  );
  r.post('/v1/imessage/demo', user, async (c) => {
    const uid = c.get('user').id;
    if (!demoAllowed()) return c.json({ error: { code: 'demo_disabled' } }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    if (b.enabled === false) {
      if (demoOn()) await demoHandles.get(deps)?.stop();
      demoHandles.delete(deps);
      return c.json({ ok: true, on: false });
    }
    if (demoOn()) return c.json({ ok: true, on: true });
    if (deps.imessageInfo) return c.json({ error: { code: 'another_bridge_running' } }, 409);
    const squadId = deps.directory.squadOf(uid);
    if (!squadId) return c.json({ error: { code: 'no_squad' } }, 409);
    const h = await attachIMessage(
      { deps },
      {
        provider: 'fake',
        env: {
          IMESSAGE_PROVIDER: 'fake',
          IMESSAGE_ENABLED: '1',
          IMESSAGE_ALLOWED_CHATS: FIXTURE_CHAT,
        },
        fixtureSquadId: squadId,
        minGapMs: 0,
      },
    );
    if (!h) return c.json({ error: { code: 'demo_failed' } }, 500);
    demoHandles.set(deps, h);
    return c.json({ ok: true, on: true });
  });
  r.post('/v1/imessage/demo/inbound', user, async (c) => {
    const uid = c.get('user').id;
    if (!demoOn()) return c.json({ error: { code: 'demo_off' } }, 409);
    const rl = limit(`imsg-demo:${uid}`, 60, 60_000);
    if (!rl.ok)
      return c.json({ error: { code: 'rate_limited', retryAfterS: rl.retryAfterS } }, 429);
    const b = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 2000) : '';
    if (!text) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (!deps.directory.squad(deps.directory.squadOf(uid) ?? '')?.members.includes(uid))
      return c.json({ error: { code: 'not_found' } }, 404);
    if (!(await deps.imessageInfo!.demo!.emit(uid, text)))
      return c.json({ error: { code: 'no_account' } }, 409);
    return c.json({ ok: true });
  });

  r.get('/v1/imessage/squads/:squadId/settings', user, (c) => {
    const sid = c.req.param('squadId');
    if (!canSee(c.get('user').id, `group:${sid}`))
      return c.json({ error: { code: 'not_found' } }, 404);
    return c.json({
      settings: deps.imessage.syncSettings(sid),
      chats: deps.imessage.bindingsOf(sid).length,
    });
  });

  r.put('/v1/imessage/squads/:squadId/settings', user, async (c) => {
    const sid = c.req.param('squadId');
    const uid = c.get('user').id;
    if (!canSee(uid, `group:${sid}`)) return c.json({ error: { code: 'not_found' } }, 404);
    if (deps.squads.roleOf(sid, uid) !== 'owner')
      return c.json({ error: { code: 'owner_only' } }, 403);
    const b = await readBody(c, SettingsBody);
    if (!b.ok) return b.res;
    return c.json({
      settings: deps.imessage.setSyncSettings(
        sid,
        b.data as Parameters<typeof deps.imessage.setSyncSettings>[1],
      ),
    });
  });
  return r;
}
