import { useEffect, useId, useRef, useState } from 'react';
import { relTime, type ActivityView, type InspectorStore } from '@squad/village/inspector';
import { LvIcon, usePresence, usePrefersReducedMotion } from '../kit';
import { pixelPortrait } from '../../pixel/portraits';
import { useNow, useSelectedView, useStoreVersion } from './useInspector';
import { useRoomSnapshot } from './useRoomSession';
import { AgentsTab, ChatTab } from './Conversation';
import type { InspectorHub } from './useDmHistory';
import { MasterySummary, useChapterFor } from '../mastery/MasterySummary';
import './inspector.css';

type Tab = 'doing' | 'thinking' | 'chat' | 'agents';
const TABS: Array<[Tab, string]> = [
  ['doing', 'Doing'],
  ['thinking', 'Thinking'],
  ['chat', 'Chat'],
  ['agents', 'Agents'],
];

/** Pixel portrait for an agent: the viewer is the red hood, other students share the freshman look. */
export function portraitFor(v: Pick<ActivityView, 'id' | 'kind' | 'isMe'>): string | undefined {
  if (v.kind === 'student') return pixelPortrait(v.isMe ? 'student' : 'freshman');
  if (v.kind === 'council') return pixelPortrait('council-balance');
  return pixelPortrait(v.kind);
}

const STATE_ICON = {
  idle: 'clock',
  studying: 'sparkle',
  in_call: 'mic',
  waiting_for_student: 'hand',
} as const;

export interface InspectorPanelProps {
  store: InspectorStore;
  calm?: boolean;
  /** Where focus goes when the panel closes (the village stage). */
  returnFocusTo?: () => HTMLElement | null | undefined;
  /** Hub access for the viewer's own chat history. Omit in replays. */
  hub?: InspectorHub | null;
  mode?: 'live' | 'replay';
}

/**
 * Agent Inspector: what the selected agent is doing, thinking and waiting on, live from the event stream.
 * Not modal: the village keeps running and walking keeps working underneath. Esc closes.
 */
