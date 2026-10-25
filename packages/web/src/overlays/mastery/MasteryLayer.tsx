import { timedFetch } from '../../lib/http';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MASTERY_OPEN_EVENT } from '@squad/village/rooms';
import { MasteryPanel, type DetailStatus } from './MasteryPanel';
import { useMasteryChapters } from './MasterySummary';
import { masteryFromHub, sanitize, type MasteryData } from './model';
import { COURSE_ID } from './fixtures';

export interface MasteryLayerProps {
  hub: { hubUrl: string; token: string | null } | null;
  /** Sends a phrase to the squad chat; absent in replays. */
  onRun?: (phrase: string) => void;
  calm?: boolean;
  returnFocusTo?: () => HTMLElement | null | undefined;
  courseId?: string;
  /** Open on mount (`?mastery=1`). */
  initialOpen?: boolean;
}

/**
 * Hosts the Mastery panel inside the village page. It opens on the world's `squad:mastery-open` event (Enter at the
 * Mastery board, or the HUD) and on `?mastery=1`. Chapter mastery is live from the world; the concept list comes from
 * the hub when the panel opens.
 */
export function MasteryLayer(props: MasteryLayerProps) {
  const { hub, onRun, calm, returnFocusTo, courseId = COURSE_ID, initialOpen } = props;
  const chapters = useMasteryChapters();
  const [open, setOpen] = useState(!!initialOpen);
  const [detail, setDetail] = useState<MasteryData>();
  const [status, setStatus] = useState<DetailStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [focusEl, setFocusEl] = useState<HTMLElement | null>(null);
  const prev = useRef<HTMLElement | null>(null);

  const openPanel = useCallback(() => {
    prev.current = (returnFocusTo?.() ?? document.activeElement) as HTMLElement | null;
    setFocusEl(prev.current);
    setOpen(true);
  }, [returnFocusTo]);

  useEffect(() => {
    globalThis.addEventListener(MASTERY_OPEN_EVENT, openPanel);
    return () => globalThis.removeEventListener(MASTERY_OPEN_EVENT, openPanel);
  }, [openPanel]);
  useEffect(() => {
    if (initialOpen) openPanel();
  }, [initialOpen, openPanel]);

  // Fetch the concept detail each time the panel opens (cheap, and never stale).
  useEffect(() => {
    if (!open) return;
    if (!hub?.token) {
      setStatus('error');
      return;
    }
    let dead = false;
    setStatus('loading');
    void (async () => {
      try {
        const res = await timedFetch(
          `${hub.hubUrl.replace(/\/+$/, '')}/v1/mastery/${encodeURIComponent(courseId)}`,
          { headers: { Authorization: `Bearer ${hub.token}` } },
        );
        if (!res.ok) throw new Error(String(res.status));
        const parsed = masteryFromHub(await res.json());
        if (!parsed) throw new Error('shape');
        if (!dead) {
          setDetail(sanitize(parsed));
          setStatus('ready');
        }
      } catch {
        if (!dead)
          setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      }
    })();
    return () => {
      dead = true;
    };
  }, [open, hub?.hubUrl, hub?.token, courseId, attempt]);

  return (
    <MasteryPanel
      open={open}
      onClose={() => setOpen(false)}
      returnFocusTo={focusEl}
      calm={calm}
      chapters={chapters}
      detail={detail}
      status={status}
      onPractise={onRun}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
