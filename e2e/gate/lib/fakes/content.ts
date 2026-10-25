// Original, synthetic course content shared by the fake Canvas and fake Google servers and by the step assertions.
// Nothing here is copied from a real course, institution, or person.
import { SENTINELS } from '../config';

export const COURSE = {
  id: 'c_stat201',
  code: 'STAT 201',
  name: 'Introductory Statistics (synthetic)',
};

/** Due dates are fixed (UTC) so the countdown and "due this week" assertions are deterministic. */
export const ASSIGNMENTS = [
  {
    id: 'a_hw4',
    title: 'Homework 4: Sampling distributions',
    dueAt: '2026-10-29T23:59:00Z',
    description:
      'Compute the standard error of the mean for the three samples in the packet and explain why it shrinks as n grows.',
  },
  {
    id: 'a_lab3',
    title: 'Lab 3: Confidence intervals',
    dueAt: '2026-11-03T17:00:00Z',
    description:
      'Build a 95 percent interval for the dorm sleep survey and interpret it in one paragraph.',
  },
  {
    id: 'a_midterm',
    title: 'Midterm exam (chapters 1 to 6)',
    dueAt: '2026-11-12T15:00:00Z',
    description:
      'In-person. One page of notes allowed. Covers sampling, estimation and the central limit theorem.',
  },
] as const;

export const EVENTS = [
  {
    id: 'e_review',
    title: 'STAT 201 review session',
    startsAt: '2026-11-09T22:00:00Z',
    endsAt: '2026-11-09T23:30:00Z',
  },
  {
    id: 'e_office',
    title: 'STAT 201 office hours',
    startsAt: '2026-10-28T20:00:00Z',
    endsAt: '2026-10-28T21:00:00Z',
  },
] as const;

/** Busy blocks as Google freebusy returns them: intervals only, never titles. */
export const BUSY = [
  ['2026-10-27T14:00:00Z', '2026-10-27T15:00:00Z'],
  ['2026-10-27T18:00:00Z', '2026-10-27T19:30:00Z'],
  ['2026-10-28T13:00:00Z', '2026-10-28T14:00:00Z'],
  ['2026-10-29T16:00:00Z', '2026-10-29T17:30:00Z'],
  ['2026-10-30T19:00:00Z', '2026-10-30T20:00:00Z'],
] as const;

/** The private calendar title Google returns only to a calendar.readonly token. It must never be ingested. */
export const PRIVATE_EVENT = { id: 'g_private', summary: SENTINELS.calTitle };

export const DRIVE_FILES = {
  picked: {
    id: 'd_lecture5',
    name: 'Lecture 5 notes: the central limit theorem',
    text: [
      'Lecture 5: the central limit theorem.',
      'The sampling distribution of the sample mean is approximately normal when n is at least 30, whatever the shape of the population.',
      'The standard error of the mean equals sigma divided by the square root of n.',
      'Doubling the sample size shrinks the standard error by a factor of about 1.41.',
    ].join('\n'),
  },
  unpicked: {
    id: 'd_hidden',
    name: SENTINELS.driveHidden,
    text: 'Private notes the user did not pick.',
  },
} as const;

export const CLASSROOM = {
  course: { id: 'cr_1', name: 'Intro Stats (Classroom, synthetic)' },
  work: [{ id: 'cw_1', title: 'Reading response 2', dueDate: { year: 2026, month: 11, day: 2 } }],
  /** Grades live on submissions; the gate scopes never include them and they must never be stored. */
  submissionGrade: SENTINELS.grade,
};

/**
 * What the HUB's own fixture upstream holds (packages/brain/fixtures/connectors/{canvas,google}.json, served by the
 * in-process fake connectors). These, not the HTTP fakes' data above, are what S1-S3 assert against.
 * Synthetic and original; no real course, institution or person.
 */
