import { useLayoutEffect, useRef } from 'react';
import {
  messageTruth,
  TRUTH_LABELS,
  type ChatCitation,
  type ChatMessage,
  type HubStatus,
} from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { Markdown } from '../../primitives/Markdown';
import { renderCard } from './card-registry';
import { useSquadConfig } from '../../shell/context';
import { AudioPlayer, ImageAttachment } from './media';
import { ChatAvatar } from './parts';
import { SyncBadge } from './sync/SyncBadge';
import { ProvenanceRow } from './provenance/ProvenanceRow';
import { openSource } from '../../components/source-viewer';
import {
  attachmentLabel,
  citationSpeech,
  linkHost,
  resolveCitations,
  roleTag,
  senderSpeech,
  textRepeatsCard,
  timeLabel,
  withInlineCites,
  type ThreadRow,
} from './model';
import type { ConfirmResult } from './useChat';
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
  /** Retry a failed iMessage delivery of this message (id = hub message id). */
  onRetryDelivery?: (messageId: string) => void;
  quizAnswer: (messageId: string) => string | undefined;
  onQuizAnswer: (m: ChatMessage, choice: string) => Promise<boolean>;
  onConfirm: (m: ChatMessage, n: number) => Promise<ConfirmResult>;
  onOpenDm?: () => void;
}

/** Links whose text hides where they go get the host after them, in small muted text. */
function useLinkHosts(ref: React.RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (a.querySelector('.sqc-host')) continue;
      const host = linkHost(a.textContent ?? '', a.getAttribute('href') ?? '');
      if (!host) continue;
      const s = document.createElement('span');
      s.className = 'sqc-host';
      s.textContent = ` (${host})`;
      a.append(s);
    }
  }, [ref, text]);
}

