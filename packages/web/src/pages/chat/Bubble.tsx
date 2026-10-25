import type { ChatCitation, ChatMessage, HubStatus } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { Markdown } from '../../primitives/Markdown';
import { ConfirmMessageCard, QuizMessageCard } from './cards';
import { AudioPlayer, ImageAttachment } from './media';
import { ChatAvatar } from './parts';
import {
  resolveCitations,
  roleTag,
  textRepeatsCard,
  timeLabel,
  withInlineCites,
  type ThreadRow,
} from './model';
import type { ChatApi } from './api';

type MsgRow = Extract<ThreadRow, { kind: 'msg' }>;

export interface BubbleProps {
  row: MsgRow;
  api: ChatApi | null;
  status: HubStatus | null;
  me: string;
  /** arrived live after the thread was opened: gets the short entrance */
  isNew: boolean;
  reduced: boolean;
  scene?: boolean;
  compact?: boolean;
  /** sending is paused (offline / expired) */
  paused?: boolean;
  onCite: (c: ChatCitation, answerText?: string) => void;
  onRetry: (localId: string) => void;
  onDiscard: (localId: string) => void;
  quizAnswer: (messageId: string) => string | undefined;
  onQuizAnswer: (m: ChatMessage, choice: string) => Promise<boolean>;
  onConfirm: (m: ChatMessage, n: number) => Promise<boolean>;
  onOpenDm?: () => void;
}

export function MessageBubble(p: BubbleProps) {
  const { row, api, status } = p;
  const m = row.message;
  const sender = m.sender;

  if (sender.kind === 'system')
    return (
      <div
        className="sqc-sys"
        data-testid="chat-message"
        data-sender-id="system"
        data-message-id={m.id}
        role="note"
      >
        <Icon name="info" size={14} />
        <span>{m.text}</span>
      </div>
    );

  const senderId = sender.id;
  const tag = roleTag(sender);
  const bot = sender.kind === 'persona';
  const showDemo = bot && !!status?.demo;
  const cites = resolveCitations(m.text, m.citations);
  const onBubbleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.sq-md__cite');
    if (!el) return;
    const n = Number(el.textContent?.trim());
    const c = cites[n - 1];
    if (c) p.onCite(c, m.text);
  };
  const text = m.card && textRepeatsCard(m.text, m.card) ? '' : m.text.trim();
  const attachments = m.attachments;
  const cls = [
    'sqc-msg',
    row.own && 'is-own',
    bot && 'is-bot',
    row.head && 'is-head',
    row.tail && 'is-tail',
    row.state !== 'sent' && `is-${row.state}`,
    p.isNew && !p.reduced && 'sqc-enter',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-testid="chat-message"
      data-sender-id={senderId}
      data-message-id={m.id}
      data-own={row.own || undefined}
      data-state={row.state}
    >
      {!row.own ? (
        <div className="sqc-msg__av">{row.head ? <ChatAvatar sender={sender} /> : null}</div>
      ) : null}
      <div className="sqc-msg__col">
        {row.head ? (
          <div className="sqc-msg__head">
            {!row.own ? <span className="sqc-msg__name">{sender.name}</span> : null}
            {tag ? <span className="sqc-pixtag">{tag}</span> : null}
            {showDemo ? (
              <span
                className="sqc-pixtag sqc-pixtag--demo"
                data-testid="chat-demo-label"
                title="Demo mode answer"
              >
                Demo
              </span>
            ) : null}
            <time className="sqc-msg__time" dateTime={new Date(m.ts).toISOString()}>
              {row.state === 'sent' ? timeLabel(m.ts) : ''}
            </time>
          </div>
        ) : null}

        {text || attachments.length ? (
          <div
            className="sqc-bubble"
            title={timeLabel(m.ts)}
            onClick={cites.length ? onBubbleClick : undefined}
          >
            {text ? <Markdown>{withInlineCites(text, m.citations)}</Markdown> : null}
            {attachments.map((a) =>
              a.kind === 'image' ? (
                <ImageAttachment
                  key={a.id}
                  att={a}
                  url={api?.fileUrl(a) ?? a.url}
                  scene={p.scene}
                />
              ) : a.kind === 'audio' ? (
                <AudioPlayer key={a.id} att={a} url={api?.fileUrl(a) ?? a.url} />
              ) : (
                <div key={a.id} className="sqc-media sqc-media--broken">
                  <Icon name="file" size={18} />
                  <span>{a.name ?? 'File'}</span>
                </div>
              ),
            )}
          </div>
        ) : null}

        {m.card?.type === 'quiz' ? (
          <QuizMessageCard
            message={m}
            card={m.card}
            answered={p.quizAnswer(m.id)}
            inDm={m.chatId.startsWith('dm:')}
            onAnswer={(a) => p.onQuizAnswer(m, a)}
            onOpenDm={p.onOpenDm}
            disabled={p.paused}
          />
        ) : null}
        {m.card?.type === 'confirm' ? (
          <ConfirmMessageCard
            card={m.card}
            onChoose={(n) => p.onConfirm(m, n)}
            disabled={p.paused}
          />
        ) : null}

        {cites.length ? (
          <div className="sqc-sources" role="group" aria-label="Sources">
            {cites.map((c, i) => (
              <button
                key={`${c.file}-${c.page}`}
                type="button"
                className="sqc-cite"
                data-testid="chat-citation-chip"
                aria-haspopup="dialog"
                onClick={() => p.onCite(c, m.text)}
              >
                <span className="sqc-cite__n" aria-hidden="true">
                  {i + 1}
                </span>
                {c.label}
              </button>
            ))}
          </div>
        ) : null}

        {row.state === 'pending' ? (
          <p className="sqc-msg__state" role="status">
            Sending
          </p>
        ) : null}
        {row.state === 'failed' && row.localId ? (
          <p className="sqc-msg__state is-failed" role="alert">
            <Icon name="alert" size={14} />
            <span>{row.error ?? 'Not sent.'}</span>
            <button
              type="button"
              className="sqc-link"
              onClick={() => p.onRetry(row.localId!)}
              disabled={p.paused}
            >
              Retry
            </button>
            <button type="button" className="sqc-link" onClick={() => p.onDiscard(row.localId!)}>
              Remove
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