export const HUB_FIXTURE = {
  canvas: {
    assignments: [
      { title: 'Assignment 3: Sampling Distributions', due: 'Nov 2' },
      { title: 'Assignment 4: Confidence Intervals', due: 'Nov 16' },
      { title: 'Lab Report 2: Osmosis in Potato Cores', due: 'Nov 5' },
    ],
    announcement: {
      title: 'Midterm review session moved',
      needle: 'midterm review session moved Thursday room',
    },
    file: {
      title: 'week5-sampling-lecture.pdf',
      /** verbatim sentence on page 3 of the file */
      quote:
        'The standard error of the mean equals the population standard deviation divided by the square root of the sample size.',
    },
    /** sources one Canvas fixture connection yields: 3 assignments + 1 announcement (canvas_event) + 1 file */
    counts: { canvas_assignment: 3, canvas_event: 1, canvas_file: 1 } as Record<string, number>,
  },
  google: {
    picked: { id: 'doc-notes-1', title: 'Sampling distributions: my notes' },
    /** in the fixture Drive but NOT picked in the Picker: drive.file must never see it */
    unpicked: {
      id: 'file-sheet-2',
      title: 'survey-results-summary.txt',
      textNeedle: 'Class survey summary',
    },
    /** private calendar titles: never in hub_busy_blocks, never bulk-shared */
    eventTitles: [
      'Study group: sampling distributions',
      'Office hours with the teaching assistant',
    ],
    eventNeedle: 'study group library annex sampling distributions',
    classroom: { title: 'Reflection: when does the mean mislead?' },
    /** with only `picked` chosen: 2 calendar events + 1 picked doc + 1 Classroom item */
    counts: { gcal_event: 2, gdoc: 1, classroom_item: 1 } as Record<string, number>,
  },
  /** raw upstream account ids the hub must never store or return (only a salted hash is kept) */
  rawAccountIds: ['fixture-canvas-user-1', 'fixture.student@example.invalid'],
} as const;

/** Strings that exist only in data that must never reach a squad surface (unpicked Drive file, private calendar titles). */
export const PRIVATE_FIXTURE: string[] = [
  HUB_FIXTURE.google.unpicked.title,
  HUB_FIXTURE.google.unpicked.textNeedle,
  ...HUB_FIXTURE.google.eventTitles,
];

/** What a fixture-world question should be answered from (stable facts for S3/S5 assertions; real hub fixture). */
export const FACTS = {
  /** Nook "what is due" answer: deterministic, produced from the asker's own Canvas sources before any model runs. */
  hw4Question: 'when is the stats homework due?',
  hw4Needle: 'Assignment 3: Sampling Distributions',
  hw4DueDay: 'Nov 2',
  /** content question: answered from retrieved chunks by the model (needs a real LLM to be grounded). */
  cltQuestion: 'what does the standard error of the mean equal?',
  cltQuote: HUB_FIXTURE.canvas.file.quote,
  unsupported: 'what is the capital of Burkina Faso?',
};

const ics = (s: string) => s.replace(/[-:]/g, '').replace(/\.\d+/, '');
export function feedIcs(base: string, extra = 0): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//gate fake canvas//EN'];
  for (const a of ASSIGNMENTS) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-assignment-${a.id}`,
      `DTSTART:${ics(a.dueAt)}`,
      `DTEND:${ics(a.dueAt)}`,
      `SUMMARY:[${COURSE.code}] ${a.title}`,
      `DESCRIPTION:${a.description}\\nGrade so far: ${SENTINELS.grade}`,
      `URL:${base}/courses/${COURSE.id}/assignments/${a.id}`,
      'END:VEVENT',
    );
  }
  for (const e of EVENTS) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-calendar-${e.id}`,
      `DTSTART:${ics(e.startsAt)}`,
      `DTEND:${ics(e.endsAt)}`,
      `SUMMARY:${e.title}`,
      `URL:${base}/calendar?event=${e.id}`,
      'END:VEVENT',
    );
  }
  for (let i = 0; i < extra; i++)
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-bulk-${i}`,
      `DTSTART:${ics('2026-12-01T10:00:00Z')}`,
      `DTEND:${ics('2026-12-01T11:00:00Z')}`,
      `SUMMARY:Bulk event ${i}`,
      'END:VEVENT',
    );
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
