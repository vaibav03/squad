import { defaultTab } from './defaultTab';
import { useEffect, useId, useRef, useState } from 'react';
import {
  relTime,
  voiceKey,
  type ActivityView,
  type InspectorStore,
} from '@squad/village/inspector';
import { roomInfo } from '@squad/village/rooms';
import { LvIcon, usePresence, usePrefersReducedMotion } from '../kit';
import { pixelPortrait } from '../../pixel/portraits';
import { useNow, useSelectedView, useStoreVersion } from './useInspector';
import { useRoomSnapshot } from './useRoomSession';
import { AgentsTab, ChatTab } from './Conversation';
import { HierarchyTab } from './Hierarchy';
import { openBoard, useBoardStoreRef, useCanOpenBoard } from '../../council/board/bridge';
import { ModeBadge } from '../../council/board/ModeBadge';
import { openVoice } from './bridge';
import type { InspectorHub } from './useDmHistory';
import { useDockPanel } from '../../shell/panel-dock';
import { NO_COUNCIL_YET, useAgentNote } from '../../council/last-run/agent-note';
import { MasterySummary, useChapterFor } from '../mastery/MasterySummary';
import './inspector.css';

type Tab = 'doing' | 'thinking' | 'chat' | 'agents' | 'hierarchy';
const TABS: Array<[Tab, string]> = [
  ['doing', 'Doing'],
  ['thinking', 'Thinking'],
  ['chat', 'Chat'],
  ['agents', 'Agents'],
  ['hierarchy', 'Hierarchy'],
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
  const board = useBoardStoreRef();
  const canBoard = useCanOpenBoard();
  const view = useSelectedView(store);
  useStoreVersion(store);
  const room = store.room;
  const roomSeats = useRoomSnapshot().seats ?? [];
  // A click on a character inside a room opens on the chat, so the discussion is the first thing you read.
  const seat = room
    ? roomSeats.find((x) => x.agent === store.selected && x.who === room.who)
    : undefined;
  const roomKey = room ? `${store.selected}|${room.slot}|${room.who}` : null;
  // See defaultTab: inside a room the Chat tab; a council agent clicked outside a room opens on Thinking when it is
  // thinking now or has a thought on record, otherwise on Chat.
  const sel = store.selected;
  const councilWho =
    sel && sel.startsWith('council:')
      ? room
        ? room.who
        : sel.startsWith('council:live-')
          ? voiceKey(sel)
          : ''
      : null;
  const voice = sel && councilWho !== null ? store.voice(councilWho, sel) : null;
  const voiceNote = useAgentNote(voice?.who || sel || undefined);
  const openKey = sel ? `${sel}|${room?.slot ?? ''}|${room?.who ?? ''}` : null;
  const openTab: Tab | null = defaultTab(room?.initialTab, voice);
  const openTabRef = useRef(openTab);
  openTabRef.current = openTab;
  useEffect(() => {
    if (!openKey) return;
    if (openTabRef.current) setTab(openTabRef.current);
    else if (roomKey) setTab('chat');
  }, [openKey, roomKey]);
  // Words the room session recorded for this room join the council thread (deduped against the event stream).
  const sessionSnap = useRoomSnapshot();
  const roomSlot = room?.slot;
  const roomWords = roomSlot ? sessionSnap.transcripts[roomSlot] : undefined;
  useEffect(() => {
    if (!roomSlot || !roomWords || !sel?.startsWith('council:')) return;
    for (const e of roomWords)
      if (e.kind === 'opinion' || e.kind === 'rank' || e.kind === 'verdict')
        store.noteVoice({
          who: e.who,
          group: sel,
          kind: e.kind,
          text: e.text,
          ...(e.dissent ? { dissent: true } : {}),
          key: `room:${roomSlot}:${e.id}`,
          ...(e.ts ? { at: e.ts } : {}),
        });
  }, [roomSlot, roomWords, sel, store]);
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
  // Council agents: never a dead "Idle" / "no reasoning shared"; say what the last council was, or that none ran.
  const isCouncil = !!v && v.id.startsWith('council:');
  const note = useAgentNote(isCouncil ? v!.id : undefined);
  const councilIdle = isCouncil && v!.state === 'idle' && !v!.thinking;

  const close = () => {
    store.select(null);
    store.setFollow(false);
    const st = returnFocusTo?.();
    if (st) st.focus({ preventScroll: true });
  };

  // A large panel of the village dock: another large panel opening (or the Chat launcher) lets it go, no focus move.
  useDockPanel('inspector', 'large', open, () => {
    store.select(null);
    store.setFollow(false);
  });

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
      store.select(n.agent, {
        slot: room.slot,
        who: n.who,
        ...(room.initialTab ? { initialTab: room.initialTab } : {}),
      });
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
            {voice && voice.who ? voice.name : (seat?.label ?? v.name)}
          </h2>
          <p className="ai-role">{voice && voice.who ? voice.role : v.role}</p>
        </div>
        {canBoard && (
          <button
            type="button"
            className="ai-btn"
            onClick={() => openBoard(board?.has(v.id) ? { agent: v.id } : {})}
          >
            Board
          </button>
        )}
        <button type="button" className="ai-icon" onClick={close} aria-label="Close inspector">
          <LvIcon name="x" size={20} />
        </button>
      </header>

      <div className="ai-bar">
        <span className="ai-state" data-state={v.state}>
          <LvIcon name={STATE_ICON[v.state]} size={16} aria-hidden="true" />
          {councilIdle ? (note?.label ?? NO_COUNCIL_YET) : v.stateLabel}
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
            {id === 'thinking' && (voice ? voice.thinking : v.thinking) && (
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
                {councilIdle ? (note?.said ?? note?.label ?? NO_COUNCIL_YET) : v.headline}
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
                      {v.demo && <ModeBadge mode="demo" />}
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
        {tab === 'thinking' && voice && (
          <VoiceThinking
            voice={voice}
            lastNote={voice.thought.source === 'none' ? (voiceNote ?? null) : null}
            onOpen={(who) => openVoice(who, { agent: v.id, slot: room?.slot ?? '' })}
          />
        )}
        {tab === 'thinking' && !voice && (
          <div className="ai-tabpanel">
            <section className="ai-think" aria-label="Thinking">
              <h3 className="ai-label">
                How it is thinking
                {v.thinking && <span className="ai-live">live</span>}
              </h3>
              <div className="ai-bubble" data-source={v.thought.source}>
                <p>
                  {isCouncil && v.thought.source === 'none'
                    ? note
                      ? `Last said: ${note.said ?? note.stance ?? 'nothing public'}`
                      : NO_COUNCIL_YET
                    : v.thought.text}
                </p>
                {isCouncil && v.thought.source === 'none' && note && (
                  <small>{note.label}. Public words only.</small>
                )}
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
            voice={
              voice
                ? {
                    view: voice,
                    title: (room?.slot && roomInfo(room.slot)?.title) || 'the council',
                  }
                : null
            }
          />
        )}
        {tab === 'agents' && <AgentsTab view={v} convo={convo} store={store} now={now} />}
        {tab === 'hierarchy' && <HierarchyTab agentId={v.id} board={board} inspector={store} />}
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

const POS_KIND = {
  opinion: 'Opinion',
  rank: 'Ranking',
  verdict: 'Verdict',
  turn: 'Said',
  yield: 'Yielded',
  thought: 'Thought',
} as const;

/** What a council voice is thinking: its latest thought or stance, earlier thoughts, and where every member stands. */
function VoiceThinking({
  voice,
  onOpen,
  lastNote,
}: {
  voice: NonNullable<ReturnType<InspectorStore['voice']>>;
  onOpen(who: string): void;
  lastNote?: ReturnType<typeof useAgentNote> | null;
}) {
  return (
    <div className="ai-tabpanel" data-testid="voice-thinking">
      <section className="ai-think" aria-label="Thinking">
        <h3 className="ai-label">
          {voice.who ? `How ${voice.name} is thinking` : 'How the council is thinking'}
          {voice.thinking && <span className="ai-live">live</span>}
        </h3>
        <div className="ai-bubble" data-source={voice.thought.source}>
          <p>
            {voice.thought.source === 'none'
              ? lastNote
                ? `Last said: ${lastNote.said ?? lastNote.stance ?? 'nothing public'}`
                : NO_COUNCIL_YET
              : voice.thought.text}
          </p>
          {voice.thought.source === 'none' && lastNote && (
            <small>{lastNote.label}. Public words only.</small>
          )}
          {voice.thought.source === 'stream' && (
            <small>From what it said in the council, not extra reasoning.</small>
          )}
        </div>
        {voice.history.length > 0 && (
          <details className="ai-history">
            <summary>Earlier thoughts ({voice.history.length})</summary>
            <ul>
              {voice.history.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {voice.positions.length > 0 && (
        <section aria-label="Where the council stands" className="ai-positions">
          <h3 className="ai-label">Where everyone stands</h3>
          <ul className="ai-thread">
            {voice.positions.map((p) => (
              <li
                key={p.who}
                className="ai-msg"
                data-dissent={p.dissent || undefined}
                data-focus={p.who === voice.who || undefined}
              >
                <div className="ai-msg__head">
                  {p.who === voice.who ? (
                    <b className="ai-party">{p.name}</b>
                  ) : (
                    <button
                      type="button"
                      className="ai-party ai-party--btn"
                      onClick={() => onOpen(p.who)}
                    >
                      {p.name}
                    </button>
                  )}
                </div>
                <p className="ai-msg__text">{p.text}</p>
                <div className="ai-msg__meta">
                  <span className="ai-kind">{POS_KIND[p.kind]}</span>
                  {p.dissent && (
                    <span className="ai-flag">
                      <LvIcon name="alert" size={12} aria-hidden="true" /> Dissent recorded
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
