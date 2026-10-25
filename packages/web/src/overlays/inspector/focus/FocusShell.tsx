import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProviderState } from '@squad/village/council';
import { LvIcon } from '../../kit';
import { ProviderBadge } from './parts';

export type FocusTab = 'activity' | 'reasoning' | 'conversation' | 'team' | 'structure';
export const FOCUS_TABS: ReadonlyArray<readonly [FocusTab, string]> = [
  ['activity', 'Activity'],
  ['reasoning', 'Reasoning summary'],
  ['conversation', 'Conversation'],
  ['team', 'Team'],
  ['structure', 'Structure'],
];

export interface FocusShellProps {
  titleId: string;
  /** Display name, never a raw id. */
  name: string;
  /** Role words ('Chair', 'Specialist', 'Chapter expert'). */
  role: string;
  portrait?: ReactNode;
  provider?: ProviderState | undefined;
  /** One status word with its icon: 'Working', 'Done', 'Studying in the Chapter 6 house'. */
  status?: ReactNode;
  /** Buttons on the status bar (previous, next, follow). */
  barExtras?: ReactNode;
  /** Buttons beside Close (Board). */
  actions?: ReactNode;
  tab: FocusTab;
  onTab(t: FocusTab): void;
  panels: Record<FocusTab, ReactNode>;
  /** Small marker inside a tab label ('Thinking now' dots). */
  tabAddon?: Partial<Record<FocusTab, ReactNode>>;
  onClose(): void;
  /** Changes with the focused agent: remounts the body so the swap animates and announces. */
  swapKey: string;
  footer?: ReactNode;
}

/**
 * The inside of the focused agent panel, shared by the village inspector and the Council board: the title
 * `<name> — <role>` (h2), provider state, status word, a Close button, the Conversation | Activity | Decisions tabs
 * (role=tablist, arrow keys, aria-selected) and a polite 'Now showing <name>' announcement when another agent swaps in.
 * The wrapper (dialog semantics, dock, presence) belongs to the host.
 */
export function FocusShell(p: FocusShellProps) {
  const [announce, setAnnounce] = useState('');
  // The live text is derived from THIS panel's agent only: "Now showing <name>" on open or swap,
  // "<name>: <tab>" when the tab changes. A state event from another agent can never change it.
  const first = useRef(true);
  const lastAgent = useRef('');
  const swappedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const swapped = lastAgent.current !== p.swapKey;
    if (swapped) swappedAt.current = Date.now();
    lastAgent.current = p.swapKey;
    // the host resets the tab right after a swap; that is part of the swap, not a tab change
    if (!swapped && Date.now() - swappedAt.current < 250) return;
    const label = FOCUS_TABS.find(([id]) => id === p.tab)![1];
    const text = swapped ? `Now showing ${p.name}` : `${p.name}: ${label}`;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnnounce(text), first.current ? 60 : 0);
    first.current = false;
  }, [p.swapKey, p.name, p.tab]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const list = useRef<HTMLDivElement>(null);
  const onTabKey = (e: React.KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = FOCUS_TABS.findIndex(([id]) => id === p.tab);
    const n =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? FOCUS_TABS.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + FOCUS_TABS.length) % FOCUS_TABS.length;
    const id = FOCUS_TABS[n]![0];
    p.onTab(id);
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus(),
    );
  };
  return (
    <>
      <span className="ai-grip" aria-hidden="true" />
      <header className="ai-head">
        {p.portrait ? (
          <span className="ai-portrait" aria-hidden="true">
            {p.portrait}
          </span>
        ) : null}
        <div className="ai-id">
          <h2 id={p.titleId} className="ai-name" tabIndex={-1} data-autofocus>
            {p.name} — {p.role}
          </h2>
          <ProviderBadge state={p.provider} />
        </div>
        <div className="ai-head__actions">
          {p.actions}
          <button type="button" className="ai-btn ai-close" onClick={p.onClose}>
            <LvIcon name="x" size={16} aria-hidden="true" /> Close
          </button>
        </div>
      </header>
      <div className="ai-bar">
        {p.status ? <span className="ai-state">{p.status}</span> : null}
        <span className="ai-spacer" />
        {p.barExtras}
      </div>
      <div
        ref={list}
        className="ai-tabs"
        role="tablist"
        aria-label={`${p.name}, sections`}
        onKeyDown={onTabKey}
      >
        {FOCUS_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${p.titleId}-t-${id}`}
            data-tab={id}
            aria-selected={p.tab === id}
            aria-controls={`${p.titleId}-p`}
            tabIndex={p.tab === id ? 0 : -1}
            className="ai-tab"
            onClick={() => p.onTab(id)}
          >
            {label}
            {p.tabAddon?.[id]}
          </button>
        ))}
      </div>
      <div
        key={p.swapKey}
        className="ai-body af-swap"
        role="tabpanel"
        id={`${p.titleId}-p`}
        aria-labelledby={`${p.titleId}-t-${p.tab}`}
        data-testid="af-body"
      >
        {p.panels[p.tab]}
        {p.footer}
      </div>
      <p className="af-sr" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </>
  );
}
