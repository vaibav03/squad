import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningHub } from '../../src/server';
import { boot, get, login, post } from '../helpers';

let hub: RunningHub;
let ana: string;
let ben: string;
beforeAll(async () => {
  hub = await boot();
  ana = await login(hub.url, 's_ana');
  ben = await login(hub.url, 's_ben');
});
afterAll(async () => {
  await hub.stop();
});

// The Members page loads /v1/squads/:id (members, roles) and /v1/squads/:id/invites (invite link) for the active
// squad. For the dev-login demo user that squad is the seeded sq_demo, which used to exist only in the
// directory, so the invites call returned 404 and the page said "Something went wrong".
describe('demo user on the Members page', () => {
  it('s_ana owns the demo squad: members, roles and an invite link all load', async () => {
    const me = await get<{ activeSquadId: string; squads: { id: string; role: string }[] }>(
      hub.url,
      '/v1/me',
      ana,
    );
    expect(me.body.activeSquadId).toBe('sq_demo');
    expect(me.body.squads[0]).toMatchObject({ id: 'sq_demo', role: 'owner' });

    const d = await get<{ squad: { role: string; members: { id: string; role: string }[] } }>(
      hub.url,
      '/v1/squads/sq_demo',
      ana,
    );
    expect(d.status).toBe(200);
    const detail = (d.body as { squad?: unknown }).squad ?? d.body;
    const sq = detail as { role: string; members: { id: string; role: string; you?: boolean }[] };
    expect(sq.role).toBe('owner');
    expect(sq.members.length).toBeGreaterThanOrEqual(3);
    expect(sq.members.find((m) => m.id === 's_ana')?.role).toBe('owner');
    expect(sq.members.filter((m) => m.role === 'member').length).toBe(sq.members.length - 1);

    const list = await get<{ invites: unknown[] }>(hub.url, '/v1/squads/sq_demo/invites', ana);
    expect(list.status).toBe(200);
    const made = await post<{ invite: { link: string; code: string; status: string } }>(
      hub.url,
      '/v1/squads/sq_demo/invites',
      {},
      ana,
    );
    expect(made.status).toBe(201);
    expect(made.body.invite.link).toContain(made.body.invite.code);
    const after = await get<{ invites: { code: string }[] }>(
      hub.url,
      '/v1/squads/sq_demo/invites',
      ana,
    );
    expect(after.body.invites.map((i) => i.code)).toContain(made.body.invite.code);
  });

  it('a non-owner member can see the squad but not its invites', async () => {
    const d = await get(hub.url, '/v1/squads/sq_demo', ben);
    expect(d.status).toBe(200);
    const made = await post(hub.url, '/v1/squads/sq_demo/invites', {}, ben);
    expect(made.status).toBe(403);
  });
});
