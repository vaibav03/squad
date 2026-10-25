import type { ReactNode } from 'react';
import type { ChatCard, ChatMessage } from '@squad/core';
import { CouncilChatCard } from '../../council';
import { LiveChatCard } from '../../live/LiveChatCard';
import { ConfirmMessageCard, QuizMessageCard } from './cards';
import { PlanChatCard } from './PlanChatCard';
import { TripChatCard } from '../../plans/TripChatCard';
import type { BubbleProps } from './Bubble';

export type CardOf<T extends ChatCard['type']> = Extract<ChatCard, { type: T }>;
export interface CardEnv {
  m: ChatMessage;
  p: BubbleProps;
  hub: { hubUrl: string; token: string | null } | null;
}

/**
 * Thread cards are a registry keyed by card type. `framed` cards share the compact container: height constrained to
 * ~40% of the thread viewport (--sqc-card-max) with internal scroll, so no card can push recent messages away. Plan
 * cards (and any later type) register here and inherit the same container and section styling (.sqc-card*).
 */
interface Entry<T extends ChatCard['type']> {
  framed: boolean;
  render(card: CardOf<T>, env: CardEnv): ReactNode;
}
type Registry = { [K in ChatCard['type']]: Entry<K> };

export const CARD_REGISTRY: Registry = {
  quiz: {
    framed: false,
    render: (card, { m, p }) => (
      <QuizMessageCard
        message={m}
        card={card}
        answered={p.quizAnswer(m.id)}
        inDm={m.chatId.startsWith('dm:')}
        onAnswer={(a) => p.onQuizAnswer(m, a)}
        onOpenDm={p.onOpenDm}
        disabled={p.paused}
      />
    ),
  },
  council: {
    framed: false, // the council card owns its clamp (header stays sticky outside the scrolling body)
    render: (card, { hub, p }) => (
      <div data-testid="chat-council-card">
        <CouncilChatCard hub={hub} runId={card.runId} calm={p.reduced} />
      </div>
    ),
  },
  plan: {
    framed: true,
    render: (card, { hub }) => (
      <PlanChatCard hub={hub} planId={card.planId} status={card.status} rev={card.rev} />
    ),
  },
  trip: {
    framed: true,
    render: (card, { hub }) => <TripChatCard hub={hub} card={card} />,
  },
  live: {
    framed: true,
    render: (card, { hub, p }) => (
      <div data-testid="chat-live-card">
        <LiveChatCard
          hub={hub}
          liveId={card.liveId}
          {...(card.topic ? { topic: card.topic } : {})}
          calm={p.reduced}
        />
      </div>
    ),
  },
  confirm: {
    framed: false,
    render: (card, { m, p }) => (
      <ConfirmMessageCard
        card={card}
        onChoose={(n) => p.onConfirm(m, n)}
        {...(p.onReask ? { onReask: () => p.onReask!(m) } : {})}
        disabled={p.paused}
      />
    ),
  },
};

export function renderCard(
  m: ChatMessage,
  card: ChatCard,
  p: BubbleProps,
  hub: CardEnv['hub'],
): ReactNode {
  const entry = CARD_REGISTRY[card.type] as Entry<typeof card.type> | undefined;
  if (!entry) return null;
  const node = (entry.render as (c: ChatCard, e: CardEnv) => ReactNode)(card, { m, p, hub });
  return entry.framed ? (
    <div className="sqc-cardslot" data-card={card.type}>
      {node}
    </div>
  ) : (
    node
  );
}
