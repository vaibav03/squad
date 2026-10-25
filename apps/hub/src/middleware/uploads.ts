import type { MiddlewareHandler } from 'hono';
import { POLICIES, safeFileName, validateUpload, type UploadPolicy } from '../security/upload';

interface Route {
  path: string;
  policy: UploadPolicy;
}
const ROUTES: Route[] = [
  { path: '/v1/squad/courses', policy: POLICIES.pdf },
  { path: '/v1/squad/calendar', policy: POLICIES.ics },
];

const STATUS = { empty: 400, too_large: 413, bad_magic: 400, bad_content: 400, bomb: 413 } as const;

/**
 * Validates multipart uploads by content before the route sees them (magic number, size, structure).
 * Works on a clone of the request so the route's own parsing is unchanged.
 */
export function uploadGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const route = ROUTES.find((r) => new URL(c.req.url).pathname === r.path);
    const ct = c.req.header('content-type') ?? '';
    if (!route || !ct.toLowerCase().startsWith('multipart/form-data')) return next();
    let form: FormData;
    let file: unknown;
    try {
      form = await c.req.raw.clone().formData();
      file = form.get('file');
    } catch {
      return c.json(
        { error: { code: 'invalid_request', message: 'malformed multipart body' } },
        400,
      );
    }
    if (!(file instanceof File))
      return c.json(
        { error: { code: 'invalid_request', message: 'multipart field "file" required' } },
        400,
      );
    const res = validateUpload(new Uint8Array(await file.arrayBuffer()), route.policy);
    if (!res.ok)
      return c.json({ error: { code: 'invalid_upload', message: res.code } }, STATUS[res.code!]);
    // Hand the route a copy whose file name is display/storage safe (no path parts, control or bidi chars).
    const clean = safeFileName(file.name);
    if (clean !== file.name) {
      form.set('file', new File([file], clean, { type: file.type }));
      const headers = new Headers(c.req.raw.headers);
      headers.delete('content-type');
      headers.delete('content-length');
      c.req.raw = new Request(c.req.raw.url, { method: 'POST', headers, body: form });
    }
    return next();
  };
}