export function InspectorPanel({
  store,
  calm,
  returnFocusTo,
  hub,
  mode = 'live',
}: InspectorPanelProps) {
  const [tab, setTab] = useState<Tab>('doing');
  const view = useSelectedView(store);
  useStoreVersion(store);
  const room = store.room;
  const roomSeats = useRoomSnapshot().seats ?? [];
  // A click on a character inside a room opens on the chat, so the discussion is the first thing you read.
  const seat = room
    ? roomSeats.find((x) => x.agent === store.selected && x.who === room.who)
    : undefined;
  const roomKey = room ? `${store.selected}|${room.slot}|${room.who}` : null;
  useEffect(() => {
    if (roomKey) setTab('chat');
  }, [roomKey]);
  const now = useNow();
  const reduced = usePrefersReducedMotion(calm);
  const open = !!view;
  const { mounted, shown, onExited } = usePresence(open, reduced ? 140 : 280);
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const last = useRef<ActivityView | undefined>(undefined);
  if (view) last.current = view;
  const v = view ?? last.current; // keep the last content while the exit transition runs
  const mastery = useChapterFor(v?.kind === 'expert' ? v.id : undefined);

  const close = () => {
    store.select(null);
    store.setFollow(false);
    const st = returnFocusTo?.();
    if (st) st.focus({ preventScroll: true });
  };

  // Esc closes (capture, so it beats the world's "leave the building"), unless another dialog is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, store]);

  // Opened from the keyboard (a focus-visible HUD chip had focus): move focus to the panel title once it is mounted.
  const openedId = view?.id;
  const wantFocus = useRef(false);
  useEffect(() => {
    if (!openedId) return;
    const a = document.activeElement as HTMLElement | null;
    wantFocus.current =
      !!a && !root.current?.contains(a) && a.matches(':focus-visible') && !!a.closest('.sqv-hud');
  }, [openedId]);
  useEffect(() => {
    if (wantFocus.current && root.current) {
      wantFocus.current = false;
      root.current.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    }
  });

  if (!mounted || !v) return null;
  const go = (dir: 1 | -1) => {
    if (room && roomSeats.length > 1) {
      const i = roomSeats.findIndex((s) => s.agent === v.id && s.who === room.who);
      const n = roomSeats[(i < 0 ? 0 : i + dir + roomSeats.length) % roomSeats.length]!;
      store.select(n.agent, { slot: room.slot, who: n.who });
      return;
    }
    const next = store.cycle(v.id, dir);
    if (next) store.select(next);
  };
  const convo = store.conversation(v.id);
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex(([id]) => id === tab);
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]![0];
    setTab(n);
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`#${CSS.escape(`${titleId}-t-${n}`)}`)?.focus(),
    );
  };
  const portrait = portraitFor(v);
  return (
    <aside
      ref={root}
      className="ai-panel sq-scene"
      data-state={shown && open ? 'open' : 'closed'}
      data-reduced={reduced ? 'true' : undefined}
      data-kind={v.kind}
      data-side={store.side}
      data-room={room ? room.slot : undefined}
      aria-labelledby={titleId}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) onExited();
      }}
    >
      <span className="ai-grip" aria-hidden="true" />
      <header className="ai-head">
        <span className="ai-portrait" aria-hidden="true">
          {portrait && <img src={portrait} alt="" width={32} height={32} />}
        </span>
        <div className="ai-id">
          <h2 id={titleId} className="ai-name" tabIndex={-1} data-autofocus>
            {seat?.label ?? v.name}
          </h2>
          <p className="ai-role">{v.role}</p>
        </div>
        <button type="button" className="ai-icon" onClick={close} aria-label="Close inspector">
          <LvIcon name="x" size={20} />
        </button>
      </header>

      <div className="ai-bar">
        <span className="ai-state" data-state={v.state}>
          <LvIcon name={STATE_ICON[v.state]} size={16} aria-hidden="true" />
          {v.stateLabel}
        </span>
        <span className="ai-spacer" />
        <button type="button" className="ai-btn" onClick={() => go(-1)} aria-label="Previous agent">
          <LvIcon name="chevron" size={18} style={{ transform: 'scaleX(-1)' }} />
        </button>
        <button type="button" className="ai-btn" onClick={() => go(1)} aria-label="Next agent">
          <LvIcon name="chevron" size={18} />
        </button>
        <button
          type="button"
          className="ai-btn ai-follow"
          aria-pressed={store.follow}
          onClick={() => store.setFollow(!store.follow)}
        >
          <LvIcon name="pin" size={16} />
          Follow
        </button>
      </div>

      <div className="ai-tabs" role="tablist" aria-label="Inspector sections" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${titleId}-t-${id}`}
            aria-selected={tab === id}
            aria-controls={`${titleId}-p`}
            tabIndex={tab === id ? 0 : -1}
            className="ai-tab"
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'thinking' && v.thinking && (
              <span className="ai-dots" role="status" aria-label="Thinking now">
                <i />
                <i />
                <i />
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        className="ai-body"
        role="tabpanel"
        id={`${titleId}-p`}
        aria-labelledby={`${titleId}-t-${tab}`}
      >
        {tab === 'doing' && (
          <div className="ai-tabpanel">
            <section className="ai-now" aria-label="Right now">
              <h3 className="ai-label">Right now</h3>
              <p className="ai-headline" aria-live="polite" aria-atomic="true">
                {v.headline}
              </p>
              <dl className="ai-facts">
                <dt>Where</dt>
                <dd>{cap(v.place)}</dd>
                {v.heading && (
                  <>
                    <dt>Heading</dt>
                    <dd>{v.heading}</dd>
                  </>
                )}
                <dt>Waiting on</dt>
                <dd>{v.waitingOn ?? 'Nothing'}</dd>
                {v.skill && (
                  <>
                    <dt>Skill</dt>
                    <dd>{v.skill}</dd>
                  </>
                )}
                {(v.tierLabel || v.demo) && (
                  <>
                    <dt>Model</dt>
                    <dd>
                      {v.tierLabel && <span className="ai-tag">{v.tierLabel}</span>}
                      {v.demo && <span className="ai-tag ai-tag--demo">Demo mode</span>}
                    </dd>
                  </>
                )}
              </dl>
            </section>
            {mastery && (
              <section className="ai-mastery" aria-label="Your mastery of this chapter">
                <h3 className="ai-label">Your mastery</h3>
                <MasterySummary chapter={mastery} />
              </section>
            )}
            <section className="ai-log" aria-label="Recent activity">
              <h3 className="ai-label">Recent</h3>
              {v.log.length === 0 ? (
                <p className="ai-empty">Nothing yet. This updates live.</p>
              ) : (
                <ol>
                  {v.log.map((l, i) => (
                    <li key={`${l.at}-${i}`}>
                      <span>{l.text}</span>
                      <time>{relTime(l.at, now)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
        {tab === 'thinking' && (
          <div className="ai-tabpanel">
            <section className="ai-think" aria-label="Thinking">
              <h3 className="ai-label">
                How it is thinking
                {v.thinking && <span className="ai-live">live</span>}
              </h3>
              <div className="ai-bubble" data-source={v.thought.source}>
                <p>{v.thought.text}</p>
                {v.thought.source === 'stream' && (
                  <small>From what the agent shared, not extra reasoning.</small>
                )}
              </div>
              {v.thoughtHistory.length > 0 && (
                <details className="ai-history">
                  <summary>Earlier thoughts ({v.thoughtHistory.length})</summary>
                  <ul>
                    {v.thoughtHistory.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          </div>
        )}
        {tab === 'chat' && (
          <ChatTab
            view={seat ? { ...v, name: seat.label } : v}
            convo={convo}
            hub={hub}
            now={now}
            mode={mode}
            room={room}
          />
        )}
        {tab === 'agents' && <AgentsTab view={v} convo={convo} store={store} now={now} />}
        {!v.isMe && v.kind === 'student' && tab !== 'chat' && (
          <p className="ai-privacy">
            <LvIcon name="lock" size={14} aria-hidden="true" /> Public activity only. Private
            details stay hidden.
          </p>
        )}
      </div>
    </aside>
  );
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
