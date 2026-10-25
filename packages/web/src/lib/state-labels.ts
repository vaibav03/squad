/**
 * ONE vocabulary for "is this real?" across the product. Every badge, banner, pill and card that says whether
 * something is live, partly live, practice (fixture/demo) or not set up reads from here, so the customer sees the
 * same words on every screen.
 *
 *   live      the real thing answered / is connected
 *   partial   it worked, but part of it did not (one council member timed out, one provider degraded)
 *   practice  example data or scripted answers; nothing real happened
 *   notset    needs a setting or an account link before it can work
 *   offline   Squad cannot reach the server right now
 *   checking  still finding out
 */
export type TruthState = 'live' | 'partial' | 'practice' | 'notset' | 'offline' | 'checking';

export interface TruthLabel {
  /** Short text for pills and chips. */
  short: string;
  /** Full customer sentence (tooltips, banners, empty states). */
  sentence: string;
  icon: 'check' | 'info' | 'alert' | 'refresh' | 'lock';
}

export const TRUTH_LABELS: Record<TruthState, TruthLabel> = {
  live: { short: 'Live', sentence: 'Live: answered by Gemini', icon: 'check' },
  partial: {
    short: 'Partly live',
    sentence: 'Partly live: one member could not answer',
    icon: 'alert',
  },
  practice: {
    short: 'Practice mode',
    sentence: 'Practice mode: example answers, not real AI',
    icon: 'info',
  },
  notset: {
    short: 'Not set up yet',
    sentence: 'Not set up yet: add the missing setting to turn this on',
    icon: 'lock',
  },
  offline: {
    short: 'Offline',
    sentence: 'Offline: Squad cannot reach the server. Check your connection and try again',
    icon: 'alert',
  },
  checking: { short: 'Checking', sentence: 'Checking what is available...', icon: 'refresh' },
};

/** "Not set up yet: add X to turn this on" */
export function notSetUp(what: string): string {
  return `Not set up yet: add ${what} to turn this on`;
}

/** Top bar wording for the whole system (what the coordinator asked for: no bare "Live"). */
export const SYSTEM_PILL: Record<TruthState, string> = {
  live: 'System live',
  partial: 'Degraded',
  practice: 'Demo data',
  notset: 'Not set up yet',
  offline: 'Offline',
  checking: 'Checking',
};

/** GET /v1/status -> a TruthState plus a short reason for a degraded provider. */
export interface HubStatusLike {
  llm?: string;
  demo?: boolean;
  probing?: boolean;
  reason?: string;
}
const DEGRADED_REASON: Record<string, string> = {
  rate_limited: 'Gemini is busy',
  credits_depleted: 'Gemini credits ran out',
  invalid_key: 'Gemini key was rejected',
};
export function truthFromStatus(s: HubStatusLike | null | undefined): {
  state: TruthState;
  reason?: string;
} {
  if (!s) return { state: 'checking' };
  if (s.probing) return { state: 'checking' };
  if (!s.demo && s.llm !== 'fake') return { state: 'live' };
  const reason = s.reason ? DEGRADED_REASON[s.reason] : undefined;
  if (reason) return { state: 'partial', reason };
  return { state: 'practice' };
}
