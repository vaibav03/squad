/**
 * Google Workspace, adapted from Nook's bridge/google-workspace.ts: web OAuth with PKCE (`access_type=offline`,
 * `prompt=consent select_account`, S256), code exchange, userinfo identity, refresh before expiry, revoke.
 * Squad differs in scopes (read-only and minimal, see GOOGLE_SCOPES) and in what it does after connecting: it
 * ingests Calendar events, picked Drive files and the student's own Classroom coursework as citable sources.
 *
 * `fetch` is injected everywhere so tests run against a fake Google server shaped like the real APIs. No secret is
 * ever logged or put in an error message.
 */
import { createHash } from 'node:crypto';
import {
  ConnectorAuthError,
  ConnectorExpiredError,
  ConnectorRevokedError,
  ConnectorRateLimitError,
  GOOGLE_SCOPES,
  type ConnectorCourse,
  type ConnectorItem,
  type ConnectorStatusInfo,
  type FetchedContent,
  type GoogleAuth,
  type GoogleConnector,
  type ListOpts,
} from './types';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Identity scopes: needed for the account id (`sub`) and nothing else. Not part of the ALLOWED_SCOPES surface. */
export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email'] as const;

/** What Squad asks Google for on the consent screen: identity + the four minimal read-only scopes. */
export const GOOGLE_CONSENT_SCOPES: readonly string[] = [
  ...GOOGLE_IDENTITY_SCOPES,
  ...Object.values(GOOGLE_SCOPES),
];

export const googleOAuthConfigured = (
  c: Partial<GoogleOAuthConfig> | undefined,
): c is GoogleOAuthConfig => Boolean(c?.clientId && c.clientSecret && c.redirectUri);

export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export function buildGoogleAuthorizationUrl(
  cfg: GoogleOAuthConfig,
  input: { state: string; verifier: string; loginHint?: string | null; scopes?: readonly string[] },
): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', (input.scopes ?? GOOGLE_CONSENT_SCOPES).join(' '));
  u.searchParams.set('state', input.state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent select_account');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('code_challenge', pkceChallenge(input.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  if (input.loginHint) u.searchParams.set('login_hint', input.loginHint);
  return u.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}
type TokenBody = Partial<GoogleTokenResponse> & { error?: string };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const form = (o: Record<string, string>) => new URLSearchParams(o);
const post = (f: typeof fetch, url: string, body: URLSearchParams) =>
  f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

