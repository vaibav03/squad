import { timedFetch } from '../../lib/http';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveConfig } from '../../overlays/kit';
import { sampleEmpty, sampleReal, sampleStatus } from './fixtures';
import { parseAdminStatus, type AdminStatus, type StatusView } from './model';

const TOKEN_KEY = 'squad.adminToken';
const POLL_MS = 10_000;

const readToken = (): string => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Preview states for mock mode: /squad/status?state=loading|error|offline|denied|empty|real */
export function previewState(search: string): string | undefined {
  return new URLSearchParams(search).get('state') ?? undefined;
}

export function useStatus(preview?: string) {
  const cfg = useLiveConfig();
  const live = cfg.mode === 'live' && Boolean(cfg.hubUrl);
  const [data, setData] = useState<AdminStatus | undefined>(undefined);
  const [view, setView] = useState<StatusView>(live ? 'loading' : 'ready');
  const [now, setNow] = useState(() => Date.now());
  const [token, setTokenState] = useState(readToken);
  const [fetchedAt, setFetchedAt] = useState<number | undefined>();
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!live || busy.current) return;
    busy.current = true;
    try {
      const bearer = token || cfg.token;
      const res = await timedFetch(`${cfg.hubUrl}/v1/admin/status`, {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        setView('denied');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const parsed = parseAdminStatus(await res.json());
      if (!parsed) throw new Error('shape');
      setData(parsed);
      setFetchedAt(Date.now());
      setView('ready');
    } catch {
      setView(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    } finally {
      busy.current = false;
    }
  }, [live, cfg.hubUrl, cfg.token, token]);

  useEffect(() => {
    if (!live) return;
    void refresh();
    const id = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const setToken = useCallback((t: string) => {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: token lives in memory only */
    }
    setTokenState(t);
    setView('loading');
  }, []);

  if (!live) {
    const p = preview;
    const v: StatusView =
      p === 'loading' || p === 'error' || p === 'offline' || p === 'denied' ? p : 'ready';
    const d = p === 'empty' ? sampleEmpty : p === 'real' ? sampleReal : sampleStatus;
    // sample "now" is frozen so the screenshots and countdowns are stable
    return {
      data: d,
      view: v,
      now: d.now,
      sample: true,
      fetchedAt: undefined,
      refresh: () => {},
      token,
      setToken,
    };
  }
  return {
    data,
    view,
    now,
    sample: false,
    fetchedAt,
    refresh: () => void refresh(),
    token,
    setToken,
  };
}
