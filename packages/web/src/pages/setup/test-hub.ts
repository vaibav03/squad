import { vi } from 'vitest';

export const HUB = 'http://hub.test';

export const googleFixture = (over: object = {}) => ({
  id: 'g1',
  provider: 'google',
  mode: 'fixture',
  status: 'live',
  state: 'fixture',
  lastSyncAt: 1_700_000_000_000,
  scopes: [],
  sources: { total: 5, byKind: { classroom_course: 1, gcal_event: 4 } },
  sharedWithSquads: [],
  ...over,
});

/** A stateful stand-in for the hub API (the same endpoints the real client calls). `connections` is the server state. */
export function fakeHub(initial: Record<string, unknown> = {}) {
  const hub = {
    connections: [] as object[],
    answers: {
      '/v1/imessage/status': { enabled: false, mode: 'off', killSwitch: true, squads: [] },
      '/v1/imessage/setup': {
        provider: 'sendblue',
        missingEnv: ['SENDBLUE_API_KEY', 'SENDBLUE_API_SECRET'],
      },
      '/v1/imessage/link': { links: [] },
      '/v1/library/courses': { courses: [] },
      '/v1/squad/calendar': { ics: false },
      '/v1/me': { user: { id: 'u' }, projector: true },
      '/v1/council/runs?limit=5': { runs: [] },
      '/v1/plans/current': { plan: null },
      '/v1/chat/chats': { chats: [] },
      '/v1/trips/current': { trip: null },
      ...initial,
    } as Record<string, unknown>,
    calls: [] as string[],
    connectGoogleFixture() {
      hub.connections = [...hub.connections, googleFixture()];
    },
    install() {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          const path = url.replace(HUB, '');
          const method = init?.method ?? 'GET';
          const json = (b: unknown, status = 200) =>
            Promise.resolve(new Response(JSON.stringify(b), { status }));
          if (path === '/health') return json({ ok: true });
          hub.calls.push(`${method} ${path}`);
          if (path === '/v1/connections') return json({ connections: hub.connections });
          const del = /^\/v1\/connections\/([^/?]+)/.exec(path);
          if (method === 'DELETE' && del) {
            hub.connections = hub.connections.filter((c) => (c as { id: string }).id !== del[1]);
            return json({ removed: true });
          }
          const a = hub.answers[path];
          if (a === 'hang') return new Promise(() => {});
          if (a instanceof Error) return Promise.reject(a);
          return a === undefined ? json({}, 404) : json(a);
        }),
      );
    },
  };
  return hub;
}
