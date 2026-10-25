#!/usr/bin/env node
// Local fault-injection proxy in front of a hub, for blank-shell testing. Not shipped, no secrets involved.
//   node scripts/dev/fault-proxy.mjs --listen 4815 --target http://localhost:8950
// Switch behaviour while running:  curl 'http://localhost:4815/__ctl?mode=slow&ms=12000'
//   mode=pass            forward untouched (default)
//   mode=slow&ms=N       delay every request by N ms before forwarding (SSE included)
//   mode=down            drop every connection (hub down)
//   mode=flap&up=8000&down=6000   alternate pass / down (a hub that restarts mid-session)
//   mode=401             answer 401 to everything except /health and /v1/auth/dev-login
//   mode=hang            data endpoints never answer (account, auth, status still do)
//   mode=500             data endpoints answer 500
//   mode=429&n=N&retry=S the first N non-account requests answer 429 with Retry-After: S, then pass
import http from 'node:http';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const LISTEN = Number(arg('listen', 4815));
const target = new URL(arg('target', 'http://localhost:8950'));
const st = { mode: 'pass', ms: 0, up: 8000, down: 6000, n: 0, retry: 3, t0: Date.now() };
const account = (u) =>
  u === '/health' ||
  u === '/v1/status' ||
  u.startsWith('/v1/auth/') ||
  u === '/v1/me' ||
  u === '/v1/squads';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const u = url.pathname;
  if (u === '/__ctl') {
    for (const [k, v] of url.searchParams) st[k] = k === 'mode' ? v : Number(v);
    st.t0 = Date.now();
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(st));
  }
  const cors = () => {
    const o = req.headers.origin;
    if (o) {
      res.setHeader('access-control-allow-origin', o);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('access-control-expose-headers', 'content-type,x-squad-token,retry-after');
    }
  };
  const down =
    st.mode === 'down' || (st.mode === 'flap' && (Date.now() - st.t0) % (st.up + st.down) >= st.up);
  if (down) return req.socket.destroy();
  if (req.method === 'OPTIONS') {
    // preflight is answered by the hub; fall through (slow applies too)
  }
  const forward = () => {
    const p = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    p.on('error', () => res.destroy());
    res.on('close', () => p.destroy());
    req.pipe(p);
  };
  if (st.mode === '401' && u !== '/health' && !u.startsWith('/v1/auth/dev')) {
    cors();
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end('{"error":{"code":"unauthorized"}}');
  }
  if ((st.mode === 'hang' || st.mode === '500') && req.method !== 'OPTIONS' && !account(u)) {
    if (st.mode === 'hang') return; // never answers
    cors();
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end('{"error":{"code":"boom"}}');
  }
  if (st.mode === '429' && req.method !== 'OPTIONS' && u !== '/health' && st.n > 0) {
    st.n--;
    cors();
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(st.retry) });
    return res.end(`{"error":{"code":"rate_limited","retryAfterS":${st.retry}}}`);
  }
  if (st.mode === 'slow' && st.ms > 0) return void setTimeout(forward, st.ms);
  forward();
});
server.listen(LISTEN, () => console.log(`fault proxy :${LISTEN} -> ${target.origin}`));
