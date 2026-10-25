import type { StepKey } from '../setup/steps';

export interface ChecklistItem {
  key: StepKey;
  title: string;
  /** The Setup step this row opens. */
  to: string;
}

/** The four Home rows are the four Setup steps: same names, same order, same answers (see pages/setup/steps.ts). */
export const HOME_CHECKLIST: readonly ChecklistItem[] = [
  { key: 'context', title: 'Learning context', to: '/squad/setup/context' },
  { key: 'availability', title: 'Availability', to: '/squad/setup/availability' },
  { key: 'messaging', title: 'Messaging', to: '/squad/setup/messaging' },
  { key: 'agent', title: 'Agent', to: '/squad/setup/agent' },
];

/**
 * Static Home cards. The trip card is NOT here: its target is resolved at render time from the squad's real
 * current trip (see home-links.ts), never from a hard-coded trip id.
 */
export const HOME_STATIC_LINKS = [
  {
    to: '/squad/ledger',
    icon: 'ledger',
    title: 'Privacy ledger',
    body: 'What agents shared, and what they kept private.',
  },
  {
    to: '/squad/mastery',
    icon: 'book',
    title: 'Mastery map',
    body: 'Your progress by chapter, next to the squad average.',
  },
  {
    to: '/squad/courses',
    icon: 'book',
    title: 'Courses',
    body: 'Your course library and the chapters your experts learn from.',
  },
] as const;
