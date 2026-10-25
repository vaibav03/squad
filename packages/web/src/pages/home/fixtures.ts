export const HOME_CHECKLIST = [
  {
    key: 'phone',
    title: 'Link your phone',
    body: 'So your agent can text you in iMessage.',
    to: '/squad/setup/phone',
    done: false,
  },
  {
    key: 'courses',
    title: 'Add your course PDFs',
    body: 'Your experts learn from these chapters.',
    to: '/squad/setup/courses',
    done: false,
  },
  {
    key: 'calendar',
    title: 'Share your busy times',
    body: 'Only free or busy leaves your device.',
    to: '/squad/setup/calendar',
    done: false,
  },
  {
    key: 'persona',
    title: 'Pick your study buddy',
    body: 'Choose a voice and a face you like.',
    to: '/squad/personas',
    done: false,
  },
] as const;

export const HOME_LINKS = [
  {
    to: '/squad/ledger',
    icon: 'ledger',
    title: 'Glass Box',
    body: 'See exactly what each agent shared, and what it kept private.',
  },
  {
    to: '/squad/trips/spring-break',
    icon: 'plane',
    title: 'Spring break trip',
    body: 'Vote on options and confirm when you are in.',
  },
  {
    to: '/squad/mastery',
    icon: 'book',
    title: 'Mastery map',
    body: 'Your progress by chapter, next to the squad average.',
  },
] as const;
