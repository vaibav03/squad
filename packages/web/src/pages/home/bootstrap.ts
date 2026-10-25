import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Home waits on the hub before it reads anything: 3 attempts over about 8 s (0 s, 2.5 s, 5.5 s, each bounded to 2.5 s),
 * then a true offline state with Retry. Nothing is ever reported offline just because the hub is not up *yet*.
 */
export const HUB_PROBE_START_MS: readonly number[] = [0, 2500, 5500];
export const HUB_PROBE_TIMEOUT_MS = 2500;
export type HubReadiness = 'connecting' | 'ready' | 'offline';

export async function probeHub(hubUrl: string, ms = HUB_PROBE_TIMEOUT_MS): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${hubUrl.replace(/\/+$/, '')}/health`, {
      signal: ctl.signal,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** `hubUrl` null (demo/mock) is ready at once. Retry restarts the bounded schedule. */
export function useHubReady(hubUrl: string | null): { state: HubReadiness; retry: () => void } {
  const [state, setState] = useState<HubReadiness>(hubUrl ? 'connecting' : 'ready');
  const run = useRef(0);
  const start = useCallback(() => {
    if (!hubUrl) {
      setState('ready');
      return () => {};
    }
    const id = ++run.current;
    setState('connecting');
    const timers: ReturnType<typeof setTimeout>[] = [];
    HUB_PROBE_START_MS.forEach((at, i) => {
      timers.push(
        setTimeout(() => {
          if (run.current !== id) return;
          void probeHub(hubUrl).then((ok) => {
            if (run.current !== id) return;
            if (ok) {
              run.current++; // settles the run: later attempts see a stale id
              setState('ready');
            } else if (i === HUB_PROBE_START_MS.length - 1) setState('offline');
          });
        }, at),
      );
    });
    return () => {
      run.current++;
      timers.forEach(clearTimeout);
    };
  }, [hubUrl]);
  const stop = useRef<() => void>(() => {});
  useEffect(() => {
    stop.current = start();
    return () => stop.current();
  }, [start]);
  const retry = useCallback(() => {
    stop.current();
    stop.current = start();
  }, [start]);
  return { state, retry };
}
