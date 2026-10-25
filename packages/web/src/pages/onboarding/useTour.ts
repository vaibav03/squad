import { useEffect, useMemo, useState } from 'react';
import { phaseHasData, phaseOf } from '../../lib/connection-phase';
import { useSquadConfig } from '../../shell/context';
import { useConnections, type ConnectionsState } from '../connections/useConnections';
import { googleIsLive } from './api';
import type { ConnRows } from './model';

export interface TourData extends ConnectionsState {
  rows: ConnRows[] | null;
  googleLive: boolean | null;
  userId: string | null;
}

/** Connections + their imported items + whether real Google sign-in is configured. */
export function useTour(): TourData {
  const cfg = useSquadConfig();
  const conns = useConnections();
  const [googleLive, setGoogleLive] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ConnRows[] | null>(null);
  useEffect(() => {
    if (cfg.hubUrl && cfg.token)
      void googleIsLive({ hubUrl: cfg.hubUrl, token: cfg.token, userId: cfg.userId }).then(
        setGoogleLive,
      );
  }, [cfg.hubUrl, cfg.token, cfg.userId]);
  const withData = useMemo(
    () => conns.connections.filter((c) => phaseHasData(phaseOf(c))),
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
  return { ...conns, rows, googleLive, userId: cfg.userId };
}
