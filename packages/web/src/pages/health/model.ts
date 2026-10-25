import type { HealthCheck, HealthGroup, HealthReport, HealthStatus } from '@squad/core';

export const GROUP_TITLE: Record<HealthGroup, string> = {
  canvas: 'Canvas',
  google: 'Google Workspace',
  chain: 'Chain: context to chat, plan and trip',
  sendblue: 'iMessage (Sendblue)',
  platform: 'Platform',
};
export const GROUP_ORDER: HealthGroup[] = ['canvas', 'google', 'chain', 'sendblue', 'platform'];

export const STATUS_WORD: Record<HealthStatus, string> = {
  pass: 'Pass',
  warn: 'Warn',
  fail: 'Fail',
  blocked: 'BLOCKED',
};
export const STATUS_TONE: Record<HealthStatus, 'ok' | 'ember' | 'alert' | 'violet'> = {
  pass: 'ok',
  warn: 'ember',
  fail: 'alert',
  blocked: 'violet',
};

export function groupChecks(r: HealthReport): { group: HealthGroup; checks: HealthCheck[] }[] {
  return GROUP_ORDER.map((group) => ({ group, checks: r.checks.filter((c) => c.group === group) })).filter(
    (g) => g.checks.length > 0,
  );
}

/** The banner shows for any fail, or a warn on a core chain link (Canvas, Google, or the context chain). */
export function bannerChecks(r: HealthReport): HealthCheck[] {
  return r.checks.filter(
    (c) => c.status === 'fail' || (c.status === 'warn' && ['canvas', 'google', 'chain'].includes(c.group)),
  );
}

export const countByStatus = (r: HealthReport): Record<HealthStatus, number> => {
  const o: Record<HealthStatus, number> = { pass: 0, warn: 0, fail: 0, blocked: 0 };
  for (const c of r.checks) o[c.status]++;
  return o;
};
