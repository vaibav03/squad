import { useEffect, useState } from 'react';
import type { ChatCard, ChatMessage } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import type { ConfirmResult } from './useChat';

type Quiz = Extract<ChatCard, { type: 'quiz' }>;
type Confirm = Extract<ChatCard, { type: 'confirm' }>;
const LETTERS = 'ABCDEFGH';

/**
 * Quiz question as a chat card. Answering sends the choice id (or free text) as an ordinary message; the viewer's
 * own answered state lives in localStorage (owned by useChat). Never any score, XP or streak.
 */
export function QuizMessageCard({
  message,
  card,
  answered,
  onAnswer,
  inDm,
  onOpenDm,
  disabled,
}: {
  message: ChatMessage;
  card: Quiz;
  /** what this viewer answered, if anything */
  answered?: string;
  onAnswer: (answer: string) => Promise<boolean>;
  inDm: boolean;
  onOpenDm?: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const locked = answered !== undefined || busy !== null;
  const mine = answered ?? busy ?? undefined;

  const submit = async (a: string) => {
    if (locked || disabled || !a.trim()) return;
    setBusy(a);
    setFailed(false);
    const ok = await onAnswer(a.trim());
    setBusy(null);
    if (!ok) setFailed(true);
  };

  return (
    <section
      className="sqc-card sqc-card--quiz"
      aria-label={`Quiz question ${card.index + 1}`}
      data-testid="chat-quiz-card"
      data-answered={answered !== undefined || undefined}
    >
      <header className="sqc-card__head">
        <span className="sqc-tag">Quiz</span>
        <span className="sqc-card__eyebrow">Question {card.index + 1}</span>
      </header>
      <p className="sqc-card__q">{card.question}</p>
      {card.input === 'choice' && card.choices ? (
        <div className="sqc-choices" role="group" aria-label="Answer choices">
          {card.choices.map((c, i) => {
            const chosen = mine === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className="sqc-choice"
                data-testid={`chat-quiz-choice-${c.id}`}
                data-chosen={chosen || undefined}
                aria-pressed={locked ? chosen : undefined}
                disabled={locked || disabled}
                onClick={() => void submit(c.id)}
              >
                <span className="sqc-choice__key" aria-hidden="true">
                  {c.id.length === 1 ? c.id : (LETTERS[i] ?? i + 1)}
                </span>
                <span className="sqc-choice__text">{c.text}</span>
                {chosen ? <Icon name="check" size={18} /> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="sqc-free"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(text);
          }}
        >
          <label className="sq-sr-only" htmlFor={`quiz-free-${message.id}`}>
            Your answer
          </label>
          <textarea
            id={`quiz-free-${message.id}`}
            data-testid="chat-quiz-free"
            rows={2}
            value={answered ?? text}
            placeholder="Type your answer"
            disabled={locked || disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit(text);
              }
            }}
          />
          {!locked ? (
            <button
              type="submit"
              className="sqc-btn sqc-btn--primary"
              disabled={!text.trim() || disabled}
            >
              Send answer
            </button>
          ) : null}
        </form>
      )}
      {failed ? (
        <p className="sqc-card__note is-error" role="alert">
          <Icon name="alert" size={14} />
          Your answer did not send. Try again.
        </p>
      ) : null}
      {locked ? (
        <p className="sqc-card__note" role="status" data-testid="chat-quiz-sent">
          <Icon name="lock" size={14} />
          {busy !== null && answered === undefined
            ? 'Sending your answer'
            : inDm
              ? 'Answer sent. Feedback will show up here.'
              : 'Answer sent, feedback in your DM'}
          {!inDm && onOpenDm && answered !== undefined ? (
            <button type="button" className="sqc-link" onClick={onOpenDm}>
              Open DM
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/** A confirmation the student must answer: options map to the 1-based number the router expects. */
export function ConfirmMessageCard({
  card,
  onChoose,
  onReask,
  disabled,
}: {
  card: Confirm;
  /** send the 1-based option number (with the task id) to the DM */
  onChoose: (n: number) => Promise<ConfirmResult>;
  /** re-send the original question so the bot creates a NEW confirm (the old card stays closed) */
  onReask?: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [reasked, setReasked] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  // the card's own expiry: a missed chat.update must not leave live-looking buttons
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (card.status !== 'pending' || !card.expiresAt) return;
    const ms = card.expiresAt - Date.now();
    if (ms <= 0) {
      setNow(Date.now());
      return;
    }
    const t = setTimeout(() => setNow(Date.now()), Math.min(ms + 50, 2_147_000_000));
    return () => clearTimeout(t);
  }, [card.status, card.expiresAt]);
  const lapsed = card.status === 'pending' && card.expiresAt !== undefined && now >= card.expiresAt;
  const expired = card.status === 'timeout' || stale || lapsed;
  const pending = card.status === 'pending' && !expired;
  const askAgain = async () => {
    if (!onReask || reasked === 'busy' || reasked === 'done') return;
    setReasked('busy');
    setReasked((await onReask()) ? 'done' : 'failed');
  };

  const choose = async (n: number) => {
    if (!pending || busy !== null || sent !== null || disabled) return;
    setBusy(n);
    setFailed(false);
    const r = await onChoose(n);
    setBusy(null);
    if (r === 'ok') setSent(n);
    else if (r === 'stale') setStale(true);
    else setFailed(true);
  };
  const answeredIdx = card.answer ? card.options.findIndex((o) => o === card.answer) : -1;
  return (
    <section
      className="sqc-card sqc-card--confirm"
      aria-label="Confirmation needed"
      data-testid="chat-confirm-card"
      data-status={card.status}
    >
      <header className="sqc-card__head">
        <span className="sqc-tag sqc-tag--warm">Your yes</span>
        <span className="sqc-card__eyebrow">
          {pending
            ? 'Waiting for your answer'
            : card.status === 'answered'
              ? 'Answered'
              : 'Expired'}
        </span>
      </header>
      <p className="sqc-card__q">{card.question}</p>
      <div className="sqc-choices" role="group" aria-label="Options">
        {card.options.map((opt, i) => {
          const n = i + 1;
          const chosen = card.status === 'answered' ? answeredIdx === i : sent === n || busy === n;
          return (
            <button
              key={`${n}-${opt}`}
              type="button"
              className={`sqc-choice${i === 0 && pending && sent === null ? ' is-primary' : ''}`}
              data-testid={`chat-confirm-option-${n}`}
              data-chosen={chosen || undefined}
              disabled={!pending || busy !== null || sent !== null || disabled}
              aria-busy={busy === n || undefined}
              onClick={() => void choose(n)}
            >
              <span className="sqc-choice__key" aria-hidden="true">
                {n}
              </span>
              <span className="sqc-choice__text">{opt}</span>
              {chosen ? <Icon name="check" size={18} /> : null}
            </button>
          );
        })}
      </div>
      {failed ? (
        <p className="sqc-card__note is-error" role="alert">
          <Icon name="alert" size={14} />
          That did not go through. Try again.
        </p>
      ) : null}

      {pending && (busy !== null || sent !== null) ? (
        <p className="sqc-card__note" role="status">
          <Icon name="check" size={14} />
          {busy !== null ? 'Sending your answer' : 'Answer sent. Waiting for confirmation.'}
        </p>
      ) : null}
      {card.status === 'answered' ? (
        <p className="sqc-card__note" role="status">
          <Icon name="check" size={14} />
          Already answered. You chose: {card.answer ?? 'an option'}
        </p>
      ) : null}
      {expired && card.status !== 'answered' ? (
        <>
          <p className="sqc-card__note is-warn" role="status" data-testid="chat-confirm-state">
            <Icon name="alert" size={14} />
            This question expired.
          </p>
          {onReask && card.reask ? (
            reasked === 'done' ? (
              <p className="sqc-card__note" role="status">
                <Icon name="check" size={14} />
                Asked again. A new question will show up.
              </p>
            ) : (
              <button
                type="button"
                className="sqc-choice is-primary"
                data-testid="chat-confirm-ask-again"
                disabled={reasked === 'busy' || disabled}
                aria-busy={reasked === 'busy' || undefined}
                onClick={() => void askAgain()}
              >
                <span className="sqc-choice__text">Ask again</span>
              </button>
            )
          ) : null}
          {reasked === 'failed' ? (
            <p className="sqc-card__note is-error" role="alert">
              <Icon name="alert" size={14} />
              Could not ask again. Try again.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
