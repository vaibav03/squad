import { connectionState, GOOGLE_SCOPES } from '@squad/brain';
import { configuredWebOrigin, isAllowedWebOrigin } from '../../web-origin';
import { contextServiceFor } from '../../context/service';
import { registerHealthCheck, type HealthCtx, type HealthResult } from '../registry';

const CONN = '/squad/connections';
export const GOOGLE_ENV = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'] as const;
const REQUIRED: [string, string][] = [
  [GOOGLE_SCOPES.calendar, 'calendar.readonly'],
  [GOOGLE_SCOPES.classroomCourses, 'classroom.courses.readonly'],
  [GOOGLE_SCOPES.classroomWork, 'classroom.coursework.me.readonly'],
  [GOOGLE_SCOPES.drive, 'drive.file'],
];

const googleOf = (ctx: HealthCtx) => {
  const svc = contextServiceFor(ctx.deps);
  const all = svc.store.connectionsOf(ctx.viewer.studentId).filter((c) => c.provider === 'google' && c.status !== 'revoked');
  return { svc, all };
};
const missingEnv = () => GOOGLE_ENV.filter((n) => !process.env[n]);

export function googleConnected(ctx: HealthCtx): HealthResult {
  const { svc, all } = googleOf(ctx);
  const label = 'Google connected';
  const states = all.map((c) => ({ c, st: connectionState(c) }));
  const real = states.filter((x) => x.c.mode === 'live');
  if (all.length === 0) {
    if (!svc.googleOAuth)
      return {
        label,
        status: 'blocked',
        mode: 'not connected',
        missingEnv: missingEnv() as string[],
        reason: `Live Google is blocked: set ${missingEnv().join(', ') || 'the Google OAuth env'} on the hub. The labelled fixture simulator still works.`,
        fix: { label: 'Try the fixture', to: CONN },
      };
    return { label, status: 'warn', mode: 'not connected', reason: 'Google is not connected.', fix: { label: 'Connect Google', to: CONN } };
  }
  const bad = states.find((x) => x.st === 'expired');
  if (bad)
    return {
      label,
      status: 'fail',
      mode: 'expired',
      reason: 'The Google grant expired and could not be renewed. Imported data is kept but may be out of date.',
      fix: { label: 'Reconnect Google', to: CONN },
    };
  const err = states.find((x) => x.st === 'error' || x.st === 'rate_limited');
  if (err)
    return { label, status: 'warn', mode: err.st, reason: 'Google is failing or rate limiting; showing the last imported data.', fix: { label: 'Sync again', to: CONN } };
  if (real.length === 0)
    return {
      label,
      status: 'blocked',
      mode: 'fixture',
      ...(svc.googleOAuth ? {} : { missingEnv: missingEnv() as string[] }),
      reason: svc.googleOAuth
        ? 'Fixture (simulated, not your account). Real Google is configured: connect it to replace the demo data.'
        : `Fixture (simulated, not your account). Live Google is blocked: set ${missingEnv().join(', ')}.`,
      fix: svc.googleOAuth ? { label: 'Connect real Google', to: CONN } : { label: 'See setup', to: CONN },
    };
  const c = real[0]!.c;
  const acct = svc.accounts.get(c.id)?.label ?? 'account';
  const lacking = REQUIRED.filter(([full]) => !c.scopes.includes(full)).map(([, s]) => s);
  return {
    label,
    status: lacking.length ? 'warn' : 'pass',
    mode: 'real',
    facts: { account: acct, granted: c.scopes.length, missing: lacking.length },
    reason: lacking.length
      ? `Connected as ${acct}, but these permissions were not granted: ${lacking.join(', ')}.`
      : `Connected as ${acct} with ${c.scopes.length} read-only permissions.`,
    ...(lacking.length ? { fix: { label: 'Reconnect and allow all', to: CONN } } : {}),
  };
}

export function googleSynced(ctx: HealthCtx): HealthResult {
  const { svc, all } = googleOf(ctx);
  const label = 'Google synced';
  if (all.length === 0)
    return { label, status: 'warn', reason: 'Nothing to sync: Google is not connected.', fix: { label: 'Connect Google', to: CONN } };
  const byKind: Record<string, number> = {};
  for (const c of all) for (const s of svc.store.sourcesOfConnection(c.id)) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  const last = Math.max(0, ...all.map((c) => c.lastSyncAt ?? 0)) || null;
  const fixture = all.every((c) => c.mode === 'fixture');
  const facts: Record<string, string | number | boolean | null> = { items: total, lastSyncAt: last, fixture, ...byKind };
  if (last === null || total === 0)
    return {
      label,
      status: 'warn',
      mode: fixture ? 'fixture' : 'real',
      facts,
      reason: last === null ? 'Connected but never synced.' : 'Synced, but no items were imported.',
      fix: { label: 'Sync now', to: CONN },
    };
  const mins = Math.max(0, Math.round((ctx.now - last) / 60000));
  return {
    label,
    status: 'pass',
    mode: fixture ? 'fixture' : 'real',
    facts,
    reason: `${total} item${total === 1 ? '' : 's'} (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}), last synced ${mins} min ago${fixture ? ' (fixture data)' : ''}.`,
  };
}

/** The origin the OAuth callback would send the browser back to, versus the origin actually being served. */
export function redirectOrigin(ctx: HealthCtx): HealthResult {
  const cfg = ctx.deps.config;
  const label = 'OAuth returns to the served origin';
  const configured = configuredWebOrigin(cfg);
  const svc = contextServiceFor(ctx.deps);
  const redirectUri = svc.googleOAuth?.redirectUri;
  const facts: Record<string, string | null> = { configured, redirectUri: redirectUri ?? null };
  if (!ctx.servedOrigin)
    return { label, status: 'warn', facts, reason: 'The served web origin could not be determined from this request.', fix: { label: 'Open Connections from the app', to: CONN } };
  const allowed = isAllowedWebOrigin(cfg, ctx.servedOrigin);
  if (!allowed)
    return {
      label,
      status: 'fail',
      facts: { ...facts, served: ctx.servedOrigin },
      reason: `The served origin ${ctx.servedOrigin} is not allowed, so the OAuth callback would NOT return here and falls back to ${configured ?? 'a plain page'}. Add it to CORS_ORIGINS or set PUBLIC_WEB_URL.`,
      fix: { label: 'Set PUBLIC_WEB_URL', api: 'env:PUBLIC_WEB_URL' },
    };
  facts.served = allowed;
  if (configured && configured !== allowed)
    return {
      label,
      status: 'warn',
      facts,
      reason: `Served at ${allowed} but PUBLIC_WEB_URL is ${configured}. Flows started here return here, but flows without an origin go to ${configured}.`,
      fix: { label: 'Align PUBLIC_WEB_URL', api: 'env:PUBLIC_WEB_URL' },
    };
  if (cfg.production && !configured)
    return { label, status: 'fail', facts, reason: 'PUBLIC_WEB_URL is not set in production; the callback has no fallback origin.', fix: { label: 'Set PUBLIC_WEB_URL', api: 'env:PUBLIC_WEB_URL' } };
  return { label, status: 'pass', facts, reason: `The callback returns to ${allowed}, the origin being served.` };
}

export function registerGoogleChecks(): void {
  registerHealthCheck('google_connected', 'google', 20, googleConnected);
  registerHealthCheck('google_synced', 'google', 21, googleSynced);
  registerHealthCheck('redirect_origin', 'google', 22, redirectOrigin);
}
