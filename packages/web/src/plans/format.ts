import { planBadge, type PlanGenerator } from '@squad/core';

const WORD = { live: 'Live', demo: 'Demo', degraded: 'Degraded' } as const;
export const modeWord = (m: PlanGenerator['mode']) => WORD[m];
export const modeTone = (m: PlanGenerator['mode']): 'live' | 'practice' | 'partly' =>
  m === 'live' ? 'live' : m === 'demo' ? 'practice' : 'partly';

/** The one status line for a plan's mode: the mode once, then why, then who wrote it: "Live · Planner agent". */
export function planModeLine(g: PlanGenerator): string {
  const b = planBadge(g);
  const detail =
    g.mode === 'degraded' && g.reason
      ? `: ${g.reason}`
      : g.mode === 'demo'
        ? ': sample data, scripted'
        : '';
  return `${WORD[g.mode]}${detail} · ${b.kindLabel}`;
}
