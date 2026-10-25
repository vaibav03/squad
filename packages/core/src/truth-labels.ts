// ONE vocabulary for "is this real?" across Squad: chat header, bubbles, council card, Home pill, Connections.
// Plain words, no jargon. The long labels are the full sentence; the short ones fit a badge.
export type TruthState = 'live' | 'partial' | 'practice' | 'notset';

export const TRUTH_LABELS: Record<TruthState, string> = {
  live: 'Live: answered by Gemini',
  partial: 'Partly live',
  practice: 'Practice mode: example answers, not real AI',
  notset: 'Not set up yet',
};

/** Compact badge text per state (chat header and per-message badges). */
export const TRUTH_SHORT: Record<TruthState, string> = {
  live: 'Live provider',
  partial: 'Degraded',
  practice: 'Fixture council',
  notset: 'Not set up',
};

/** Kind of council content visible in a thread. */
export type CouncilTruth = 'live' | 'fixture' | 'degraded';

export interface HeaderTruthInput {
  /** SSE transport: connected | connecting | reconnecting | signed out */
  conn: 'live' | 'connecting' | 'offline' | 'expired';
  online: boolean;
  /** hub /v1/status; null while unknown */
  status: { demo: boolean; probing?: boolean; reason?: string } | null;
  /** truth of every visible council card (empty when none) */
  councils: readonly CouncilTruth[];
}

export interface HeaderTruth {
  /** badge text, exactly */
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'idle' | 'info';
  /** longer sentence for the tooltip / screen readers */
  detail: string;
}

/**
 * The header badge describes the CHAT TRANSPORT and PROVIDER. Fixture or degraded council content visible in the
 * thread is named in the same badge so the header never implies real agents ("Live chat · Example council").
 */
export function headerTruth(i: HeaderTruthInput): HeaderTruth {
  if (i.conn === 'expired')
    return { label: 'Signed out', tone: 'error', detail: 'Your session ended. Sign in again.' };
  if (!i.online)
    return { label: 'Offline', tone: 'warn', detail: 'You are offline. Messages wait here.' };
  if (i.conn === 'offline')
    return { label: 'Reconnecting', tone: 'warn', detail: 'Reconnecting to the squad.' };
  if (i.conn === 'connecting' || !i.status || i.status.probing)
    return { label: 'Connecting', tone: 'idle', detail: 'Checking the connection.' };

  const reason = i.status.reason ?? '';
  const providerLive = !i.status.demo;
  const fixture = i.councils.includes('fixture');
  const degradedCouncil = i.councils.includes('degraded');

  if (providerLive) {
    if (fixture)
      return {
        label: 'Live chat · Example council',
        tone: 'info',
        detail: `${TRUTH_LABELS.live}. The council result shown below is an example, not real agents.`,
      };
    if (degradedCouncil)
      return {
        label: 'Live chat · Degraded council',
        tone: 'warn',
        detail: `${TRUTH_LABELS.live}. The council result shown is only partly live.`,
      };
    return { label: TRUTH_SHORT.live, tone: 'ok', detail: TRUTH_LABELS.live };
  }
  // the model backend is not answering for real
  const notSet = /key|unset|missing|none/i.test(reason) || reason === '';
  if (fixture) return { label: 'Fixture council', tone: 'info', detail: TRUTH_LABELS.practice };
  if (notSet)
    return {
      label: TRUTH_SHORT.notset,
      tone: 'idle',
      detail: `${TRUTH_LABELS.notset}. ${TRUTH_LABELS.practice}`,
    };
  return {
    label: TRUTH_SHORT.partial,
    tone: 'warn',
    detail: `${TRUTH_LABELS.partial}. ${TRUTH_LABELS.practice}`,
  };
}

/** Per-message / per-card badge: its OWN truth, independent of the header. */
export function messageTruth(demo: boolean, mode?: string): { state: TruthState; label: string } {
  if (mode?.startsWith('degraded')) return { state: 'partial', label: 'Degraded' };
  if (demo || mode?.startsWith('demo')) return { state: 'practice', label: 'Example answer' };
  return { state: 'live', label: 'Live' };
}
