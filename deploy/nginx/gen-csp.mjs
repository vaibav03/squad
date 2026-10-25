// Build step: hash the inline pre-paint theme script in index.html and emit an nginx headers snippet.
// Usage: node gen-csp.mjs <dist/index.html> <out security-headers.conf>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , htmlPath, outPath] = process.argv;
const html = readFileSync(htmlPath, 'utf8');
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
);
const csp = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(' ')}`.trim(),
  "style-src 'self' 'unsafe-inline'", // React inline styles
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'", // hub is same origin (SSE, fetch, ws on the same host)
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const lines = [
  `add_header Content-Security-Policy "${csp}" always;`,
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header X-Frame-Options "DENY" always;',
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  'add_header Permissions-Policy "camera=(), geolocation=(), payment=(), microphone=(self)" always;',
  'add_header Cross-Origin-Opener-Policy "same-origin" always;',
];
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`csp: ${hashes.length} inline script hash(es)`);
