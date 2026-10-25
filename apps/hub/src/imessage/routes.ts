// Account side of linking a handle (docs/imessage.md): the bot texts an unknown number a short code; the signed-in
// student enters it here, and that number is from then on that account.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth';
import { createLimiter, readBody } from '../http';
import { MIRROR_MODES } from './store';
import type { HubApp, HubDeps, HubEnv } from '../types';

const LinkBody = z.strictObject({ code: z.string().trim().min(4).max(12) });
const SettingsBody = z
  .strictObject({
    mirror: z.enum(MIRROR_MODES as [string, ...string[]]).optional(),
    showUnlinked: z.boolean().optional(),
  })
  .refine((b) => b.mirror !== undefined || b.showUnlinked !== undefined);

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
    if (!st || !sync)
      return c.json({ enabled: false, mode: 'off', killSwitch: true, squads, lastSyncAt: null });
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
    });
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
