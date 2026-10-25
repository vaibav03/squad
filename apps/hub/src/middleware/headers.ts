import type { MiddlewareHandler } from 'hono';

export interface HeaderOptions {
  /** Add Strict-Transport-Security (set when the hub is served over TLS, e.g. production behind a proxy). */
  hsts?: boolean;
}

/** Headers for a JSON/SSE API: nothing here is meant to be rendered, so the CSP denies everything. */
export function apiHeaders(o: HeaderOptions = {}): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'permissions-policy': 'microphone=(), camera=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'cross-origin', // the web host is another origin and reads via CORS
    ...(o.hsts ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

/**
 * Headers for the web host (static SPA). `callPaths` are the only routes that get microphone access.
 * Exported for apps/web-host (vite preview / static host config) to apply; see docs/security/FINDINGS.md.
 */
export function webHostHeaders(o: {
  hubOrigin: string;
  hsts?: boolean;
  callPage?: boolean;
}): Record<string, string> {
  const hub = o.hubOrigin;
  const wsHub = hub.replace(/^http/, 'ws');
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src 'self' data: blob: https:`,
      `media-src 'self' blob: data:`,
      `connect-src 'self' ${hub} ${wsHub}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'permissions-policy': o.callPage
      ? 'microphone=(self), camera=(), geolocation=()'
      : 'microphone=(), camera=(), geolocation=()',
    ...(o.hsts ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

export function securityHeaders(o: HeaderOptions = {}): MiddlewareHandler {
  const h = apiHeaders(o);
  return async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(h)) c.res.headers.set(k, v);
    const p = new URL(c.req.url).pathname;
    if (p.startsWith('/v1/') && !c.res.headers.has('cache-control'))
      c.res.headers.set('cache-control', 'no-store');
  };
}
