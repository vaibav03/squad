import type { Connection } from '../pages/connections/api';

/**
 * THE one connection state machine. Onboarding, Home, Setup, Connections and the chat banner all read it, so no screen
 * can call demo data "Live" and no screen disagrees about whether Google is connected.
 */
export type ConnPhase =
  | 'not_connected'
  | 'connecting'
  | 'syncing'
  | 'live'
  | 'demo'
  | 'degraded'
  | 'reauth';

export const PHASE_LABEL: Record<ConnPhase, string> = {
  not_connected: 'Not connected',
  connecting: 'Connecting...',
  syncing: 'Syncing...',
  live: 'Live',
  demo: 'Demo data',
  degraded: 'Needs attention',
  reauth: 'Sign in again',
};

/** Customer sentence for each phase (tooltips, banners, setup rows). */
export const PHASE_SENTENCE: Record<ConnPhase, string> = {
  not_connected: 'Not connected yet.',
  connecting: 'Connecting. This can take a few seconds.',
  syncing: 'Importing your items. This can take a minute.',
  live: 'Live: imported from your own account.',
  demo: 'Demo data: example items, not your account.',
  degraded: 'Needs attention: showing the last items we imported.',
  reauth: 'Sign in again to keep syncing.',
};

type PhaseInput = Pick<Connection, 'mode' | 'state' | 'syncPhase'> & { degraded?: boolean };

export function phaseOf(c: PhaseInput | null | undefined): ConnPhase {
  if (!c) return 'not_connected';
  if (c.state === 'revoked') return 'not_connected';
  if (c.state === 'expired') return 'reauth';
  if (c.state === 'error' || c.state === 'rate_limited' || c.degraded) return 'degraded';
  if (c.syncPhase === 'syncing') return 'syncing';
  return c.mode === 'fixture' || c.state === 'fixture' ? 'demo' : 'live';
}

export const phaseHasData = (p: ConnPhase): boolean =>
  p === 'live' || p === 'demo' || p === 'degraded' || p === 'syncing';

export interface SourceSummary {
  phase: ConnPhase;
  /** Imported item count (0 when not connected). */
  items: number;
  byKind: Record<string, number>;
  connection: Connection | null;
}

const CAL = new Set(['gcal_event', 'canvas_event']);

function best(list: Connection[]): Connection | null {
  const rank: Record<ConnPhase, number> = {
    live: 6,
    syncing: 5,
    demo: 4,
    degraded: 3,
    reauth: 2,
    connecting: 1,
    not_connected: 0,
  };
  return [...list].sort((a, b) => rank[phaseOf(b)] - rank[phaseOf(a)])[0] ?? null;
}
function summary(c: Connection | null, only?: (k: string) => boolean): SourceSummary {
  if (!c) return { phase: 'not_connected', items: 0, byKind: {}, connection: null };
  const byKind = Object.fromEntries(
    Object.entries(c.sources.byKind).filter(([k]) => (only ? only(k) : true)),
  );
  const items = Object.values(byKind).reduce((a, n) => a + n, 0);
  return { phase: phaseOf(c), items: only ? items : c.sources.total, byKind, connection: c };
}

/** What the four Setup steps and Home read: learning context (Canvas, Classroom, PDFs) and availability (calendar). */
export function summarizeConnections(conns: Connection[]) {
  const canvas = summary(best(conns.filter((c) => c.provider === 'canvas')));
  const google = best(conns.filter((c) => c.provider === 'google'));
  const classroom = summary(google, (k) => k.startsWith('classroom') || k === 'gdoc' || k === 'gdrive_file');
  const calendar = summary(google, (k) => CAL.has(k));
  const canvasCal = summary(canvas.connection, (k) => CAL.has(k));
  return { canvas, classroom, calendar, canvasCalendar: canvasCal };
}
