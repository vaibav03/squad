import type { ChatSummary } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { MemberStack } from './parts';
import { listTime, previewLine } from './model';

export interface ChatListProps {
  chats: ChatSummary[];
  activeId: string | null;
  unread: Record<string, number>;
  onSelect: (id: string) => void;
  loading?: boolean;
  /** The viewer's display name: their own last messages read "You: ...". */
  meName?: string;
}

export function ChatList({ chats, activeId, unread, onSelect, loading, meName }: ChatListProps) {
  if (loading)
    return (
      <div className="sqc-list" data-testid="chat-list" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="sqc-row sqc-row--skeleton">
            <Skeleton shape="block" width={60} height={32} />
            <div className="sqc-row__body">
              <Skeleton shape="line" width="55%" />
              <Skeleton shape="line" width="85%" />
            </div>
          </div>
        ))}
        <p className="sqc-loading" role="status">
          Loading chats
        </p>
      </div>
    );
  if (chats.length === 0)
    return (
      <div className="sqc-list" data-testid="chat-list">
        <p className="sqc-loading" data-testid="chat-list-empty">
          No chats yet
        </p>
      </div>
    );
  return (
    <ul className="sqc-list" data-testid="chat-list" aria-label="Chats">
      {chats.map((c) => {
        const n = unread[c.id] ?? 0;
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <button
              type="button"
              className="sqc-row"
              data-testid={`chat-row-${c.id}`}
              data-unread={n > 0 || undefined}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(c.id)}
            >
              <MemberStack chat={c} />
              <span className="sqc-row__body">
                <span className="sqc-row__top">
                  <span className="sqc-row__title">
                    {c.title}
                    {c.private ? (
                      <>
                        <Icon name="lock" size={13} className="sqc-row__lock" />
                        <span className="sq-sr-only">, private</span>
                      </>
                    ) : null}
                  </span>
                  {c.last ? <time className="sqc-row__time">{listTime(c.last.ts)}</time> : null}
                </span>
                <span className="sqc-row__bottom">
                  <span className="sqc-row__preview">{previewLine(c, meName)}</span>
                  {n > 0 ? (
                    <span className="sqc-unread" data-testid={`chat-unread-${c.id}`}>
                      <span aria-hidden="true">{n > 9 ? '9+' : n}</span>
                      <span className="sq-sr-only">{n} unread</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
