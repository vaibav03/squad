import { useState } from 'react';
import type { GalleryStory } from '../../overlays/kit';
import { LedgerView, type LedgerViewProps } from './LedgerView';
import { ledgerFromSnapshot } from './model';
import { longEntries, roster, snapshot, TASK_ID, TASK_TITLE } from './fixtures';

const rows = ledgerFromSnapshot(TASK_ID, snapshot).rows;
const base: LedgerViewProps = {
  status: 'ready',
  connection: 'live',
  title: TASK_TITLE,
  rows,
  roster,
  me: 's_ana',
  projector: false,
  onProjectorChange: () => {},
};

function Interactive(p: Partial<LedgerViewProps>) {
  const [projector, setProjector] = useState(p.projector ?? false);
  return <LedgerView {...base} {...p} projector={projector} onProjectorChange={setProjector} />;
}

const blockedId = rows.find((r) => r.blocked)?.id;

export const stories: GalleryStory[] = [
  { id: 'ledger-ready', title: 'Ledger: ready', render: () => <Interactive /> },
  {
    id: 'ledger-projector',
    title: 'Ledger: demo projector (others blurred)',
    render: () => <Interactive projector />,
  },
  {
    id: 'ledger-fresh-blocked',
    title: 'Ledger: gate just blocked a leak',
    render: () => <Interactive freshIds={new Set(blockedId ? [blockedId] : [])} />,
  },
  {
    id: 'ledger-loading',
    title: 'Ledger: loading',
    render: () => <Interactive status="loading" rows={[]} connection="connecting" />,
  },
  { id: 'ledger-empty', title: 'Ledger: empty', render: () => <Interactive rows={[]} /> },
  {
    id: 'ledger-error',
    title: 'Ledger: error',
    render: () => <Interactive status="error" rows={[]} connection="error" onRetry={() => {}} />,
  },
  {
    id: 'ledger-offline',
    title: 'Ledger: offline',
    render: () => (
      <Interactive status="offline" rows={[]} connection="offline" onRetry={() => {}} />
    ),
  },
  {
    id: 'ledger-replay',
    title: 'Ledger: replay badge',
    render: () => <Interactive connection="replaying" />,
  },
  {
    id: 'ledger-long',
    title: 'Ledger: long text',
    render: () => <Interactive rows={ledgerFromSnapshot(TASK_ID, longEntries).rows} />,
  },
  {
    id: 'ledger-small-squad',
    title: 'Ledger: squad of 2 (no counts)',
    render: () => (
      <Interactive
        roster={roster.slice(0, 2)}
        rows={
          ledgerFromSnapshot(
            TASK_ID,
            snapshot.filter((s) => s.student === 's_ana' || s.student === 's_ben'),
          ).rows
        }
      />
    ),
  },
];
