import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { ROTATE_AFTER_MS } from './store/accounts';
import type { HubDeps, HubEnv, Viewer } from './types';

/** `session` is the stateful account token (cookie or bearer); `bearer` is the stateless dev-login token. */
export type TokenKind = 'bearer' | 'session' | 'stream' | 'call';
export const SESSION_COOKIE = 'squad_session';
interface Claims {
  k: TokenKind;
  sub: string; // student id
  exp: number; // ms
  call?: string; // call id for call tickets
  sid?: string; // session id (kind session)
  sq?: string; // squad a stream token was minted for
  n: string;
}

const b64 = (b: Buffer) => b.toString('base64url');
const sig = (secret: string, body: string) =>
  b64(createHmac('sha256', secret).update(body).digest());

export function signToken(
  secret: string,
  c: { kind: TokenKind; sub: string; ttlMs: number; call?: string; sid?: string; sq?: string },
  now = Date.now(),
): { token: string; expiresAt: number } {
  const claims: Claims = {
    k: c.kind,
    sub: c.sub,
    exp: now + c.ttlMs,
    n: randomBytes(6).toString('hex'),
  };
  if (c.call) claims.call = c.call;
  if (c.sid) claims.sid = c.sid;
  if (c.sq) claims.sq = c.sq;
  const body = b64(Buffer.from(JSON.stringify(claims)));
  return { token: `${body}.${sig(secret, body)}`, expiresAt: claims.exp };
}

export function verifyToken(
  secret: string,
  token: string | undefined,
  kinds: TokenKind[],
  now = Date.now(),
): { sub: string; kind: TokenKind; call?: string; sid?: string; sq?: string } | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sig(secret, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims;
    if (!kinds.includes(c.k) || c.exp < now) return null;
    return {
      sub: c.sub,
      kind: c.k,
      ...(c.call ? { call: c.call } : {}),
      ...(c.sid ? { sid: c.sid } : {}),
      ...(c.sq ? { sq: c.sq } : {}),
    };
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

/** The viewer for a student acting in `squadId` (default: their active squad). Membership is checked here, always. */
export function viewerFor(deps: HubDeps, studentId: string, squadId?: string): Viewer | null {
  const sq = squadId ?? deps.directory.squadOf(studentId);
  if (!sq || !deps.directory.squad(sq)?.members.includes(studentId)) return null;
  return { studentId, squadId: sq, projector: deps.projector.has(studentId) };
}

interface Cred {
  sub: string;
  sid?: string;
  sq?: string;
  viaCookie: boolean;
}

/** Bearer header, else the session cookie, else (SSE, `allowQuery`) `?st=`. Session tokens are checked against the sessions table. */
function credential(
  deps: HubDeps,
  c: Parameters<MiddlewareHandler<HubEnv>>[0],
  allowQuery: boolean,
): Cred | null {
  const now = deps.now();
  const h = c.req.header('authorization');
  let v: ReturnType<typeof verifyToken> = null;
  let viaCookie = false;
  if (h?.startsWith('Bearer ')) {
    const tok = h.slice(7);
    v =
      verifyToken(deps.config.authSecret, tok, ['bearer'], now) ??
      verifyToken(deps.config.sessionSecret, tok, ['session'], now);
  } else if (allowQuery && c.req.query('st')) {
    v = verifyToken(deps.config.authSecret, c.req.query('st'), ['stream', 'bearer'], now);
  } else {
    const ck = getCookie(c, SESSION_COOKIE);
    if (ck) {
      v = verifyToken(deps.config.sessionSecret, ck, ['session'], now);
      viaCookie = true;
    }
  }
  if (!v) return null;
  if (v.kind === 'session' && (!v.sid || !deps.accounts.sessionValid(v.sid))) return null;
  if (v.kind === 'session' && !deps.accounts.user(v.sub)) return null;
  return { sub: v.sub, ...(v.sid ? { sid: v.sid } : {}), ...(v.sq ? { sq: v.sq } : {}), viaCookie };
}

/** Cookie-carried requests that change state must come from a listed origin (CSRF). */
function csrfOk(deps: HubDeps, c: Parameters<MiddlewareHandler<HubEnv>>[0], cred: Cred): boolean {
  if (!cred.viaCookie || ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return true;
  const origin = c.req.header('origin');
  if (!origin) return true; // non-browser client
  const list = deps.config.corsOrigins;
  return list.includes('*') || list.includes(origin);
}

/** Any signed-in account, squad or not. Sets `user`. */
export function requireUser(
  deps: HubDeps,
  opts: { allowQuery?: boolean } = {},
): MiddlewareHandler<HubEnv> {
  return async (c, next) => {
    const cred = credential(deps, c, opts.allowQuery === true);
    if (!cred) return c.json({ error: { code: 'unauthorized' } }, 401);
    if (!csrfOk(deps, c, cred)) return c.json({ error: { code: 'forbidden' } }, 403);
    c.set('user', { id: cred.sub, ...(cred.sid ? { sessionId: cred.sid } : {}) });
    await next();
    await maybeRotate(deps, c, cred);
  };
}

/** Sessions older than a day are rotated: the response carries the new token (cookie and `x-squad-token`). */
async function maybeRotate(
  deps: HubDeps,
  c: Parameters<MiddlewareHandler<HubEnv>>[0],
  cred: Cred,
): Promise<void> {
  if (!cred.sid || c.res.headers.get('content-type')?.includes('text/event-stream')) return;
  const s = deps.accounts.session(cred.sid);
  if (!s || deps.now() - s.createdAt < ROTATE_AFTER_MS) return;
  const next = deps.accounts.rotate(cred.sid);
  if (!next) return;
  const { token } = signToken(
    deps.config.sessionSecret,
    { kind: 'session', sub: cred.sub, sid: next.id, ttlMs: next.expiresAt - deps.now() },
    deps.now(),
  );
  c.res.headers.set('x-squad-token', token);
  if (cred.viaCookie) setSessionCookie(deps, c, token, next.expiresAt);
}

export function setSessionCookie(
  deps: HubDeps,
  c: Parameters<MiddlewareHandler<HubEnv>>[0],
  token: string,
  expiresAt: number,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: deps.config.baseUrl.startsWith('https:'),
    expires: new Date(expiresAt),
  });
}

/** A signed-in account in a squad. 401 when not signed in, 409 `no_squad` for an account with no squad yet, 403 for a squad it is not in. */
export function requireViewer(
  deps: HubDeps,
  opts: { allowQuery?: boolean } = {},
): MiddlewareHandler<HubEnv> {
  return async (c, next) => {
    const cred = credential(deps, c, opts.allowQuery === true);
    if (!cred) return c.json({ error: { code: 'unauthorized' } }, 401);
    if (!csrfOk(deps, c, cred)) return c.json({ error: { code: 'forbidden' } }, 403);
    const wanted = c.req.header('x-squad-id') || cred.sq;
    const viewer = viewerFor(deps, cred.sub, wanted || undefined);
    if (!viewer) {
      if (wanted)
        return c.json({ error: { code: 'forbidden', message: 'not a member of that squad' } }, 403);
      if (deps.accounts.user(cred.sub)) return c.json({ error: { code: 'no_squad' } }, 409);
      return c.json({ error: { code: 'unauthorized' } }, 401);
    }
    c.set('viewer', viewer);
    c.set('user', { id: cred.sub, ...(cred.sid ? { sessionId: cred.sid } : {}) });
    await next();
    await maybeRotate(deps, c, cred);
  };
}
