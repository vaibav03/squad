import { useEffect, useMemo, useState } from 'react';
import { useSquadConfig } from '../../shell/context';
import { useConnections, type ConnectionsState } from '../connections/useConnections';
import { providerHasData, providerViews, type ConnRows } from './model';

export interface TourData extends ConnectionsState {
  rows: ConnRows[] | null;
  userId: string | null;
}

/** Connections + their imported items + whether real Google sign-in is configured. */
export function useTour(): TourData {
  const cfg = useSquadConfig();
  const conns = useConnections();
  const [rows, setRows] = useState<ConnRows[] | null>(null);
  const withData = useMemo(
    () => conns.connections.filter((c) => providerHasData(providerViews([c])[c.provider])),
    [conns.connections],
  );
  const key = withData.map((c) => `${c.id}:${c.lastSyncAt}:${c.sources.total}`).join('|');
  useEffect(() => {
    const client = conns.client;
    if (!client) return;
    if (withData.length === 0) {
      setRows([]);
      return;
    }
    let off = false;
    void Promise.all(
      withData.map((c) =>
        client.sources(c.id).then(
          (r) => ({ connectionId: c.id, rows: r }),
          () => ({ connectionId: c.id, rows: [] }),
        ),
      ),
    ).then((r) => !off && setRows(r));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conns.client, key]);
  return { ...conns, rows, userId: cfg.userId };
}
