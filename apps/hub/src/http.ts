import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { SquadErr } from './store/squads';

export type Limiter = (
  key: string,
  max: number,
  windowMs: number,
) => { ok: boolean; retryAfterS: number };

/** In-memory sliding-window limiter. Single process, which is what the hub is. */
export function createLimiter(now: () => number): Limiter {
  const hits = new Map<string, number[]>();
  return (key, max, windowMs) => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return {
        ok: false,
        retryAfterS: Math.max(1, Math.ceil(((list[0] ?? t) + windowMs - t) / 1000)),
      };
    }
    list.push(t);
    hits.set(key, list);
    if (hits.size > 5000)
      for (const [k, v] of hits) if (!v.some((x) => x > t - windowMs)) hits.delete(k);
    return { ok: true, retryAfterS: 0 };
  };
}

/** Best-effort client address: first x-forwarded-for hop, else the socket peer. Used for rate limits only, never stored. */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
}

export async function readBody<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const r = schema.safeParse(raw ?? {});
  if (!r.success)
    return {
      ok: false,
      res: c.json(
        {
          error: {
            code: 'invalid_request',
            message: r.error.issues[0]?.message ?? 'invalid request',
            // paths only, never the submitted values
            issues: r.error.issues.map((i) => i.path.join('.')),
          },
        },
        400,
      ),
    };
  return { ok: true, data: r.data };
}

export function fail(c: Context, e: SquadErr): Response {
  return c.json(
    { error: { code: e.code, ...(e.message ? { message: e.message } : {}), ...(e.extra ?? {}) } },
    e.status,
  );
}
