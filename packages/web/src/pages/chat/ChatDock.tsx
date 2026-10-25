import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../../primitives/EmptyState';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useSquadConfig } from '../../shell/context';
import { hubStudentId } from '../../shell/dev-login';
import { createChatApi, type ChatApi } from './api';
import type { ComposerHandle } from './Composer';
import { ThreadPane } from './Thread';
import { useChat } from './useChat';
import './chat.css';
import './dock.css';
import { useChatPrefill } from './prefill';

export interface ChatDockProps {
  /** false in replay mode or without a hub token: nothing renders and no request is made */
  enabled: boolean;
  /** inject a fake api (tests, gallery) instead of the hub */
  api?: ChatApi | null;
  me?: string;
}

/**
 * A small floating chat over the village: the squad group chat in a compact panel. Closed, it never touches the
 * keyboard. Open, every key inside the panel is kept away from the game canvas.
 */
export function ChatDock({ enabled, api: injected, me: injectedMe }: ChatDockProps) {
  const cfg = useSquadConfig();
  const live = cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const api = useMemo<ChatApi | null>(
    () =>
      !enabled
        ? null
        : injected !== undefined
          ? injected
          : live
            ? createChatApi({ hubUrl: cfg.hubUrl!, token: cfg.token! })
            : null,
    [enabled, injected, live, cfg.hubUrl, cfg.token],
  );
  const me = injectedMe ?? (cfg.userId ? hubStudentId(cfg.userId) : '');
  const ctl = useChat(api, { me });
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const panelId = useId();
  const dock = useRef<HTMLDivElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const group = ctl.chats.find((c) => c.kind === 'group') ?? null;

  const { setActive } = ctl;
  useEffect(() => {
    setActive(open && group ? group.id : null);
    return () => setActive(null);
  }, [open, group?.id, setActive]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => composer.current?.focus());
  }, [open, group?.id]);

  // Another surface (the council decision card) asks for a drafted message: open the dock and fill the composer.
  useChatPrefill((text) => {
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => composer.current?.fill(text)));
  });

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => pill.current?.focus());
  };
  closeRef.current = close;

  // Keys typed in the dock belong to the dock. The Phaser canvas and the village cutscene listen on window and
  // document (the cutscene in the capture phase), so this listener runs first, on window in the capture phase, and
  // only for events whose target is inside the open panel. Because that also hides keys from React, the composer's own key
  // handling and Escape are run from here.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const root = dock.current;
      const t = e.target as Node | null;
      // only the open panel: the pill, sheets (portals) and the rest of the page are not ours
      const panel = root?.querySelector('.sqd-panel');
      if (!root || !t || !panel || !panel.contains(t)) return;
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      const area = root.querySelector('[data-testid=chat-composer-input]');
      const used = t === area && composer.current ? composer.current.keydown(e) : false;
      if (e.key === 'Escape' && !used) {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [enabled]);

  if (!enabled || !api) return null;
  const unread = ctl.totalUnread;

  return (
    <div ref={dock} className="sqd sq-scene" data-testid="chat-dock">
      {open ? <div className="sqd-scrim" aria-hidden="true" /> : null}
      {open ? (
        <section
          id={panelId}
          className={`sqd-panel${reduced ? ' sqc--reduced' : ''}`}
          role="dialog"
          aria-label="Squad chat"
        >
          <span className="sqd-handle" aria-hidden="true" />
          {ctl.phase === 'loading' ? (
            <div className="sqd-state" role="status" aria-label="Loading chat">
              <Skeleton shape="block" height={48} />
              <Skeleton shape="block" height={96} />
            </div>
          ) : ctl.phase !== 'ready' || !group ? (
            <div className="sqd-state">
              <EmptyState
                icon="message"
                tone={ctl.phase === 'idle' ? 'default' : 'error'}
                title={
                  ctl.phase === 'expired'
                    ? 'Your session ended'
                    : ctl.phase === 'idle'
                      ? 'Chat is offline'
                      : ctl.phase === 'ready'
                        ? 'No chats yet'
                        : 'Chat did not load'
                }
                body={
                  ctl.phase === 'expired'
                    ? 'Sign in again.'
                    : ctl.phase === 'ready'
                      ? 'Your squad chat is not available yet. Try again.'
                      : ctl.phase === 'idle'
                        ? 'Connect to the hub to chat with your squad.'
                        : ctl.errorText
                }
              />
              {ctl.phase === 'error' || ctl.phase === 'ready' ? (
                <button
                  type="button"
                  className="sqc-btn"
                  data-testid="chat-dock-retry"
                  onClick={ctl.reload}
                >
                  Retry
                </button>
              ) : null}
              <button type="button" className="sqc-btn" onClick={close}>
                Close
              </button>
            </div>
          ) : (
            <>
              <ThreadPane
                chat={group!}
                ctl={ctl}
                reduced={reduced}
                composerRef={composer}
                compact
                scene
                headerEnd={
                  <button
                    type="button"
                    className="sqc-iconbtn"
                    aria-label="Close chat"
                    onClick={close}
                    data-testid="chat-dock-close"
                  >
                    <Icon name="x" size={20} />
                  </button>
                }
              />
            </>
          )}
        </section>
      ) : null}
      <button
        ref={pill}
        type="button"
        className="sqd-pill"
        data-testid="chat-dock-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="message" size={18} />
        <span>Chat</span>
        {unread > 0 && !open ? (
          <span className="sqc-unread" data-testid="chat-dock-unread">
            <span aria-hidden="true">{unread > 9 ? '9+' : unread}</span>
            <span className="sq-sr-only">{unread} unread messages</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
