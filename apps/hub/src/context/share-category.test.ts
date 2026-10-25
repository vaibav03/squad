import { describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES } from '@squad/brain';
import { createHub } from '../app';
import { signToken } from '../auth';

const SECRET = 'share-cat-secret-0123456789abcdef';
const T0 = Date.UTC(2026, 10, 3, 9);

describe('sharing categories over the Canvas demo + Google demo', () => {
  it('Canvas files/modules/pages/announcements are Courses, Drive is Google only (6), counts agree with rows', async () => {
    const hub = createHub({
      config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
      now: () => T0,
    });
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await hub.app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub: 's_ana', ttlMs: 60_000 }, T0).token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return (await res.json()) as any;
    };
    await call('POST', '/v1/connections', {
      provider: 'canvas',
      variant: 'demo',
      scopes: ['canvas.demo_workspace'],
    });
    await call('POST', '/v1/connections', {
      provider: 'google',
      variant: 'demo',
      scopes: Object.values(GOOGLE_SCOPES),
    });
    const { connections } = await call('GET', '/v1/connections');
    const by = (provider: string) => connections.find((c: any) => c.provider === provider);
    expect(by('canvas').counts.courses).toBe(3);
    expect(by('google').counts.driveDocs).toBe(6);
    const tally = async (id: string) => {
      const { sources } = await call('GET', `/v1/connections/${id}/sources`);
      const t: Record<string, number> = { courses: 0, assignments: 0, calendar: 0, drive: 0 };
      for (const s of sources) t[s.category] = (t[s.category] ?? 0) + 1;
      return t;
    };
    const canvas = await tally(by('canvas').id);
    const google = await tally(by('google').id);
    expect(canvas.drive).toBe(0);
    expect(canvas).toEqual({
      courses: 18 /* 6 modules + 6 pages + 3 files + 3 announcements */,
      assignments: 6,
      calendar: 3,
      drive: 0,
    });
    expect(google.drive).toBe(6);
    expect((google.drive ?? 0) + (canvas.drive ?? 0)).toBe(6);
  });
});
