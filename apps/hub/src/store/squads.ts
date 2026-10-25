import { randomBytes, randomInt } from 'node:crypto';
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  meetsMinGroupSize,
  normalizeInviteCode,
  type AccountErrorCode,
  type Invite,
  type InvitePreview,
  type Member,
  type SquadDetail,
  type SquadRole,
  type SquadSummary,
} from '@squad/core';
import type { Db } from '@squad/core';
import type { Directory } from '../types';
import type { AccountsStore } from './accounts';
import { runMigrations, type Migration } from './migrate';

export const SQUAD_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'squads, members, invites, audit',
    sql: `
CREATE TABLE IF NOT EXISTS squads(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, course TEXT, created_at INTEGER NOT NULL, created_by TEXT);
CREATE TABLE IF NOT EXISTS squad_members(
  squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  role TEXT NOT NULL, joined_at INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(squad_id, user_id));
CREATE INDEX IF NOT EXISTS squad_members_user ON squad_members(user_id);
CREATE TABLE IF NOT EXISTS squad_invites(
  id TEXT PRIMARY KEY, squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS squad_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, squad_id TEXT NOT NULL,
  user_id TEXT, actor_id TEXT, action TEXT NOT NULL, meta TEXT);
CREATE INDEX IF NOT EXISTS squad_audit_squad ON squad_audit(squad_id, ts);`,
  },
];

export type SquadErr = {
  ok: false;
  code: AccountErrorCode | 'no_squad';
  status: 400 | 403 | 404 | 409 | 410 | 429;
  message?: string;
  extra?: Record<string, unknown>;
};
export type Res<T> = ({ ok: true } & T) | SquadErr;
const err = (
  code: SquadErr['code'],
  status: SquadErr['status'],
  message?: string,
  extra?: Record<string, unknown>,
): SquadErr => ({
  ok: false,
  code,
  status,
  ...(message ? { message } : {}),
  ...(extra ? { extra } : {}),
});

export interface SquadsStore {
  create(userId: string, a: { name: string; course?: string }): { squadId: string };
  /** null when the user is not a member (never reveal existence). */
  detail(squadId: string, userId: string): SquadDetail | null;
  list(userId: string, activeId: string | null): SquadSummary[];
  patch(squadId: string, actor: string, p: { name?: string; course?: string | null }): Res<object>;
  isMember(squadId: string, userId: string): boolean;
  roleOf(squadId: string, userId: string): SquadRole | null;
  leave(squadId: string, userId: string): Res<{ disbanded: boolean }>;
  remove(squadId: string, actor: string, target: string): Res<object>;
  setRole(squadId: string, actor: string, target: string, role: SquadRole): Res<object>;
  disband(squadId: string, actor: string, confirm: string): Res<object>;
  createInvite(
    squadId: string,
    actor: string,
    a: { maxUses?: number | null; expiresInHours?: number },
    webBase: string,
  ): Res<{ invite: Invite }>;
  listInvites(squadId: string, userId: string, webBase: string): Invite[] | null;
  revokeInvite(squadId: string, actor: string, inviteId: string): Res<object>;
  preview(code: string): Res<{ preview: InvitePreview }>;
  join(userId: string, code: string): Res<{ squadId: string }>;
  /** Removes the user from every squad (ownership passes on, empty squads are disbanded). Returns disbanded ids. */
  leaveAll(userId: string): string[];
  auditFor(userId: string): { ts: number; squadId: string; action: string }[];
  /** Strips a deleted user's id from audit rows. */
  anonymizeAudit(userId: string): void;
  /** Loads real accounts and squads into the directory (boot, and after a directory reset). */
  hydrate(): void;
  /** Re-mirrors one squad's membership into the directory. */
  sync(squadId: string): void;
  /**
   * Turns a directory-only squad (the seeded demo) into a real one: a squads row and member rows, the first
   * member as owner, so the Members page, invites and roles work for the demo user. Idempotent.
   */
  adopt(squadId: string): void;
  audit(
    squadId: string,
    action: string,
    userId: string | null,
    actor: string | null,
    meta?: object,
  ): void;
}

export interface SquadsOpts {
  now: () => number;
  maxSize: number;
  /** Purges per-squad data (events, trips, settings) when a squad is disbanded. */
  onDisband?: (squadId: string) => void;
  onLog?: (msg: string, f: Record<string, unknown>) => void;
}

