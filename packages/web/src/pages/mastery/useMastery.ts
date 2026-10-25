import { useCallback, useMemo, useState } from 'react';
import { safeParseVillageEvent, type VillageEvent } from '@squad/core';
import { useEventFeed, useLiveConfig, type Connection } from '../../overlays/kit';
import { masteryFromHub, masteryReducer, sanitize, type MasteryData } from './model';
import { masteryData, recordedScript } from './fixtures';
import type { MasteryStatus } from './MasteryView';

export function useMastery(courseId: string) {
  const cfg = useLiveConfig();
  const mock = cfg.mode !== 'live';
  const [data, setData] = useState<MasteryData | undefined>(
    mock ? { ...masteryData, courseId } : undefined,
  );
  const [status, setStatus] = useState<MasteryStatus>(mock ? 'ready' : 'loading');

  const refresh = useCallback(async () => {
    if (cfg.mode !== 'live' || !cfg.hubUrl) return;
    try {
      const res = await fetch(`${cfg.hubUrl}/v1/mastery/${encodeURIComponent(courseId)}`, {
        headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const body: unknown = await res.json();
      const parsed = masteryFromHub(body);
      if (!parsed) throw new Error('mastery shape');
      setData(sanitize(parsed));
      setStatus('ready');
    } catch {
      setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    }
  }, [cfg.mode, cfg.hubUrl, cfg.token, courseId]);

  const script = useMemo(() => recordedScript, []);
  const { connection, retry } = useEventFeed<VillageEvent>(
    {
      recorded: script,
      live: {
        parse: (raw) => {
          const r = safeParseVillageEvent(raw);
          return r.success ? r.data : null;
        },
        refresh,
      },
    },
    (e) => setData((d) => (d ? masteryReducer(d, e, cfg.userId) : d)),
  );
  const conn: Connection = connection;
  return {
    data,
    status: connection === 'offline' ? ('offline' as const) : status,
    connection: conn,
    retry: () => {
      setStatus('loading');
      retry();
    },
  };
}
