import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { SourceViewerHost, hasSourceHost, openSource } from '../../components/source-viewer';
import {
  headerTruth,
  type ChatCitation,
  type ChatCitationExcerpt,
  type ChatSummary,
  type CouncilTruth,
} from '@squad/core';
import { ChatCardActionsContext, councilTruthFor, useCouncilTruthVersion } from '../../council';
import { EmptyState, ErrorState } from '../../primitives/EmptyState';
import { Icon } from '../../primitives/Icon';
import { Notice } from '../../primitives/Notice';
import { Sheet } from '../../primitives/Sheet';
import { Skeleton } from '../../primitives/Skeleton';
import { StatusDot, type Status } from '../../primitives/StatusDot';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { chatErrorText } from './api';
import { MessageBubble } from './Bubble';
import { Composer, type ComposerHandle } from './Composer';
import { MemberStack, TypingIndicator } from './parts';
import { AnswerWait } from './AnswerWait';
import {
  dropRedelivered,
  foldCouncilProse,
  QUICK_PROMPTS_DM,
  QUICK_PROMPTS_GROUP,
  buildRows,
  dmIdFor,
  type ThreadRow,
} from './model';
import type { ChatController } from './useChat';
import { ImessageIndicator } from './sync/ImessageIndicator';
import { useImessageStatus } from './sync/useImessageStatus';
import { LivePanel } from '../../live/LivePanel';
import { useSquadConfig } from '../../shell/context';
import { PlansDrawer } from '../../plans/PlansDrawer';
import { WizardDrawer } from '../../plans/WizardDrawer';
import { PlanPanel } from '../../plans/PlanPanel';
import { usePlans } from '../../plans/usePlans';
import { collapsePlanCards } from '../../plans/dedupe';
import { PlanActionsContext } from '../../plans/context';
import type { PlanKind } from '../../plans/registry';

// ------------------------------------------------------------------ banners

const DISMISS_KEY = 'squad.chat.demo-dismissed';
const readDismissed = (): string | null => {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
};

