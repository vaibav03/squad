import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryCodeSender } from '../../src/code-sender';
import { startHub, type RunningHub } from '../../src/server';
import { FIXTURE, SECRET, openSse } from '../helpers';

interface Api {
  hub: RunningHub;
  clock: { t: number };
  sender: ReturnType<typeof createMemoryCodeSender>;
  logs: string[];
}
let live: RunningHub[] = [];
afterEach(async () => {
  await Promise.all(live.map((h) => h.stop()));
  live = [];
});

async function boot(over: Record<string, unknown> = {}, seed = false): Promise<Api> {
  const replayDir = mkdtempSync(join(tmpdir(), 'acct-replays-'));
  cpSync(FIXTURE, join(replayDir, 'sample.json'));
  const clock = { t: 1_800_000_000_000 };
  const sender = createMemoryCodeSender();
  const hub = await startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: SECRET,
      authSecret: 'auth-test',
      sessionSecret: 'session-secret-for-tests-0123456789abcdef',
      contactPepper: 'pepper',
      seed,
      sim: false,
      production: false,
      devLogin: true,
      logLevel: 'silent',
      replayDir,
      corsOrigins: ['http://localhost:5180'],
      ...over,
    },
    now: () => clock.t,
    codeSender: sender,
  });
  live.push(hub);
  return { hub, clock, sender, logs: [] };
}

