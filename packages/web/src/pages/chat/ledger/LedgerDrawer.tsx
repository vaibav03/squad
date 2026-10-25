import { useEffect, useRef } from 'react';
import type { GroupLedgerEntry, GroupLedgerKind } from '@squad/core';
import { Button } from '../../../primitives/Button';
import { EmptyState, ErrorState } from '../../../primitives/EmptyState';
import { Skeleton } from '../../../primitives/Skeleton';
import { requestChatPrefill } from '../prefill';
import type { FetchGroupLedger } from './api';
import { useGroupLedger } from './useGroupLedger';
import { absoluteTime, relativeTime } from './time';
import './ledger-drawer.css';

export const KIND_LABEL: Record<GroupLedgerKind, string> = {
  decision: 'Decision',
  vote: 'Vote',
  edit: 'Edit',
  plan_created: 'Plan created',
  import: 'Import',
};
export const MODE_LABEL = { live: 'Live', demo: 'Demo', degraded: 'Degraded' } as const;

export interface LedgerDrawerProps {
  groupId: string;
  onClose: () => void;
  fetchLedger: FetchGroupLedger | null;
  /** Shown above the list, e.g. the old-link migration notice. */
  notice?: string | undefined;
  /** Clock for relative times (tests). */
  now?: number;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

/**
 * The group ledger: what this group decided, voted, edited and imported, newest first, each with who, when and
 * where the data came from (source plus the honest Live / Demo / Degraded mode). A dialog: focus moves in, Tab
 * stays inside, Esc closes and focus returns to whatever opened it. Desktop: a side panel next to the chat (the
 * composer stays usable). Phone: a bottom sheet.
 */
export function LedgerDrawer({ groupId, onClose, fetchLedger, notice, now }: LedgerDrawerProps) {
  const { state, retry } = useGroupLedger(groupId, fetchLedger);
  const root = useRef<HTMLElement>(null);
  const clock = now ?? Date.now();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !root.current.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !root.current.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="sqld-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={root}
        className="sqld"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sqld-title"
        data-testid="ledger-drawer"
        onKeyDown={onKeyDown}
      >
        <header className="sqld__head">
          <h2 id="sqld-title" className="sqld__title">
            Group ledger
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close ledger" data-autofocus>
            Close
          </Button>
        </header>
        {notice ? (
          <p className="sqld__notice" role="status" data-testid="ledger-notice">
            {notice}
          </p>
        ) : null}
        <div className="sqld__body">
          {state.phase === 'loading' ? (
            <div role="status" aria-label="Loading ledger" className="sqld__loading">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} shape="block" height={64} />
              ))}
            </div>
          ) : state.phase === 'error' ? (
            state.notFound ? (
              <EmptyState
                tone="error"
                icon="lock"
                title="Ledger not found"
                body="This ledger belongs to a group you are not in."
              />
            ) : (
              <div role="alert">
                <ErrorState
                  title="The ledger did not load"
                  error="We could not reach the hub. Try again."
                  onRetry={retry}
                  retryLabel="Retry"
                />
              </div>
            )
          ) : state.entries.length === 0 ? (
            <EmptyState
              icon="ledger"
              title="Nothing in the ledger yet"
              body="The ledger records what your group decides together: who made a plan, who voted, who edited it and where the information came from. It fills up as soon as you plan something in chat."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    onClose();
                    requestChatPrefill('@cubbie make a study plan for our next exam');
                  }}
                >
                  Plan something in chat
                </Button>
              }
            />
          ) : (
            <ol className="sqld__list" aria-label="Ledger entries">
              {state.entries.map((e) => (
                <Row key={e.id} e={e} now={clock} />
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}

function Row({ e, now }: { e: GroupLedgerEntry; now: number }) {
  return (
    <li className="sqld__row" data-testid="ledger-entry" data-kind={e.kind}>
      <div className="sqld__meta">
        <span className="sqld__kind">{KIND_LABEL[e.kind]}</span>
        {e.ts === null ? (
          <span className="rr-dim">Time not recorded</span>
        ) : (
          <time dateTime={new Date(e.ts).toISOString()} title={absoluteTime(e.ts)}>
            {absoluteTime(e.ts)} <span className="rr-dim">({relativeTime(e.ts, now)})</span>
          </time>
        )}
      </div>
      <p className="sqld__text">{e.text}</p>
      <p className="sqld__prov">
        <span className="sqld__by">By {e.by.name}</span>
        <span className="sqld__chip" data-testid="ledger-provenance">
          {e.source.label}
          <span
            className={`sqld__mode sqld__mode--${e.mode}`}
            data-testid="ledger-mode"
            data-mode={e.mode}
          >
            {MODE_LABEL[e.mode]}
          </span>
        </span>
      </p>
    </li>
  );
}
