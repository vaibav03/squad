// The single server-side integration state function (docs/integration-health.md). Web, onboarding and health all use it.
import {
  COUNT_TYPES,
  type ImportCounts,
  type IntegrationState,
  type IntegrationSub,
} from '@squad/core';
import type { ContextConnection, ContextSource, ContextSyncState } from '@squad/brain';

export interface IntegrationStateInfo {
  state: IntegrationState;
  sub: IntegrationSub;
}

/** One connection -> one state. Fixture mode is `demo` and can never be `live`. */
export function integrationStateOf(
  c: Pick<ContextConnection, 'mode' | 'status' | 'degraded' | 'lastSyncAt'>,
  sync?: Pick<ContextSyncState, 'startedAt'>,
): IntegrationStateInfo {
  if (c.status === 'revoked') return { state: 'not_connected', sub: 'disconnected' };
  if (c.status === 'expired') return { state: 'reauth_required', sub: null };
  if (c.status === 'error' || c.status === 'rate_limited' || c.degraded)
    return { state: 'degraded', sub: null };
  if (sync && sync.startedAt !== null) return { state: 'syncing', sub: null };
  if (c.lastSyncAt === null) return { state: 'connecting', sub: null };
  return { state: c.mode === 'fixture' ? 'demo' : 'live', sub: null };
}

const RANK: IntegrationState[] = [
  'reauth_required',
  'degraded',
  'syncing',
  'connecting',
  'live',
  'demo',
  'not_connected',
];

/** A provider with several connections: the one that needs attention first, then the best working one. */
export function rollupState(infos: IntegrationStateInfo[]): IntegrationStateInfo {
  const active = infos.filter((i) => i.state !== 'not_connected');
  if (active.length === 0)
    return {
      state: 'not_connected',
      sub: infos.some((i) => i.sub === 'disconnected') ? 'disconnected' : null,
    };
  return [...active].sort((a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state))[0]!;
}

/** Human-type counts from imported sources, by external id prefix (stable keys, all present). */
export function importCounts(sources: ContextSource[]): ImportCounts {
  const n = Object.fromEntries(COUNT_TYPES.map((k) => [k, 0])) as ImportCounts;
  const courses = new Set<string>();
  for (const s of sources) {
    const p = s.externalId.split(':')[0];
    if (s.courseId) courses.add(s.courseId);
    if (p === 'module') n.modules++;
    else if (p === 'page') n.pages++;
    else if (p === 'file') n.files++;
    else if (p === 'assignment') n.assignments++;
    else if (p === 'announcement') n.announcements++;
    else if (p === 'drive') n.driveDocs++;
    else if (p === 'classroom') n.classroomItems++;
    else if (p === 'event' || p === 'cal' || p === 'feed') n.calendarEvents++;
    else if (s.kind === 'canvas_assignment') n.assignments++;
    else if (s.kind === 'canvas_file') n.files++;
    else if (s.kind === 'gcal_event' || s.kind === 'canvas_event') n.calendarEvents++;
  }
  n.courses = courses.size;
  return n;
}

/** The four sharing categories shown to the customer (first-run Share step, Connections). One mapping, server side. */
export type ShareCategory = 'courses' | 'assignments' | 'calendar' | 'drive';

/**
 * Which sharing category a source belongs to. Canvas modules, pages, files and announcements are COURSE material
 * (never Drive); Drive documents are Google Drive/Docs sources only. Uses the external id prefix first because the
 * Canvas demo stores modules and pages as `canvas_file` and announcements as `canvas_event`.
 */
export function shareCategory(
  s: Pick<ContextSource, 'externalId' | 'kind' | 'dueAt'>,
): ShareCategory {
  const p = s.externalId.split(':')[0];
  if (p === 'module' || p === 'page' || p === 'file' || p === 'announcement') return 'courses';
  if (p === 'assignment') return 'assignments';
  if (p === 'drive') return 'drive';
  if (p === 'classroom') return 'assignments';
  if (p === 'event' || p === 'cal' || p === 'feed') return 'calendar';
  switch (s.kind) {
    case 'canvas_assignment':
      return 'assignments';
    case 'gcal_event':
    case 'canvas_event':
      return 'calendar';
    case 'gdoc':
    case 'gdrive_file':
    case 'pdf':
      return 'drive';
    case 'classroom_item':
      return 'assignments';
    default:
      return 'courses';
  }
}
