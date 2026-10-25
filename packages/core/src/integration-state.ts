import { z } from 'zod';

/**
 * ONE integration state for Canvas / Google, computed on the hub from the connection record and consumed by every
 * surface (Connections, Home, onboarding, health). Fixture data is always `demo`, never `live`.
 */
export const INTEGRATION_STATES = [
  'not_connected',
  'connecting',
  'syncing',
  'live',
  'demo',
  'degraded',
  'reauth_required',
] as const;
export const IntegrationStateSchema = z.enum(INTEGRATION_STATES);
export type IntegrationState = (typeof INTEGRATION_STATES)[number];

/** `disconnected` is a sub-state of `not_connected`: the person disconnected and the imports were deleted. */
export type IntegrationSub = 'disconnected' | null;

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  not_connected: 'Not connected',
  connecting: 'Connecting',
  syncing: 'Syncing',
  live: 'Live',
  demo: 'Demo data',
  degraded: 'Degraded',
  reauth_required: 'Reconnect needed',
};
export const INTEGRATION_SUB_LABELS = { disconnected: 'Disconnected' } as const;

/** Stable keys of the per-type import counts (every key is always present, 0 when none). */
export const COUNT_TYPES = [
  'courses',
  'modules',
  'assignments',
  'pages',
  'files',
  'announcements',
  'calendarEvents',
  'driveDocs',
  'classroomItems',
] as const;
export type CountType = (typeof COUNT_TYPES)[number];
export type ImportCounts = Record<CountType, number>;
export const COUNT_LABELS: Record<CountType, string> = {
  courses: 'Courses',
  modules: 'Modules',
  assignments: 'Assignments',
  pages: 'Pages',
  files: 'Files',
  announcements: 'Announcements',
  calendarEvents: 'Calendar events',
  driveDocs: 'Drive docs',
  classroomItems: 'Classroom items',
};
