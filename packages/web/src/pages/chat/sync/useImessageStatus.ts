import { useCallback, useEffect, useState } from 'react';
import type { ImessageStatus } from '@squad/core';
import type { ChatApi } from '../api';

export const IMESSAGE_POLL_MS = 20_000;

/**
 * The iMessage bridge status for the chat header: fetched on mount, every 20 s while the page is visible and when the
 * window regains focus. Any failure (404 on an old hub, offline) is `null`, which the indicator reads as "Web only".
 */
export function useImessageStatus(
  api: ChatApi | null,
  pollMs = IMESSAGE_POLL_MS,
): ImessageStatus | null {
  const [status, setStatus] = useState<ImessageStatus | null>(null);
  const load = useCallback(async () => {
    if (!api?.imessageStatus) return;
    try {
      setStatus(await api.imessageStatus());
    } catch {
      setStatus(null);
    }
  }, [api]);
  useEffect(() => {
    if (!api?.imessageStatus) {
      setStatus(null);
      return;
    }
    void load();
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void load();
    }, pollMs);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [api, load, pollMs]);
  return status;
}