async function call(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json, text, headers: r.headers };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function signUp(api: Api, name: string, phone: string) {
  const url = api.hub.url;
  const s = await call(url, 'POST', '/v1/auth/start', { name, phone });
  expect(s.status).toBe(200);
  const code = api.sender.last()!.code;
  const v = await call(url, 'POST', '/v1/auth/verify', { challengeId: s.json.challengeId, code });
  expect(v.status).toBe(200);
  return {
    token: v.json.token as string,
    id: v.json.user.id as string,
    cookie: (v.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
    body: v.json,
  };
}

describe('sign-up and sessions', () => {
  it('start -> code -> verify creates an account, a session, a cookie and no clear PII', async () => {
    const api = await boot();
    const s = await call(api.hub.url, 'POST', '/v1/auth/start', {
      name: 'Maya',
      phone: '(415) 555-0134',
    });
    expect(s.json.to).toBe('•••• 0134');
    expect(s.json.devCode).toMatch(/^\d{6}$/); // dev login on
    expect(api.sender.last()!.code).toBe(s.json.devCode);
    const me = await signUp(api, 'Maya', '415 555 0134');
    expect(me.body.created).toBe(true);
    const login = await signUp(api, 'Ignored name', '415.555.0134'); // same phone: a login, the name is ignored
    expect(login.id).toBe(me.id);
    expect(login.body.user.name).toBe('Maya');
    expect(login.body.created).toBeUndefined();
    expect(me.cookie).toMatch(/^squad_session=/);
    const full = await call(api.hub.url, 'GET', '/v1/me', undefined, bearer(me.token));
    expect(full.json.user.name).toBe('Maya');
    expect(full.json.squads).toEqual([]);
    expect(full.json.squadId).toBe('');
    // the cookie alone works for the browser
    const viaCookie = await call(api.hub.url, 'GET', '/v1/me', undefined, { cookie: me.cookie });
    expect(viaCookie.status).toBe(200);
    // raw phone digits never reach the database
    const dump = JSON.stringify([
      api.hub.deps.db.prepare('SELECT * FROM acct_users').all(),
      api.hub.deps.db.prepare('SELECT * FROM acct_challenges').all(),
      api.hub.deps.db.prepare('SELECT * FROM hub_students').all(),
    ]);
    expect(dump).not.toContain('4155550134');
    expect(dump).toContain('0134');
  });

  it('a new account needs a name; bad contacts and unknown keys are rejected', async () => {
    const api = await boot();
    expect(
      (await call(api.hub.url, 'POST', '/v1/auth/start', { phone: '4155550134' })).status,
    ).toBe(400);
    expect(
      (await call(api.hub.url, 'POST', '/v1/auth/start', { name: 'X', phone: '12' })).status,
    ).toBe(400);
    expect(
      (
        await call(api.hub.url, 'POST', '/v1/auth/start', {
          name: 'X',
          phone: '4155550134',
          admin: 1,
        })
      ).status,
    ).toBe(400);
  });

  it('wrong codes count down, then lock; expired codes are refused; resend kills the old code', async () => {
    const api = await boot();
    const u = api.hub.url;
    const s = await call(u, 'POST', '/v1/auth/start', { name: 'Ben', phone: '4155550111' });
    const good = api.sender.last()!.code;
    const bad = good === '000000' ? '111111' : '000000';
    const w1 = await call(u, 'POST', '/v1/auth/verify', {
      challengeId: s.json.challengeId,
      code: bad,
    });
    expect(w1.status).toBe(400);
    expect(w1.json.error.code).toBe('code_invalid');
    expect(w1.json.error.triesLeft).toBe(4);
    // resend too early
    expect(
      (await call(u, 'POST', '/v1/auth/resend', { challengeId: s.json.challengeId })).status,
    ).toBe(429);
    api.clock.t += 31_000;
    const r = await call(u, 'POST', '/v1/auth/resend', { challengeId: s.json.challengeId });
    expect(r.status).toBe(200);
    const fresh = api.sender.last()!.code;
    if (fresh !== good)
      expect(
        (await call(u, 'POST', '/v1/auth/verify', { challengeId: s.json.challengeId, code: good }))
          .status,
      ).toBe(400);
    api.clock.t += 11 * 60_000;
    const exp = await call(u, 'POST', '/v1/auth/verify', {
      challengeId: s.json.challengeId,
      code: fresh,
    });
    expect(exp.status).toBe(410);
    expect(exp.json.error.code).toBe('code_expired');

    const s2 = await call(u, 'POST', '/v1/auth/start', { name: 'Ben', phone: '4155550111' });
    const ok = api.sender.last()!.code;
    const wrong = ok === '123456' ? '654321' : '123456';
    let last: any;
    for (let i = 0; i < 5; i++)
      last = await call(u, 'POST', '/v1/auth/verify', {
        challengeId: s2.json.challengeId,
        code: wrong,
      });
    expect(last.json.error.code).toBe('too_many_attempts');
    // even the right code no longer works
    expect(
      (await call(u, 'POST', '/v1/auth/verify', { challengeId: s2.json.challengeId, code: ok }))
        .status,
    ).toBe(429);
  });

  it('start is rate limited per contact', async () => {
    const api = await boot();
    for (let i = 0; i < 5; i++)
      expect(
        (await call(api.hub.url, 'POST', '/v1/auth/start', { name: 'R', phone: '4155550199' }))
          .status,
      ).toBe(200);
    const r = await call(api.hub.url, 'POST', '/v1/auth/start', { name: 'R', phone: '4155550199' });
    expect(r.status).toBe(429);
    expect(r.json.error.retryAfterS).toBeGreaterThan(0);
  });

  it('sessions expire, logout revokes, refresh rotates with a grace window', async () => {
    const api = await boot({ sessionDays: 2 });
    const u = api.hub.url;
    const me = await signUp(api, 'Chi', '4155550122');
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(me.token))).status).toBe(200);

    const rot = await call(u, 'POST', '/v1/auth/refresh', undefined, bearer(me.token));
    expect(rot.status).toBe(200);
    const next = rot.json.token as string;
    expect(next).not.toBe(me.token);
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(next))).status).toBe(200);
    // old token: still fine inside the 60 s grace, dead after it
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(me.token))).status).toBe(200);
    api.clock.t += 61_000;
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(me.token))).status).toBe(401);

    // auto rotation after a day
    api.clock.t += 25 * 3600_000;
    const aged = await call(u, 'GET', '/v1/me', undefined, bearer(next));
    expect(aged.status).toBe(200);
    expect(aged.headers.get('x-squad-token')).toBeTruthy();

    // hard expiry
    api.clock.t += 3 * 86_400_000;
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(next))).status).toBe(401);

    const again = await signUp(api, 'Chi', '4155550122');
    expect(again.id).toBe(me.id);
    const out = await call(u, 'POST', '/v1/auth/logout', undefined, bearer(again.token));
    expect(out.status).toBe(200);
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(again.token))).status).toBe(401);
  });

  it('forged and tampered tokens are refused; cookie writes from a foreign origin are 403', async () => {
    const api = await boot();
    const u = api.hub.url;
    const me = await signUp(api, 'Dev', '4155550133');
    const [body] = me.token.split('.');
    expect((await call(u, 'GET', '/v1/me', undefined, bearer(`${body}.AAAA`))).status).toBe(401);
    const evil = await call(
      u,
      'PATCH',
      '/v1/me',
      { name: 'Hax' },
      { cookie: me.cookie, origin: 'https://evil.example' },
    );
    expect(evil.status).toBe(403);
    const good = await call(
      u,
      'PATCH',
      '/v1/me',
      { name: 'Devi' },
      { cookie: me.cookie, origin: 'http://localhost:5180' },
    );
    expect(good.status).toBe(200);
    expect(good.json.user.name).toBe('Devi');
  });

  it('dev-login works only with HUB_DEV_LOGIN, and devCode is withheld without it', async () => {
    const api = await boot({ devLogin: false }, true);
    expect(
      (await call(api.hub.url, 'POST', '/v1/auth/dev-login', { studentId: 's_ana' })).status,
    ).toBe(403);
    expect((await call(api.hub.url, 'GET', '/v1/auth/students')).status).toBe(404);
    const s = await call(api.hub.url, 'POST', '/v1/auth/start', { name: 'N', phone: '4155550144' });
    expect(s.json.devCode).toBeUndefined();
    const on = await boot({}, true);
    expect(
      (await call(on.hub.url, 'POST', '/v1/auth/dev-login', { studentId: 's_ana' })).status,
    ).toBe(200);
  });
});

