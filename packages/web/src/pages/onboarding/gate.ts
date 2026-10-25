import type { OnboardingState } from './api';

export type GateView = 'loading' | 'gate' | 'banner' | 'open';

/**
 * What the chat shows for a first-run state:
 * - gate:   nobody connected anything and nobody skipped: full-width guided interstitial
 * - banner: skipped and still nothing connected: chat works, with a quiet "Limited context" banner
 * - open:   connected, or we cannot tell (the gate never blocks chat on a failed read)
 */
export function gateView(state: OnboardingState | null): GateView {
  if (!state) return 'loading';
  if (state.connected === null || state.connected) return 'open';
  return state.skipped ? 'banner' : 'gate';
}

export const GATE_TITLE =
  'Connect your learning context so Cubbie can answer from your real courses';
export const SKIP_EXPLAIN =
  'Agents will have limited context: they can only use what you type or upload. You can connect any time from Connections.';
export const BANNER_TEXT = 'Limited context: connect Canvas or Google';
export const TOUR_PATH = '/squad/welcome-tour';
