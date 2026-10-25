import { summarizeConnections, type ConnPhase } from '../../lib/connection-phase';
import type { Connection } from './api';
import type { ConnectionsState } from './useConnections';

export interface NextStep {
  /** Rendered by <Page> as "Next: ..." */
  next: string;
  /** The ONE primary call to action of the page (none while loading). */
  cta: { label: string; kind: 'hash' | 'route' | 'retry'; to?: string } | null;
}

const KEY = 'squad.connections.reviewed';
export function markReviewed(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage blocked: the page keeps suggesting the review, harmless
  }
}
const wasReviewed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

const BAD: ConnPhase[] = ['reauth', 'degraded'];

/** What the page tells a customer to do next, by state. Pure apart from the "already reviewed" memory. */
export function nextStep(
  view: ConnectionsState['view'],
  connections: Connection[],
  reviewed: boolean = wasReviewed(),
): NextStep {
  if (view === 'loading') return { next: 'checking what is connected', cta: null };
  if (view === 'offline')
    return {
      next: 'try again when Squad is reachable',
      cta: { label: 'Try again', kind: 'retry' },
    };
  if (view === 'demo')
    return {
      next: 'sign in to connect Canvas or Google',
      cta: { label: 'Sign in', kind: 'route', to: '/welcome' },
    };
  const s = summarizeConnections(connections);
  const canvas = s.canvas.phase;
  const google = s.classroom.phase;
  if (BAD.includes(canvas))
    return {
      next: canvas === 'reauth' ? 'sign in to Canvas again' : 'check Canvas',
      cta: {
        label: canvas === 'reauth' ? 'Sign in to Canvas again' : 'Check Canvas',
        kind: 'hash',
        to: '#canvas',
      },
    };
  if (BAD.includes(google))
    return {
      next: google === 'reauth' ? 'sign in to Google again' : 'check Google',
      cta: {
        label: google === 'reauth' ? 'Sign in to Google again' : 'Check Google',
        kind: 'hash',
        to: '#google',
      },
    };
  const connected = (p: ConnPhase) => p !== 'not_connected' && p !== 'connecting';
  if (!connected(canvas) && !connected(google))
    return {
      next: 'connect Canvas or Google',
      cta: { label: 'Connect Canvas or Google', kind: 'hash', to: '#canvas' },
    };
  const items = s.canvas.items + (s.classroom.connection?.sources.total ?? 0);
  if (items > 0 && !reviewed)
    return {
      next: 'review what was imported',
      cta: { label: 'Review imported context', kind: 'hash', to: '#imported' },
    };
  return {
    next:
      connected(canvas) && connected(google)
        ? 'Everything is connected. Ask Cubbie in the group chat.'
        : 'ask Cubbie, or connect the other one too',
    cta: { label: 'Ask Cubbie in the group chat', kind: 'route', to: '/squad/chat' },
  };
}