/** `google_token_exchange_failed:<google error>` carries Google's error code only, never a token. */
export async function exchangeGoogleCode(
  cfg: GoogleOAuthConfig,
  code: string,
  verifier: string,
  f: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const res = await post(
    f,
    TOKEN_URL,
    form({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  );
  const json = (await res.json().catch(() => ({}))) as TokenBody;
  if (!res.ok || !json.access_token)
    throw new Error(`google_token_exchange_failed:${json.error ?? res.status}`);
  return json as GoogleTokenResponse;
}

export async function googleUserinfo(
  accessToken: string,
  f: typeof fetch = fetch,
): Promise<{ sub: string; email: string | null; name: string | null }> {
  const res = await f('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new ConnectorRateLimitError(retryAfterMs(res));
  if (res.status === 401) throw new ConnectorAuthError(401);
  if (res.status === 403) throw new ConnectorAuthError(403);
  const json = (await res.json().catch(() => ({}))) as { sub?: string; email?: string; name?: string };
  if (!res.ok || !json.sub) throw new Error(`google_userinfo_failed:${res.status}`);
  return { sub: json.sub, email: json.email?.toLowerCase() ?? null, name: json.name ?? null };
}

const apiHeaders = (a: GoogleAuth) => ({
  Authorization: `Bearer ${a.accessToken}`,
  Accept: 'application/json',
});

function retryAfterMs(res: Response): number {
  const h = res.headers.get('Retry-After');
  const n = h ? Number(h) : NaN;
  return Number.isFinite(n) ? Math.max(1, n) * 1000 : 60_000;
}

/** Maps a Google API failure to Squad's honest states. 404 is returned to the caller (removed/unsupported). */
async function guardGoogle(res: Response): Promise<void> {
  if (res.ok || res.status === 404) return;
  if (res.status === 429) throw new ConnectorRateLimitError(retryAfterMs(res));
  if (res.status === 401) throw new ConnectorAuthError(401);
  if (res.status === 403) {
    const body = (await res
      .clone()
      .json()
      .catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[]; status?: string };
    };
    const reasons = body.error?.errors?.map((e) => e.reason ?? '') ?? [];
    if (
      reasons.some((r) => /ratelimit|quotaexceeded/i.test(r)) ||
      body.error?.status === 'RESOURCE_EXHAUSTED'
    )
      throw new ConnectorRateLimitError(retryAfterMs(res));
    throw new ConnectorAuthError(403);
  }
  throw new Error(`google_http_${res.status}`);
}

const MAX_PAGES = 5;
const ms = (iso: string | undefined | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

interface CalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}
interface CourseWork {
  id: string;
  courseId?: string;
  title: string;
  description?: string;
  alternateLink?: string;
  updateTime?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
}

const dueMs = (w: CourseWork): number | null =>
  w.dueDate
    ? Date.UTC(
        w.dueDate.year,
        w.dueDate.month - 1,
        w.dueDate.day,
        w.dueTime?.hours ?? 23,
        w.dueTime?.minutes ?? 59,
      )
    : null;

export function createLiveGoogleConnector(
  opts: { fetch?: typeof fetch; oauth?: GoogleOAuthConfig; now?: () => number } = {},
): GoogleConnector {
  const clock = opts.now ?? Date.now;
  const f: typeof fetch = opts.fetch ?? ((...a) => fetch(...a));
  const has = (a: GoogleAuth, s: string) => a.scopes.includes(s);
  const getJson = async <T>(
    url: string,
    a: GoogleAuth,
  ): Promise<{ status: number; body: T | null }> => {
    const res = await f(url, { headers: apiHeaders(a), signal: AbortSignal.timeout(15_000) });
    await guardGoogle(res);
    if (res.status === 404) return { status: 404, body: null };
    return { status: res.status, body: (await res.json()) as T };
  };
  const content = new Map<string, FetchedContent>();

  return {
    provider: 'google',
    mode: 'live',
    async accountId(a) {
      return (await googleUserinfo(a.accessToken, f)).sub;
    },
    async listCourses(a): Promise<ConnectorCourse[]> {
      if (!has(a, GOOGLE_SCOPES.classroomCourses)) return [];
      const out: ConnectorCourse[] = [];
      let token = '';
      for (let i = 0; i < MAX_PAGES; i++) {
        const r = await getJson<{
          courses?: { id: string; name: string; section?: string }[];
          nextPageToken?: string;
        }>(
          `https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=50${token}`,
          a,
        );
        for (const c of r.body?.courses ?? []) out.push({ id: `classroom-${c.id}`, name: c.name });
        if (!r.body?.nextPageToken) break;
        token = `&pageToken=${encodeURIComponent(r.body.nextPageToken)}`;
      }
      return out;
    },
    async listItems(a, _courseId, o?: ListOpts) {
      content.clear();
      const out: ConnectorItem[] = [];
      const now = clock();
      const from = new Date(o?.windowFrom ?? now - 120 * 86_400_000).toISOString();
      const to = new Date(o?.windowTo ?? now + 180 * 86_400_000).toISOString();

      if (has(a, GOOGLE_SCOPES.calendar)) {
        // Incremental passes ask only for events changed since the cursor (`updatedMin`, deleted ones included).
        const upd =
          o && !o.full && o.since
            ? `&updatedMin=${encodeURIComponent(new Date(o.since).toISOString())}&showDeleted=true`
            : '';
        let token = '';
        for (let i = 0; i < MAX_PAGES; i++) {
          const r = await getJson<{ items?: CalEvent[]; nextPageToken?: string }>(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=250&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}${upd}${token}`,
            a,
          );
          for (const e of r.body?.items ?? []) {
            if (e.status === 'cancelled') continue;
            const externalId = `cal:${e.id}`;
            out.push({
              externalId,
              kind: 'gcal_event',
              title: e.summary ?? '(busy)',
              courseId: null,
              url: e.htmlLink ?? null,
              modifiedAt: ms(e.updated),
              startsAt: ms(e.start?.dateTime ?? e.start?.date),
              endsAt: ms(e.end?.dateTime ?? e.end?.date),
            });
            content.set(externalId, { text: e.description ?? '' });
          }
          if (!r.body?.nextPageToken) break;
          token = `&pageToken=${encodeURIComponent(r.body.nextPageToken)}`;
        }
      }

      // drive.file: only what the student picked in the Picker can be read. A 404 means removed or not shared with us.
      if (has(a, GOOGLE_SCOPES.drive))
        for (const id of a.pickedFileIds ?? []) {
          const r = await getJson<DriveFile>(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,webViewLink`,
            a,
          );
          if (!r.body) continue;
          const d = r.body;
          const isDoc = d.mimeType === 'application/vnd.google-apps.document';
          const externalId = `drive:${d.id}`;
          out.push({
            externalId,
            kind: isDoc ? 'gdoc' : 'gdrive_file',
            title: d.name,
            courseId: null,
            url: d.webViewLink ?? null,
            modifiedAt: ms(d.modifiedTime),
          });
          let text = '';
          if (isDoc || d.mimeType.startsWith('text/')) {
            const url = isDoc
              ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(d.id)}/export?mimeType=text/plain`
              : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(d.id)}?alt=media`;
            const res = await f(url, {
              headers: apiHeaders(a),
              signal: AbortSignal.timeout(20_000),
            });
            await guardGoogle(res);
            if (res.ok) text = (await res.text()).slice(0, 200_000);
          } else {
            // Binary files (pdf, pptx, docx) are listed with metadata only: text extraction is not built (BLOCKED).
            text = `File type: ${d.mimeType}. Text is not extracted for this file type.`;
          }
          content.set(externalId, { text });
        }

      if (has(a, GOOGLE_SCOPES.classroomWork) && has(a, GOOGLE_SCOPES.classroomCourses)) {
        for (const course of await this.listCourses(a)) {
          const cid = course.id.replace(/^classroom-/, '');
          const r = await getJson<{ courseWork?: CourseWork[] }>(
            `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(cid)}/courseWork?pageSize=50`,
            a,
          );
          for (const w of r.body?.courseWork ?? []) {
            const externalId = `classroom:${cid}:${w.id}`;
            out.push({
              externalId,
              kind: 'classroom_item',
              title: w.title,
              courseId: course.id,
              url: w.alternateLink ?? null,
              modifiedAt: ms(w.updateTime),
              dueAt: dueMs(w),
            });
            content.set(externalId, {
              text: [`Course: ${course.name}`, w.description ?? ''].filter(Boolean).join('\n\n'),
            });
          }
        }
      }
      return out;
    },
    async fetchContent(_a, item) {
      return content.get(item.externalId) ?? { text: '' };
    },
    async revoke(a) {
      const token = a.refreshToken ?? a.accessToken;
      // Best effort: the local purge never depends on Google answering.
      await f('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ token }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    },
    async status(a): Promise<ConnectorStatusInfo> {
      try {
        await googleUserinfo(a.accessToken, f);
        return { state: 'live' };
      } catch (e) {
        if (e instanceof ConnectorAuthError && e.httpStatus === 401)
          return {
            state: 'revoked',
            note: 'Google no longer accepts this grant. It was revoked or removed.',
          };
        if (e instanceof ConnectorAuthError)
          return { state: 'error', degraded: true, note: 'Google rejected the credential (403).' };
        throw e;
      }
    },
    async refresh(a) {
      const cfg = opts.oauth;
      if (!a.refreshToken || !cfg) throw new ConnectorExpiredError('no refresh token');
      const res = await post(
        f,
        TOKEN_URL,
        form({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: a.refreshToken,
          grant_type: 'refresh_token',
        }),
      );
      const json = (await res.json().catch(() => ({}))) as TokenBody;
      if (res.status === 429) throw new ConnectorRateLimitError(retryAfterMs(res));
      if (!res.ok || !json.access_token) {
        // invalid_grant is Google saying the grant is revoked/removed; any other refusal only means "could not renew".
        if (json.error === 'invalid_grant')
          throw new ConnectorRevokedError('google_refresh_failed:invalid_grant');
        if (res.status === 400 || res.status === 401)
          throw new ConnectorExpiredError('google_refresh_failed:' + (json.error ?? res.status));
        throw new Error(`google_refresh_failed:${json.error ?? res.status}`);
      }
      return {
        accessToken: json.access_token,
        expiresAt: clock() + Math.max(30, json.expires_in ?? 3600) * 1000,
      };
    },
  };
}
