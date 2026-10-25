import type { HubConfig } from './config';

/**
 * Which web origin may a hub-built redirect or link point at?
 *
 * Allowed: the hub's configured CORS origins (never `*`), PUBLIC_WEB_URL / WEB_URL / HUB_WEB_URL when set, and
 * localhost / 127.0.0.1 / [::1] on any port ONLY outside production. Anything else is rejected so a crafted
 * `Origin` header or `return_origin` parameter can never turn the OAuth callback into an open redirect.
 */
type OriginCfg = Pick<HubConfig, 'corsOrigins' | 'production'> & { publicWebUrl?: string | null };

/** Canonical `scheme://host[:port]` or null when `raw` is not a plain http(s) origin (no path, creds, query). */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 200) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.origin;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedWebOrigin(cfg: OriginCfg, raw: string | null | undefined): string | null {
  const o = normalizeOrigin(raw);
  if (!o) return null;
  const listed = [...cfg.corsOrigins.filter((x) => x !== '*'), cfg.publicWebUrl]
    .map((x) => normalizeOrigin(x))
    .filter((x): x is string => x !== null);
  if (listed.includes(o)) return o;
  if (!cfg.production && LOOPBACK.has(new URL(o).hostname)) return o;
  return null;
}

/** The configured fallback origin, or null when none was set explicitly. */
export function configuredWebOrigin(cfg: OriginCfg): string | null {
  return normalizeOrigin(cfg.publicWebUrl);
}

/**
 * Pick the web origin that started a flow: the validated Origin header first (a browser sets it and page script
 * cannot forge it), else an explicit `return_origin`. Null when neither is an allowed origin.
 */
export function pickWebOrigin(
  cfg: OriginCfg,
  headerOrigin: string | null | undefined,
  explicit?: string | null,
): string | null {
  return isAllowedWebOrigin(cfg, headerOrigin) ?? isAllowedWebOrigin(cfg, explicit);
}

/** Base for links the hub sends out: the asking origin when allowed, else configuration, else the legacy default. */
export function webBaseFor(cfg: HubConfig, headerOrigin: string | null | undefined): string {
  return pickWebOrigin(cfg, headerOrigin) ?? configuredWebOrigin(cfg) ?? cfg.webUrl;
}
