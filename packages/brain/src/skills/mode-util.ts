import { modeKind, type AgentMode, type NonLiveMode } from '@squad/core';
import { degraded, degradedReason, decideRunMode, type ModeInputs } from '../agents/mode';

/** Optional mode source for the single-agent judges. Absent means "as before": real model assumed, fallbacks labelled by cause. */
export interface ModeDeps {
  mode?: () => AgentMode;
}

/** The run's mode, decided ONCE per session/turn (call this at the start, keep the result). */
export const startMode = (d: ModeDeps): AgentMode => d.mode?.() ?? 'live';

/** `mode` getter for hubs: wraps the one decision point `decideRunMode`. */
export const modeGetter =
  (inputs: () => ModeInputs): (() => AgentMode) =>
  () =>
    decideRunMode(inputs());

/**
 * Mode of a scripted fallback. A run that started demo stays demo; a run that started live and lost its model is
 * `degraded:<reason>` (never scripted-as-live).
 */
export function fallbackMode(start: AgentMode, err?: unknown): NonLiveMode {
  if (modeKind(start) !== 'live') return start as NonLiveMode;
  return degraded(degradedReason(err)) as NonLiveMode;
}

/** Short plain label for user-visible fallback text ('' for live). */
export function modeLabel(mode: AgentMode): string {
  if (mode === 'live') return '';
  if (modeKind(mode) === 'degraded')
    return `(Degraded: ${mode.slice(9).replace(/_/g, ' ')}, scripted) `;
  return '(Demo, scripted, not Gemini) ';
}

/** Appends the mode to a session's worst mode: demo beats degraded beats live. */
export const worse = (a: AgentMode, b: AgentMode): AgentMode =>
  modeKind(a) === 'demo' ? a : modeKind(b) === 'demo' ? b : modeKind(a) === 'degraded' ? a : b;
