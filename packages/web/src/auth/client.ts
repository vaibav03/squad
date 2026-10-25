import { z } from 'zod';
import {
  AccountUserSchema,
  AuthStartResponseSchema,
  InviteSchema,
  InvitePreviewSchema,
  SessionResponseSchema,
  SquadDetailSchema,
  SquadSummarySchema,
  type AccountUser,
  type AuthStartBody,
  type AuthStartResponse,
  type Invite,
  type InviteCreateBody,
  type InvitePreview,
  type SessionResponse,
  type SquadCreateBody,
  type SquadDetail,
  type SquadPatchBody,
  type SquadRole,
  type SquadSummary,
} from '@squad/core';
import { AccountApiError, errorFromResponse } from './errors';

const MeSchema = z.object({
  user: AccountUserSchema,
  squads: z.array(SquadSummarySchema),
  activeSquadId: z.string().nullable().optional(),
  squadId: z.string().optional(),
});
const SquadsSchema = z.object({
  squads: z.array(SquadSummarySchema),
  activeSquadId: z.string().nullable().optional(),
});
const SquadBody = z.object({ squad: SquadDetailSchema });
const JoinBody = z.object({
  squad: SquadDetailSchema,
  activeSquadId: z.string().nullable().optional(),
});
const InviteBody = z.object({ invite: InviteSchema });
const InvitesBody = z.object({ invites: z.array(InviteSchema) });
const ActivateBody = z.object({ activeSquadId: z.string().nullable().optional() });
const OkBody = z.object({ ok: z.boolean().optional() }).passthrough();
const UserBody = z.object({ user: AccountUserSchema });
const StudentsBody = z.object({ students: z.array(z.unknown()) }).passthrough();

export interface Me {
  user: AccountUser;
  squads: SquadSummary[];
  activeSquadId: string | null;
}

export interface AccountsClient {
  /** `mock` clients run in memory (no hub URL). */
  readonly mock: boolean;
  setToken(token: string | null): void;
  authStart(body: AuthStartBody): Promise<AuthStartResponse>;
  authResend(challengeId: string): Promise<AuthStartResponse>;
  authVerify(challengeId: string, code: string): Promise<SessionResponse>;
  logout(): Promise<void>;
  refreshSession(): Promise<SessionResponse>;
  me(): Promise<Me>;
  patchMe(name: string): Promise<AccountUser>;
  exportMe(): Promise<Blob>;
  deleteMe(): Promise<void>;
  /** True when the hub reports dev login on (GET /v1/auth/students succeeds). */
  devLoginAvailable(): Promise<boolean>;
  listSquads(): Promise<{ squads: SquadSummary[]; activeSquadId: string | null }>;
  createSquad(body: SquadCreateBody): Promise<SquadDetail>;
  getSquad(id: string): Promise<SquadDetail>;
  patchSquad(id: string, body: SquadPatchBody): Promise<SquadDetail>;
  activateSquad(id: string): Promise<string | null>;
  leaveSquad(id: string): Promise<void>;
  removeMember(squadId: string, userId: string): Promise<void>;
  setRole(squadId: string, userId: string, role: SquadRole): Promise<void>;
  deleteSquad(id: string, name: string): Promise<void>;
  listInvites(squadId: string): Promise<Invite[]>;
  createInvite(squadId: string, body?: InviteCreateBody): Promise<Invite>;
  revokeInvite(squadId: string, inviteId: string): Promise<void>;
  previewInvite(code: string): Promise<InvitePreview>;
  joinInvite(code: string): Promise<{ squad: SquadDetail; activeSquadId: string | null }>;
}

export interface ClientOptions {
  hubUrl: string;
  fetch?: typeof fetch;
  /** Called when the hub rotates the session and says so in `x-squad-token`. Never logged. */
  onToken?: (token: string) => void;
  initialToken?: string | null;
}

