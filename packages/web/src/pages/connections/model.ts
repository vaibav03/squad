/** Pure helpers for the connections page: honest state labels, plain-word scopes, error copy. */

export const STATES = ['live', 'fixture', 'expired', 'revoked', 'rate_limited', 'error'] as const;
export type ConnState = (typeof STATES)[number];
export type StateTone = 'ok' | 'neutral' | 'alert' | 'ember' | 'violet';

export const STATE_TONE: Record<ConnState, StateTone> = {
  live: 'ok',
  fixture: 'violet',
  expired: 'alert',
  revoked: 'neutral',
  rate_limited: 'ember',
  error: 'alert',
};

/** The one-line state a card leads with: real | fixture | disconnected, never a generic success badge. */
export const STATE_HEADLINE: Record<ConnState, string> = {
  live: 'Real account',
  fixture: 'Fixture',
  expired: 'Expired',
  revoked: 'Disconnected',
  rate_limited: 'Rate limited',
  error: 'Error',
};

/** Fallback copy when the hub sends no `stateLabel`. */
export const STATE_COPY: Record<ConnState, string> = {
  live: 'Connected',
  fixture: 'Fixture (simulated, not your account)',
  expired: 'Expired: reconnect to resume syncing',
  revoked: 'Disconnected: imported data deleted',
  rate_limited: 'Paused: the provider asked us to slow down',
  error: 'Error: showing the last imported data',
};

export const FIXTURE_LABEL = 'Fixture (simulated, not your account)';

export const SCOPE_WORDS: Record<string, string> = {
  'https://www.googleapis.com/auth/calendar.readonly':
    'Your calendar events. Your squad sees only busy times unless you share an event.',
  'https://www.googleapis.com/auth/drive.file':
    'Only the Drive files you pick. Nothing else in Drive.',
  'https://www.googleapis.com/auth/classroom.courses.readonly': 'Your Classroom course list.',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly':
    'Your own Classroom coursework. No grades.',
  'canvas.calendar_feed': 'Your Canvas calendar feed: due dates and events.',
  'canvas.api_token.read': 'Your Canvas courses, assignments and files, read only. No grades.',
  'canvas.browser_session.read':
    'Your Canvas courses, assignments and files, read through your own browser session. No grades.',
};
export const scopeWords = (s: string): string =>
  SCOPE_WORDS[s] ?? 'Read-only access to one data type.';

export const KIND_LABEL: Record<string, string> = {
  canvas_assignment: 'assignments',
  canvas_file: 'files',
  canvas_event: 'Canvas events',
  gdoc: 'Docs',
  gdrive_file: 'Drive files',
  gcal_event: 'calendar events',
  classroom_item: 'Classroom items',
  pdf: 'PDFs',
};
export const kindCounts = (byKind: Record<string, number>): string[] =>
  Object.entries(byKind)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`);

const ITEM_TYPE: Record<string, string> = {
  canvas_assignment: 'Canvas assignment',
  canvas_file: 'Canvas file',
  canvas_event: 'Canvas calendar event',
  canvas_page: 'Canvas page',
  gcal_event: 'Calendar event',
  classroom_coursework: 'Classroom coursework',
  classroom_course: 'Classroom course',
  classroom_item: 'Classroom item',
  gdrive_file: 'Drive file',
  gdoc: 'Google Doc',
  pdf: 'PDF',
};
export const itemTypeLabel = (k: string): string => ITEM_TYPE[k] ?? k.replace(/_/g, ' ');

export const CALENDAR_KINDS = new Set(['gcal_event', 'canvas_event']);

/** Honest copy for extension/bridge/hub error codes. */
export const ERROR_COPY: Record<string, string> = {
  canvas_account_already_bound:
    'That Canvas account is already connected to another Squad account. Disconnect it there first.',
  canvas_account_conflict:
    'You already have a different Canvas login connected for this school. Disconnect it first.',
  canvas_origin_not_allowed:
    'That Canvas address is not allowed. Only exact https school addresses work.',
  squad_not_signed_in:
    'The extension is not signed in to Squad. Create a pairing code below and paste it in the extension options.',
  squad_account_mismatch: 'The extension is signed in as a different Squad account than this page.',
  canvas_session_changed: 'Your Canvas sign-in changed. Open Canvas, sign in again, then retry.',
  canvas_registration_failed: 'Squad could not register that Canvas account. Try again.',
  scope_not_allowed: 'That access level is not offered. Squad only asks for read-only access.',
  already_connected: 'That account is already connected.',
  token_store_unconfigured: 'This server cannot store credentials yet, so it cannot connect.',
  live_not_available: 'Live connections are not available on this server yet.',
  google_not_configured: 'Google sign-in is not set up on this server.',
  connection_expired: 'This connection expired. Reconnect to sync.',
  connection_revoked: 'This connection was disconnected.',
  offline: 'Cannot reach the hub.',
};
export const errorCopy = (code: string): string =>
  ERROR_COPY[code] ?? 'Something went wrong. Nothing was changed.';

export function relTime(ms: number | null | undefined, now: number): string {
  if (!ms) return 'never';
  const d = Math.round((now - ms) / 1000);
  const f = d < 0 ? 'in ' : '';
  const a = Math.abs(d);
  const t =
    a < 60
      ? `${a} s`
      : a < 3600
        ? `${Math.floor(a / 60)} min`
        : a < 86400
          ? `${Math.floor(a / 3600)} h`
          : `${Math.floor(a / 86400)} d`;
  return d < 0 ? `${f}${t}` : a < 5 ? 'just now' : `${t} ago`;
}

/** Decode the `message` param the OAuth return carries (base64url). */
export function decodeMessage(b64: string | null): string | null {
  if (!b64) return null;
  try {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return s.slice(0, 160);
  } catch {
    return null;
  }
}

export function oauthReturn(
  search: string,
): { provider: string; ok: boolean; message: string | null } | null {
  const p = new URLSearchParams(search);
  const status = p.get('status');
  if (status !== 'connected' && status !== 'error') return null;
  return {
    provider: p.get('provider') ?? 'google',
    ok: status === 'connected',
    message: decodeMessage(p.get('message')),
  };
}

/** A squad as a person reads it: its name from the roster, never its raw id. */
export const squadLabel = (id: string, names: Record<string, string> | undefined): string =>
  names?.[id] ?? 'another squad';
