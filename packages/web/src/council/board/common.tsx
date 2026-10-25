import { a2aPartyName, modeInfo, type A2aStatus, type BoardRole } from '@squad/village/council';

export const STATUS_LABEL: Record<A2aStatus, string> = {
  queued: 'Waiting',
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  partial: 'Partial',
};
export const STATUS_GLYPH: Record<A2aStatus, string> = {
  queued: '○',
  working: '◐',
  done: '✓',
  failed: '✕',
  skipped: '–',
  partial: '◑',
};
export const ROLE_LABEL: Record<BoardRole, string> = {
  chair: 'Chair',
  specialist: 'Specialist',
  code: 'Checked in code',
};

/** Confidence is always a word, never a meter or number. */
export function confidenceWord(c: string | undefined): string | undefined {
  if (!c) return undefined;
  if (c === 'sure') return 'Sure';
  if (c === 'fairly_sure') return 'Fairly sure';
  if (c === 'unsure') return 'Unsure';
  const w = c.replace(/[_-]+/g, ' ').trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : undefined;
}

/** Non-live messages carry a mode badge; live ones stay quiet. */
export const showsMode = (mode: string | undefined): boolean => modeInfo(mode).tier !== 'live';

export function StatusChip({ status }: { status: A2aStatus }) {
  return (
    <span className="cb-status" data-status={status}>
      <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** Agent ids never reach the screen: a rank `order` entry that still looks like an id goes through the resolver. */
export const displayName = (s: string): string => (/^[a-z]+:/i.test(s) ? a2aPartyName(s) : s);

export const classes = (...c: Array<string | false | undefined>): string =>
  c.filter(Boolean).join(' ');
