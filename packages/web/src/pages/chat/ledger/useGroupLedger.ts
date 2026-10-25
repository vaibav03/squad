import { useCallback, useEffect, useState } from 'react';
import type { GroupLedgerEntry } from '@squad/core';
import type { FetchGroupLedger } from './api';

export type GroupLedgerState =
  | { phase: 'loading' }
  | { phase: 'error'; notFound: boolean }
  | { phase: 'ready'; entries: GroupLedgerEntry[] };

/** Loads one group's ledger, newest first. `retry` reloads after an error. */
export function useGroupLedger(groupId: string | null, fetchLedger: FetchGroupLedger | null) {
  const [state, setState] = useState<GroupLedgerState>({ phase: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!groupId || !fetchLedger) return;
    let dead = false;
    setState({ phase: 'loading' });
    fetchLedger(groupId).then(
      (entries) => {
        if (dead) return;
        setState({
          phase: 'ready',
          entries: [...entries].sort((a, b) => (b.ts ?? -1) - (a.ts ?? -1)),
        });
      },
      (e: unknown) => {
        if (!dead) setState({ phase: 'error', notFound: e instanceof Error && e.message === 'not_found' });
      },
    );
    return () => {
      dead = true;
    };
  }, [groupId, fetchLedger, n]);
  const retry = useCallback(() => setN((x) => x + 1), []);
  return { state, retry };
}
