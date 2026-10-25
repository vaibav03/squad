import { Hono } from 'hono';
import { z } from 'zod';
import { VoicesUnavailableError } from '@squad/core';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const Patch = z.strictObject({
  voiceId: z.string().min(1).max(128).optional(),
  avatarUrl: z
    .string()
    .max(512)
    .refine(
      (u) =>
        u.startsWith('https://') ||
        (u.startsWith('/') && !u.startsWith('//')) ||
        /^[\w./-]+$/.test(u),
      'relative path or https URL',
    )
    .optional(),
});
const Preview = z.strictObject({
  voiceId: z.string().min(1).max(128),
  text: z.string().min(1).max(400),
});

export function createMediaRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const cache = new Map<string, { mime: string; data: Uint8Array }>(); // LRU via insertion order

  r.get('/v1/personas', need, async (c) => c.json(await deps.ports.media.personas()));

  r.put('/v1/personas/:id', need, async (c) => {
    const p = Patch.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const out = await deps.ports.media.updatePersona(c.req.param('id'), p.data);
    return out ? c.json(out) : c.json({ error: { code: 'not_found' } }, 404);
  });

  r.get('/v1/voices', need, async (c) => c.json({ voices: await deps.ports.media.voices() }));

  r.post('/v1/voices/preview', need, async (c) => {
    const p = Preview.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const key = `${p.data.voiceId}\u0000${p.data.text}`;
    let hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
    } else {
      let fresh;
      try {
        fresh = await deps.ports.media.preview(p.data.voiceId, p.data.text);
      } catch (e) {
        // speech is known to be off: say so plainly (the personas page shows `message`) instead of a 500
        if (e instanceof VoicesUnavailableError)
          return c.json(
            { error: { code: 'voices_unavailable', reason: e.reason, message: e.message } },
            503,
          );
        throw e;
      }
      if (!fresh) return c.json({ error: { code: 'not_found' } }, 404);
      hit = fresh;
      cache.set(key, hit);
      if (cache.size > 64) cache.delete(cache.keys().next().value as string);
    }
    return c.body(hit.data as unknown as ArrayBuffer, 200, {
      'content-type': hit.mime,
      'cache-control': 'private, max-age=3600',
    });
  });

  return r;
}
