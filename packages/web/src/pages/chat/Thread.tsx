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
import type { ChatCitation, ChatCitationExcerpt, ChatSummary } from '@squad/core';
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
import { QUICK_PROMPTS_DM, QUICK_PROMPTS_GROUP, buildRows, dmIdFor, type ThreadRow } from './model';
import type { ChatController } from './useChat';
import { LivePanel } from '../../live/LivePanel';
import { useSquadConfig } from '../../shell/context';

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

function connStatus(ctl: ChatController): { status: Status; label: string } {
  if (ctl.conn === 'expired') return { status: 'error', label: 'Signed out' };
  if (!ctl.online) return { status: 'offline', label: 'Offline' };
  if (ctl.conn === 'offline') return { status: 'busy', label: 'Reconnecting' };
  if (ctl.conn === 'connecting') return { status: 'idle', label: 'Connecting' };
  return { status: 'live', label: 'Live' };
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
  const items = useMemo(() => ctl.thread(chat.id), [ctl.thread, chat.id]);
  const rows = useMemo(() => buildRows(items, ctl.me), [items, ctl.me]);
  const el = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [cite, setCite] = useState<ChatCitation | null>(null);
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

  return (
    <div className="sqc-log-wrap">
      <div
        ref={el}
        className="sqc-log"
        role="log"
        tabIndex={0}
        aria-label={`Messages in ${chat.title}`}
        aria-live={quiet || quietOlder ? 'off' : 'polite'}
        aria-relevant="additions text"
        aria-busy={bucket.loading || undefined}
        data-testid="chat-thread"
        data-chat-id={chat.id}
        onScroll={onScroll}
      >
        {bucket.loading && !bucket.loaded ? (
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
                        setCite(c);
                        setCiteCtx(t);
                      }}
                      onRetry={(id) => void ctl.retry(chat.id, id)}
                      onDiscard={(id) => ctl.discard(chat.id, id)}
                      quizAnswer={ctl.quizAnswer}
                      onQuizAnswer={(m, choice) => ctl.answerQuiz(m.chatId, m.id, choice)}
                      onConfirm={(m, n) =>
                        m.card?.type === 'confirm'
                          ? ctl.confirm(m.chatId, m.card.taskId, n)
                          : Promise.resolve('failed' as const)
                      }
                      onOpenDm={onOpenChat && chat.id !== dmId ? () => onOpenChat(dmId) : undefined}
                    />
                  </li>
                ),
              )}
            </ol>
            <TypingIndicator names={typing} reduced={reduced} />
          </>
        )}
        {rows.length === 0 && typing.length ? (
          <TypingIndicator names={typing} reduced={reduced} />
        ) : null}
      </div>
      {!atBottom && newCount > 0 ? (
        <button type="button" className="sqc-pill" data-testid="chat-new-pill" onClick={toBottom}>
          <Icon name="arrow-down" size={14} />
          New messages
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
}: ThreadPaneProps) {
  const st = connStatus(ctl);
  const names = chat.members.map((m) => m.name);
  const subtitle =
    chat.kind === 'dm'
      ? 'Cubbie, your study buddy'
      : `Shared with your squad · ${chat.subtitle ?? `${names.join(', ')} and Cubbie`}`;
  const paused = pausedCopy(ctl);
  const cfg = useSquadConfig();
  const liveHub = cfg.hubUrl ? { hubUrl: cfg.hubUrl, token: cfg.token ?? null } : null;
  const [liveTopic, setLiveTopic] = useState<string | null>(null);
  return (
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
          <span className="sqc-head__conn">
            <StatusDot status={st.status} label={st.label} hideLabel={compact} />
          </span>
          {headerEnd}
        </div>
      </header>
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
      <Composer
        ref={composerRef}
        key={`c-${chat.id}`}
        api={ctl.api}
        chatKind={chat.kind}
        compact={compact}
        paused={paused}
        onSend={(input) => ctl.send(chat.id, input)}
        onDiscuss={setLiveTopic}
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
  );
}
