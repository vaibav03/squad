import type { MiddlewareHandler } from 'hono';

const err = (code: string, message: string) => ({ error: { code, message } });

export interface BodyOptions {
  /** max bytes for JSON/other bodies */
  jsonMax: number;
  /** max bytes for multipart (uploads); a route may be tighter in its own handler */
  multipartMax: number;
  /** path prefixes that are exempt from the strict content-type rule */
  exempt?: string[];
}

/**
 * - Rejects non-JSON, non-multipart bodies on /v1 and /__sim with 415 (strict JSON content-type).
 * - Enforces a byte cap while STREAMING, so chunked uploads without a Content-Length cannot bypass it.
 */
export function bodyGuard(o: BodyOptions): MiddlewareHandler {
  return async (c, next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    const path = new URL(c.req.url).pathname;
    const ct = (c.req.header('content-type') ?? '').toLowerCase();
    const len = c.req.header('content-length');
    const hasBody =
      (len !== undefined && len !== '0') || c.req.header('transfer-encoding') !== undefined;
    const multipart = ct.startsWith('multipart/form-data');
    const json = ct.startsWith('application/json') || /^application\/[\w.+-]+\+json/.test(ct);
    // the course catalogue import takes CSV text as well as JSON
    const csvOk = path === '/v1/library/catalogue' && /^text\/(csv|plain)/.test(ct);
    const strict = path.startsWith('/v1/') || path.startsWith('/__sim/');
    if (hasBody && strict && !multipart && !json && !csvOk)
      return c.json(err('unsupported_media_type', 'application/json required'), 415);
    const max = multipart ? o.multipartMax : o.jsonMax;
    if (len !== undefined && Number(len) > max)
      return c.json(err('payload_too_large', 'body too large'), 413);
    if (hasBody && c.req.raw.body && !(o.exempt ?? []).some((p) => path.startsWith(p))) {
      // Re-wrap the body with a counting stream that errors past the cap.
      let seen = 0;
      const limited = c.req.raw.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            seen += chunk.byteLength;
            if (seen > max) ctl.error(new BodyTooLarge());
            else ctl.enqueue(chunk);
          },
        }),
      );
      c.req.raw = new Request(c.req.raw, { body: limited, duplex: 'half' } as RequestInit);
    }
    try {
      await next();
    } catch (e) {
      if (e instanceof BodyTooLarge) return c.json(err('payload_too_large', 'body too large'), 413);
      throw e;
    }
    return;
  };
}

export class BodyTooLarge extends Error {
  constructor() {
    super('body too large');
    this.name = 'BodyTooLarge';
  }
}
