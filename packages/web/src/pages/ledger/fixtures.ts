import type { VillageEvent } from '@squad/core';
import type { RecordedScript } from '../../overlays/kit';
import type { RosterMember, SnapshotEntry } from './model';

export const TASK_ID = 'task_group_study';
export const TASK_TITLE = 'Group study: BIO 201 midterm';

export const roster: RosterMember[] = [
  { id: 's_ana', name: 'Ana' },
  { id: 's_ben', name: 'Ben' },
  { id: 's_chi', name: 'Chi' },
  { id: 's_dev', name: 'Dev' },
];

type LedgerEv = Extract<VillageEvent, { t: 'ledger.entry' }>;
const e = (student: string, field: string, rest: Partial<LedgerEv> = {}): LedgerEv => ({
  t: 'ledger.entry',
  taskId: TASK_ID,
  student,
  field,
  ...rest,
});

/** The recorded run, in the shape the hub sends it (viewer already filtered: withheld is only 'hidden'). */
export const recordedScript: RecordedScript<VillageEvent> = [
  { at: 400, event: e('s_ana', 'Free time', { shared: 'Tue 2 to 4 pm, Thu after 5 pm' }) },
  { at: 1500, event: e('s_ben', 'Free time', { shared: 'Tue 1 to 5 pm' }) },
  { at: 2400, event: e('s_ana', 'Other plans on Tuesday', { withheld: 'hidden' }) },
  { at: 3300, event: e('s_chi', 'Free time', { shared: 'Tue 2 to 3:30 pm' }) },
  { at: 4200, event: e('s_ben', 'Why Wednesday is busy', { withheld: 'hidden' }) },
  { at: 5200, event: e('s_dev', 'Free time', { shared: 'Tue 2 to 4 pm, Fri morning' }) },
  { at: 6200, event: e('s_chi', 'Full class schedule', { blocked: true }) },
  { at: 7200, event: e('s_dev', 'Preferred room', { shared: 'Any quiet room in the library' }) },
  { at: 8200, event: e('s_dev', 'Reason for leaving early', { withheld: 'hidden' }) },
  { at: 9400, event: e('s_ana', 'Meeting slot', { shared: 'Tue 2 to 3:30 pm works for everyone' }) },
];

/** Same data as one snapshot (used for the ready, first-paint states). */
export const snapshot: SnapshotEntry[] = recordedScript.map((s, i) => {
  const ev = s.event as LedgerEv;
  return {
    student: ev.student,
    field: ev.field,
    ...(ev.shared !== undefined ? { shared: ev.shared } : {}),
    ...(ev.withheld ? { withheld: 'hidden' as const } : {}),
    ...(ev.blocked ? { blocked: true as const } : {}),
    ts: i,
  };
});

export const longEntries: SnapshotEntry[] = [
  ...snapshot,
  {
    student: 's_ben',
    field: 'Everything about the week of the exam including the long list of commitments that keep him busy',
    shared: 'Free every evening after 6 pm except Wednesday, and also available for a Saturday morning review if the group wants one before the exam',
    ts: 20,
  },
];
