import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { HubDeps, HubEnv, Viewer } from './types';

export type TokenKind = 'bearer' | 'stream' | 'call';
interface Claims {
  k: TokenKind;
  sub: string; // student id
  exp: number; // ms
  call?: string; // call id for call tickets
  n: string;
}

const b64 = (b: Buffer) => b.toString('base64url');
const sig = (secret: string, body: string) =>
  b64(createHmac('sha256', secret).update(body).digest());

export function signToken(
  secret: string,
  c: { kind: TokenKind; sub: string; ttlMs: number; call?: string },
  now = Date.now(),
): { token: string; expiresAt: number } {
  const claims: Claims = {
    k: c.kind,
    sub: c.sub,
    exp: now + c.ttlMs,
    n: randomBytes(6).toString('hex'),
  };
  if (c.call) claims.call = c.call;
  const body = b64(Buffer.from(JSON.stringify(claims)));
  return { token: `${body}.${sig(secret, body)}`, expiresAt: claims.exp };
}

export function verifyToken(
  secret: string,
  token: string | undefined,
  kinds: TokenKind[],
  now = Date.now(),
): { sub: string; kind: TokenKind; call?: string } | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sig(secret, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims;
    if (!kinds.includes(c.k) || c.exp < now) return null;
    return { sub: c.sub, kind: c.k, ...(c.call ? { call: c.call } : {}) };
  } catch {
    return null;
  }
}

export function secretMatches(given: string | undefined, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function viewerFor(deps: HubDeps, studentId: string): Viewer | null {
  const squadId = deps.directory.squadOf(studentId);
  if (!squadId) return null;
  return { studentId, squadId, projector: deps.projector.has(studentId) };
}

/** Bearer header, or `?st=` when `allowQuery` (SSE). Stream tokens are accepted only where allowQuery is true. */
export function requireViewer(
  deps: HubDeps,
  opts: { allowQuery?: boolean } = {},
): MiddlewareHandler<HubEnv> {
  return async (c, next) => {
    const h = c.req.header('authorization');
    let sub: string | undefined;
    if (h?.startsWith('Bearer '))
      sub = verifyToken(deps.config.authSecret, h.slice(7), ['bearer'], deps.now())?.sub;
    else if (opts.allowQuery)
      sub = verifyToken(
        deps.config.authSecret,
        c.req.query('st'),
        ['stream', 'bearer'],
        deps.now(),
      )?.sub;
    const viewer = sub ? viewerFor(deps, sub) : null;
    if (!viewer) return c.json({ error: { code: 'unauthorized' } }, 401);
    c.set('viewer', viewer);
    await next();
  };
}
