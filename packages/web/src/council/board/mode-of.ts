import type { CouncilResult } from '@squad/core';

/**
 * Honest mode of a finished council run for its badge: scripted answers are always Demo; a live run where a member
 * did not answer is Degraded (with the reason in words); everything else is Live.
 */
export function resultMode(r: Pick<CouncilResult, 'demo' | 'members'> & { mode?: string }): string {
  if (r.mode) return r.mode; // the runtime's own honest status, decided once and only worsened
  if (r.demo) return 'demo';
  if (r.members.some((m) => m.status === 'failed')) return 'degraded:member_missing';
  return 'live';
}
