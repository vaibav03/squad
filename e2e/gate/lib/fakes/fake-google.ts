// Fake Google over HTTP (loopback). The gate hub rewrites the Google hosts (accounts, oauth2, openidconnect, www,
// classroom .googleapis.com) to `${GOOGLE}/__h/<host>/...` with a fetch seam in lib/gate-hub.ts, so the REAL connector
// (packages/brain google-live + the hub OAuth routes: PKCE, state, token exchange, refresh, revoke) runs unmodified.
// It enforces scopes like Google does (a drive.file token cannot see unpicked files; events need calendar.readonly) and
// records every request so the gate can assert what the hub asked for.
//
// Controls: POST /_ctl/{revoke,expire,ttl,over-grant,pick,reset,fail-refresh}, GET /_ctl/{requests,grants}.
//   revoke       every grant revoked: the next refresh is invalid_grant and API calls are 401
//   expire       every issued access token is expired (refresh still works)
//   ttl          expires_in (seconds) of tokens issued from now on
//   over-grant   the consent grants one extra, unrequested scope (the hub must keep only the allowed set)
//   fail-refresh the next n refreshes answer 500
import crypto from 'node:crypto';
import http from 'node:http';
import { SENTINELS } from '../config';
import { BUSY, CLASSROOM, DRIVE_FILES, EVENTS, PRIVATE_EVENT } from './content';
import type { FakeServer } from './fake-canvas';

interface Grant {
  id: string;
  scopes: string[];
  refresh: string;
  revoked: boolean;
}