/** Demo notice (dismissable for the session; every bot bubble still carries its own label) and connection notices. */
export function ChatBanners({ ctl, className }: { ctl: ChatController; className?: string }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  // always the hub's own words; a changed notice (say, credits ran out) shows again after a dismissal
  const demo = ctl.status?.demo
    ? (ctl.status.notice ?? 'Demo mode: answers come from a built-in demo model.')
    : null;
  const expired = ctl.phase === 'expired' || ctl.conn === 'expired';
  return (
    <div className={`sqc-banners${className ? ` ${className}` : ''}`}>
      {expired ? (
        <Notice tone="error" title="Your session ended. Sign in again." />
      ) : !ctl.online ? (
        <div data-testid="chat-offline">
          <Notice tone="warn" title="You are offline">
            Messages you wrote stay here. Sending resumes when you are back online.
          </Notice>
        </div>
      ) : ctl.conn === 'offline' ? (
        <div data-testid="chat-offline">
          <Notice tone="warn" title="Reconnecting to the squad">
            New messages will appear as soon as the connection is back.
          </Notice>
        </div>
      ) : null}
      {demo && dismissed !== demo ? (
        <div data-testid="chat-demo-notice">
          <Notice
            tone="info"
            onDismiss={() => {
              setDismissed(demo);
              try {
                sessionStorage.setItem(DISMISS_KEY, demo);
              } catch {
                /* ignore */
              }
            }}
          >
            {demo}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

export function pausedCopy(ctl: ChatController): string | null {
  if (ctl.phase === 'expired' || ctl.conn === 'expired')
    return 'Your session ended. Sign in again.';
  // offline or reconnecting never blocks Send: the message shows Sending, then Failed with Retry and Delete
  // (its text is kept), and the connection chip says Offline or Reconnecting
  return null;
}

const TONE_STATUS: Record<string, Status> = {
  ok: 'live',
  info: 'live',
  warn: 'busy',
  error: 'error',
  idle: 'idle',
};

/** Truth of every council card visible in this chat (loaded result wins; the message's own demo flag is the fallback). */
function visibleCouncils(ctl: ChatController, chatId: string): CouncilTruth[] {
  const out: CouncilTruth[] = [];
  for (const it of ctl.thread(chatId)) {
    const c = it.message.card;
    if (c?.type !== 'council') continue;
    out.push(councilTruthFor(c.runId) ?? (it.message.demo ? 'fixture' : 'live'));
  }
  return out;
}

/** The header badge: transport + provider, with any fixture/degraded council content named in the same badge. */
export function useHeaderTruth(ctl: ChatController, chatId: string) {
  const v = useCouncilTruthVersion();
  const items = ctl.thread(chatId);
  const councils = useMemo(() => visibleCouncils(ctl, chatId), [items, v, chatId]);
  const t = headerTruth({
    conn:
      ctl.conn === 'expired'
        ? 'expired'
        : ctl.conn === 'offline'
          ? 'offline'
          : ctl.conn === 'connecting'
            ? 'connecting'
            : 'live',
    online: ctl.online,
    status: ctl.status,
    councils,
  });
  return { ...t, status: TONE_STATUS[t.tone] ?? 'idle' };
}

// ------------------------------------------------------------------ citation sheet

type Excerpt =
  { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ok'; data: ChatCitationExcerpt };

/** The excerpt with the matched sentence highlighted (a quiet underline-tint, not a loud marker). */
function ExcerptText({ data }: { data: ChatCitationExcerpt }) {
  const i = data.highlight ? data.excerpt.indexOf(data.highlight) : -1;
  if (!data.highlight || i < 0) return <>{data.excerpt}</>;
  return (
    <>
      {data.excerpt.slice(0, i)}
      <mark className="sqc-excerpt__mark">{data.highlight}</mark>
      {data.excerpt.slice(i + data.highlight.length)}
    </>
  );
}

function CitationSheet({
  cite,
  context,
  ctl,
  scene,
  onClose,
}: {
  cite: ChatCitation | null;
  context?: string;
  ctl: ChatController;
  scene?: boolean;
  onClose: () => void;
}) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [ex, setEx] = useState<Excerpt>({ s: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const last = useRef<ChatCitation | null>(null);
  if (cite) last.current = cite;
  const shown = cite ?? last.current;
  useEffect(() => {
    if (!cite || !ctl.api) return;
    let dead = false;
    setEx({ s: 'loading' });
    ctl.api.citation(cite.file, cite.page, context).then(
      (data) => !dead && setEx({ s: 'ok', data }),
      (e) =>
        !dead &&
        setEx({
          s: 'error',
          msg:
            e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404
              ? 'We could not find that page in the course files.'
              : chatErrorText(e, 'The excerpt did not load. Check your connection and try again.'),
        }),
    );
    return () => {
      dead = true;
    };
  }, [cite, context, ctl.api, attempt]);
  return (
    <Sheet
      open={!!cite}
      onClose={onClose}
      title={shown?.label ?? 'Source'}
      description="The page this answer was checked against"
      side={wide ? 'center' : 'bottom'}
      scene={scene}
    >
      <div className="sqc-excerpt" data-testid="chat-citation-excerpt" aria-live="polite">
        {ex.s === 'loading' ? (
          <div role="status" aria-label="Loading excerpt">
            <Skeleton shape="line" width="92%" />
            <Skeleton shape="line" width="100%" />
            <Skeleton shape="line" width="64%" />
          </div>
        ) : ex.s === 'error' ? (
          <div className="sqc-excerpt__error" role="alert">
            <p>
              <Icon name="alert" size={16} />
              {ex.msg}
            </p>
            <button type="button" className="sqc-btn" onClick={() => setAttempt((n) => n + 1)}>
              <Icon name="refresh" size={14} />
              Try again
            </button>
          </div>
        ) : (
          <>
            {ex.data.chapter || ex.data.title ? (
              <p className="sqc-excerpt__eyebrow">
                {[ex.data.chapter, ex.data.title].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            <blockquote className="sqc-excerpt__text">
              <ExcerptText data={ex.data} />
            </blockquote>
            <p className="sqc-excerpt__src">
              <Icon name="file" size={14} />
              {ex.data.file}, page {ex.data.page}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ message list

function MessageList({
  chat,
  ctl,
  reduced,
  scene,
  compact,
  onPrompt,
  onOpenChat,
}: {
  chat: ChatSummary;
  ctl: ChatController;
  reduced: boolean;
  scene?: boolean;
  compact?: boolean;
  onPrompt: (text: string) => void;
  onOpenChat?: (id: string) => void;
}) {
  const bucket = ctl.bucket(chat.id);
  const items = useMemo(
    () => foldCouncilProse(dropRedelivered(ctl.thread(chat.id))),
    [ctl.thread, chat.id],
  );
  const rows = useMemo(() => buildRows(collapsePlanCards(items), ctl.me), [items, ctl.me]);
  const el = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [cite, setCite] = useState<ChatCitation | null>(null);
  // the village mounts its own source viewer; a standalone chat page needs one
  const [ownSourceHost] = useState(() => !hasSourceHost());
  const [citeCtx, setCiteCtx] = useState<string | undefined>();
  const [quiet, setQuiet] = useState(true);
  const first = useRef<{ chat: string; baseSeq: number } | null>(null);
  const prev = useRef<{
    chat: string;
    h: number;
    firstKey?: string;
    lastKey?: string;
    loaded: boolean;
  }>({
    chat: chat.id,
    h: 0,
    loaded: false,
  });
  const typing = ctl.typing(chat.id);

  // messages already there when the thread opened never animate; only live arrivals do
  if (bucket.loaded && first.current?.chat !== chat.id)
    first.current = { chat: chat.id, baseSeq: Math.max(0, ...items.map((i) => i.message.seq)) };
  const baseSeq = first.current?.chat === chat.id ? first.current.baseSeq : Infinity;

  useEffect(() => {
    setQuiet(true);
    if (!bucket.loaded) return;
    const t = setTimeout(() => setQuiet(false), 400);
    return () => clearTimeout(t);
  }, [chat.id, bucket.loaded]);

  // prepended history is not news: keep the log quiet while it loads and for a moment after it lands
  const [quietOlder, setQuietOlder] = useState(false);
  useEffect(() => {
    if (bucket.loadingOlder) {
      setQuietOlder(true);
      return;
    }
    const t = setTimeout(() => setQuietOlder(false), 400);
    return () => clearTimeout(t);
  }, [bucket.loadingOlder]);

  // Only messages that just arrived over the stream get the entrance: the newest three of the last second, so a
  // reconnect that replays a pile of messages does not make them all fly in.
  const now = Date.now();
  const fresh = new Set(
    rows
      .flatMap((r) => {
        if (r.kind !== 'msg' || r.own || r.message.seq <= baseSeq) return [];
        const at = ctl.arrivedAt(r.message.id);
        return at !== undefined && now - at <= 1000 ? [{ id: r.message.id, at }] : [];
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .map((x) => x.id),
  );

  const toBottom = useCallback(() => {
    const e = el.current;
    if (!e) return;
    e.scrollTop = e.scrollHeight;
    stick.current = true;
    setAtBottom(true);
    setNewCount(0);
  }, []);

  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    const p = prev.current;
    const firstKey = rows.find((r) => r.kind === 'msg')?.key;
    const lastRow = [...rows].reverse().find((r) => r.kind === 'msg') as
      Extract<ThreadRow, { kind: 'msg' }> | undefined;
    const lastKey = lastRow?.key;
    if (p.chat !== chat.id || (!p.loaded && bucket.loaded)) {
      toBottom();
    } else if (firstKey && p.firstKey && firstKey !== p.firstKey && lastKey === p.lastKey) {
      // older history was prepended: keep the reading position
      e.scrollTop += e.scrollHeight - p.h;
    } else if (lastKey !== p.lastKey) {
      if (stick.current || lastRow?.own) toBottom();
      else setNewCount((n) => n + 1);
    } else if (stick.current) {
      e.scrollTop = e.scrollHeight;
    }
    prev.current = { chat: chat.id, h: e.scrollHeight, firstKey, lastKey, loaded: bucket.loaded };
  }, [rows, typing.length, chat.id, bucket.loaded, toBottom]);

  const onScroll = () => {
    const e = el.current;
    if (!e) return;
    const near = e.scrollHeight - e.scrollTop - e.clientHeight < 48;
    stick.current = near;
    setAtBottom(near);
    if (near) setNewCount(0);
    if (e.scrollTop < 80 && bucket.hasMore && !bucket.loadingOlder) void ctl.loadOlder(chat.id);
  };

  const prompts = chat.kind === 'dm' ? QUICK_PROMPTS_DM : QUICK_PROMPTS_GROUP;
  const dmId = dmIdFor(ctl.me);
  const paused = pausedCopy(ctl) !== null;

  const cardActions = useMemo(
    () => ({
      fill: onPrompt,
      cite: (c: { file: string; page: number; label: string }) => {
        setCite(c);
        setCiteCtx(undefined);
      },
    }),
    [onPrompt],
  );

  // cards never take more than ~40% of the thread viewport
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const apply = () =>
      w.style.setProperty('--sqc-card-max', `${Math.round(w.clientHeight * 0.4)}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(w);
    return () => ro.disconnect();
  }, []);

  return (
    <ChatCardActionsContext.Provider value={cardActions}>
      <div className="sqc-log-wrap" ref={wrap}>
        <div
          ref={el}
          className="sqc-log"
          role="log"
          tabIndex={0}
          aria-label={`Messages in ${chat.title}`}
          aria-live={quiet || quietOlder ? 'off' : 'polite'}
          aria-relevant="additions text"
          aria-busy={(!bucket.loaded && !bucket.error) || undefined}
          data-testid="chat-thread"
          data-chat-id={chat.id}
          onScroll={onScroll}
        >
          {!bucket.loaded && !bucket.error ? (
            <div className="sqc-skeletons" role="status" aria-label="Loading messages">
              {[70, 45, 82, 38].map((w, i) => (
                <div key={i} className={`sqc-skel${i % 3 === 1 ? ' is-own' : ''}`}>
                  <Skeleton shape="block" width={32} height={32} />
                  <Skeleton shape="block" width={`${w}%`} height={i % 2 ? 40 : 56} />
                </div>
              ))}
            </div>
          ) : bucket.error && !bucket.loaded ? (
            <ErrorState
              title="Messages did not load"
              error={bucket.errorText}
              retryLabel="Retry"
              onRetry={() => void ctl.loadHistory(chat.id)}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="message"
              title={chat.kind === 'dm' ? 'A private chat with Cubbie' : 'No messages yet, say hi'}
              body={
                chat.kind === 'dm'
                  ? 'Only you can see this. Ask about your progress, your notes, or a chapter.'
                  : 'Start the conversation, or ask Cubbie something.'
              }
              action={
                <div className="sqc-prompts" role="group" aria-label="Suggestions">
                  {prompts.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="sqc-prompt"
                      data-testid="chat-prompt"
                      onClick={() => onPrompt(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              }
            />
          ) : (
            <>
              {bucket.hasMore ? (
                <div className="sqc-older">
                  <button
                    type="button"
                    className="sqc-link"
                    onClick={() => void ctl.loadOlder(chat.id)}
                    disabled={bucket.loadingOlder}
                  >
                    {bucket.loadingOlder ? 'Loading earlier messages' : 'Show earlier messages'}
                  </button>
                </div>
              ) : null}
              <ol className="sqc-rows">
                {rows.map((r) =>
                  r.kind === 'day' ? (
                    <li key={r.key} className="sqc-day" aria-label={r.label}>
                      <span>{r.label}</span>
                    </li>
                  ) : (
                    <li key={r.key} className="sqc-rowitem" data-head={r.head || undefined}>
                      <MessageBubble
                        row={r}
                        api={ctl.api}
                        status={ctl.status}
                        me={ctl.me}
                        isNew={fresh.has(r.message.id)}
                        reduced={reduced}
                        scene={scene}
                        compact={compact}
                        paused={paused}
                        onCite={(c, t) => {
                          // Canvas / Drive / Calendar / Classroom citations open the shared source viewer.
                          if (c.source && c.source.kind !== 'pdf') {
                            openSource({
                              file: c.file,
                              page: 1,
                              source: {
                                kind: c.source.kind,
                                id: c.source.id,
                                ...(c.source.anchor ? { anchor: c.source.anchor } : {}),
                                title: c.file,
                              },
                              ...(c.quote ? { quote: c.quote } : {}),
                            });
                            return;
                          }
                          setCite(c);
                          setCiteCtx(t);
                        }}
                        onRetry={(id) => void ctl.retry(chat.id, id)}
                        onDiscard={(id) => ctl.discard(chat.id, id)}
                        onRetryDelivery={(id) => void ctl.retryDelivery(id)}
                        quizAnswer={ctl.quizAnswer}
                        onQuizAnswer={(m, choice) => ctl.answerQuiz(m.chatId, m.id, choice)}
                        onConfirm={(m, n) =>
                          m.card?.type === 'confirm'
                            ? ctl.confirm(m.chatId, m.card.taskId, n)
                            : Promise.resolve('failed' as const)
                        }
                        onOpenDm={
                          onOpenChat && chat.id !== dmId ? () => onOpenChat(dmId) : undefined
                        }
                      />
                    </li>
                  ),
                )}
              </ol>
              <AnswerWait chat={chat} ctl={ctl} items={items} reduced={reduced} typing={typing} />
            </>
          )}
          {rows.length === 0 && typing.length ? (
            <TypingIndicator names={typing} reduced={reduced} />
          ) : null}
        </div>
        {!atBottom && newCount > 0 ? (
          <button type="button" className="sqc-pill" data-testid="chat-new-pill" onClick={toBottom}>
            <Icon name="arrow-down" size={14} />
            Jump to latest ({newCount} new)
          </button>
        ) : null}
        <CitationSheet
          cite={cite}
          context={citeCtx}
          ctl={ctl}
          scene={scene}
          onClose={() => setCite(null)}
        />
      </div>
      {ownSourceHost && <SourceViewerHost />}
    </ChatCardActionsContext.Provider>
  );
}

// ------------------------------------------------------------------ thread pane

export interface ThreadPaneProps {
  chat: ChatSummary;
  ctl: ChatController;
  reduced: boolean;
  composerRef: RefObject<ComposerHandle | null>;
  compact?: boolean;
  scene?: boolean;
  onBack?: () => void;
  onOpenChat?: (id: string) => void;
  /** extra controls in the header (the dock's close button) */
  headerEnd?: ReactNode;
  /** small header actions next to the truth badge (a 'Plans' button) */
  headerActions?: ReactNode;
  /** left of the textarea (the '+' action menu) */
  composerLeading?: ReactNode;
  /** inline wizard/drawer above the composer: capped height, scrolls inside, never pushes the composer out */
  drawer?: ReactNode;
  /** open the group activity and ledger drawer (the chat page keeps `view=ledger` in the URL) */
  onOpenLedger?: () => void;
}

export function ThreadPane({
  chat,
  ctl,
  reduced,
  composerRef,
  compact,
  scene,
  onBack,
  onOpenChat,
  headerEnd,
  headerActions,
  composerLeading,
  drawer,
  onOpenLedger,
}: ThreadPaneProps) {
  const st = useHeaderTruth(ctl, chat.id);
  const names = chat.members.map((m) => m.name);
  const subtitle =
    chat.kind === 'dm'
      ? 'Cubbie, your study buddy'
      : `Shared with your squad · ${chat.subtitle ?? `${names.join(', ')} and Cubbie`}`;
  const paused = pausedCopy(ctl);
  const cfg = useSquadConfig();
  const liveHub = cfg.hubUrl ? { hubUrl: cfg.hubUrl, token: cfg.token ?? null } : null;
  const [liveTopic, setLiveTopic] = useState<string | null>(null);
  const isGroup = chat.kind === 'group';
  const planParam = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('plan');
    } catch {
      return null;
    }
  }, []);
  const wizardParam = useMemo(() => {
    try {
      const w = new URLSearchParams(window.location.search).get('wizard');
      return w === 'trip' || w === 'study' ? (w as PlanKind) : null;
    } catch {
      return null;
    }
  }, []);
  const [wizard, setWizard] = useState<PlanKind | null>(isGroup ? wizardParam : null);
  const [panel, setPanel] = useState<{ kind: PlanKind; id: string } | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const noticeKind = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('notice');
    } catch {
      return null;
    }
  }, []);
  const [noticeOpen, setNoticeOpen] = useState(!!noticeKind);
  // `plan=` deep link: scroll to the plan's card and highlight it (the card renders once history has loaded)
  useEffect(() => {
    if (!isGroup || !planParam) return;
    let tries = 0;
    const find = () =>
      [...document.querySelectorAll<HTMLElement>('[data-plan-id]')].find(
        (e) => e.dataset.planId === planParam,
      );
    const t = setInterval(() => {
      const el = find();
      if (el) {
        clearInterval(t);
        el.scrollIntoView?.({ block: 'center' });
        el.classList.add('is-highlight');
        el.setAttribute('data-highlighted', 'true');
      } else if (++tries > 40) {
        clearInterval(t);
        setPlansOpen(true); // the card is not in the loaded history: list the plans instead
      }
    }, 250);
    return () => clearInterval(t);
  }, [isGroup, planParam, chat.id]);
  const plansState = usePlans(liveHub, isGroup && plansOpen);
  const imsg = useImessageStatus(ctl.api);
  const planActions = useMemo(
    () => ({
      askCubbie: (r: { id: string; label: string }) => composerRef.current?.attachContext(r),
      openPlan: (r: { kind: PlanKind; id: string }) => {
        setWizard(null);
        setPlansOpen(false);
        setPanel(r);
      },
    }),
    [composerRef],
  );
  return (
    <PlanActionsContext.Provider value={planActions}>
      <div className="sqc-thread" data-chat-kind={chat.kind}>
        <header className="sqc-head">
          {onBack ? (
            <button
              type="button"
              className="sqc-iconbtn sqc-back"
              onClick={onBack}
              aria-label="Back to chats"
              data-testid="chat-back"
            >
              <Icon name="chevron-left" size={22} />
            </button>
          ) : null}
          {!compact ? <MemberStack chat={chat} /> : null}
          <div className="sqc-head__text">
            <h2 className="sqc-head__title">{chat.title}</h2>
            {!compact ? <p className="sqc-head__sub">{subtitle}</p> : null}
          </div>
          <div className="sqc-head__end">
            {chat.private ? (
              <span className="sqc-privacy" data-testid="chat-privacy-badge">
                <Icon name="lock" size={13} />
                <span className="sqc-privacy__long">Only you can see this</span>
                <span className="sqc-privacy__short" aria-hidden="true">
                  Private
                </span>
              </span>
            ) : null}
            {headerActions ? (
              <span className="sqc-head__actions" data-slot="header-actions">
                {headerActions}
              </span>
            ) : null}
            <ImessageIndicator status={imsg} chatId={chat.id} compact={compact} />
            <span className="sqc-head__conn">
              <span data-testid="chat-header-badge" data-tone={st.tone} title={st.detail}>
                <StatusDot status={st.status} label={st.label} hideLabel={compact} />
              </span>
            </span>
            {isGroup && !compact ? (
              <button
                type="button"
                className="sqc-iconbtn"
                aria-label="Plans"
                aria-expanded={plansOpen}
                data-testid="plans-toggle"
                onClick={() => setPlansOpen((o) => !o)}
              >
                <Icon name="ledger" size={20} />
              </button>
            ) : null}
            {headerEnd}
          </div>
        </header>
        {isGroup && plansOpen ? (
          <PlansDrawer
            {...plansState}
            focusId={planParam}
            onRetry={plansState.reload}
            onCreate={(k) => {
              setPlansOpen(false);
              setWizard(k);
            }}
            onOpen={(p) => planActions.openPlan({ kind: p.kind, id: p.id })}
            onClose={() => setPlansOpen(false)}
          />
        ) : null}
        {isGroup && noticeOpen && (noticeKind === 'plans' || noticeKind === 'ledger') ? (
          <div data-testid="chat-migration-notice">
            <Notice tone="info" onDismiss={() => setNoticeOpen(false)}>
              {noticeKind === 'plans'
                ? 'Plans now live in your group chat: use + to plan a trip or a study plan, or open Plans.'
                : 'The ledger now lives in your group chat: use + then Group activity & ledger.'}
            </Notice>
          </div>
        ) : null}
        <ChatBanners ctl={ctl} />
        <MessageList
          key={chat.id}
          chat={chat}
          ctl={ctl}
          reduced={reduced}
          scene={scene}
          compact={compact}
          onPrompt={(t) => composerRef.current?.fill(t)}
          onOpenChat={onOpenChat}
        />
        {isGroup && panel ? (
          <PlanPanel kind={panel.kind} id={panel.id} hub={liveHub} onClose={() => setPanel(null)} />
        ) : null}
        {isGroup && wizard ? (
          <WizardDrawer
            kind={wizard}
            groupTitle={chat.title}
            hub={liveHub}
            onClose={() => setWizard(null)}
            onCreated={() => plansState.reload()}
            onOpenPlan={planActions.openPlan}
          />
        ) : null}
        {drawer ? (
          <div className="sqc-drawer" data-slot="drawer" data-testid="chat-drawer">
            {drawer}
          </div>
        ) : null}
        <Composer
          ref={composerRef}
          leading={composerLeading}
          key={`c-${chat.id}`}
          api={ctl.api}
          chatKind={chat.kind}
          chatId={chat.id}
          compact={compact}
          paused={paused}
          onSend={(input) => ctl.send(chat.id, input)}
          onDiscuss={setLiveTopic}
          onPlan={isGroup ? setWizard : undefined}
          {...(isGroup && onOpenLedger ? { onLedger: onOpenLedger } : {})}
        />
        {liveTopic ? (
          <LivePanel
            hub={liveHub}
            open
            topic={liveTopic}
            chatId={chat.id}
            calm={reduced}
            onClose={() => setLiveTopic(null)}
          />
        ) : null}
      </div>
    </PlanActionsContext.Provider>
  );
}
