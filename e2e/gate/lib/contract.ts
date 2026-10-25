/* eslint-disable @typescript-eslint/no-explicit-any -- the gate reads untyped hub JSON */
// The hub HTTP contract the gate asserts. ALIGNED TO THE REAL FEATURE (feature/nook-parity on top of
// feature/context-store): apps/hub/src/routes/connections.ts, docs/context-store.md, docs/nook-parity.md.
// ONE place to edit when a route changes: change it here, the steps follow.
//
// HOW THE HUB IS POINTED AT UPSTREAMS (verified in apps/hub/src/context/service.ts and
// packages/brain/src/context/connectors/*): there is NO base-URL override. Fixture mode is two IN-PROCESS fake
// connectors (createFakeCanvasConnector / createFakeGoogleConnector) that read
// packages/brain/fixtures/connectors/{canvas,google}.json and the hub's labelled consent simulator
// (GET /v1/connections/google/sim-consent). Google live talks to the hard-coded googleapis.com hosts and only turns on
// when GOOGLE_OAUTH_CLIENT_ID/SECRET are set (which the gate must NEVER do). The HTTP fakes on 8940/8941 are therefore
// not reachable from the hub; upstream misbehaviour (revoke, expiry, refresh failure, feed gone) is driven through the
// gate-hub control server instead (HUB_CTL below), which flips the in-process fake's FakeControls.
import { SENTINELS } from './config';

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
 * Gate-hub control routes (CTL_PORT, loopback). The in-process fakes cannot be reached over the hub's HTTP surface, so
 * the gate-hub entrypoint must expose these (see the report to the lead for the exact snippet):
 *   POST /ctl/ctx/upstream     { provider:'canvas'|'google', behavior:'ok'|'expired'|'revoked'|'unauthorized'|'rate_limited', refreshFails?:boolean }
 *   POST /ctl/ctx/expire-clock { provider?:'google'|'canvas' }  -> sets ctx_connections.expires_at into the past so the next listing runs the refresh path
 *   POST /ctl/ctx/reset        {}                               -> every fake back to behavior 'ok', refreshFails=false
 */
export const HUB_CTL = {
  upstream: '/ctl/ctx/upstream',
  expireClock: '/ctl/ctx/expire-clock',
  reset: '/ctl/ctx/reset',
} as const;

export type UpstreamBehavior = 'ok' | 'expired' | 'revoked' | 'unauthorized' | 'rate_limited';

/**
 * Environment the gate hub needs for connectors. There is intentionally no base-URL variable (the hub has none).
 * CONTEXT_TOKEN_KEY: 32 bytes as 64 hex chars (AES-256-GCM key for ctx_tokens; a gate-only value, not a secret).
 */
export const CONNECTOR_ENV: Record<string, string> = {
  CONTEXT_TOKEN_KEY: '5a7e1c3b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c2e4b6d8f0a1c3e5b7d9f1a3c',
};

/**
 * Names that must be ABSENT from the hub (and every child) environment, even if the developer's shell or .env sets
 * them: with a Google OAuth client configured the hub leaves fixture mode and talks to accounts.google.com.
 * `GOOGLE_CLIENT_ID` etc. are not read by the hub; they are listed because the old stack.ts block set them.
 */
export const CONNECTOR_ENV_UNSET: string[] = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_AUTH_URL',
  'GOOGLE_TOKEN_URL',
  'GOOGLE_REVOKE_URL',
  'GOOGLE_API_BASE',
  'GOOGLE_REDIRECT_URI',
  'CANVAS_ALLOWED_HOSTS',
  'CONNECTIONS_KEY',
];

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

/** Canvas token the gate sends. It is a secret by construction and must never be echoed or stored in plaintext. */
export const CANVAS_SECRET = `${SENTINELS.feedSecret}_tok_9f3a1c`;
export const CANVAS_FIXTURE_BASE = 'https://canvas.fixture.invalid';

export const NOT_IN_MATERIALS = 'Not in the materials. Ask the TA.';

export const state = (c: any): string => String(c?.state ?? c?.status ?? c ?? '');
