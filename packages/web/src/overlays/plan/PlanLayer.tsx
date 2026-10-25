import { useCallback, useEffect, useRef, useState } from 'react';
import { PLAN_OPEN_EVENT } from '@squad/village/rooms';
import type { PlanItem, PlanItemPatch, PlanView } from '@squad/core';
import { PlanPanel } from './PlanPanel';
import { ASK_PHRASE, planApi, type PlanCall, type PlanHub, type PlanStatus } from './model';

export interface PlanLayerProps {
  hub: PlanHub | null;
  onRun?: (phrase: string) => void;
  calm?: boolean;
  returnFocusTo?: () => HTMLElement | null | undefined;
  /** Open on mount (`?plan=1`). */
  initialOpen?: boolean;
  pollMs?: number;
}

const FAIL_WORDS: Record<string, string> = {
  conflict: 'Someone else changed that item first. Pick which version to keep.',
  forbidden: 'Only the item owner or the organizer can do that.',
  network: 'Could not reach the hub. Nothing was changed.',
  not_found: 'That plan or item is gone.',
};

/**
 * Hosts the Study Plan panel in the village page. Opens on the world's `squad:plan-open` event (Enter at the planning
 * table) and on `?plan=1`. Loads on open, then re-fetches every few seconds while open so other members' edits show.
 */
export function PlanLayer(props: PlanLayerProps) {
  const { hub, onRun, calm, returnFocusTo, initialOpen, pollMs = 5000 } = props;
  const [open, setOpen] = useState(!!initialOpen);
  const [plan, setPlan] = useState<PlanView | null>();
  const [status, setStatus] = useState<PlanStatus>('loading');
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [focusEl, setFocusEl] = useState<HTMLElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const hubRef = useRef(hub);
  hubRef.current = hub;

  const openPanel = useCallback(() => {
    setFocusEl((returnFocusTo?.() ?? document.activeElement) as HTMLElement | null);
    setOpen(true);
  }, [returnFocusTo]);
  useEffect(() => {
    globalThis.addEventListener(PLAN_OPEN_EVENT, openPanel);
    return () => globalThis.removeEventListener(PLAN_OPEN_EVENT, openPanel);
  }, [openPanel]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    const load = async () => {
      const h = hubRef.current;
      if (!h?.token) return setStatus('error');
      const r = await planApi.current(h);
      if (dead) return;
      if (r.ok) {
        setPlan(r.plan);
        setStatus('ready');
      } else
        setStatus((s) =>
          s === 'ready'
            ? s
            : typeof navigator !== 'undefined' && !navigator.onLine
              ? 'offline'
              : 'error',
        );
    };
    void load();
    const t = setInterval(() => void load(), pollMs);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [open, hub?.hubUrl, hub?.token, attempt, pollMs]);

  const run = async (doing: () => Promise<PlanCall>, ok?: string) => {
    if (!hub) return;
    setBusy(true);
    const r = await doing();
    setBusy(false);
    if (r.ok) {
      if (r.plan) setPlan(r.plan);
      setNotice(ok);
      return;
    }
    if (r.plan) setPlan(r.plan);
    setNotice(FAIL_WORDS[r.code] ?? r.message ?? 'That did not work. Try again.');
  };
  const id = plan?.id ?? '';
  return (
    <PlanPanel
      open={open}
      onClose={() => setOpen(false)}
      returnFocusTo={focusEl}
      calm={calm}
      plan={plan}
      status={status}
      notice={notice}
      busy={busy}
      onRespond={(r) =>
        void run(
          () => planApi.respond(hub!, id, r),
          r === 'accept' ? 'You accepted.' : 'You declined.',
        )
      }
      onConfirm={() => void run(() => planApi.confirm(hub!, id), 'Plan confirmed.')}
      onEdit={(item: PlanItem, patch: PlanItemPatch) =>
        void run(() => planApi.edit(hub!, id, item.id, item.rev, patch), 'Saved.')
      }
      onResolve={(cid, pick) =>
        void run(() => planApi.resolve(hub!, id, cid, pick), 'Conflict settled.')
      }
      onDone={(item, done) =>
        void run(
          () => planApi.done(hub!, id, item.id, done),
          done ? 'Marked done.' : 'Marked not done.',
        )
      }
      {...(onRun ? { onAsk: (p: string) => onRun(p || ASK_PHRASE) } : {})}
      onRetry={() => setAttempt((n) => n + 1)}
      onPropose={(d) => void run(() => planApi.propose(hub!, d), 'Plan proposed.')}
    />
  );
}