export async function startFakeGoogle(port: number): Promise<FakeServer> {
  const base = `http://localhost:${port}`;
  const grants = new Map<string, Grant>(); // by refresh token
  const access = new Map<string, { grant: Grant; exp: number; expired: boolean }>();
  const codes = new Map<string, { scopes: string[]; redirect: string }>();
  let ttlS = 3600;
  let overGrant = false;
  let failRefresh = 0;
  const picked = new Set<string>([DRIVE_FILES.picked.id]);
  const requests: { method: string; path: string; scope?: string; status: number; at: number }[] =
    [];
  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const issue = (g: Grant) => {
    const tok = `ya29.fake.${crypto.randomBytes(8).toString('hex')}`;
    access.set(tok, { grant: g, exp: Date.now() + ttlS * 1000, expired: false });
    return tok;
  };

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', base);
    // `/__h/<host>/<path>`: the logical Google host is the first segment; plain paths keep working for the controls
    const hm = /^\/__h\/([^/]+)(\/.*)?$/.exec(u.pathname);
    const host = hm?.[1] ?? '';
    const p = hm ? (hm[2] ?? '/') : u.pathname;
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = new URLSearchParams(raw);
      const body = (() => {
        try {
          return raw && raw.trim().startsWith('{') ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      })();
      const log = (status: number, scope?: string) =>
        requests.push({
          method: req.method ?? 'GET',
          path: p,
          status,
          at: Date.now(),
          ...(scope ? { scope } : {}),
        });

      if (p.startsWith('/_ctl/')) {
        if (p === '/_ctl/requests') return json(res, 200, { requests });
        if (p === '/_ctl/grants')
          return json(res, 200, {
            grants: [...grants.values()].map((g) => ({
              id: g.id,
              scopes: g.scopes,
              revoked: g.revoked,
            })),
          });
        if (p === '/_ctl/revoke') for (const g of grants.values()) g.revoked = true;
        if (p === '/_ctl/expire') for (const a of access.values()) a.expired = true;
        if (p === '/_ctl/ttl') ttlS = Number(body.seconds ?? 3600);
        if (p === '/_ctl/over-grant') overGrant = !!body.on;
        if (p === '/_ctl/fail-refresh') failRefresh = Number(body.n ?? 1);
        if (p === '/_ctl/pick') {
          picked.clear();
          for (const id of body.ids ?? [DRIVE_FILES.picked.id]) picked.add(id);
        }
        if (p === '/_ctl/reset') {
          grants.clear();
          access.clear();
          codes.clear();
          picked.clear();
          picked.add(DRIVE_FILES.picked.id);
          requests.length = 0;
          ttlS = 3600;
          overGrant = false;
          failRefresh = 0;
        }
        return json(res, 200, { ok: true });
      }

      // OAuth 2.0 authorize: a fake consent page whose only job is to show the scopes and redirect with a code.
      if (p === '/o/oauth2/v2/auth') {
        const scopes = (u.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
        const redirect = u.searchParams.get('redirect_uri') ?? '';
        const state = u.searchParams.get('state') ?? '';
        const code = `code-${crypto.randomBytes(6).toString('hex')}`;
        codes.set(code, {
          scopes: overGrant
            ? [...scopes, 'https://www.googleapis.com/auth/gmail.readonly']
            : scopes,
          redirect,
        });
        const allow = `${redirect}${redirect.includes('?') ? '&' : '?'}code=${code}&state=${encodeURIComponent(state)}`;
        const deny = `${redirect}${redirect.includes('?') ? '&' : '?'}error=access_denied&state=${encodeURIComponent(state)}`;
        log(200);
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(
          `<!doctype html><title>Fake Google consent</title><h1>Squad (fake) wants access</h1><ul>${scopes
            .map((s) => `<li data-scope="${s}">${s}</li>`)
            .join(
              '',
            )}</ul><a id="allow" href="${allow}">Allow</a> <a id="deny" href="${deny}">Deny</a>`,
        );
      }
      if (p === '/token' && req.method === 'POST') {
        const type = form.get('grant_type');
        if (type === 'authorization_code') {
          const c = codes.get(form.get('code') ?? '');
          if (!c) return (log(400), json(res, 400, { error: 'invalid_grant' }));
          codes.delete(form.get('code') ?? '');
          const g: Grant = {
            id: `grant-${grants.size + 1}`,
            scopes: c.scopes,
            refresh: `${SENTINELS.refreshToken}-${crypto.randomBytes(6).toString('hex')}`,
            revoked: false,
          };
          grants.set(g.refresh, g);
          log(200);
          return json(res, 200, {
            access_token: issue(g),
            refresh_token: g.refresh,
            expires_in: ttlS,
            scope: g.scopes.join(' '),
            token_type: 'Bearer',
          });
        }
        if (type === 'refresh_token') {
          const g = grants.get(form.get('refresh_token') ?? '');
          if (failRefresh > 0) {
            failRefresh--;
            return (log(500), json(res, 500, { error: 'temporarily_unavailable' }));
          }
          if (!g || g.revoked)
            return (
              log(400),
              json(res, 400, {
                error: 'invalid_grant',
                error_description: 'Token has been expired or revoked.',
              })
            );
          log(200);
          return json(res, 200, {
            access_token: issue(g),
            expires_in: ttlS,
            scope: g.scopes.join(' '),
            token_type: 'Bearer',
          });
        }
        return json(res, 400, { error: 'unsupported_grant_type' });
      }
      if (p === '/revoke' && req.method === 'POST') {
        const g = grants.get(form.get('token') ?? '');
        if (g) g.revoked = true;
        log(200);
        return json(res, 200, {});
      }

      // API surface: bearer token with scope enforcement.
      const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const a = access.get(tok);
      const need = (scope: string): boolean => {
        if (!a || a.expired || a.exp < Date.now() || a.grant.revoked) {
          log(401);
          json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
          return false;
        }
        if (!a.grant.scopes.some((s) => s.endsWith(scope))) {
          log(403, scope);
          json(res, 403, {
            error: { code: 403, status: 'PERMISSION_DENIED', message: `needs ${scope}` },
          });
          return false;
        }
        return true;
      };
      if (p === '/calendar/v3/freeBusy' && req.method === 'POST') {
        if (!need('calendar.freebusy')) return;
        log(200, 'calendar.freebusy');
        return json(res, 200, {
          calendars: { primary: { busy: BUSY.map(([start, end]) => ({ start, end })) } },
        });
      }
      if (p === '/calendar/v3/calendars/primary/events') {
        if (!need('calendar.readonly')) return;
        log(200, 'calendar.readonly');
        return json(res, 200, {
          items: [
            ...EVENTS.map((e) => ({
              id: e.id,
              summary: e.title,
              start: { dateTime: e.startsAt },
              end: { dateTime: e.endsAt },
              updated: '2026-10-20T10:00:00Z',
              status: 'confirmed',
            })),
            {
              id: PRIVATE_EVENT.id,
              summary: PRIVATE_EVENT.summary,
              start: { dateTime: '2026-10-30T15:00:00Z' },
              end: { dateTime: '2026-10-30T16:00:00Z' },
              updated: '2026-10-21T10:00:00Z',
              status: 'confirmed',
            },
          ],
        });
      }
      if (p === '/drive/v3/files') {
        if (!need('drive.file')) return;
        log(200, 'drive.file');
        // drive.file only exposes files the user picked
        return json(res, 200, {
          files: Object.values(DRIVE_FILES)
            .filter((f) => picked.has(f.id))
            .map((f) => ({
              id: f.id,
              name: f.name,
              mimeType: 'application/vnd.google-apps.document',
            })),
        });
      }
      const meta = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
      if (meta && u.searchParams.get('alt') !== 'media') {
        if (!need('drive.file')) return;
        const f = Object.values(DRIVE_FILES).find((x) => x.id === meta[1]);
        if (!f || !picked.has(f.id))
          return (log(404, 'drive.file'), json(res, 404, { error: { code: 404 } }));
        log(200, 'drive.file');
        return json(res, 200, {
          id: f.id,
          name: f.name,
          mimeType: 'application/vnd.google-apps.document',
          modifiedTime: '2026-10-19T10:00:00Z',
          webViewLink: `https://docs.google.com/document/d/${f.id}/edit`,
        });
      }
      const exp = meta ? meta : /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(p);
      if (exp) {
        if (!need('drive.file')) return;
        const f = Object.values(DRIVE_FILES).find((x) => x.id === exp[1]);
        if (!f || !picked.has(f.id))
          return (log(404, 'drive.file'), json(res, 404, { error: { code: 404 } }));
        log(200, 'drive.file');
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end(f.text);
      }
      if (p === '/picker') {
        log(200);
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(
          `<!doctype html><title>Fake Picker</title><button id="pick" data-id="${DRIVE_FILES.picked.id}">${DRIVE_FILES.picked.name}</button>`,
        );
      }
      if (p === '/v1/userinfo' && host === 'openidconnect.googleapis.com') {
        if (!a || a.expired || a.exp < Date.now() || a.grant.revoked)
          return (log(401), json(res, 401, { error: { code: 401 } }));
        log(200);
        return json(res, 200, { sub: 'gate-google-sub-1', email: 'gate.student@fixture.invalid' });
      }
      if (p === '/v1/courses') {
        if (!need('classroom.courses.readonly')) return;
        log(200, 'classroom.courses.readonly');
        return json(res, 200, { courses: [CLASSROOM.course] });
      }
      if (/^\/v1\/courses\/[^/]+\/courseWork$/.test(p)) {
        if (!need('classroom.coursework.me.readonly')) return;
        log(200, 'classroom.coursework.me.readonly');
        return json(res, 200, {
          courseWork: CLASSROOM.work.map((w) => ({
            ...w,
            alternateLink: `https://classroom.google.com/c/${CLASSROOM.course.id}/a/${w.id}`,
            updateTime: '2026-10-22T10:00:00Z',
          })),
        });
      }
      log(404);
      json(res, 404, { error: 'not_found' });
    });
  });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return {
    port,
    url: base,
    close: () =>
      new Promise<void>((r) => {
        srv.close(() => r());
        srv.closeAllConnections?.();
      }),
  };
}