describe('squads and invites', () => {
  it('create, single-use invite, join, race, revoke, expiry, full', async () => {
    const api = await boot({ squadMax: 3 });
    const u = api.hub.url;
    const a = await signUp(api, 'Ana', '4155550201');
    const b = await signUp(api, 'Ben', '4155550202');
    const c = await signUp(api, 'Cat', '4155550203');
    const d = await signUp(api, 'Dan', '4155550204');

    const mk = await call(
      u,
      'POST',
      '/v1/squads',
      { name: 'Bio 101 crew', course: 'BIO 101' },
      bearer(a.token),
    );
    expect(mk.status).toBe(201);
    const sq = mk.json.squad.id as string;
    expect(mk.json.squad.role).toBe('owner');
    expect(mk.json.squad.memberCount).toBeNull(); // 1 member: counts hidden

    // members cannot create invites; owner can
    const inv1 = await call(u, 'POST', `/v1/squads/${sq}/invites`, { maxUses: 1 }, bearer(a.token));
    expect(inv1.status).toBe(201);
    expect(inv1.json.invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(inv1.json.invite.link).toContain(`/join/${inv1.json.invite.code}`);

    const pre = await call(u, 'GET', `/v1/invites/${inv1.json.invite.code}`);
    expect(pre.json).toMatchObject({
      squadName: 'Bio 101 crew',
      course: 'BIO 101',
      invitedBy: 'Ana',
      memberCount: null,
      full: false,
    });

    // two people race a single-use code
    const [r1, r2] = await Promise.all([
      call(u, 'POST', '/v1/invites/join', { code: inv1.json.invite.code }, bearer(b.token)),
      call(u, 'POST', '/v1/invites/join', { code: inv1.json.invite.code }, bearer(c.token)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 410]);
    const winner = r1.status === 200 ? b : c;
    const loser = winner === b ? c : b;
    expect(
      (
        await call(
          u,
          'POST',
          '/v1/invites/join',
          { code: inv1.json.invite.code },
          bearer(loser.token),
        )
      ).json.error.code,
    ).toBe('invite_used_up');
    // already a member
    const again = await call(
      u,
      'POST',
      '/v1/invites/join',
      { code: inv1.json.invite.code },
      bearer(winner.token),
    );
    expect(again.json.error.code).toMatch(/invite_used_up|already_member/);

    // multi-use link, revoke, expiry
    const inv2 = (await call(u, 'POST', `/v1/squads/${sq}/invites`, {}, bearer(a.token))).json
      .invite;
    const rev = await call(
      u,
      'DELETE',
      `/v1/squads/${sq}/invites/${inv2.id}`,
      undefined,
      bearer(a.token),
    );
    expect(rev.status).toBe(200);
    expect(
      (await call(u, 'POST', '/v1/invites/join', { code: inv2.code }, bearer(loser.token))).json
        .error.code,
    ).toBe('invite_revoked');
    expect((await call(u, 'GET', `/v1/invites/${inv2.code}`)).status).toBe(410);

    const inv3 = (
      await call(u, 'POST', `/v1/squads/${sq}/invites`, { expiresInHours: 1 }, bearer(a.token))
    ).json.invite;
    api.clock.t += 2 * 3600_000;
    expect(
      (await call(u, 'POST', '/v1/invites/join', { code: inv3.code }, bearer(loser.token))).json
        .error.code,
    ).toBe('invite_expired');

    // fill the squad (max 3) then full
    const inv4 = (await call(u, 'POST', `/v1/squads/${sq}/invites`, {}, bearer(a.token))).json
      .invite;
    expect(
      (await call(u, 'POST', '/v1/invites/join', { code: inv4.code }, bearer(loser.token))).status,
    ).toBe(200);
    const full = await call(u, 'POST', '/v1/invites/join', { code: inv4.code }, bearer(d.token));
    expect(full.status).toBe(409);
    expect(full.json.error.code).toBe('squad_full');

    // unknown code and garbage
    expect(
      (await call(u, 'POST', '/v1/invites/join', { code: 'ZZZZ-ZZZZ' }, bearer(d.token))).json.error
        .code,
    ).toBe('invite_invalid');
    expect(
      (await call(u, 'POST', '/v1/invites/join', { code: 'nope' }, bearer(d.token))).status,
    ).toBe(404);

    // now 3 members: counts visible; the audit log has every join
    const det = await call(u, 'GET', `/v1/squads/${sq}`, undefined, bearer(a.token));
    expect(det.json.squad.memberCount).toBe(3);
    expect(det.json.squad.members.map((m: any) => m.name).sort()).toEqual(['Ana', 'Ben', 'Cat']);
    const joins = api.hub.deps.db
      .prepare("SELECT COUNT(*) AS n FROM squad_audit WHERE action='join'")
      .get() as { n: number };
    expect(joins.n).toBe(2);
    // the invite list is readable by members, not by outsiders (404, not 403)
    expect(
      (await call(u, 'GET', `/v1/squads/${sq}/invites`, undefined, bearer(b.token))).status,
    ).toBe(200);
    expect(
      (await call(u, 'GET', `/v1/squads/${sq}/invites`, undefined, bearer(d.token))).status,
    ).toBe(404);
    expect((await call(u, 'GET', `/v1/squads/${sq}`, undefined, bearer(d.token))).status).toBe(404);
  });

  it('roles: owner-only actions, ownership passes on leave, last member disbands', async () => {
    const api = await boot();
    const u = api.hub.url;
    const a = await signUp(api, 'Ana', '4155550301');
    const b = await signUp(api, 'Ben', '4155550302');
    const sq = (await call(u, 'POST', '/v1/squads', { name: 'Crew' }, bearer(a.token))).json.squad
      .id;
    const inv = (await call(u, 'POST', `/v1/squads/${sq}/invites`, {}, bearer(a.token))).json
      .invite;
    await call(u, 'POST', '/v1/invites/join', { code: inv.code }, bearer(b.token));

    expect(
      (await call(u, 'PATCH', `/v1/squads/${sq}`, { name: 'Nope' }, bearer(b.token))).status,
    ).toBe(403);
    expect((await call(u, 'POST', `/v1/squads/${sq}/invites`, {}, bearer(b.token))).status).toBe(
      403,
    );
    expect(
      (await call(u, 'DELETE', `/v1/squads/${sq}/members/${a.id}`, undefined, bearer(b.token)))
        .status,
    ).toBe(403);
    const ren = await call(
      u,
      'PATCH',
      `/v1/squads/${sq}`,
      { name: 'Crew 2', course: 'CHEM 2' },
      bearer(a.token),
    );
    expect(ren.json.squad).toMatchObject({ name: 'Crew 2', course: 'CHEM 2' });
    expect(api.hub.deps.directory.squad(sq)?.name).toBe('Crew 2');

    // sole owner cannot demote themselves
    expect(
      (
        await call(
          u,
          'POST',
          `/v1/squads/${sq}/members/${a.id}/role`,
          { role: 'member' },
          bearer(a.token),
        )
      ).json.error.code,
    ).toBe('last_owner');
    // owner leaves: Ben inherits
    expect(
      (await call(u, 'POST', `/v1/squads/${sq}/leave`, undefined, bearer(a.token))).status,
    ).toBe(200);
    const det = await call(u, 'GET', `/v1/squads/${sq}`, undefined, bearer(b.token));
    expect(det.json.squad.role).toBe('owner');
    // Ana is out: no access, and her squad list is empty
    expect((await call(u, 'GET', `/v1/squads/${sq}`, undefined, bearer(a.token))).status).toBe(404);
    expect((await call(u, 'GET', '/v1/squads', undefined, bearer(a.token))).json.squads).toEqual(
      [],
    );
    // last member leaves: squad is gone
    const out = await call(u, 'POST', `/v1/squads/${sq}/leave`, undefined, bearer(b.token));
    expect(out.json.disbanded).toBe(true);
    expect(api.hub.deps.directory.squad(sq)).toBeUndefined();
    expect(api.hub.deps.db.prepare('SELECT COUNT(*) AS n FROM squads').get()).toEqual({ n: 0 });
  });

  it('several squads: activate switches the default view, X-Squad-Id overrides per request and is membership checked', async () => {
    const api = await boot();
    const u = api.hub.url;
    const a = await signUp(api, 'Ana', '4155550401');
    const b = await signUp(api, 'Ben', '4155550402');
    const s1 = (await call(u, 'POST', '/v1/squads', { name: 'One' }, bearer(a.token))).json.squad
      .id;
    const s2 = (await call(u, 'POST', '/v1/squads', { name: 'Two' }, bearer(a.token))).json.squad
      .id;
    const sb = (await call(u, 'POST', '/v1/squads', { name: 'Ben only' }, bearer(b.token))).json
      .squad.id;

    const list = await call(u, 'GET', '/v1/squads', undefined, bearer(a.token));
    expect(list.json.activeSquadId).toBe(s2);
    expect(list.json.squads.map((s: any) => s.name).sort()).toEqual(['One', 'Two']);

    expect(
      (await call(u, 'POST', `/v1/squads/${s1}/activate`, undefined, bearer(a.token))).json
        .activeSquadId,
    ).toBe(s1);
    const st = await call(u, 'GET', '/v1/squad/state', undefined, bearer(a.token));
    expect(st.json.squad.id).toBe(s1);
    const over = await call(u, 'GET', '/v1/squad/state', undefined, {
      ...bearer(a.token),
      'x-squad-id': s2,
    });
    expect(over.json.squad.id).toBe(s2);
    const foreign = await call(u, 'GET', '/v1/squad/state', undefined, {
      ...bearer(a.token),
      'x-squad-id': sb,
    });
    expect(foreign.status).toBe(403);
    expect(
      (await call(u, 'POST', `/v1/squads/${sb}/activate`, undefined, bearer(a.token))).status,
    ).toBe(404);
    // a squadless account gets 409, not 401
    const c = await signUp(api, 'Cat', '4155550403');
    expect(
      (await call(u, 'GET', '/v1/squad/state', undefined, bearer(c.token))).json.error.code,
    ).toBe('no_squad');
  });

  it('the active squad survives a restart (sqlite)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acct-db-'));
    const dbPath = join(dir, 'squad.db');
    const api = await boot({ dbPath });
    const a = await signUp(api, 'Ana', '4155550501');
    const sq = (await call(api.hub.url, 'POST', '/v1/squads', { name: 'Keep' }, bearer(a.token)))
      .json.squad.id;
    await api.hub.stop();
    live = live.filter((h) => h !== api.hub);
    const api2 = await boot({ dbPath });
    const me = await call(api2.hub.url, 'GET', '/v1/me', undefined, bearer(a.token));
    expect(me.status).toBe(200);
    expect(me.json.activeSquadId).toBe(sq);
    expect(me.json.squads[0].name).toBe('Keep');
  });
});

