import type { MiddlewareHandler } from 'hono';
import { POLICIES, validateUpload, type UploadPolicy } from '../security/upload';

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
    let file: unknown;
    try {
      file = (await c.req.raw.clone().formData()).get('file');
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
    return next();
  };
}
