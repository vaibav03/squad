// Fake Google: OAuth (authorize, token, revoke), Calendar freebusy + events, Drive files/export, Picker stub, Classroom.
// It enforces scopes like Google does (a drive.file token cannot see unpicked files; freebusy cannot read titles) and
// records every request so the gate can assert what the hub asked for. Loopback only.
//
// Controls: POST /_ctl/{revoke,expire,ttl,over-grant,pick,reset,fail-refresh}, GET /_ctl/{requests,grants}.
import crypto from 'node:crypto';
import http from 'node:http';
import { SENTINELS } from '../config';
import { BUSY, CLASSROOM, DRIVE_FILES, PRIVATE_EVENT } from './content';
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
  const picked = new Set<string>();
  const requests: { method: string; path: string; scope?: string; status: number; at: number }[] = [];
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
    const p = u.pathname;
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
        requests.push({ method: req.method ?? 'GET', path: p, status, at: Date.now(), ...(scope ? { scope } : {}) });

      if (p.startsWith('/_ctl/')) {
        if (p === '/_ctl/requests') return json(res, 200, { requests });
        if (p === '/_ctl/grants')
          return json(res, 200, {
            grants: [...grants.values()].map((g) => ({ id: g.id, scopes: g.scopes, revoked: g.revoked })),
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
        codes.set(code, { scopes: overGrant ? [...scopes, 'https://www.googleapis.com/auth/gmail.readonly'] : scopes, redirect });
        const allow = `${redirect}${redirect.includes('?') ? '&' : '?'}code=${code}&state=${encodeURIComponent(state)}`;
        const deny = `${redirect}${redirect.includes('?') ? '&' : '?'}error=access_denied&state=${encodeURIComponent(state)}`;
        log(200);
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(
          `<!doctype html><title>Fake Google consent</title><h1>Squad (fake) wants access</h1><ul>${scopes
            .map((s) => `<li data-scope="${s}">${s}</li>`)
            .join('')}</ul><a id="allow" href="${allow}">Allow</a> <a id="deny" href="${deny}">Deny</a>`,
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
          if (!g || g.revoked) return (log(400), json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
          log(200);
          return json(res, 200, { access_token: issue(g), expires_in: ttlS, scope: g.scopes.join(' '), token_type: 'Bearer' });
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
          json(res, 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: `needs ${scope}` } });
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
        return json(res, 200, { items: [{ id: PRIVATE_EVENT.id, summary: PRIVATE_EVENT.summary }] });
      }
      if (p === '/drive/v3/files') {
        if (!need('drive.file')) return;
        log(200, 'drive.file');
        // drive.file only exposes files the user picked
        return json(res, 200, {
          files: Object.values(DRIVE_FILES)
            .filter((f) => picked.has(f.id))
            .map((f) => ({ id: f.id, name: f.name, mimeType: 'application/vnd.google-apps.document' })),
        });
      }
      const exp = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(p);
      if (exp) {
        if (!need('drive.file')) return;
        const f = Object.values(DRIVE_FILES).find((x) => x.id === exp[1]);
        if (!f || !picked.has(f.id)) return (log(404, 'drive.file'), json(res, 404, { error: { code: 404 } }));
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
      if (p === '/v1/courses') {
        if (!need('classroom.courses.readonly')) return;
        log(200, 'classroom.courses.readonly');
        return json(res, 200, { courses: [CLASSROOM.course] });
      }
      if (/^\/v1\/courses\/[^/]+\/courseWork$/.test(p)) {
        if (!need('classroom.coursework.me.readonly')) return;
        log(200, 'classroom.coursework.me.readonly');
        return json(res, 200, { courseWork: CLASSROOM.work });
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