describe('minimum group size is real membership', () => {
  it('counts appear only at 3 real members, in snapshot, trips and mastery', async () => {
    const api = await boot();
    const u = api.hub.url;
    const people = [];
    for (let i = 0; i < 3; i++) people.push(await signUp(api, `P${i}`, `415555060${i}`));
    const sq = (await call(u, 'POST', '/v1/squads', { name: 'Trio' }, bearer(people[0]!.token)))
      .json.squad.id;
    const inv = (await call(u, 'POST', `/v1/squads/${sq}/invites`, {}, bearer(people[0]!.token)))
      .json.invite;
    await call(u, 'POST', '/v1/invites/join', { code: inv.code }, bearer(people[1]!.token));
    let st = await call(u, 'GET', '/v1/squad/state', undefined, bearer(people[0]!.token));
    expect(st.json.squad.memberCount).toBeNull();
    const m2 = await call(u, 'GET', '/v1/mastery/demo', undefined, bearer(people[0]!.token));
    expect(m2.json.squadAvg).toBeNull();
    await call(u, 'POST', '/v1/invites/join', { code: inv.code }, bearer(people[2]!.token));
    st = await call(u, 'GET', '/v1/squad/state', undefined, bearer(people[0]!.token));
    expect(st.json.squad.memberCount).toBe(3);
    expect(st.json.squad.members).toHaveLength(3);
    const m3 = await call(u, 'GET', '/v1/mastery/demo', undefined, bearer(people[0]!.token));
    expect(Array.isArray(m3.json.squadAvg)).toBe(true);
  });
});

