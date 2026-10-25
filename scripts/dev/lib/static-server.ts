/**
 * Tiny static server for the production-built web host (used by `pnpm demo:serve`).
 *
 *  - /static/** (hashed bundles)   Cache-Control: public, max-age=31536000, immutable
 *  - index.html + SPA fallback     Cache-Control: no-cache (always revalidated)
 *  - repo art (/assets/**)         ETag + max-age=300 (unhashed, wins over dist like the vite plugin does)
 *  - text types                    brotli (preferred) or gzip, compressed once and kept in memory
 *  - unknown path without an extension -> index.html (SPA); unknown file with an extension -> 404
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.map',
  '.wasm',
  '.ttf',
]);

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';
export const CACHE_ART = 'public, max-age=300';

interface Entry {
  file: string;
  ext: string;
  cache: string;
  body: Buffer;
  etag: string;
  br?: Buffer;
  gz?: Buffer;
}

export interface StaticServerOptions {
  /** Built web host output (apps/web-host/dist). */
  distDir: string;
  /** Repo `assets/` dir served at /assets (optional). */
  assetsDir?: string;
  /** Hashed-bundle prefix (vite `build.assetsDir`). */
  hashedPrefix?: string;
}

export function createStaticHandler(opts: StaticServerOptions) {
  const dist = resolve(opts.distDir);
  const art = opts.assetsDir ? resolve(opts.assetsDir) : undefined;
  const hashed = `/${(opts.hashedPrefix ?? 'static').replace(/^\/|\/$/g, '')}/`;
  const memo = new Map<string, Entry & { mtime: number }>();

  function load(file: string, cache: string): Entry | null {
    let st;
    try {
      st = statSync(file);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    const hit = memo.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.cache === cache) return hit;
    const body = readFileSync(file);
    const entry = {
      file,
      ext: extname(file).toLowerCase(),
      cache,
      body,
      etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
      mtime: st.mtimeMs,
    };
    memo.set(file, entry);
    return entry;
  }

  function within(root: string, rel: string): string | null {
    const p = normalize(join(root, rel));
    return p === root || p.startsWith(root + sep) ? p : null;
  }

  function resolveEntry(pathname: string): { entry: Entry; status: number } | null {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (rel.includes('\0')) return null;
    if (art && rel.startsWith('/assets/')) {
      const p = within(art, rel.slice('/assets'.length));
      const e = p && load(p, CACHE_ART);
      if (e) return { entry: e, status: 200 };
    }
    const p = within(dist, rel);
    if (p && rel !== '/') {
      const e = load(p, rel.startsWith(hashed) ? CACHE_IMMUTABLE : CACHE_REVALIDATE);
      if (e) return { entry: e, status: 200 };
      if (extname(rel)) return null; // a missing file is a 404, never index.html
    }
    const index = load(join(dist, 'index.html'), CACHE_REVALIDATE);
    return index ? { entry: index, status: 200 } : null;
  }

  function compressed(e: Entry, enc: 'br' | 'gz'): Buffer {
    if (enc === 'br')
      return (e.br ??= brotliCompressSync(e.body, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 9,
          [constants.BROTLI_PARAM_SIZE_HINT]: e.body.length,
        },
      }));
    return (e.gz ??= gzipSync(e.body, { level: 9 }));
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const hit = resolveEntry(pathname);
    if (!hit) {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end('not found');
      return;
    }
    const e = hit.entry;
    const headers: Record<string, string | number> = {
      'content-type': MIME[e.ext] ?? 'application/octet-stream',
      'cache-control': e.cache,
      etag: e.etag,
      vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === e.etag) {
      res.writeHead(304, headers).end();
      return;
    }
    let body = e.body;
    if (COMPRESSIBLE.has(e.ext) && e.body.length > 512) {
      const accept = String(req.headers['accept-encoding'] ?? '');
      const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gz' : null;
      if (enc) {
        body = compressed(e, enc);
        headers['content-encoding'] = enc === 'br' ? 'br' : 'gzip';
      }
    }
    headers['content-length'] = body.length;
    res.writeHead(hit.status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  /** Reads and compresses every compressible file under dist now, so the first page load pays no compression time. */
  function warm(): number {
    let n = 0;
    const walk = (dir: string, urlBase: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, d.name);
        if (d.isDirectory()) walk(f, `${urlBase}${d.name}/`);
        else {
          const hit = resolveEntry(`${urlBase}${d.name}`);
          if (hit && COMPRESSIBLE.has(hit.entry.ext) && hit.entry.body.length > 512) {
            compressed(hit.entry, 'br');
            compressed(hit.entry, 'gz');
            n++;
          }
        }
      }
    };
    walk(dist, '/');
    if (art) walk(art, '/assets/');
    return n;
  }

  return { handler, warm, resolveEntry };
}

export function createStaticServer(opts: StaticServerOptions): {
  server: Server;
  warm: () => number;
} {
  const { handler, warm } = createStaticHandler(opts);
  return { server: createServer(handler), warm };
}