export function MessageBubble(p: BubbleProps) {
  const { row, api, status } = p;
  const cfg = useSquadConfig();
  const hub = cfg.hubUrl ? { hubUrl: cfg.hubUrl, token: cfg.token ?? null } : null;
  const m = row.message;
  const sender = m.sender;
  const bubbleRef = useRef<HTMLDivElement>(null);
  useLinkHosts(bubbleRef, m.text);

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
  // each message carries its OWN truth badge, independent of the header
  const truth = messageTruth(m.demo);
  const showDemo = bot && truth.state !== 'live';
  // Only the bot's replies carry verified sources: a student typing `[x.pdf p.3]` stays plain text.
  const cites = bot && m.card?.type !== 'council' ? resolveCitations(m.text, m.citations) : [];
  // Non-PDF sources (Canvas, Drive, Calendar) have no page: they open the source viewer instead of the page sheet.
  const cite = (c: ChatCitation) => {
    if (c.source) {
      const { title, url, ...ref } = c.source;
      openSource({
        file: c.file,
        page: 1,
        source: {
          ...ref,
          ...(title ? { title } : {}),
          ...(url ? { url } : {}),
        } as NonNullable<Parameters<typeof openSource>[0]['source']>,
      });
    } else p.onCite(c, m.text);
  };
  const onBubbleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.sq-md__cite');
    if (!el) return;
    const n = Number(el.textContent?.trim());
    const c = cites[n - 1];
    if (c) cite(c);
  };
  // The structured card is the canonical answer; its text twin is for transports that cannot render cards (iMessage,
  // Discord) and for screen readers (the card carries it as accessible text).
  const text =
    m.card?.type === 'council' || (m.card && textRepeatsCard(m.text, m.card)) ? '' : m.text.trim();
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
            {!row.own ? (
              <span className="sqc-msg__name" aria-hidden="true">
                {sender.name}
              </span>
            ) : null}
            {tag ? (
              <span className="sqc-pixtag" aria-hidden="true">
                {tag}
              </span>
            ) : null}
            {showDemo ? (
              <span
                className="sqc-pixtag sqc-pixtag--demo"
                data-testid="chat-demo-label"
                title={TRUTH_LABELS[truth.state]}
              >
                {truth.label}
              </span>
            ) : null}
            {m.repeat ? (
              <span
                className="sqc-pixtag"
                data-testid="chat-repeat"
                title={`The same message was sent ${m.repeat} times; shown once`}
              >
                ×{m.repeat}
              </span>
            ) : null}
            {sender.kind === 'student' ? (
              <span
                className="sqs__src"
                data-testid="chat-source-label"
                data-source={m.transport === 'imessage' ? 'imessage' : 'web'}
              >
                {m.transport === 'imessage' ? 'via iMessage' : 'via web'}
              </span>
            ) : null}
            <time className="sqc-msg__time" dateTime={new Date(m.ts).toISOString()}>
              {row.state === 'sent' ? timeLabel(m.ts) : ''}
            </time>
          </div>
        ) : null}

        <span className="sq-sr-only">{senderSpeech(sender, p.me)}: </span>
        {text || attachments.length ? (
          <div
            ref={bubbleRef}
            className="sqc-bubble"
            title={timeLabel(m.ts)}
            onClick={cites.length ? onBubbleClick : undefined}
          >
            {text ? <Markdown>{bot ? withInlineCites(text, m.citations) : text}</Markdown> : null}
            {attachments.map((a) =>
              a.kind === 'image' ? (
                <ImageAttachment
                  key={a.id}
                  att={a}
                  url={api?.fileUrl(a) ?? a.url}
                  scene={p.scene}
                  label={attachmentLabel(a, sender, p.me)}
                />
              ) : a.kind === 'audio' ? (
                <AudioPlayer
                  key={a.id}
                  att={a}
                  url={api?.fileUrl(a) ?? a.url}
                  label={attachmentLabel(a, sender, p.me)}
                />
              ) : (
                <div key={a.id} className="sqc-media sqc-media--broken">
                  <Icon name="file" size={18} />
                  <span>{a.name ?? 'File'}</span>
                </div>
              ),
            )}
          </div>
        ) : null}

        {m.card ? renderCard(m, m.card, p, hub) : null}

        {cites.length ? (
          <div className="sqc-sources" role="group" aria-label="Sources">
            {cites.map((c, i) => (
              <button
                key={`${c.file}-${c.page}`}
                type="button"
                className="sqc-cite"
                data-testid="chat-citation-chip"
                aria-haspopup="dialog"
                aria-label={citationSpeech(c)}
                onClick={() => cite(c)}
              >
                <span className="sqc-cite__n" aria-hidden="true">
                  {i + 1}
                </span>
                {c.label}
              </button>
            ))}
          </div>
        ) : null}

        {bot ? <ProvenanceRow message={m} /> : null}

        <SyncBadge
          {...(row.head && sender.kind === 'student' ? { hideVia: true } : {})}
          {...(m.transport ? { transport: m.transport } : {})}
          {...(m.deliveryState ? { deliveryState: m.deliveryState } : {})}
          {...(m.senderLabel && m.senderLabel !== sender.name
            ? { senderLabel: m.senderLabel }
            : {})}
          {...(m.skippedAttachments ? { skippedAttachments: m.skippedAttachments } : {})}
          {...(m.receivedLate ? { receivedLate: true } : {})}
          {...(p.onRetryDelivery && row.state === 'sent'
            ? { onRetry: () => p.onRetryDelivery!(m.id) }
            : {})}
        />

        {row.state === 'pending' ? (
          <p className="sqc-msg__state" data-testid="chat-msg-state" role="status">
            Sending
          </p>
        ) : null}
        {row.state === 'sent' && row.acked ? (
          <p className="sqc-msg__state is-sent" data-testid="chat-msg-state">
            Sent
          </p>
        ) : null}
        {row.state === 'failed' && row.localId ? (
          <p className="sqc-msg__state is-failed" role="alert" data-testid="chat-msg-state">
            <Icon name="alert" size={14} />
            <span>Failed to send. {row.error ?? ''}</span>
            <button
              type="button"
              className="sqc-link"
              onClick={() => p.onRetry(row.localId!)}
              disabled={p.paused}
            >
              Retry
            </button>
            <button type="button" className="sqc-link" onClick={() => p.onDiscard(row.localId!)}>
              Delete
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