/** Typed client for docs/accounts-api.md. Cookie first (credentials: include), bearer as a fallback. */
export function createAccountsClient(opts: ClientOptions): AccountsClient {
  const base = opts.hubUrl.replace(/\/+$/, '');
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);
  let token: string | null = opts.initialToken ?? null;

  async function raw(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    // A request that never answers (hub stalled, connection pool starved) must fail, or sign-in hangs on "loading".
    const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), method === 'GET' ? 8000 : 20000) : undefined;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        credentials: 'include',
        ...(ctl ? { signal: ctl.signal } : {}),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AccountApiError('network', 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const rotated = res.headers?.get?.('x-squad-token');
    if (rotated) {
      token = rotated;
      opts.onToken?.(rotated);
    }
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      throw errorFromResponse(res.status, json);
    }
    return res;
  }

  async function call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const res = await raw(method, path, body, auth);
    const json: unknown = await res.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AccountApiError('bad_response', res.status);
    return parsed.data;
  }

  const enc = encodeURIComponent;
  const orNull = (v: string | null | undefined): string | null => (v ? v : null);

  return {
    mock: false,
    setToken(t) {
      token = t;
    },
    authStart: (b) => call('POST', '/v1/auth/start', AuthStartResponseSchema, b, false),
    authResend: (challengeId) =>
      call('POST', '/v1/auth/resend', AuthStartResponseSchema, { challengeId }, false),
    authVerify: (challengeId, code) =>
      call('POST', '/v1/auth/verify', SessionResponseSchema, { challengeId, code }, false),
    async logout() {
      try {
        await raw('POST', '/v1/auth/logout', {});
      } catch (e) {
        if (!(e instanceof AccountApiError) || e.code === 'network') throw e;
      }
    },
    refreshSession: () => call('POST', '/v1/auth/refresh', SessionResponseSchema, {}),
    async me() {
      const m = await call('GET', '/v1/me', MeSchema);
      return {
        user: m.user,
        squads: m.squads,
        activeSquadId: orNull(m.activeSquadId ?? m.squadId),
      };
    },
    async patchMe(name) {
      return (await call('PATCH', '/v1/me', UserBody, { name })).user;
    },
    async exportMe() {
      const res = await raw('GET', '/v1/me/export');
      return res.blob();
    },
    async deleteMe() {
      await call('DELETE', '/v1/me', OkBody, { confirm: 'delete my account' });
    },
    async devLoginAvailable() {
      try {
        await call('GET', '/v1/auth/students', StudentsBody, undefined, false);
        return true;
      } catch {
        return false;
      }
    },
    async listSquads() {
      const r = await call('GET', '/v1/squads', SquadsSchema);
      return { squads: r.squads, activeSquadId: orNull(r.activeSquadId) };
    },
    async createSquad(body) {
      return (await call('POST', '/v1/squads', SquadBody, body)).squad;
    },
    async getSquad(id) {
      return (await call('GET', `/v1/squads/${enc(id)}`, SquadBody)).squad;
    },
    async patchSquad(id, body) {
      return (await call('PATCH', `/v1/squads/${enc(id)}`, SquadBody, body)).squad;
    },
    async activateSquad(id) {
      const r = await call('POST', `/v1/squads/${enc(id)}/activate`, ActivateBody, {});
      return orNull(r.activeSquadId) ?? id;
    },
    async leaveSquad(id) {
      await call('POST', `/v1/squads/${enc(id)}/leave`, OkBody, {});
    },
    async removeMember(squadId, userId) {
      await call('DELETE', `/v1/squads/${enc(squadId)}/members/${enc(userId)}`, OkBody);
    },
    async setRole(squadId, userId, role) {
      await call('POST', `/v1/squads/${enc(squadId)}/members/${enc(userId)}/role`, OkBody, {
        role,
      });
    },
    async deleteSquad(id, name) {
      await call('DELETE', `/v1/squads/${enc(id)}`, OkBody, { confirm: name });
    },
    async listInvites(squadId) {
      return (await call('GET', `/v1/squads/${enc(squadId)}/invites`, InvitesBody)).invites;
    },
    async createInvite(squadId, body = {}) {
      return (await call('POST', `/v1/squads/${enc(squadId)}/invites`, InviteBody, body)).invite;
    },
    async revokeInvite(squadId, inviteId) {
      await call('DELETE', `/v1/squads/${enc(squadId)}/invites/${enc(inviteId)}`, OkBody);
    },
    previewInvite: (code) =>
      call('GET', `/v1/invites/${enc(code)}`, InvitePreviewSchema, undefined, false),
    async joinInvite(code) {
      const r = await call('POST', '/v1/invites/join', JoinBody, { code });
      return { squad: r.squad, activeSquadId: orNull(r.activeSquadId) ?? r.squad.id };
    },
  };
}
