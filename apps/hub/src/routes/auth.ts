import {
  AuthStartBodySchema,
  AuthVerifyBodySchema,
  normalizeEmail,
  normalizePhone,
  type AccountUser,
  type SessionResponse,
} from '@squad/core';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  requireUser,
  requireViewer,
  setSessionCookie,
  signToken,
  viewerFor,
} from '../auth';
import { clientIp, createLimiter, rateLimited, readBody } from '../http';
import type { UserRow } from '../store/accounts';
import type { HubApp, HubDeps, HubEnv, Student } from '../types';

const BEARER_TTL = 12 * 60 * 60 * 1000;
const STREAM_TTL = 5 * 60 * 1000;
const DELETE_PHRASE = 'delete my account';

export function accountUser(deps: HubDeps, id: string): AccountUser | null {
  const row: UserRow | undefined = deps.accounts.user(id);
  if (row)
    return {
      id: row.id,
      name: row.name,
      contactHint: row.hint,
      ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
      ...(row.personaId ? { personaId: row.personaId } : {}),
      createdAt: row.createdAt,
    };
  const st: Student | undefined = deps.directory.student(id); // seeded demo cast
  if (!st) return null;
  return {
    id: st.id,
    name: st.name,
    contactHint: null,
    ...(st.avatarUrl ? { avatarUrl: st.avatarUrl } : {}),
    ...(st.personaId ? { personaId: st.personaId } : {}),
    createdAt: 0,
  };
}

function sessionBody(
  deps: HubDeps,
  userId: string,
  token: string,
  expiresAt: number,
  created?: boolean,
): SessionResponse {
  const activeSquadId = deps.directory.squadOf(userId) ?? null;
  return {
    token,
    expiresAt,
    user: accountUser(deps, userId) as AccountUser,
    squads: deps.squads.list(userId, activeSquadId),
    activeSquadId,
    ...(created ? { created: true } : {}),
  };
}

