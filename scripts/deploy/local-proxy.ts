/**
 * Docker-free one-origin server for demos: serves apps/web-host/dist (+ repo assets/) and proxies the hub.
 *   pnpm build:web   (build with VITE_HUB_URL=http://<this-host>:8080 so the app talks to this origin)
 *   pnpm --filter @squad/hub start &
 *   pnpm tsx scripts/deploy/local-proxy.ts            # PORT=8080 HUB_UPSTREAM=http://127.0.0.1:8788 BIND=0.0.0.0
 * Blocks /internal and /__sim like the nginx image. Supports SSE (streamed) and the call websocket (upgrade).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'apps/web-host/dist');
const ASSETS = path.join(ROOT, 'assets');
const hub = new URL(process.env.HUB_UPSTREAM ?? 'http://127.0.0.1:8788');
const port = Number(process.env.PORT ?? 8080);
const bind = process.env.BIND ?? '0.0.0.0';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const isApi = (u: string) => u === '/health' || u.startsWith('/v1/');
const blocked = (u: string) =>
  u.startsWith('/internal/') || u.startsWith('/__sim/') || u.includes('/vendor/');

function file(root: string, rel: string): string | null {
  const p = path.normalize(path.join(root, decodeURIComponent(rel)));
  return p.startsWith(root) && existsSync(p) && statSync(p).isFile() ? p : null;
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const pathname = url.split('?')[0]!;
  if (blocked(pathname)) {
    res.writeHead(404).end();
    return;
  }
  if (isApi(pathname)) {
    const up = http.request(
      { host: hub.hostname, port: hub.port, path: url, method: req.method, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => res.writeHead(502).end('hub unreachable'));
    req.pipe(up);
    return;
  }
  const f =
    (pathname.startsWith('/assets/') && file(ASSETS, pathname.slice('/assets'.length))) ||
    file(DIST, pathname);
  const target = f ?? path.join(DIST, 'index.html');
  const ext = path.extname(target);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/static/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(target).pipe(res);
});

server.on('upgrade', (req, socket, head) => {
  if (!(req.url ?? '').startsWith('/v1/call/ws/')) return void socket.destroy();
  const up = net.connect(Number(hub.port), hub.hostname, () => {
    up.write(
      `${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')}\r\n\r\n`,
    );
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(port, bind, () =>
  console.log(`squad one-origin proxy on http://${bind}:${port} -> hub ${hub.origin}`),
);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.once(sig, () => server.close(() => process.exit(0)));
