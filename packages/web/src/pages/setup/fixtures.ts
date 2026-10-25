import type { BusyBlock } from './ics';

export const SAMPLE_COURSES = [
  { name: 'Biology 2e, ch 5 - Cellular respiration.pdf', size: 4_820_000 },
  { name: 'Biology 2e, ch 6 - Photosynthesis.pdf', size: 3_910_000 },
  { name: 'Biology 2e, ch 7 - Cell division.pdf', size: 5_240_000 },
] as const;

export const PERSONA_CHOICES = [
  {
    id: 'buddy-bear',
    name: 'Study buddy',
    blurb: 'Warm, patient, always up for one more question.',
    portrait: 'freshman',
  },
  {
    id: 'owl',
    name: 'Night owl',
    blurb: 'Calm and precise. Best for late sessions.',
    portrait: 'mediator',
  },
  {
    id: 'examiner',
    name: 'The examiner',
    blurb: 'Quizzes you the way your exam will.',
    portrait: 'examiner',
  },
] as const;

/** Deterministic demo week: Mon-Sun, hours as local-day offsets. */
export function demoBlocks(weekStart: Date = mondayOf(new Date())): BusyBlock[] {
  const mk = (day: number, h1: number, h2: number): BusyBlock => {
    const s = new Date(weekStart);
    s.setDate(s.getDate() + day);
    s.setHours(Math.floor(h1), (h1 % 1) * 60, 0, 0);
    const e = new Date(weekStart);
    e.setDate(e.getDate() + day);
    e.setHours(Math.floor(h2), (h2 % 1) * 60, 0, 0);
    return { start: s.toISOString(), end: e.toISOString() };
  };
  return [
    mk(0, 9, 10.5),
    mk(0, 13, 15),
    mk(1, 10, 11),
    mk(1, 16, 18),
    mk(2, 9, 10.5),
    mk(2, 14, 16),
    mk(3, 11, 12.5),
    mk(3, 17, 19),
    mk(4, 9, 10.5),
    mk(4, 12, 13),
    mk(5, 10, 12),
  ];
}

export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