describe('cross-squad isolation', () => {
  it('a member of squad A can never read squad B stream, ledger, tasks, trips or state', async () => {
    const api = await boot();
    const u = api.hub.url;
    const a = await signUp(api, 'Ana', '4155550701');
    const b = await signUp(api, 'Bea', '4155550702');
    const sqA = (await call(u, 'POST', '/v1/squads', { name: 'Alpha' }, bearer(a.token))).json.squad
      .id;
    const sqB = (await call(u, 'POST', '/v1/squads', { name: 'Bravo' }, bearer(b.token))).json.squad
      .id;
    const SECRET_PUBLIC = 'SENTINEL-PUBLIC-B-9f3c';
    const SECRET_PRIVATE = 'SENTINEL-PRIVATE-B-77d1';
    const emit = (body: unknown) =>
      call(u, 'POST', '/internal/events', body, { 'x-nook-internal': SECRET });
    await emit({
      type: 'x.ledger.private',
      data: {
        taskId: 'task_b',
        student: b.id,
        field: 'budget',
        shared: SECRET_PUBLIC,
        withheld: SECRET_PRIVATE,
        ts: 1,
      },
    });
    await emit({ t: 'agent.state', agent: `student:${b.id}`, state: 'studying' });
    await emit({
      type: 'x.trip.upsert',
      data: {
        tripId: 'trip_b',
        taskId: 'task_trip_b',
        squadId: sqB,
        status: 'voting',
        options: [{ id: 'o1', label: SECRET_PUBLIC }],
        dates: null,
        votes: [],
        vetoed: [],
        confirmations: [{ student: b.id, confirmed: false }],
      },
    });

    // A's stream (opened after, replayed from 0, plus live) must carry nothing from B
    const stA = (await call(u, 'POST', '/v1/squad/stream-token', undefined, bearer(a.token))).json
      .st;
    const sse = await openSse(u, { st: stA, lastEventId: 0 });
    await emit({ t: 'agent.state', agent: `student:${b.id}`, state: 'idle' });
    await emit({ t: 'agent.state', agent: `student:${a.id}`, state: 'studying' });
    await sse.waitFor((f) =>
      f.some((x) => x.event === 'agent.state' && (x.data ?? '').includes(a.id)),
    );
    const wire = JSON.stringify(sse.frames);
    sse.stop();
    expect(wire).not.toContain(b.id);
    expect(wire).not.toContain(SECRET_PUBLIC);
    expect(wire).not.toContain(SECRET_PRIVATE);

    // REST: ledger by guessed task id, tasks, trip, state
    const led = await call(u, 'GET', '/v1/ledger/task_b', undefined, bearer(a.token));
    expect(led.json.entries).toEqual([]);
    expect(led.text).not.toContain(SECRET_PUBLIC);
    expect((await call(u, 'GET', '/v1/trips/trip_b', undefined, bearer(a.token))).status).toBe(404);
    const tasks = await call(u, 'GET', '/v1/tasks', undefined, bearer(a.token));
    expect(tasks.text).not.toContain('task_b');
    const state = await call(u, 'GET', '/v1/squad/state', undefined, bearer(a.token));
    expect(state.text).not.toContain(b.id);
    expect(state.text).not.toContain(SECRET_PUBLIC);
    // B still sees its own public value, and only its own raw withheld value
    const own = await call(u, 'GET', '/v1/ledger/task_b', undefined, bearer(b.token));
    expect(own.json.entries[0].withheld).toBe(SECRET_PRIVATE);
    // A cannot name B's squad in a header, nor read B's detail/members/invites, nor mint a stream token for it
    expect(
      (
        await call(u, 'GET', '/v1/squad/state', undefined, {
          ...bearer(a.token),
          'x-squad-id': sqB,
        })
      ).status,
    ).toBe(403);
    expect((await call(u, 'GET', `/v1/squads/${sqB}`, undefined, bearer(a.token))).status).toBe(
      404,
    );
    expect((await call(u, 'POST', `/v1/squads/${sqB}/invites`, {}, bearer(a.token))).status).toBe(
      404,
    );
    expect(
      (await call(u, 'DELETE', `/v1/squads/${sqB}/members/${b.id}`, undefined, bearer(a.token)))
        .status,
    ).toBe(404);
    expect(
      (await call(u, 'PATCH', `/v1/squads/${sqB}`, { name: 'Pwned' }, bearer(a.token))).status,
    ).toBe(404);
    expect(sqA).not.toBe(sqB);
  });
});

