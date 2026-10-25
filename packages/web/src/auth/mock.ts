import {
  formatInviteCode,
  maskContact,
  normalizeEmail,
  normalizeInviteCode,
  normalizePhone,
  type AccountUser,
  type Invite,
  type InvitePreview,
  type Member,
  type SessionResponse,
  type SquadDetail,
  type SquadRole,
  type SquadSummary,
} from '@squad/core';
import { AccountApiError } from './errors';
import type { AccountsClient, Me } from './client';

const MIN_GROUP = 3;
const MOCK_CODE = '123456';

interface MockSquad {
  id: string;
  name: string;
  course: string | null;
  createdAt: number;
  members: { userId: string; role: SquadRole; joinedAt: number }[];
  invites: Invite[];
}

/**
 * In-memory stand-in for the hub, used when VITE_HUB_URL is unset so /welcome and the squad pages still work
 * in the host. The verification code is always 123456 and the response carries it as `devCode`.
 * Invite codes with a known suffix show every error state: `EXPIRED2` style codes are `invite_*` fixtures below.
 */
export function createMockAccountsClient(): AccountsClient {
  let user: AccountUser | null = null;
  let squads: MockSquad[] = [];
  let active: string | null = null;
  let seq = 1;
  const challenges = new Map<string, { name?: string; to: string; channel: 'phone' | 'email' }>();
  const now = () => Date.now();
  const id = (p: string) => `${p}_${(seq++).toString(36)}${Math.floor(now() % 1e6).toString(36)}`;

  const requireUser = (): AccountUser => {
    if (!user) throw new AccountApiError('unauthorized', 401);
    return user;
  };
  const roleOf = (s: MockSquad) => s.members.find((m) => m.userId === user?.id)?.role ?? 'member';
  const count = (s: MockSquad) => (s.members.length >= MIN_GROUP ? s.members.length : null);
  const summary = (s: MockSquad): SquadSummary => ({
    id: s.id,
    name: s.name,
    course: s.course,
    role: roleOf(s),
    memberCount: count(s),
    active: s.id === active,
  });
  const detail = (s: MockSquad): SquadDetail => ({
    id: s.id,
    name: s.name,
    course: s.course,
    role: roleOf(s),
    memberCount: count(s),
    maxSize: 12,
    createdAt: s.createdAt,
    members: s.members.map((m): Member => ({
      id: m.userId,
      name: m.userId === user?.id ? user.name : `Member ${m.userId.slice(-3)}`,
      role: m.role,
      joinedAt: m.joinedAt,
      you: m.userId === user?.id,
    })),
  });
  const mine = (sid: string): MockSquad => {
    const s = squads.find((x) => x.id === sid);
    if (!s || !s.members.some((m) => m.userId === user?.id))
      throw new AccountApiError('not_found', 404);
    return s;
  };
  const session = (): SessionResponse => {
    const u = requireUser();
    return {
      token: `mock-${u.id}`,
      expiresAt: now() + 30 * 864e5,
      user: u,
      squads: squads.map(summary),
      activeSquadId: active,
    };
  };
  const invite = (s: MockSquad, maxUses: number | null, hours: number): Invite => {
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let raw = '';
    for (let i = 0; i < 8; i++) raw += alphabet[Math.floor(Math.random() * alphabet.length)];
    const code = formatInviteCode(raw);
    return {
      id: id('inv'),
      code,
      link: `${typeof location !== 'undefined' ? location.origin : ''}/join/${code}`,
      maxUses,
      uses: 0,
      expiresAt: now() + hours * 36e5,
      createdAt: now(),
      createdBy: user?.id ?? '',
      status: 'active',
    };
  };

  return {
    mock: true,
    setToken() {},
    async authStart(body) {
      const phone = body.phone ? normalizePhone(body.phone) : null;
      const email = body.email ? normalizeEmail(body.email) : null;
      if (!phone && !email) throw new AccountApiError('invalid_request', 400);
      const channel = phone ? 'phone' : 'email';
      const to = maskContact(channel, (phone ?? email)!);
      const challengeId = id('ch');
      challenges.set(challengeId, { name: body.name, to, channel });
      return {
        challengeId,
        channel,
        to,
        expiresAt: now() + 10 * 6e4,
        resendAfter: now() + 30_000,
        devCode: MOCK_CODE,
      };
    },
    async authResend(challengeId) {
      const c = challenges.get(challengeId);
      if (!c) throw new AccountApiError('not_found', 404);
      return {
        challengeId,
        channel: c.channel,
        to: c.to,
        expiresAt: now() + 10 * 6e4,
        resendAfter: now() + 30_000,
        devCode: MOCK_CODE,
      };
    },
    async authVerify(challengeId, code) {
      const c = challenges.get(challengeId);
      if (!c) throw new AccountApiError('code_expired', 410);
      if (code.trim() !== MOCK_CODE)
        throw new AccountApiError('code_invalid', 400, { triesLeft: 4 });
      user = {
        id: 'u_mock0000001',
        name: c.name?.trim() || 'Student',
        contactHint: c.to,
        createdAt: now(),
      };
      return { ...session(), created: true };
    },
    async logout() {
      user = null;
      squads = [];
      active = null;
    },
    async refreshSession() {
      return session();
    },
    async me(): Promise<Me> {
      const u = requireUser();
      return { user: u, squads: squads.map(summary), activeSquadId: active };
    },
    async patchMe(name) {
      user = { ...requireUser(), name };
      return user;
    },
    async exportMe() {
      const u = requireUser();
      return new Blob(
        [
          JSON.stringify(
            { profile: { id: u.id, name: u.name }, memberships: squads.map(summary) },
            null,
            2,
          ),
        ],
        {
          type: 'application/json',
        },
      );
    },
    async deleteMe() {
      user = null;
      squads = [];
      active = null;
    },
    async devLoginAvailable() {
      return false;
    },
    async listSquads() {
      requireUser();
      return { squads: squads.map(summary), activeSquadId: active };
    },
    async createSquad(body) {
      const u = requireUser();
      const s: MockSquad = {
        id: id('sq'),
        name: body.name,
        course: body.course?.trim() || null,
        createdAt: now(),
        members: [{ userId: u.id, role: 'owner', joinedAt: now() }],
        invites: [],
      };
      squads.push(s);
      active = s.id;
      return detail(s);
    },
    async getSquad(sid) {
      requireUser();
      return detail(mine(sid));
    },
    async patchSquad(sid, body) {
      const s = mine(sid);
      if (roleOf(s) !== 'owner') throw new AccountApiError('forbidden', 403);
      if (body.name !== undefined) s.name = body.name;
      if (body.course !== undefined) s.course = body.course?.trim() || null;
      return detail(s);
    },
    async activateSquad(sid) {
      mine(sid);
      active = sid;
      return sid;
    },
    async leaveSquad(sid) {
      const u = requireUser();
      const s = mine(sid);
      s.members = s.members.filter((m) => m.userId !== u.id);
      squads = squads.filter((x) => x.members.length > 0);
      if (active === sid) active = squads[0]?.id ?? null;
    },
    async removeMember(sid, uid) {
      const s = mine(sid);
      if (roleOf(s) !== 'owner') throw new AccountApiError('forbidden', 403);
      s.members = s.members.filter((m) => m.userId !== uid);
    },
    async setRole(sid, uid, role) {
      const s = mine(sid);
      if (roleOf(s) !== 'owner') throw new AccountApiError('forbidden', 403);
      const m = s.members.find((x) => x.userId === uid);
      if (!m) throw new AccountApiError('not_found', 404);
      if (role === 'member' && s.members.filter((x) => x.role === 'owner').length < 2)
        throw new AccountApiError('last_owner', 409);
      m.role = role;
    },
    async deleteSquad(sid, name) {
      const s = mine(sid);
      if (roleOf(s) !== 'owner') throw new AccountApiError('forbidden', 403);
      if (name !== s.name) throw new AccountApiError('invalid_request', 400);
      squads = squads.filter((x) => x.id !== sid);
      if (active === sid) active = squads[0]?.id ?? null;
    },
    async listInvites(sid) {
      return mine(sid).invites;
    },
    async createInvite(sid, body = {}) {
      const s = mine(sid);
      if (roleOf(s) !== 'owner') throw new AccountApiError('forbidden', 403);
      const inv = invite(s, body.maxUses ?? null, body.expiresInHours ?? 168);
      s.invites.unshift(inv);
      return inv;
    },
    async revokeInvite(sid, iid) {
      const s = mine(sid);
      s.invites = s.invites.map((i) => (i.id === iid ? { ...i, status: 'revoked' as const } : i));
    },
    async previewInvite(code): Promise<InvitePreview> {
      const c = normalizeInviteCode(code);
      const own = squads
        .flatMap((s) => s.invites.map((i) => ({ s, i })))
        .find(({ i }) => normalizeInviteCode(i.code) === c);
      if (own) {
        if (own.i.status === 'revoked') throw new AccountApiError('invite_revoked', 410);
        return {
          squadName: own.s.name,
          course: own.s.course,
          invitedBy: user?.name ?? 'A classmate',
          memberCount: count(own.s),
          full: false,
        };
      }
      if (c === '22222222') throw new AccountApiError('invite_expired', 410);
      if (c === '33333333') throw new AccountApiError('invite_revoked', 410);
      if (c === '44444444') throw new AccountApiError('invite_used_up', 410);
      if (c === '55555555')
        return {
          squadName: 'Algorithms night owls',
          course: 'CSE 310',
          invitedBy: 'Maya',
          memberCount: 12,
          full: true,
        };
      if (c === '66666666') throw new AccountApiError('invite_invalid', 404);
      if (c === 'ABCDEFGH' || c === '77777777')
        return {
          squadName: 'Algorithms night owls',
          course: 'CSE 310',
          invitedBy: 'Maya',
          memberCount: 5,
          full: false,
        };
      throw new AccountApiError('invite_invalid', 404);
    },
    async joinInvite(code) {
      requireUser();
      const c = normalizeInviteCode(code);
      await this.previewInvite(c);
      const s: MockSquad = {
        id: id('sq'),
        name: 'Algorithms night owls',
        course: 'CSE 310',
        createdAt: now(),
        members: [
          { userId: 'u_maya', role: 'owner', joinedAt: now() - 864e5 },
          { userId: user!.id, role: 'member', joinedAt: now() },
        ],
        invites: [],
      };
      squads.push(s);
      active = s.id;
      return { squad: detail(s), activeSquadId: s.id };
    },
  };
}
