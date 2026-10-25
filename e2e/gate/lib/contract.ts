// The hub HTTP contract the gate asserts. ALIGNED TO THE REAL FEATURE (feature/nook-parity on top of
// feature/context-store): apps/hub/src/routes/connections.ts, docs/context-store.md, docs/nook-parity.md.
// ONE place to edit when a route changes: change it here, the steps follow.
//
// HOW THE HUB IS POINTED AT UPSTREAMS: gate-hub.ts installs a fetch seam that sends the Google hosts to the fake Google
// (`${GOOGLE}/__h/<host>/<path>`) and https://canvas.fixture.invalid to the fake Canvas, and stack.ts sets fake
// GOOGLE_OAUTH_CLIENT_ID/SECRET, so the hub runs its REAL Google (PKCE, state, token exchange, refresh, revoke) and Canvas
// (token variant) connector code. Upstream misbehaviour is driven through the fakes' HTTP controls (fakes/client.ts).

export const ROUTES = {
  status: '/v1/status',

  // --- connections (feature/context-store + nook-parity)
  /** GET -> { mode, allowedScopes: {google[], canvas[]}, connections: ConnectionView[] }; POST {provider, variant?, scopes, ...} -> 201 { connection, sync } */
  connections: '/v1/connections',
  /** DELETE -> { status:'revoked', purged:{sources,chunks} }; DELETE ?remove=1 on a revoked one -> { removed:true } */
  connection: (id: string) => `/v1/connections/${id}`,
  /** GET -> { sources: SourceView[] } (owner only) */
  connectionSources: (id: string) => `/v1/connections/${id}/sources`,
  /** POST -> { connection, sync: SyncReport } (409 connection_revoked | connection_expired) */
  connectionSync: (id: string) => `/v1/connections/${id}/sync`,
  /** POST { squadId, all?: boolean, sourceIds?: string[], shared?: boolean } -> { shared, squadId, count }; `all` never includes calendar kinds */
  connectionShare: (id: string) => `/v1/connections/${id}/share`,

  // --- retrieval + citation source viewer
  /** GET ?q=&limit=&kind=&courseId= (+ header x-squad-id) -> { mode, results: RetrievedChunk[] & {provenance} } */
  contextSearch: '/v1/context/search',
  /** GET ?id=&kind=&anchor=&quote= -> ExternalSourceExcerpt | { ok:false, reason } (404 not_found for non-readable) */
  contextSource: '/v1/context/source',

  // --- Google OAuth (Nook shape)
  /** GET ?picked=a,b&return_to=/relative&login_hint= -> { authorization_url, mode:'fixture'|'live', scopes[] } */
  googleAuthorize: '/v1/connections/google/authorize',
  /** the labelled simulator page that authorization_url points at while no OAuth client is configured */
  googleSimConsent: '/v1/connections/google/sim-consent',
  /** GET ?state=&code= -> 302 to HUB_WEB_URL<return_to>?provider=google&status=connected|error&mode=fixture */
  googleCallback: '/oauth/google/callback',

  // --- Canvas browser-session (extension) path
  canvasRegister: '/v1/connections/canvas/register', // POST { canvas_user_id, canvas_origin } -> 201|200 { connection, created } | 409 canvas_account_already_bound
  canvasSync: (id: string) => `/v1/connections/${id}/canvas-sync`, // POST CanvasPayload -> { ok, report, connection } | 409 canvas_session_mismatch | 422
  canvasReport: (id: string) => `/v1/connections/${id}/canvas-report`, // POST { outcome: expired|rate_limited|error }
  canvasAssignments: '/v1/context/canvas/assignments', // GET -> { data: [{ id, source, course_id, name, due_at, html_url }] }
  canvasFiles: '/v1/context/canvas/files', // GET ?type=ppt|pdf -> { data: [...] }

  // --- routes owned by other branches (used by s04-s07; not part of S1-S3)
  /** @deprecated there is no POST /v1/context/retrieve: use contextSearch (GET ?q=) via flows.searchContext(). */
  retrieve: '/v1/context/search',
  tripsCreate: '/v1/trips', // POST { squadId, title, window }
  trip: (id: string) => `/v1/trips/${id}`,
  tripVote: (id: string) => `/v1/trips/${id}/vote`,
  tripConfirm: (id: string) => `/v1/trips/${id}/confirm`,
  plansCreate: '/v1/plans', // POST { squadId, courseId, examAt }
  plan: (id: string) => `/v1/plans/${id}`,
  planAccept: (id: string) => `/v1/plans/${id}/accept`,
  planEdit: (id: string) => `/v1/plans/${id}`, // PATCH { baseRev, ...fields } -> 409 on same-field conflict
} as const;

/**
 * Environment the gate hub needs for connectors (stack.ts spreads it and sets the fake OAuth client itself).
 * CONTEXT_TOKEN_KEY: 32 bytes as 64 hex chars (AES-256-GCM key for ctx_tokens; a gate-only value, not a secret).
 */
export const CONNECTOR_ENV: Record<string, string> = {
  CONTEXT_TOKEN_KEY: '5a7e1c3b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c2e4b6d8f0a1c3e5b7d9f1a3c',
};

// ---- scopes: an INDEPENDENT oracle of what the hub declares (ALLOWED_SCOPES in packages/brain connectors/types.ts)
export const GOOGLE_SCOPE = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  drive: 'https://www.googleapis.com/auth/drive.file',
  classroomCourses: 'https://www.googleapis.com/auth/classroom.courses.readonly',
  classroomWork: 'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
} as const;
export const GOOGLE_ALLOWED: string[] = Object.values(GOOGLE_SCOPE);
export const CANVAS_SCOPE = {
  feed: 'canvas.calendar_feed',
  token: 'canvas.api_token.read',
  session: 'canvas.browser_session.read',
} as const;
export const CANVAS_ALLOWED: string[] = Object.values(CANVAS_SCOPE);
/** Anything matching is a bulk or write grant and must never be requested or granted. */
export const FORBIDDEN_SCOPE =
  /\/auth\/(drive|drive\.readonly|drive\.metadata[^\s]*|gmail[^\s]*|calendar|calendar\.events|documents|spreadsheets|presentations|contacts[^\s]*)$|mail\.google\.com/;
/** @deprecated kept for older imports; the real minimal Google set is GOOGLE_ALLOWED. */
export const MINIMAL_GOOGLE_SCOPES = GOOGLE_ALLOWED;

export const SOURCE_KINDS = [
  'canvas_assignment',
  'canvas_file',
  'canvas_event',
  'gdoc',
  'gdrive_file',
  'gcal_event',
  'classroom_item',
] as const;
/** Calendar kinds are never bulk-shared (`share all` skips them). */
export const CALENDAR_KINDS: ReadonlySet<string> = new Set(['gcal_event', 'canvas_event']);

export const CANVAS_FIXTURE_BASE = 'https://canvas.fixture.invalid';

export const NOT_IN_MATERIALS = 'Not in the materials. Ask the TA.';

export const state = (c: any): string => String(c?.state ?? c?.status ?? c ?? '');
