import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSquadConfig } from '../../shell/context';
import { hub, ConnError, type Connection, type HubClient } from './api';

export interface ConnectionsState {
  view: 'loading' | 'ready' | 'offline' | 'demo';
  connections: Connection[];
  squadId: string | null;
  error: string | null;
  client: HubClient | null;
  reload: () => Promise<void>;
  clearError: () => void;
  run: <T>(fn: (c: HubClient) => Promise<T>) => Promise<T | undefined>;
}

/** Loads GET /v1/connections. Without a live hub there is nothing to show: the page says so, no fake data. */
export function useConnections(clientOverride?: HubClient): ConnectionsState {
  const cfg = useSquadConfig();
  const client = useMemo(
    () =>
      clientOverride ??
      (cfg.mode === 'live' && cfg.hubUrl && cfg.token
        ? hub({ hubUrl: cfg.hubUrl.replace(/\/+$/, ''), token: cfg.token })
        : null),
    [clientOverride, cfg.mode, cfg.hubUrl, cfg.token],
  );
  const [connections, setConnections] = useState<Connection[]>([]);
  const [squadId, setSquadId] = useState<string | null>(null);
  const [view, setView] = useState<ConnectionsState['view']>(client ? 'loading' : 'demo');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!client) return;
    try {
      setConnections(await client.list());
      setView('ready');
    } catch (e) {
      if (e instanceof ConnError && e.code === 'offline') setView('offline');
      else {
        setError(e instanceof ConnError ? e.code : 'bad_response');
        setView('ready');
      }
    }
  }, [client]);

  useEffect(() => {
    if (!client) {
      setView('demo');
      return;
    }
    void reload();
    client.activeSquad().then(setSquadId, () => setSquadId(null));
  }, [client, reload]);

  // While a sync is running, poll until it settles.
  const syncing = connections.some((c) => c.syncPhase === 'syncing');
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [syncing, reload]);

  const run = useCallback(
    async <T>(fn: (c: HubClient) => Promise<T>): Promise<T | undefined> => {
      if (!client) return undefined;
      setError(null);
      try {
        const r = await fn(client);
        await reload();
        return r;
      } catch (e) {
        setError(e instanceof ConnError ? e.code : 'bad_response');
        return undefined;
      }
    },
    [client, reload],
  );

  return {
    view,
    connections,
    squadId,
    error,
    client,
    reload,
    clearError: () => setError(null),
    run,
  };
}
