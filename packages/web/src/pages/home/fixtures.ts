export interface ChecklistItem {
  key: 'phone' | 'courses' | 'calendar' | 'persona';
  title: string;
  body: string;
  /** The exact next step this row opens. */
  to: string;
  /** The other way to do the same thing (after the lead way). */
  alt?: { label: string; to: string };
}

export const HOME_CHECKLIST: readonly ChecklistItem[] = [
  {
    key: 'courses',
    title: 'Connect Canvas or Google Classroom',
    body: 'Your agents learn from your real courses.',
    to: '/squad/connections#canvas',
    alt: { label: 'or upload course PDFs', to: '/squad/setup/courses' },
  },
  {
    key: 'calendar',
    title: 'Connect Google Calendar',
    body: 'Only free or busy leaves your account, never event titles.',
    to: '/squad/connections#google',
    alt: { label: 'or import a calendar file', to: '/squad/setup/calendar' },
  },
  {
    key: 'phone',
    title: 'Connect iMessage via Sendblue',
    body: 'So your agent can text you.',
    to: '/squad/setup/phone',
  },
  {
    key: 'persona',
    title: 'Pick your study buddy',
    body: 'Choose a voice and a face you like.',
    to: '/squad/personas',
  },
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