export function createAuthRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const user = requireUser(deps);
  const limit = createLimiter(deps.now);
  const devCodes = (deps.config.devLogin && !deps.config.production) || !!deps.config.demoCode;

  const mintSession = (userId: string) => {
    const s = deps.accounts.createSession(userId);
    const { token } = signToken(
      deps.config.sessionSecret,
      { kind: 'session', sub: userId, sid: s.id, ttlMs: s.expiresAt - deps.now() },
      deps.now(),
    );
    return { token, expiresAt: s.expiresAt };
  };

  // ---- dev stub (HUB_DEV_LOGIN=1 only) ----
  r.get('/v1/auth/students', (c) => {
    if (!deps.config.devLogin) return c.json({ error: { code: 'not_found' } }, 404);
    return c.json({
      students: deps.directory
        .students()
        .filter((s) => !deps.accounts.user(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          ...(s.personaId ? { personaId: s.personaId } : {}),
        })),
    });
  });

  r.post('/v1/auth/dev-login', async (c) => {
    if (!deps.config.devLogin) return c.json({ error: { code: 'dev_login_disabled' } }, 403);
    const body = (await c.req.json().catch(() => null)) as { studentId?: unknown } | null;
    const id = typeof body?.studentId === 'string' ? body.studentId : '';
    const student = deps.directory.student(id);
    const viewer = student ? viewerFor(deps, id) : null;
    if (!student || !viewer)
      return c.json({ error: { code: 'not_found', message: 'unknown student' } }, 404);
    const { token } = signToken(
      deps.config.authSecret,
      { kind: 'bearer', sub: id, ttlMs: BEARER_TTL },
      deps.now(),
    );
    return c.json({ token, student, squadId: viewer.squadId });
  });

  // ---- accounts ----
  r.post('/v1/auth/start', async (c) => {
    const rl = limit(`start:${clientIp(c)}`, 20, 3_600_000);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS ?? 1);
    const b = await readBody(c, AuthStartBodySchema);
    if (!b.ok) return b.res;
    const channel = b.data.phone !== undefined ? 'phone' : 'email';
    const normalized =
      channel === 'phone' ? normalizePhone(b.data.phone ?? '') : normalizeEmail(b.data.email ?? '');
    if (!normalized)
      return c.json(
        {
          error: {
            code: 'invalid_request',
            message: channel === 'phone' ? 'Enter a valid phone number.' : 'Enter a valid email.',
          },
        },
        400,
      );
    const res = deps.accounts.start({
      channel,
      normalized,
      ...(b.data.name ? { name: b.data.name } : {}),
    });
    if (!res.ok) {
      if (res.error === 'rate_limited') return rateLimited(c, res.retryAfterS ?? 1);
      return c.json(
        { error: { code: 'invalid_request', message: 'Add your name to create an account.' } },
        400,
      );
    }
    const ch = res.challenge;
    await deps.codeSender.send({ channel, to: normalized, hint: ch.hint, code: ch.code });
    return c.json({
      challengeId: ch.id,
      channel,
      to: ch.hint,
      expiresAt: ch.expiresAt,
      resendAfter: ch.resendAfter,
      ...(devCodes ? { devCode: ch.code } : {}),
    });
  });

  r.post('/v1/auth/resend', async (c) => {
    const b = await readBody(c, z.object({ challengeId: z.string().min(1).max(80) }).strict());
    if (!b.ok) return b.res;
    const res = deps.accounts.resend(b.data.challengeId);
    if (!res.ok) {
      if (res.error === 'rate_limited') return rateLimited(c, res.retryAfterS ?? 1);
      return c.json(
        { error: { code: 'not_found', message: 'That request expired. Start again.' } },
        404,
      );
    }
    const ch = res.challenge;
    await deps.codeSender.send({
      channel: ch.channel,
      to: res.normalized ?? '',
      hint: ch.hint,
      code: ch.code,
    });
    return c.json({
      challengeId: ch.id,
      channel: ch.channel,
      to: ch.hint,
      expiresAt: ch.expiresAt,
      resendAfter: ch.resendAfter,
      ...(devCodes ? { devCode: ch.code } : {}),
    });
  });

  r.post('/v1/auth/verify', async (c) => {
    const rl = limit(`verify:${clientIp(c)}`, 60, 3_600_000);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS ?? 1);
    const b = await readBody(c, AuthVerifyBodySchema);
    if (!b.ok) return b.res;
    const res = deps.accounts.verify(b.data.challengeId, b.data.code);
    if (!res.ok) {
      const map = {
        code_invalid: [400, 'That code is not right.'],
        code_expired: [410, 'That code expired. Ask for a new one.'],
        too_many_attempts: [429, 'Too many tries. Ask for a new code.'],
        not_found: [404, 'That request expired. Start again.'],
      } as const;
      const [status, message] = map[res.error];
      return c.json(
        {
          error: {
            code: res.error,
            message,
            ...(res.triesLeft !== undefined ? { triesLeft: res.triesLeft } : {}),
          },
        },
        status,
      );
    }
    const u = res.user;
    deps.directory.upsertStudent({ id: u.id, name: u.name, handle: u.hint });
    if (u.activeSquad) deps.directory.setActiveSquad(u.id, u.activeSquad);
    if (res.created) deps.log.info('account.created', { user: u.id });
    const { token, expiresAt } = mintSession(u.id);
    setSessionCookie(deps, c, token, expiresAt);
    return c.json(sessionBody(deps, u.id, token, expiresAt, res.created));
  });

  r.post('/v1/auth/logout', user, (c) => {
    const u = c.get('user');
    if (u.sessionId) deps.accounts.revoke(u.sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  r.post('/v1/auth/refresh', user, (c) => {
    const u = c.get('user');
    if (!u.sessionId)
      return c.json({ error: { code: 'invalid_request', message: 'not a session token' } }, 400);
    const next = deps.accounts.rotate(u.sessionId);
    if (!next) return c.json({ error: { code: 'unauthorized' } }, 401);
    const { token } = signToken(
      deps.config.sessionSecret,
      { kind: 'session', sub: u.id, sid: next.id, ttlMs: next.expiresAt - deps.now() },
      deps.now(),
    );
    setSessionCookie(deps, c, token, next.expiresAt);
    return c.json(sessionBody(deps, u.id, token, next.expiresAt));
  });

  // ---- me ----
  r.get('/v1/me', user, (c) => {
    const id = c.get('user').id;
    const acct = accountUser(deps, id);
    if (!acct) return c.json({ error: { code: 'unauthorized' } }, 401);
    const wanted = c.req.header('x-squad-id');
    const viewer = viewerFor(deps, id, wanted || undefined);
    if (wanted && !viewer) return c.json({ error: { code: 'forbidden' } }, 403);
    const activeSquadId = viewer?.squadId ?? null;
    return c.json({
      student: deps.directory.student(id) ?? {
        id,
        name: acct.name,
        handle: acct.contactHint ?? '',
      },
      squadId: activeSquadId ?? '',
      projector: deps.projector.has(id),
      user: acct,
      squads: deps.squads.list(id, activeSquadId),
      activeSquadId,
      // True only for a phone the hub verified (signed up with it, or linked via /v1/me/phone/verify).
      phoneVerified:
        deps.accounts.user(id)?.channel === 'phone' || deps.imessage.linksOf(id).length > 0,
    });
  });

  r.patch('/v1/me', user, async (c) => {
    const b = await readBody(c, z.object({ name: z.string().trim().min(1).max(40) }).strict());
    if (!b.ok) return b.res;
    const id = c.get('user').id;
    if (!deps.accounts.user(id)) return c.json({ error: { code: 'forbidden' } }, 403);
    deps.accounts.rename(id, b.data.name);
    const st = deps.directory.student(id);
    if (st) deps.directory.upsertStudent({ ...st, name: b.data.name });
    deps.squads.hydrate();
    return c.json({ user: accountUser(deps, id) });
  });

  r.get('/v1/me/export', user, (c) => {
    const id = c.get('user').id;
    const acct = accountUser(deps, id);
    if (!acct) return c.json({ error: { code: 'unauthorized' } }, 401);
    const all = (sql: string) => deps.db.prepare(sql).all(id);
    const safe = (sql: string) => {
      try {
        return all(sql);
      } catch {
        return [];
      }
    };
    const body = {
      exportedAt: new Date(deps.now()).toISOString(),
      profile: acct,
      squads: deps.squads.list(id, deps.directory.squadOf(id) ?? null),
      squadActivity: deps.squads.auditFor(id),
      calendarBusyBlocks: safe('SELECT start, end, title FROM hub_busy_blocks WHERE student=?'),
      ledgerRows: safe(
        'SELECT task_id AS taskId, field, ts, shared, has_withheld AS hasWithheld FROM hub_ledger_rows WHERE student=?',
      ),
      ledgerPrivate: safe(
        'SELECT task_id AS taskId, field, raw FROM hub_ledger_private WHERE student=?',
      ),
      memory: safe('SELECT scope, key, value_json AS value, ts FROM memory WHERE scope_id=?'),
    };
    c.header('content-disposition', 'attachment; filename="squad-export.json"');
    c.header('cache-control', 'no-store');
    return c.json(body);
  });

  r.delete('/v1/me', user, async (c) => {
    const b = await readBody(c, z.object({ confirm: z.literal(DELETE_PHRASE) }).strict());
    if (!b.ok) return b.res;
    const id = c.get('user').id;
    if (!deps.accounts.user(id))
      return c.json(
        { error: { code: 'forbidden', message: 'demo accounts cannot be deleted' } },
        403,
      );
    deps.squads.leaveAll(id);
    for (const sql of [
      'DELETE FROM hub_busy_blocks WHERE student=?',
      'DELETE FROM memory WHERE scope_id=?',
      'DELETE FROM pending_confirms WHERE student_id=?',
    ])
      try {
        deps.db.prepare(sql).run(id);
      } catch {
        /* table absent in a minimal db */
      }
    deps.ledger.forget(id);
    deps.trips.forget(id);
    deps.plans.store.forgetStudent(id);
    deps.accounts.revokeAll(id);
    deps.accounts.deleteUser(id);
    deps.squads.anonymizeAudit(id);
    deps.directory.removeStudent(id);
    deps.projector.delete(id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    deps.log.info('account.deleted', { user: id });
    return c.json({ ok: true });
  });

  r.post('/v1/squad/stream-token', need, (c) => {
    const v = c.get('viewer');
    const { token, expiresAt } = signToken(
      deps.config.authSecret,
      { kind: 'stream', sub: v.studentId, ttlMs: STREAM_TTL, sq: v.squadId },
      deps.now(),
    );
    return c.json({ st: token, expiresAt });
  });

  r.post('/v1/session/projector', need, async (c) => {
    const v = c.get('viewer');
    const body = (await c.req.json().catch(() => null)) as { on?: unknown } | null;
    if (typeof body?.on !== 'boolean') return c.json({ error: { code: 'invalid_request' } }, 400);
    if (body.on) deps.projector.add(v.studentId);
    else deps.projector.delete(v.studentId);
    return c.json({ projector: body.on });
  });

  return r;
}
