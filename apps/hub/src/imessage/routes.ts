// Account side of linking a handle (docs/imessage.md): the bot texts an unknown number a short code; the signed-in
// student enters it here, and that number is from then on that account.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth';
import { createLimiter, readBody } from '../http';
import type { HubApp, HubDeps, HubEnv } from '../types';

const LinkBody = z.strictObject({ code: z.string().trim().min(4).max(12) });

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
  return r;
}
