import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticServer } from './lib/static-server';

let base = '';
let close: () => void = () => {};

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'static-server-'));
  const dist = join(root, 'dist');
  const art = join(root, 'assets');
  mkdirSync(join(dist, 'static'), { recursive: true });
  mkdirSync(art);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dist, 'static', 'app-abc123.js'), 'console.log(1);\n'.repeat(200));
  writeFileSync(join(art, 'a.json'), '{"art":true}');
  const { server } = createStaticServer({ distDir: dist, assetsDir: art });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

describe('static server', () => {
  it('serves hashed bundles immutable and compressed', async () => {
    const res = await fetch(`${base}/static/app-abc123.js`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(await res.text()).toContain('console.log(1)'); // fetch inflates it
  });
  it('prefers brotli when offered', async () => {
    const res = await fetch(`${base}/static/app-abc123.js`, {
      headers: { 'accept-encoding': 'br, gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('br');
  });
  it('serves index.html with no-cache, also as SPA fallback', async () => {
    for (const p of ['/', '/squad/village', '/squad/chat/x']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toContain('<title>app</title>');
    }
  });
  it('404s a missing file with an extension and blocks traversal', async () => {
    expect((await fetch(`${base}/static/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fetc/passwd`)).status).toBe(200); // SPA fallback html, never the file
    const t = await fetch(`${base}/%2e%2e/%2e%2e/etc/hosts`);
    expect((await t.text()).includes('localhost')).toBe(false);
  });
  it('serves repo art at /assets with etag revalidation', async () => {
    const res = await fetch(`${base}/assets/a.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const again = await fetch(`${base}/assets/a.json`, {
      headers: { 'if-none-match': res.headers.get('etag')! },
    });
    expect(again.status).toBe(304);
  });
});
