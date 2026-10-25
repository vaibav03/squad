import { useEffect, useId, useRef, useState } from 'react';
import {
  relTime,
  voiceKey,
  type ActivityView,
  type InspectorStore,
} from '@squad/village/inspector';
import { roomInfo } from '@squad/village/rooms';
import { LvIcon, usePresence, usePrefersReducedMotion } from '../kit';
import { providerState } from '@squad/village/council';
import { councilPortraitKey, pixelPortrait } from '../../pixel/portraits';
import { useNow, useSelectedView, useStoreVersion } from './useInspector';
import { useRoomSnapshot } from './useRoomSession';
import { AgentsTab, ChatTab } from './Conversation';
import { HierarchyTab } from './Hierarchy';
import { FocusShell, type FocusTab } from './focus/FocusShell';
import { HandoffTimeline } from './focus/HandoffTimeline';
import { DecisionsView } from './focus/DecisionsView';
import { AgentPortrait } from './focus/AgentPortrait';
import { EmptyHelp } from './focus/EmptyHelp';
import { resolveBoardAgent } from './focus/resolve';
import { useLastRunsState } from '../../council/last-run/store';
import { ROLE_LABEL, STATUS_LABEL } from '../../council/board/common';
import './focus/focus.css';
import { openBoard, useBoardStoreRef, useBoardVersion, useCanOpenBoard } from '../../council/board/bridge';
import { ModeBadge } from '../../council/board/ModeBadge';
import { openVoice } from './bridge';
import type { InspectorHub } from './useDmHistory';
import { NO_COUNCIL_YET, useAgentNote } from '../../council/last-run/agent-note';
import { useDockPanel } from '../../shell/panel-dock';
import { MasterySummary, useChapterFor } from '../mastery/MasterySummary';
import './inspector.css';

type Tab = FocusTab;

/** Pixel portrait for an agent: the viewer is the red hood, other students share the freshman look. */
export function portraitFor(v: Pick<ActivityView, 'id' | 'kind' | 'isMe'>): string | undefined {
  if (v.kind === 'student') return pixelPortrait(v.isMe ? 'student' : 'freshman');
  if (v.kind === 'council') return pixelPortrait(councilPortraitKey(v.id));
  return pixelPortrait(v.kind);
}