const NAME_WS = /\s+/g;

export function createSquadsStore(
  db: Db,
  directory: Directory,
  accounts: AccountsStore,
  o: SquadsOpts,
): SquadsStore {
  runMigrations(db, 'squads', SQUAD_MIGRATIONS);
  const { now } = o;
  const clean = (s: string) => s.trim().replace(NAME_WS, ' ');
  const sid = () => `sq_${randomBytes(6).toString('hex')}`;
  let seq = (
    db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM squad_members').get() as { m: number }
  ).m;

  interface SquadRow {
    id: string;
    name: string;
    course: string | null;
    created_at: number;
    created_by: string | null;
  }
  interface MemRow {
    user_id: string;
    role: SquadRole;
    joined_at: number;
  }
  const squadRow = (id: string) =>
    db.prepare('SELECT * FROM squads WHERE id=?').get(id) as SquadRow | undefined;
  const memRows = (id: string) =>
    db
      .prepare('SELECT user_id, role, joined_at FROM squad_members WHERE squad_id=? ORDER BY seq')
      .all(id) as MemRow[];
  const roleOf = (squadId: string, userId: string): SquadRole | null =>
    (
      db
        .prepare('SELECT role FROM squad_members WHERE squad_id=? AND user_id=?')
        .get(squadId, userId) as { role: SquadRole } | undefined
    )?.role ?? null;

  function audit(
    squadId: string,
    action: string,
    userId: string | null,
    actor: string | null,
    meta?: object,
  ) {
    db.prepare(
      'INSERT INTO squad_audit(ts,squad_id,user_id,actor_id,action,meta) VALUES(?,?,?,?,?,?)',
    ).run(now(), squadId, userId, actor, action, meta ? JSON.stringify(meta) : null);
    o.onLog?.('squad.audit', { squad: squadId, action });
  }

  function sync(squadId: string) {
    const sq = squadRow(squadId);
    if (!sq) return;
    directory.upsertSquad({
      id: sq.id,
      name: sq.name,
      members: memRows(squadId).map((m) => m.user_id),
    });
  }

  function addMember(squadId: string, userId: string, role: SquadRole) {
    db.prepare(
      'INSERT INTO squad_members(squad_id,user_id,role,joined_at,seq) VALUES(?,?,?,?,?)',
    ).run(squadId, userId, role, now(), ++seq);
    sync(squadId);
  }

  function dropSquad(squadId: string) {
    db.prepare('DELETE FROM squads WHERE id=?').run(squadId); // cascades members and invites
    for (const u of directory.members(squadId)) {
      directory.setActiveSquad(u.id, null);
      if (accounts.user(u.id)?.activeSquad === squadId) accounts.setActiveSquad(u.id, null);
    }
    directory.removeSquad(squadId);
    o.onDisband?.(squadId);
  }

  /** Removes one member and repairs ownership. Returns true when the squad ended up empty and was dropped. */
  function removeMember(squadId: string, userId: string): boolean {
    db.prepare('DELETE FROM squad_members WHERE squad_id=? AND user_id=?').run(squadId, userId);
    const left = memRows(squadId);
    if (left.length === 0) {
      audit(squadId, 'disband', null, userId, { reason: 'empty' });
      dropSquad(squadId);
      return true;
    }
    if (!left.some((m) => m.role === 'owner')) {
      const heir = left[0] as MemRow;
      db.prepare("UPDATE squad_members SET role='owner' WHERE squad_id=? AND user_id=?").run(
        squadId,
        heir.user_id,
      );
      audit(squadId, 'role', heir.user_id, userId, { role: 'owner', reason: 'owner_left' });
    }
    // The leaver's own active-squad pointers.
    directory.setActiveSquad(userId, null);
    if (accounts.user(userId)?.activeSquad === squadId) accounts.setActiveSquad(userId, null);
    sync(squadId);
    return false;
  }

  const name = (id: string) => accounts.user(id)?.name ?? directory.student(id)?.name ?? 'Member';

  function inviteStatus(r: InvRow): Invite['status'] {
    if (r.revoked_at !== null) return 'revoked';
    if (r.expires_at <= now()) return 'expired';
    if (r.max_uses !== null && r.uses >= r.max_uses) return 'used_up';
    return 'active';
  }
  interface InvRow {
    id: string;
    squad_id: string;
    code: string;
    max_uses: number | null;
    uses: number;
    expires_at: number;
    created_at: number;
    created_by: string;
    revoked_at: number | null;
  }
  const toInvite = (r: InvRow, base: string): Invite => ({
    id: r.id,
    code: formatInviteCode(r.code),
    link: `${base}/join/${formatInviteCode(r.code)}`,
    maxUses: r.max_uses,
    uses: r.uses,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    createdBy: name(r.created_by),
    status: inviteStatus(r),
  });
  const newCode = () =>
    Array.from(
      { length: INVITE_CODE_LENGTH },
      () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)],
    ).join('');

  const memberCount = (squadId: string) => {
    const n = directory.squad(squadId)?.members.length ?? 0;
    return meetsMinGroupSize(n) ? n : null;
  };

  const store: SquadsStore = {
    audit,
    sync,
    hydrate() {
      for (const u of accounts.users()) {
        directory.upsertStudent({
          id: u.id,
          name: u.name,
          handle: u.hint,
          ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
          ...(u.personaId ? { personaId: u.personaId } : {}),
        });
        if (u.activeSquad) directory.setActiveSquad(u.id, u.activeSquad);
      }
      for (const s of db.prepare('SELECT id FROM squads').all() as { id: string }[]) sync(s.id);
    },
    create(userId, a) {
      const id = sid();
      db.prepare('INSERT INTO squads(id,name,course,created_at,created_by) VALUES(?,?,?,?,?)').run(
        id,
        clean(a.name),
        a.course ? clean(a.course) : null,
        now(),
        userId,
      );
      addMember(id, userId, 'owner');
      audit(id, 'create', userId, userId);
      return { squadId: id };
    },
    detail(squadId, userId) {
      const sq = squadRow(squadId);
      if (!sq) {
        // Directory-only squads (the seeded demo) are read-only members-only views.
        const d = directory.squad(squadId);
        if (!d || !d.members.includes(userId)) return null;
        return {
          id: d.id,
          name: d.name,
          course: null,
          role: 'member',
          memberCount: memberCount(d.id),
          maxSize: o.maxSize,
          members: directory.members(d.id).map((m, i) => ({
            id: m.id,
            name: m.name,
            ...(m.avatarUrl ? { avatarUrl: m.avatarUrl } : {}),
            role: i === 0 ? 'owner' : 'member',
            joinedAt: 0,
            you: m.id === userId,
          })),
          createdAt: 0,
        };
      }
      const rows = memRows(squadId);
      const mine = rows.find((m) => m.user_id === userId);
      if (!mine) return null;
      const members: Member[] = rows.map((m) => {
        const st = directory.student(m.user_id);
        return {
          id: m.user_id,
          name: name(m.user_id),
          ...(st?.avatarUrl ? { avatarUrl: st.avatarUrl } : {}),
          role: m.role,
          joinedAt: m.joined_at,
          you: m.user_id === userId,
        };
      });
      return {
        id: sq.id,
        name: sq.name,
        course: sq.course,
        role: mine.role,
        memberCount: memberCount(sq.id),
        maxSize: o.maxSize,
        members,
        createdAt: sq.created_at,
      };
    },
    list(userId, activeId) {
      return directory
        .squadsOf(userId)
        .map((id): SquadSummary | null => {
          const row = squadRow(id);
          const d = directory.squad(id);
          if (!d) return null;
          return {
            id,
            name: d.name,
            course: row?.course ?? null,
            role: row ? (roleOf(id, userId) ?? 'member') : 'member',
            memberCount: memberCount(id),
            active: id === activeId,
            ...(row ? {} : { demo: true }),
          };
        })
        .filter((x): x is SquadSummary => x !== null);
    },
    adopt(squadId) {
      if (squadRow(squadId)) return;
      const d = directory.squad(squadId);
      if (!d || d.members.length === 0) return;
      db.transaction(() => {
        db.prepare(
          'INSERT INTO squads(id,name,course,created_at,created_by) VALUES(?,?,?,?,?)',
        ).run(d.id, d.name, null, now(), d.members[0]!);
        d.members.forEach((id, i) => addMember(d.id, id, i === 0 ? 'owner' : 'member'));
        audit(d.id, 'create', d.members[0]!, d.members[0]!, { adopted: true });
      })();
    },
    isMember: (squadId, userId) => directory.squad(squadId)?.members.includes(userId) ?? false,
    roleOf,
    patch(squadId, actor, p) {
      if (!squadRow(squadId)) return err('not_found', 404);
      if (roleOf(squadId, actor) !== 'owner')
        return err('forbidden', 403, 'Only an owner can change this.');
      if (p.name !== undefined)
        db.prepare('UPDATE squads SET name=? WHERE id=?').run(clean(p.name), squadId);
      if (p.course !== undefined)
        db.prepare('UPDATE squads SET course=? WHERE id=?').run(
          p.course ? clean(p.course) : null,
          squadId,
        );
      audit(squadId, 'rename', null, actor);
      sync(squadId);
      return { ok: true };
    },
    leave(squadId, userId) {
      if (!squadRow(squadId))
        return err(
          directory.squad(squadId) ? 'forbidden' : 'not_found',
          directory.squad(squadId) ? 403 : 404,
        );
      if (roleOf(squadId, userId) === null) return err('not_found', 404);
      audit(squadId, 'leave', userId, userId);
      const disbanded = removeMember(squadId, userId);
      return { ok: true, disbanded };
    },
    remove(squadId, actor, target) {
      if (!squadRow(squadId) || roleOf(squadId, actor) === null) return err('not_found', 404);
      if (roleOf(squadId, actor) !== 'owner')
        return err('forbidden', 403, 'Only an owner can remove people.');
      if (target === actor) return err('invalid_request', 400, 'Use leave to leave a squad.');
      if (roleOf(squadId, target) === null) return err('not_found', 404);
      audit(squadId, 'remove', target, actor);
      removeMember(squadId, target);
      return { ok: true };
    },
    setRole(squadId, actor, target, role) {
      if (!squadRow(squadId) || roleOf(squadId, actor) === null) return err('not_found', 404);
      if (roleOf(squadId, actor) !== 'owner')
        return err('forbidden', 403, 'Only an owner can change roles.');
      if (roleOf(squadId, target) === null) return err('not_found', 404);
      if (role === 'member') {
        const owners = memRows(squadId).filter((m) => m.role === 'owner');
        if (owners.length === 1 && owners[0]?.user_id === target)
          return err('last_owner', 409, 'Make someone else an owner first.');
      }
      db.prepare('UPDATE squad_members SET role=? WHERE squad_id=? AND user_id=?').run(
        role,
        squadId,
        target,
      );
      audit(squadId, 'role', target, actor, { role });
      return { ok: true };
    },
    disband(squadId, actor, confirm) {
      const sq = squadRow(squadId);
      if (!sq || roleOf(squadId, actor) === null) return err('not_found', 404);
      if (roleOf(squadId, actor) !== 'owner')
        return err('forbidden', 403, 'Only an owner can delete a squad.');
      if (clean(confirm) !== sq.name)
        return err('invalid_request', 400, 'Type the squad name to confirm.');
      audit(squadId, 'disband', null, actor, { reason: 'owner' });
      dropSquad(squadId);
      return { ok: true };
    },
    createInvite(squadId, actor, a, webBase) {
      if (!squadRow(squadId) || roleOf(squadId, actor) === null) return err('not_found', 404);
      if (roleOf(squadId, actor) !== 'owner')
        return err('forbidden', 403, 'Only an owner can create invites.');
      const t = now();
      const id = `iv_${randomBytes(6).toString('hex')}`;
      let code = newCode();
      for (
        let i = 0;
        i < 5 && db.prepare('SELECT 1 FROM squad_invites WHERE code=?').get(code);
        i++
      )
        code = newCode();
      db.prepare(
        'INSERT INTO squad_invites(id,squad_id,code,max_uses,uses,expires_at,created_at,created_by) VALUES(?,?,?,?,0,?,?,?)',
      ).run(
        id,
        squadId,
        code,
        a.maxUses ?? null,
        t + (a.expiresInHours ?? 168) * 3_600_000,
        t,
        actor,
      );
      audit(squadId, 'invite_create', null, actor, { maxUses: a.maxUses ?? null });
      return {
        ok: true,
        invite: toInvite(
          db.prepare('SELECT * FROM squad_invites WHERE id=?').get(id) as InvRow,
          webBase,
        ),
      };
    },
    listInvites(squadId, userId, webBase) {
      if (!squadRow(squadId) || roleOf(squadId, userId) === null) return null;
      const rows = db
        .prepare('SELECT * FROM squad_invites WHERE squad_id=? ORDER BY created_at DESC')
        .all(squadId) as InvRow[];
      const list = rows.map((r) => toInvite(r, webBase));
      return [
        ...list.filter((i) => i.status === 'active'),
        ...list.filter((i) => i.status !== 'active'),
      ];
    },
    revokeInvite(squadId, actor, inviteId) {
      if (!squadRow(squadId) || roleOf(squadId, actor) === null) return err('not_found', 404);
      if (roleOf(squadId, actor) !== 'owner')
        return err('forbidden', 403, 'Only an owner can revoke invites.');
      const r = db
        .prepare(
          'UPDATE squad_invites SET revoked_at=? WHERE id=? AND squad_id=? AND revoked_at IS NULL',
        )
        .run(now(), inviteId, squadId);
      if (r.changes === 0) return err('not_found', 404);
      audit(squadId, 'invite_revoke', null, actor);
      return { ok: true };
    },
    preview(code) {
      const r = db
        .prepare('SELECT * FROM squad_invites WHERE code=?')
        .get(normalizeInviteCode(code)) as InvRow | undefined;
      if (!r) return err('invite_invalid', 404, 'That code does not match any squad.');
      const st = inviteStatus(r);
      if (st === 'revoked') return err('invite_revoked', 410, 'This invite was cancelled.');
      if (st === 'expired') return err('invite_expired', 410, 'This invite has expired.');
      if (st === 'used_up') return err('invite_used_up', 410, 'This invite was already used.');
      const sq = squadRow(r.squad_id) as SquadRow;
      return {
        ok: true,
        preview: {
          squadName: sq.name,
          course: sq.course,
          invitedBy: name(r.created_by),
          memberCount: memberCount(sq.id),
          full: memRows(sq.id).length >= o.maxSize,
        },
      };
    },
    join(userId, code) {
      const c = normalizeInviteCode(code);
      return db.transaction((): Res<{ squadId: string }> => {
        const r = db.prepare('SELECT * FROM squad_invites WHERE code=?').get(c) as
          InvRow | undefined;
        if (!r) return err('invite_invalid', 404, 'That code does not match any squad.');
        const st = inviteStatus(r);
        if (st === 'revoked') return err('invite_revoked', 410, 'This invite was cancelled.');
        if (st === 'expired') return err('invite_expired', 410, 'This invite has expired.');
        if (st === 'used_up') return err('invite_used_up', 410, 'This invite was already used.');
        if (roleOf(r.squad_id, userId) !== null)
          return err('already_member', 409, 'You are already in this squad.', {
            squadId: r.squad_id,
          });
        if (memRows(r.squad_id).length >= o.maxSize)
          return err('squad_full', 409, 'This squad is full.');
        db.prepare('UPDATE squad_invites SET uses=uses+1 WHERE id=?').run(r.id);
        addMember(r.squad_id, userId, 'member');
        audit(r.squad_id, 'join', userId, userId, { invite: r.id });
        return { ok: true, squadId: r.squad_id };
      })();
    },
    leaveAll(userId) {
      const gone: string[] = [];
      for (const id of directory.squadsOf(userId)) {
        if (!squadRow(id)) continue; // demo squad: membership belongs to the seed
        audit(id, 'leave', userId, userId, { reason: 'account_deleted' });
        if (removeMember(id, userId)) gone.push(id);
      }
      return gone;
    },
    auditFor(userId) {
      return (
        db
          .prepare(
            'SELECT ts, squad_id, action FROM squad_audit WHERE user_id=? OR actor_id=? ORDER BY ts',
          )
          .all(userId, userId) as {
          ts: number;
          squad_id: string;
          action: string;
        }[]
      ).map((r) => ({ ts: r.ts, squadId: r.squad_id, action: r.action }));
    },
    anonymizeAudit(userId) {
      db.prepare('UPDATE squad_audit SET user_id=NULL WHERE user_id=?').run(userId);
      db.prepare('UPDATE squad_audit SET actor_id=NULL WHERE actor_id=?').run(userId);
    },
  };
  return store;
}
