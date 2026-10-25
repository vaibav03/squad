import { useLayoutEffect, useRef } from 'react';
import type { ChatCitation, ChatMessage, HubStatus } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { Markdown } from '../../primitives/Markdown';
import { ConfirmMessageCard, QuizMessageCard } from './cards';
import { CouncilChatCard } from '../../council';
import { LiveChatCard } from '../../live/LiveChatCard';
import { useSquadConfig } from '../../shell/context';
import { AudioPlayer, ImageAttachment } from './media';
import { ChatAvatar } from './parts';
import { SyncBadge } from './sync/SyncBadge';
import { ProvenanceRow } from './provenance/ProvenanceRow';
import { PlanChatCard } from './PlanChatCard';
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
  const showDemo = bot && !!status?.demo;
  // Only the bot's replies carry verified sources: a student typing `[x.pdf p.3]` stays plain text.
  const cites = bot ? resolveCitations(m.text, m.citations) : [];
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
                title="Demo mode answer"
              >
                Demo
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
        {m.card?.type === 'council' ? (
          <div data-testid="chat-council-card">
            <CouncilChatCard hub={hub} runId={m.card.runId} calm={p.reduced} />
          </div>
        ) : null}
        {m.card?.type === 'plan' ? (
          <PlanChatCard hub={hub} planId={m.card.planId} status={m.card.status} rev={m.card.rev} />
        ) : null}
        {m.card?.type === 'live' ? (
          <div data-testid="chat-live-card">
            <LiveChatCard
              hub={hub}
              liveId={m.card.liveId}
              {...(m.card.topic ? { topic: m.card.topic } : {})}
              calm={p.reduced}
            />
          </div>
        ) : null}
        {m.card?.type === 'confirm' ? (
          <ConfirmMessageCard
            card={m.card}
            onChoose={(n) => p.onConfirm(m, n)}
            disabled={p.paused}
          />
        ) : null}

        {m.context?.length ? (
          <ul className="sqc-ctxchips is-sent" aria-label="Attached context">
            {m.context.map((c) => (
              <li
                key={c.sourceId}
                className="sqc-ctxchip"
                data-testid="message-context-chip"
                data-provenance={c.provenance}
              >
                <span className="sqc-ctxchip__main">
                  <Icon name="file" size={14} />
                  <strong className="sqc-ctxchip__title">{c.title}</strong>
                  <span className="sqc-ctxchip__meta">
                    {[c.courseName, c.eventLabel, c.location?.label].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`sqc-ctxchip__prov is-${c.provenance}`}>
                  {c.provenance === 'fixture' ? 'Fixture (simulated)' : 'Real'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {cites.length ? (
          <div className="sqc-sources" role="group" aria-label="Sources">
            {cites.map((c, i) => (
              <button
                key={`${c.source ? `${c.source.kind}/${c.source.id}#${c.source.anchor ?? ''}` : c.file}-${c.page}`}
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
                {c.source?.provenance ? (
                  <span
                    className={`sqc-cite__prov is-${c.source.provenance}`}
                    data-testid="chat-citation-provenance"
                    data-provenance={c.source.provenance}
                  >
                    {c.source.provenance === 'fixture' ? 'Fixture (simulated)' : 'Real'}
                  </span>
                ) : null}
                {c.source && (c.source.courseName || c.source.locationLabel) ? (
                  <span className="sqc-cite__loc" data-testid="chat-citation-location">
                    {[c.source.courseName, c.source.locationLabel].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
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
