import type { SourceRow } from '../connections/api';
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
  courses: 'Course names and codes.',
  assignments: 'Titles and due dates.',
  calendar: 'Your squad sees only when you are busy, not event details.',
  drive: 'Only the files you picked.',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as ShareCategory[];

const KIND_CATEGORY: Record<string, ShareCategory> = {
  classroom_course: 'courses',
  canvas_page: 'courses',
  canvas_assignment: 'assignments',
  classroom_coursework: 'assignments',
  classroom_item: 'assignments',
  gcal_event: 'calendar',
  canvas_event: 'calendar',
  gdrive_file: 'drive',
  gdoc: 'drive',
  pdf: 'drive',
  canvas_file: 'drive',
};
export const categoryOf = (kind: string): ShareCategory | null => KIND_CATEGORY[kind] ?? null;

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
      const k = categoryOf(row.kind);
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
