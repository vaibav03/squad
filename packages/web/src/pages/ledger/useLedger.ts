import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeParseVillageEvent, type VillageEvent } from '@squad/core';
import { useEventFeed, useLiveConfig, type Connection } from '../../overlays/kit';
import {
  emptyLedger,
  ledgerFromSnapshot,
  ledgerReducer,
  LedgerResponseSchema,
  type LedgerState,
} from './model';
import { recordedScript, snapshot, TASK_ID } from './fixtures';
import type { LedgerStatus } from './LedgerView';

const FRESH_MS = 6000;

/** Number of fixture events already on the board when a mock session opens; the rest replay live. */
const MOCK_PRELOADED = 5;

export function useLedger(taskId: string = TASK_ID) {
  const cfg = useLiveConfig();
  const mock = cfg.mode !== 'live';
  const [state, setState] = useState<LedgerState>(() =>
    mock ? ledgerFromSnapshot(taskId, snapshot.slice(0, MOCK_PRELOADED)) : emptyLedger(taskId),
  );
  const [status, setStatus] = useState<LedgerStatus>(mock ? 'ready' : 'loading');
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const refresh = useCallback(async () => {
    if (cfg.mode !== 'live' || !cfg.hubUrl) return;
    try {
      const res = await fetch(`${cfg.hubUrl}/v1/ledger/${encodeURIComponent(taskId)}`, {
        headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      });
      if (!res.ok) throw new Error(`ledger ${res.status}`);
      const body: unknown = await res.json();
      const entries = LedgerResponseSchema.parse(body);
      setState(ledgerFromSnapshot(taskId, entries));
      setStatus('ready');
    } catch {
      setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    }
  }, [cfg.mode, cfg.hubUrl, cfg.token, taskId]);

  const script = useMemo(
    () =>
      recordedScript.slice(MOCK_PRELOADED).map((s, i) => ({ at: 1400 + i * 1500, event: s.event })),
    [],
  );

  const onEvent = useCallback((e: VillageEvent) => {
    setState((prev) => {
      const next = ledgerReducer(prev, e);
      if (next !== prev && next.rows[0]) {
        const id = next.rows[0].id;
        setFresh((f) => new Set(f).add(id));
        timers.current.push(
          setTimeout(
            () =>
              setFresh((f) => {
                const n = new Set(f);
                n.delete(id);
                return n;
              }),
            FRESH_MS,
          ),
        );
      }
      return next;
    });
  }, []);

  const { connection, retry } = useEventFeed<VillageEvent>(
    {
      recorded: script,
      onReset: () => setState(ledgerFromSnapshot(taskId, snapshot.slice(0, MOCK_PRELOADED))),
      live: {
        query: { taskId },
        parse: (raw) => {
          const r = safeParseVillageEvent(raw);
          return r.success ? r.data : null;
        },
        refresh,
      },
    },
    onEvent,
  );

  const conn: Connection = connection;
  useEffect(() => {
    if (connection === 'offline') setStatus('offline');
    else if (connection === 'error' && status !== 'ready') setStatus('error');
  }, [connection, status]);

  return {
    state,
    status,
    connection: conn,
    fresh,
    retry: () => {
      setStatus('loading');
      retry();
    },
  };
}
