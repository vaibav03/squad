import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Open/close state of the group ledger drawer, kept in the URL as `view=ledger` so it deep-links and survives reload.
 * The Composer actions menu calls `open()` from this hook to show the ledger.
 */
export function useLedgerDrawer() {
  const [params, setParams] = useSearchParams();
  const isOpen = params.get('view') === 'ledger';
  const set = useCallback(
    (on: boolean) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (on) n.set('view', 'ledger');
          else {
            n.delete('view');
            n.delete('notice');
          }
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const open = useCallback(() => set(true), [set]);
  const close = useCallback(() => set(false), [set]);
  return { isOpen, open, close };
}