const AGENT_ICON = {
  queued: 'clock',
  working: 'refresh',
  done: 'check',
  failed: 'alert',
  skipped: 'x',
  partial: 'alert',
} as const;
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
  const [tab, setTab] = useState<Tab>('conversation');
  const board = useBoardStoreRef();
  const canBoard = useCanOpenBoard();
  const view = useSelectedView(store);
  useBoardVersion(board);
  const stored = useLastRunsState();
  useStoreVersion(store);
  const room = store.room;
  const roomSeats = useRoomSnapshot().seats ?? [];
  // A click on a character inside a room opens on the chat, so the discussion is the first thing you read.
  const seat = room
    ? roomSeats.find((x) => x.agent === store.selected && x.who === room.who)
    : undefined;
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
  // Opening lands on Conversation: what this agent said and was told. Swapping to another agent (Next, a chip) keeps
  // the tab the user is on.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (openKey && !wasOpen.current) setTab('conversation');
    wasOpen.current = !!openKey;
  }, [openKey]);
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
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<ActivityView | undefined>(undefined);
  if (view) last.current = view;
  const v = view ?? last.current; // keep the last content while the exit transition runs
  const mastery = useChapterFor(v?.kind === 'expert' ? v.id : undefined);
  // Council agents: never a dead "Idle" / "no reasoning shared"; say what the last council was, or that none ran.
  const isCouncil = !!v && v.id.startsWith('council:');
  const note = useAgentNote(isCouncil ? v!.id : undefined);
  const councilIdle = isCouncil && v!.state === 'idle' && !v!.thinking;

  // The control that opened (or last swapped) the panel; Esc and Close hand focus back to it.
  const origin = useRef<HTMLElement | null>(null);
  const lastButton = useRef<{ el: HTMLElement; at: number } | null>(null);
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'BUTTON') lastButton.current = { el: t, at: Date.now() };
    };
    document.addEventListener('focusin', on);
    return () => document.removeEventListener('focusin', on);
  }, []);
  const close = () => {
    store.select(null);
    store.setFollow(false);
    const o = origin.current;
    origin.current = null;
    if (o && o.isConnected && !o.hasAttribute('disabled') && !root.current?.contains(o)) {
      o.focus({ preventScroll: true });
      return;
    }
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
    const outside = !!a && a !== document.body && !root.current?.contains(a);
    // The opener is the last real control that took focus a moment ago (the village may move focus to the stage in
    // the same click); the canvas and body fall back to the stage.
    const lb = lastButton.current;
    if (lb && lb.el.isConnected && Date.now() - lb.at < 1500 && !root.current?.contains(lb.el))
      origin.current = lb.el;
    wantFocus.current =
      outside && a!.tagName === 'BUTTON' && a!.matches(':focus-visible') && !root.current?.contains(a);
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
  const portrait = portraitFor(v);
  const shown_name = voice && voice.who ? voice.name : (seat?.label ?? v.name);
  const resolved = isCouncil
    ? resolveBoardAgent(board, [v.id, voice?.who, voice?.name, seat?.label, v.name])
    : undefined;
  const name = resolved?.agent?.name ?? shown_name;
  const roleWords = resolved?.agent
    ? resolved.agent.role === 'chair'
      ? 'Council chair'
      : ROLE_LABEL[resolved.agent.role]
    : voice && voice.who
      ? voice.role
      : v.role;
  const runRec = resolved ? stored.runs.find((r) => r.id === resolved.run.runId) : undefined;
  const provider = resolved
    ? providerState(
        { mode: resolved.run.mode, agents: resolved.run.agents },
        { transport: runRec?.transport, fixture: mode === 'replay' },
      )
    : undefined;
  const statusNode = resolved?.agent ? (
    <>
      <LvIcon name={AGENT_ICON[resolved.agent.status]} size={16} aria-hidden="true" />
      <span className="af-k">Status</span> {STATUS_LABEL[resolved.agent.status]}
    </>
  ) : (
    <>
      <LvIcon name={STATE_ICON[v.state]} size={16} aria-hidden="true" />
      <span className="af-k">Status</span>{' '}
      {councilIdle ? (note?.label ?? NO_COUNCIL_YET) : v.stateLabel}
    </>
  );
  const selectParty = (id: string) => {
    if (store.has(id)) store.select(id);
    else if (board) openBoard({ agent: id });
  };
  const timelineAgent = {
    id: resolved?.agent?.id ?? v.id,
    name,
    is: resolved?.is ?? ((id: string) => id === v.id),
  };

  const doing = (
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
        <h3 className="ai-label">Status log</h3>
        {v.log.length === 0 ? (
          <EmptyHelp
            title={`${name} has no activity yet`}
            isCouncil={isCouncil}
            topic={name}
            now={now}
          />
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
  );

  // Shared notes: only what the agent chose to say publicly. Never hidden reasoning.
  const notes = voice ? (
    <VoiceThought
      voice={voice}
      lastNote={voice.thought.source === 'none' ? (voiceNote ?? null) : null}
    />
  ) : (
    <section className="ai-think" aria-label="Public notes">
      <h3 className="ai-label">
        Shared notes
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
          <summary>Earlier notes ({v.thoughtHistory.length})</summary>
          <ul>
            {v.thoughtHistory.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );

  const conversation = resolved ? (
    <div className="ai-tabpanel">
      <HandoffTimeline
        run={resolved.run}
        agent={timelineAgent}
        defaultFilter="selected"
        onSelectAgent={selectParty}
        now={now}
        emptyExtra={<EmptyHelp isCouncil topic={name} now={now} />}
      />
    </div>
  ) : isCouncil ? (
    <>
      {!voice || voice.thread.length === 0 ? (
        <div className="ai-tabpanel">
          <div className="af-empty" data-testid="af-empty">
            <p className="af-empty__title">No messages involving {name} yet</p>
            <EmptyHelp isCouncil topic={name} now={now} />
          </div>
        </div>
      ) : null}
      <ChatTab
        view={seat ? { ...v, name: seat.label } : v}
        convo={convo}
        hub={hub}
        now={now}
        mode={mode}
        room={room}
        voice={
          voice
            ? { view: voice, title: (room?.slot && roomInfo(room.slot)?.title) || 'the council' }
            : null
        }
      />
    </>
  ) : (
    <>
      <ChatTab
        view={seat ? { ...v, name: seat.label } : v}
        convo={convo}
        hub={hub}
        now={now}
        mode={mode}
        room={room}
        voice={null}
      />
      {convo.chat.length === 0 && !room ? (
        <div className="ai-tabpanel">
          <EmptyHelp isCouncil={false} topic={name} now={now} />
        </div>
      ) : null}
    </>
  );

  const reasoning = (
    <>
      {resolved ? (
        <DecisionsView
          run={resolved.run}
          agentId={resolved.agent?.id}
          is={timelineAgent.is}
          name={name}
          isChair={resolved.agent?.role === 'chair'}
        />
      ) : (
        <div className="ai-tabpanel">
          <section aria-label="Reasoning summaries">
            <h3 className="ai-label">Reasoning summary</h3>
            <p className="af-empty__title" data-testid="af-no-decisions">
              {name} has not shared a reasoning summary yet.
            </p>
            <EmptyHelp isCouncil={isCouncil} topic={name} now={now} />
          </section>
        </div>
      )}
      <div className="ai-tabpanel">{notes}</div>
      {voice && voice.positions.length > 0 ? (
        <VoicePositions
          voice={voice}
          onOpen={(who) => openVoice(who, { agent: v.id, slot: room?.slot ?? '' })}
        />
      ) : null}
    </>
  );

  const team = (
    <>
      <AgentsTab view={v} convo={convo} store={store} now={now} />
      {convo.partners.length === 0 && convo.thread.length === 0 ? (
        <div className="ai-tabpanel">
          <EmptyHelp isCouncil={isCouncil} topic={name} now={now} />
        </div>
      ) : null}
    </>
  );
  const structure =
    isCouncil || board?.has(v.id) ? (
      <div className="ai-tabpanel">
        <HierarchyTab agentId={v.id} board={board} inspector={store} />
      </div>
    ) : (
      <div className="ai-tabpanel">
        <p className="af-empty__title" data-testid="af-no-structure">
          {name} is not part of a council, so there is no reporting line to show.
        </p>
        <EmptyHelp isCouncil={false} topic={name} now={now} />
      </div>
    );

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      className="ai-panel sq-scene"
      data-state={shown && open ? 'open' : 'closed'}
      data-reduced={reduced ? 'true' : undefined}
      data-kind={v.kind}
      data-side={store.side}
      data-room={room ? room.slot : undefined}
      data-testid="agent-focus-panel"
      aria-labelledby={titleId}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) onExited();
      }}
    >
      <FocusShell
        titleId={titleId}
        name={name}
        role={roleWords}
        portrait={portrait ? <AgentPortrait key={portrait} src={portrait} /> : null}
        provider={provider}
        status={statusNode}
        tab={tab}
        onTab={setTab}
        swapKey={`${v.id}|${room?.who ?? ''}`}
        onClose={close}
        tabAddon={{
          reasoning:
            (voice ? voice.thinking : v.thinking) ? (
              <span className="ai-dots" role="status" aria-label="Working now">
                <i />
                <i />
                <i />
              </span>
            ) : null,
        }}
        actions={
          canBoard ? (
            <button
              type="button"
              className="ai-btn"
              onClick={() => openBoard(board?.has(v.id) ? { agent: v.id } : {})}
            >
              Board
            </button>
          ) : null
        }
        barExtras={
          <>
            <button
              type="button"
              className="ai-btn"
              onClick={() => go(-1)}
              aria-label="Previous agent"
            >
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
          </>
        }
        panels={{ activity: doing, reasoning, conversation, team, structure }}
        footer={
          !v.isMe && v.kind === 'student' && tab !== 'conversation' ? (
            <p className="ai-privacy">
              <LvIcon name="lock" size={14} aria-hidden="true" /> Public activity only. Private
              details stay hidden.
            </p>
          ) : null
        }
      />
    </div>
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
function VoiceThought({
  voice,
  lastNote,
}: {
  voice: NonNullable<ReturnType<InspectorStore['voice']>>;
  lastNote?: ReturnType<typeof useAgentNote> | null;
}) {
  return (
    <div data-testid="voice-thinking">
      <section className="ai-think" aria-label="Thinking">
        <h3 className="ai-label">
          {voice.who ? `What ${voice.name} has shared` : 'What the council has shared'}
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
    </div>
  );
}

/** Where every member of the council stands, from public words only. */
function VoicePositions({
  voice,
  onOpen,
}: {
  voice: NonNullable<ReturnType<InspectorStore['voice']>>;
  onOpen(who: string): void;
}) {
  return (
    <div className="ai-tabpanel">
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