describe('privacy basics: export, deletion, logs', () => {
  it('export holds only the caller own data; deletion cascades; logs never hold the phone', async () => {
    const lines: string[] = [];
    const api = await boot({ logLevel: 'debug' });
    // capture hub logs written to stderr during the test
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (c: any, ...r: any[]) => (lines.push(String(c)), true);
    try {
      const u = api.hub.url;
      const a = await signUp(api, 'Ana', '+1 415 555 0801');
      const b = await signUp(api, 'Ben', '4155550802');
      const sq = (await call(u, 'POST', '/v1/squads', { name: 'Crew' }, bearer(a.token))).json.squad
        .id;
      const inv = (await call(u, 'POST', `/v1/squads/${sq}/invites`, {}, bearer(a.token))).json
        .invite;
      await call(u, 'POST', '/v1/invites/join', { code: inv.code }, bearer(b.token));
      api.hub.deps.db
        .prepare('INSERT INTO hub_busy_blocks(student,start,end,title) VALUES(?,?,?,?)')
        .run(a.id, '2026-01-01T10:00', '2026-01-01T11:00', 'Dentist');
      api.hub.deps.db
        .prepare('INSERT INTO hub_busy_blocks(student,start,end,title) VALUES(?,?,?,?)')
        .run(b.id, '2026-01-01T10:00', '2026-01-01T11:00', 'BenOnly');
      api.hub.deps.ledger.addPrivate({
        taskId: 't1',
        student: a.id,
        field: 'budget',
        shared: 'ok',
        withheld: 'ANA-RAW',
        ts: 1,
      });

      const exp = await call(u, 'GET', '/v1/me/export', undefined, bearer(a.token));
      expect(exp.headers.get('content-disposition')).toContain('attachment');
      expect(exp.text).toContain('Dentist');
      expect(exp.text).toContain('ANA-RAW');
      expect(exp.text).not.toContain('BenOnly');
      expect(exp.text).not.toContain(b.id);
      expect(exp.text).not.toContain('4155550801');
      expect(exp.text).not.toMatch(/contact_hash|contactHash/);

      // wrong confirm phrase is refused
      expect((await call(u, 'DELETE', '/v1/me', { confirm: 'yes' }, bearer(a.token))).status).toBe(
        400,
      );
      const del = await call(
        u,
        'DELETE',
        '/v1/me',
        { confirm: 'delete my account' },
        bearer(a.token),
      );
      expect(del.status).toBe(200);
      expect((await call(u, 'GET', '/v1/me', undefined, bearer(a.token))).status).toBe(401);
      const db = api.hub.deps.db;
      expect(db.prepare('SELECT COUNT(*) AS n FROM acct_users WHERE id=?').get(a.id)).toEqual({
        n: 0,
      });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM acct_sessions WHERE user_id=?').get(a.id),
      ).toEqual({ n: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM hub_busy_blocks WHERE student=?').get(a.id),
      ).toEqual({ n: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM hub_ledger_private WHERE student=?').get(a.id),
      ).toEqual({ n: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM squad_members WHERE user_id=?').get(a.id),
      ).toEqual({ n: 0 });
      expect(
        db
          .prepare('SELECT COUNT(*) AS n FROM squad_audit WHERE user_id=? OR actor_id=?')
          .get(a.id, a.id),
      ).toEqual({ n: 0 });
      expect(api.hub.deps.directory.student(a.id)).toBeUndefined();
      expect(
        api.hub.deps.ledger.entries('t1', { studentId: a.id, squadId: sq, projector: false }),
      ).toEqual([]);
      // Ben inherited the squad and keeps his data
      const bd = await call(u, 'GET', `/v1/squads/${sq}`, undefined, bearer(b.token));
      expect(bd.json.squad.role).toBe('owner');
      expect(bd.json.squad.members.map((m: any) => m.name)).toEqual(['Ben']);
      // she can sign up again as a fresh account
      const again = await signUp(api, 'Ana', '+1 415 555 0801');
      expect(again.id).not.toBe(a.id);
    } finally {
      (process.stderr as any).write = orig;
    }
    const logs = lines.join('');
    expect(logs).not.toMatch(/415\s?555\s?080[12]/);
    expect(logs).not.toContain('4155550801');
    void readFileSync;
  });
});
