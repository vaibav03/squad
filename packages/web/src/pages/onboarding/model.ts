import type { Connection, SourceRow } from '../connections/api';
import { deriveProviderState, type ProviderView } from '../connections/connection-state';
import { TOUR_PATH } from './gate';

export const STEP_ORDER = ['connect', 'review', 'share'] as const;
export type TourStep = (typeof STEP_ORDER)[number];
/** Step 1 of 4 is the sign-in that already happened, so the tour starts at "Step 2 of 4". */
export const TOTAL_STEPS = 4;
export const stepNumber = (s: TourStep): number => STEP_ORDER.indexOf(s) + 2;
export const stepLabel = (s: TourStep): string => `Step ${stepNumber(s)} of ${TOTAL_STEPS}`;
export const isTourStep = (s: string | undefined): s is TourStep =>
  !!s && (STEP_ORDER as readonly string[]).includes(s);
export const prevStep = (s: TourStep): TourStep | null =>
  STEP_ORDER[STEP_ORDER.indexOf(s) - 1] ?? null;
export const nextStep = (s: TourStep): TourStep | null =>
  STEP_ORDER[STEP_ORDER.indexOf(s) + 1] ?? null;

export type ShareCategory = 'courses' | 'assignments' | 'calendar' | 'drive';
export const CATEGORY_LABEL: Record<ShareCategory, string> = {
  courses: 'Courses',
  assignments: 'Assignments',
  calendar: 'Calendar free/busy',
  drive: 'Drive documents',
};
export const CATEGORY_HINT: Record<ShareCategory, string> = {
  courses: 'Course names, modules, pages, files and announcements from Canvas.',
  assignments: 'Titles and due dates.',
  calendar: 'Your squad sees only when you are busy, not event details.',
  drive: 'Google Drive documents you picked. Canvas files are under Courses.',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as ShareCategory[];

/** Fallback for a hub that does not send `category`: by kind only (the hub's external-id mapping is more exact). */
const KIND_CATEGORY: Record<string, ShareCategory> = {
  canvas_assignment: 'assignments',
  canvas_file: 'courses', // Canvas files, modules and pages are course material, never Drive
  canvas_page: 'courses',
  classroom_item: 'assignments',
  classroom_course: 'courses',
  classroom_coursework: 'assignments',
  gcal_event: 'calendar',
  canvas_event: 'calendar',
  gdrive_file: 'drive',
  gdoc: 'drive',
  pdf: 'drive',
};
export const categoryOf = (kind: string): ShareCategory | null => KIND_CATEGORY[kind] ?? null;
const isCategory = (c: string | null | undefined): c is ShareCategory =>
  !!c && (CATEGORIES as string[]).includes(c);
export const rowCategory = (r: { category?: string | null; kind: string }): ShareCategory | null =>
  isCategory(r.category) ? r.category : categoryOf(r.kind);

export interface ConnRows {
  connectionId: string;
  rows: SourceRow[];
}

export function groupRows(
  all: ConnRows[],
): Record<ShareCategory, { connectionId: string; row: SourceRow }[]> {
  const out: Record<ShareCategory, { connectionId: string; row: SourceRow }[]> = {
    courses: [],
    assignments: [],
    calendar: [],
    drive: [],
  };
  for (const c of all)
    for (const row of c.rows) {
      const k = rowCategory(row);
      if (k) out[k].push({ connectionId: c.connectionId, row });
    }
  return out;
}

/** Share plan: connection id -> source ids for the categories the person chose to share (default: nothing). */
export function sharePlan(
  grouped: ReturnType<typeof groupRows>,
  chosen: Record<ShareCategory, boolean>,
): Record<string, string[]> {
  const plan: Record<string, string[]> = {};
  for (const k of CATEGORIES)
    if (chosen[k])
      for (const { connectionId, row } of grouped[k]) (plan[connectionId] ??= []).push(row.id);
  return plan;
}

export const DEMO_CANVAS_FEED = 'https://canvas.example.edu/feeds/calendars/user_demo.ics';
export const TOUR_ROOT = TOUR_PATH;
export const TOUR_RETURN = `${TOUR_PATH}/connect`;

/** One data-bearing check shared by the tour, the adapter and the gate (via the one provider state machine). */
const HAS_DATA = new Set(['live', 'demo', 'syncing', 'degraded']);
export function providerViews(conns: readonly Connection[], now = Date.now()) {
  return {
    canvas: deriveProviderState(
      'canvas',
      conns.filter((c) => c.provider === 'canvas'),
      { now },
    ),
    google: deriveProviderState(
      'google',
      conns.filter((c) => c.provider === 'google'),
      { now },
    ),
  };
}
export const providerHasData = (v: ProviderView): boolean => HAS_DATA.has(v.state);
export const anyConnected = (conns: readonly Connection[]): boolean => {
  const v = providerViews(conns);
  return providerHasData(v.canvas) || providerHasData(v.google);
};

/**
 * THE category counts for the review summary and the Share step: one function over the connection list, preferring
 * the hub's per-type `counts` (courses = distinct courses, driveDocs = Google Drive/Docs only) and falling back to
 * the loaded rows when a connection carries no counts.
 */
export function categoryCounts(
  conns: readonly Connection[],
  rows: ConnRows[] | null = null,
): Record<ShareCategory, number> {
  const out: Record<ShareCategory, number> = { courses: 0, assignments: 0, calendar: 0, drive: 0 };
  const grouped = rows ? groupRows(rows) : null;
  for (const c of conns) {
    if (c.state === 'revoked') continue;
    if (c.counts) {
      // Courses = Canvas courses; Google Classroom items are counted (and shared) as assignments
      if (c.provider === 'canvas') out.courses += c.counts.courses ?? 0;
      out.assignments += (c.counts.assignments ?? 0) + (c.counts.classroomItems ?? 0);
      out.calendar += c.counts.calendarEvents ?? 0;
      out.drive += c.counts.driveDocs ?? 0;
    } else if (grouped) {
      for (const k of CATEGORIES)
        out[k] += grouped[k].filter((x) => x.connectionId === c.id).length;
    }
  }
  return out;
}
