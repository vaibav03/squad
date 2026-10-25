import type { HubConfig } from '../config';

export interface ConfigProblem {
  level: 'fatal' | 'warn';
  code: string;
  message: string;
}

const WEAK = new Set(['change-me', 'changeme', 'secret', 'test-secret', 'password', 'dev', '']);

/** Pure check of a config: what must not run in production. Never echoes secret values. */
export function checkConfig(c: HubConfig, o: { allowDemo?: boolean } = {}): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  const add = (level: ConfigProblem['level'], code: string, message: string) =>
    out.push({ level, code, message });
  const weak = (s: string) => WEAK.has(s) || s.length < 16 || s.startsWith('auth:change-me');
  if (c.production) {
    if (weak(c.internalSecret))
      add(
        'fatal',
        'weak_internal_secret',
        'INTERNAL_EVENTS_SECRET is default or shorter than 16 chars',
      );
    if (weak(c.authSecret))
      add(
        'fatal',
        'weak_auth_secret',
        'HUB_AUTH_SECRET is default/derived from a weak secret; set a random 32+ char value',
      );
    if (c.authSecret === `auth:${c.internalSecret}`)
      add(
        'fatal',
        'derived_auth_secret',
        'HUB_AUTH_SECRET must be set separately from INTERNAL_EVENTS_SECRET',
      );
    if (c.seed)
      add(
        o.allowDemo ? 'warn' : 'fatal',
        'seed_in_production',
        'HUB_SEED=1 exposes unauthenticated dev-login to demo students',
      );
    if (c.sim)
      add(
        o.allowDemo ? 'warn' : 'fatal',
        'sim_in_production',
        'HUB_SIM=1 mounts /__sim routes (state reset, event injection)',
      );
    if (c.corsOrigins.includes('*'))
      add('fatal', 'cors_wildcard', 'HUB_CORS_ORIGINS must be an explicit allow-list');
    if (!c.baseUrl.startsWith('https://'))
      add(
        'warn',
        'no_tls',
        'HUB_BASE_URL is not https; wss/https assumed to be terminated by a proxy',
      );
  } else {
    if (c.sim && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(c.baseUrl))
      add(
        'warn',
        'sim_on_public_host',
        'HUB_SIM is on while baseUrl is not localhost: anyone can reset state and inject events',
      );
    if (weak(c.internalSecret))
      add(
        'warn',
        'weak_internal_secret',
        'INTERNAL_EVENTS_SECRET is default (ok for local dev only)',
      );
  }
  return out;
}

/** Throws on fatal problems (boot refusal); logs warnings through `warn`. */
export function assertSafeConfig(
  c: HubConfig,
  warn: (msg: string, f: Record<string, unknown>) => void,
  o: { allowDemo?: boolean } = {},
): void {
  const problems = checkConfig(c, o);
  for (const p of problems)
    if (p.level === 'warn') warn('config warning', { code: p.code, detail: p.message });
  const fatal = problems.filter((p) => p.level === 'fatal');
  if (fatal.length)
    throw new Error(
      `refusing to start with an unsafe production config: ${fatal.map((p) => p.code).join(', ')}`,
    );
}
