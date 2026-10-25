import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  const group = ctl.chats.find((c) => c.kind === 'group') ?? null;

  const { setActive } = ctl;
  useEffect(() => {
    setActive(open && group ? group.id : null);
    return () => setActive(null);
  }, [open, group?.id, setActive]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => composer.current?.focus());
  }, [open, group?.id]);

  if (!enabled || !api) return null;

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => pill.current?.focus());
  };
  // Keys typed in the panel belong to the panel: the Phaser canvas listens on window and must not see them.
  const isolate = (e: KeyboardEvent) => {
    if (e.type === 'keydown' && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
  };
  const unread = ctl.totalUnread;

  return (
    <div className="sqd sq-scene" data-testid="chat-dock">
      {open ? (
        <section
          id={panelId}
          className={`sqd-panel${reduced ? ' sqc--reduced' : ''}`}
          role="dialog"
          aria-label="Squad chat"
          onKeyDown={isolate}
          onKeyUp={isolate}
        >
          {ctl.phase === 'loading' || (ctl.phase === 'ready' && !group) ? (
            <div className="sqd-state" role="status" aria-label="Loading chat">
              <Skeleton shape="block" height={48} />
              <Skeleton shape="block" height={96} />
            </div>
          ) : ctl.phase !== 'ready' ? (
            <div className="sqd-state">
              <EmptyState
                icon="message"
                tone={ctl.phase === 'idle' ? 'default' : 'error'}
                title={
                  ctl.phase === 'expired'
                    ? 'Your session ended'
                    : ctl.phase === 'idle'
                      ? 'Chat is offline'
                      : 'Chat did not load'
                }
                body={
                  ctl.phase === 'expired'
                    ? 'Sign in again.'
                    : 'Check your connection and try again.'
                }
              />
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
