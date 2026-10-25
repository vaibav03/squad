// The HTTP contract the gate assumes for features that are not on main yet. ONE place to edit when a branch lands
// with different names: change the route here, the steps follow. Documented in docs/qa/RELEASE-GATE.md ("Contract").
export const ROUTES = {
  status: '/v1/status',
  connections: '/v1/connections', // GET -> { connections: [{ provider, state, hint?, scopes?, lastSyncedAt? }] }
  connectCanvas: '/v1/connect/canvas', // POST { feedUrl } -> { connection }
  connectGoogleStart: '/v1/connect/google/start', // GET -> 302 | { url } to the consent URL
  connectGoogleCallback: '/v1/connect/google/callback', // GET ?code&state (hub owns the redirect)
  connectGooglePicked: '/v1/connect/google/picked', // POST { fileIds } after the Picker
  connectionDelete: (provider: string) => `/v1/connections/${provider}`, // DELETE: revoke + delete items
  contextSync: '/v1/context/sync', // POST { provider? } -> { synced }
  contextItems: (squadId?: string) => `/v1/context/items${squadId ? `?squadId=${squadId}` : ''}`, // GET -> { items }
  contextSharing: (squadId: string) => `/v1/squads/${squadId}/context-sharing`, // PUT { calendar, assignments, files }
  retrieve: '/v1/context/retrieve', // POST { squadId, query } -> { items, citations }
  tripsCreate: '/v1/trips', // POST { squadId, title, window }
  trip: (id: string) => `/v1/trips/${id}`,
  tripVote: (id: string) => `/v1/trips/${id}/vote`,
  tripConfirm: (id: string) => `/v1/trips/${id}/confirm`,
  plansCreate: '/v1/plans', // POST { squadId, courseId, examAt }
  plan: (id: string) => `/v1/plans/${id}`,
  planAccept: (id: string) => `/v1/plans/${id}/accept`,
  planEdit: (id: string) => `/v1/plans/${id}`, // PATCH { baseRev, ...fields } -> 409 on same-field conflict
} as const;

export const SOURCE_KINDS = ['canvas', 'google-calendar', 'drive', 'classroom'] as const;
export const MINIMAL_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/drive.file',
];
export const state = (c: any): string => String(c?.state ?? c?.status ?? c ?? '');
