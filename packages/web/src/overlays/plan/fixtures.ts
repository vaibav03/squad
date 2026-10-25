import type { PlanView } from '@squad/core';

const item = (
  id: string,
  ownerId: string,
  ownerName: string,
  title: string,
  date: string,
  over: Partial<PlanView['items'][number]> = {},
): PlanView['items'][number] => ({
  id,
  ownerId,
  ownerName,
  kind: 'review',
  title,
  chapter: 'ch6',
  date,
  durationMin: 60,
  status: 'todo',
  rev: 1,
  sources: [{ kind: 'material', label: 'ch6.pdf p.4', file: 'ch6.pdf', page: 4, chapter: 'ch6' }],
  ...over,
});

export const planView = (over: Partial<PlanView> = {}): PlanView => ({
  id: 'pl_abcdefghij',
  squadId: 'sq_demo',
  courseId: 'demo',
  title: 'Midterm study plan',
  status: 'proposed',
  organizerId: 's_ana',
  examDate: '2026-11-10',
  examLabel: 'Midterm',
  rev: 3,
  items: [
    item('it1', 's_ana', 'Ana', 'Chapter 6 review', '2026-11-03'),
    item('it2', 's_ben', 'Ben', 'Chapter 7 teach-back', '2026-11-03', { kind: 'teach', rev: 2 }),
    item('it3', 's_ana', 'Ana', 'Chapter 8 practice', '2026-11-05', {
      kind: 'practice',
      status: 'done',
    }),
  ],
  members: [
    { id: 's_ana', name: 'Ana', optedIn: true, response: 'accepted' },
    { id: 's_ben', name: 'Ben', optedIn: true, response: 'pending' },
    { id: 's_cy', name: 'Cy', optedIn: true, response: 'declined' },
  ],
  conflicts: [],
  citations: [
    { kind: 'material', label: 'ch6.pdf p.4', file: 'ch6.pdf', page: 4, chapter: 'ch6' },
    { kind: 'due', label: 'Problem set 3 due 2026-11-06' },
  ],
  generator: { mode: 'demo', source: 'scripted', note: 'Scripted demo plan.' },
  createdAt: 1,
  updatedAt: 2,
  me: { id: 's_ana', response: 'accepted', optedIn: true, isOrganizer: true },
  countdown: { days: 6, words: '6 days to the exam' },
  progress: { done: 1, total: 3, words: '1 of 3 items done' },
  load: [
    { memberId: 's_ana', name: 'Ana', items: 2, done: 1, minutes: 120 },
    { memberId: 's_ben', name: 'Ben', items: 1, done: 0, minutes: 60 },
  ],
  availability: { mine: [{ itemId: 'it1', busy: true }], squad: null },
  myWeakTopics: ['ch7'],
  replyHelp: 'Reply "@nook plan 1" to accept or "@nook plan 2" to decline.',
  saved: { rev: 3, lastEditedBy: 's_ben', lastEditedAt: 1_000_000 - 4 * 60_000 },
  sync: {
    posted: { at: 1_000_000 - 5 * 60_000, text: 'Ana proposed a study plan' },
    imessage: 'dry_run',
  },
  ...over,
});

export const conflictedPlan = (): PlanView =>
  planView({
    conflicts: [
      {
        id: 'cf1',
        itemId: 'it1',
        status: 'open',
        theirs: {
          ownerId: 's_ben',
          date: '2026-11-04',
          durationMin: 60,
          title: 'Chapter 6 review',
        },
        theirsBy: 'Ben',
        mine: { ownerId: 's_ana', date: '2026-11-05', durationMin: 90, title: 'Chapter 6 review' },
        mineBy: 'Ana',
        baseRev: 1,
        ts: 5,
      },
    ],
  });
