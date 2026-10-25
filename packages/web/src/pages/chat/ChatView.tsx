import { useEffect, useRef, useState } from 'react';
import { Button } from '../../primitives/Button';
import { EmptyState, ErrorState } from '../../primitives/EmptyState';
import { Skeleton } from '../../primitives/Skeleton';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { ChatList } from './ChatList';
import type { ComposerHandle } from './Composer';
import { ChatBanners, ThreadPane } from './Thread';
import type { ChatController } from './useChat';
import './chat.css';
import { useChatPrefill } from './prefill';

export interface ChatViewProps {
  ctl: ChatController;
  /** controlled selection (the page keeps it in the URL); omit to let the view own it */
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  onSignInAgain?: () => void;
  /** group chats: the composer menu's 'Group activity & ledger' */
  onOpenLedger?: () => void;
}

/** Keeps the layout in step with the on-screen keyboard (visual viewport) without shifting the page. */
function useKeyboardInset(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const apply = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const open = kb > 80;
      root.current?.style.setProperty('--sqc-kb', open ? `${Math.round(kb)}px` : '0px');
      root.current?.classList.toggle('is-kbd', open);
      if (open && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [root]);
}

export function ChatView({
  ctl,
  activeId: controlled,
  onActiveChange,
  onSignInAgain,
  onOpenLedger,
}: ChatViewProps) {
  const wide = useMediaQuery('(min-width: 768px)');
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [own, setOwn] = useState<string | null>(null);
  const picked = controlled !== undefined ? controlled : own;
  const setPicked = (id: string | null) => (onActiveChange ? onActiveChange(id) : setOwn(id));
  useKeyboardInset(root);
  useChatPrefill((text) => composer.current?.fill(text));

  const chats = ctl.chats;
  const activeId =
    picked && chats.some((c) => c.id === picked) ? picked : wide ? (chats[0]?.id ?? null) : null;
  const active = chats.find((c) => c.id === activeId) ?? null;

  const { setActive } = ctl;
  useEffect(() => {
    setActive(active?.id ?? null);
    return () => setActive(null);
  }, [active?.id, setActive, ctl.phase]);

  // '/' focuses the composer, like most chat tools; Esc inside the composer blurs it (handled there)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!composer.current) return;
      e.preventDefault();
      composer.current.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // returning from a thread on a phone puts focus back on the row you opened
  const back = () => {
    const id = active?.id ?? null;
    setPicked(null);
    requestAnimationFrame(() =>
      (document.querySelector(`[data-testid="chat-row-${id}"]`) as HTMLElement | null)?.focus(),
    );
  };

  const cls = ['sqc', reduced && 'sqc--reduced'].filter(Boolean).join(' ');
  const shell = (children: React.ReactNode) => (
    <div ref={root} className={cls} data-reduced={reduced || undefined}>
      {children}
    </div>
  );

  if (ctl.phase === 'idle')
    return shell(
      <div className="sqc__state">
        <EmptyState
          icon="message"
          title="Chat is offline"
          body="Connect to a hub to talk with your squad and Nook. Sign in with a hub URL to start."
        />
      </div>,
    );
  if (ctl.phase === 'expired')
    return shell(
      <div className="sqc__state">
        <EmptyState
          icon="lock"
          tone="error"
          title="Your session ended"
          body="Sign in again."
          action={
            onSignInAgain ? (
              <Button variant="primary" onClick={onSignInAgain}>
                Sign in again
              </Button>
            ) : undefined
          }
        />
      </div>,
    );
  if (ctl.phase === 'error')
    return shell(
      <div className="sqc__state">
        <ErrorState
          title="Chat did not load"
          error={ctl.errorText}
          retryLabel="Retry"
          onRetry={ctl.reload}
        />
      </div>,
    );

  const loading = ctl.phase === 'loading';
  return shell(
    <>
      <div className="sqc__panes" data-view={active ? 'thread' : 'list'}>
        <aside className="sqc__listpane" aria-label="Chats">
          <div className="sqc__listhead">
            <h1 className="sqc__h1">Chat</h1>
          </div>
          {!wide && !active ? <ChatBanners ctl={ctl} className="sqc-banners--list" /> : null}
          <ChatList
            chats={chats}
            activeId={activeId}
            unread={ctl.unread}
            loading={loading}
            meName={chats.flatMap((c) => c.members).find((m) => m.id === ctl.me)?.name}
            onSelect={(id) => setPicked(id)}
          />
        </aside>
        <section className="sqc__threadpane" aria-label="Conversation">
          {active ? (
            <ThreadPane
              chat={active}
              ctl={ctl}
              reduced={reduced}
              composerRef={composer}
              onBack={wide ? undefined : back}
              onOpenChat={(id) => setPicked(id)}
              {...(onOpenLedger ? { onOpenLedger } : {})}
            />
          ) : loading ? (
            <div className="sqc__loading" role="status" aria-label="Loading chat">
              <div className="sqc__loadhead">
                <Skeleton shape="block" width={40} height={40} />
                <div className="sqc__loadtext">
                  <Skeleton shape="line" width={140} />
                  <Skeleton shape="line" width={220} />
                </div>
              </div>
              <div className="sqc-skeletons">
                {[70, 45, 82, 38].map((w, i) => (
                  <div key={i} className={`sqc-skel${i % 3 === 1 ? ' is-own' : ''}`}>
                    <Skeleton shape="block" width={32} height={32} />
                    <Skeleton shape="block" width={`${w}%`} height={i % 2 ? 40 : 56} />
                  </div>
                ))}
              </div>
            </div>
          ) : chats.length === 0 ? (
            <EmptyState
              icon="message"
              title="No chats yet"
              body="Your squad chat will show up here. Try again if it does not."
              action={
                <Button variant="secondary" onClick={ctl.reload}>
                  Retry
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="message"
              title="Pick a chat"
              body="Choose your squad or your private chat with Nook."
            />
          )}
        </section>
      </div>
    </>,
  );
}
