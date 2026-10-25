import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { OverlayFrame, LvIcon } from './kit';
import type { QuizCardProps } from './types';
import './QuizCard.css';

const KEYS = 'ABCDEFGH';

export function QuizCard(props: QuizCardProps) {
  const {
    open,
    onClose,
    returnFocusTo,
    calm,
    phase,
    quiz,
    result,
    message,
    onSubmit,
    onRetry,
    onNext,
  } = props;
  const titleId = useId();
  const textId = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const radios = useRef<Array<HTMLInputElement | null>>([]);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const quizId = quiz?.quizId;

  // A new question starts clean; a failed submit keeps what was typed.
  useEffect(() => {
    setChoice(null);
    setText('');
  }, [quizId]);

  const choices = quiz?.choices;
  const isChoice = !!choices && choices.length > 0;
  const locked = phase === 'submitting' || phase === 'done';
  const canSubmit =
    phase === 'answering' || phase === 'error'
      ? isChoice
        ? choice !== null
        : text.trim().length > 0
      : false;

  const submit = () => {
    if (!canSubmit || !quiz) return;
    onSubmit(isChoice ? { choice: choice! } : { text: text.trim() });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked || !isChoice || !choices) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      e.preventDefault();
      const c = choices[n - 1]!;
      setChoice(c.id);
      radios.current[n - 1]?.focus();
    } else if (e.key === 'Enter' && choice !== null && !(t instanceof HTMLButtonElement)) {
      e.preventDefault();
      submit();
    }
  };

  const showFeedback = phase === 'done' && result;
  const verdict =
    result?.correct === true ? 'correct' : result?.correct === false ? 'incorrect' : 'recorded';

  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy={titleId}
      size="md"
      className="lv-quiz"
      initialFocus={() =>
        radios.current.find((r) => r?.checked) ?? radios.current[0] ?? area.current
      }
    >
      <span className="lv-grip" aria-hidden="true" />
      <button type="button" className="lv-btn lv-close" onClick={onClose} aria-label="Close quiz">
        <LvIcon name="x" size={20} />
      </button>

      <div
        className="lv-quiz__body"
        onKeyDown={onKey}
        aria-busy={phase === 'loading' || phase === 'submitting' || undefined}
      >
        <header className="lv-quiz__head">
          {quiz ? (
            <>
              <span className="lv-quiz__chip">{quiz.chapter}</span>
              {quiz.label && (
                <span className="lv-quiz__label">
                  {quiz.label}
                  {quiz.total ? ` of ${quiz.total}` : ''}
                </span>
              )}
              {quiz.total && quiz.index ? (
                <span
                  className="lv-quiz__pills"
                  role="img"
                  aria-label={`Question ${quiz.index} of ${quiz.total}`}
                >
                  {Array.from({ length: quiz.total }, (_, i) => (
                    <i key={i} data-on={i < quiz.index! || undefined} />
                  ))}
                </span>
              ) : null}
            </>
          ) : (
            <span className="lv-skel" style={{ width: 96 }} />
          )}
        </header>

        {phase === 'loading' || !quiz ? (
          phase === 'error' ? (
            <ErrorBlock message={message} onRetry={onRetry} />
          ) : (
            <div className="lv-quiz__skeleton" role="status">
              <span className="lv-vh">Loading question</span>
              <span className="lv-skel" style={{ width: '92%', height: 20 }} />
              <span className="lv-skel" style={{ width: '70%', height: 20 }} />
              <span className="lv-skel" style={{ width: '100%', height: 52, marginTop: 12 }} />
              <span className="lv-skel" style={{ width: '100%', height: 52 }} />
              <span className="lv-skel" style={{ width: '100%', height: 52 }} />
            </div>
          )
        ) : (
          <>
            <h2 id={titleId} className="lv-quiz__q">
              {quiz.question}
            </h2>

            {isChoice ? (
              <div className="lv-quiz__choices" role="radiogroup" aria-labelledby={titleId}>
                {choices!.map((c, i) => {
                  const selected = choice === c.id;
                  return (
                    <label
                      key={c.id}
                      className="lv-quiz__choice"
                      data-selected={selected || undefined}
                      data-locked={locked || undefined}
                    >
                      <input
                        ref={(el) => {
                          radios.current[i] = el;
                        }}
                        type="radio"
                        name={`quiz-${quiz.quizId}`}
                        value={c.id}
                        checked={selected}
                        disabled={locked}
                        onChange={() => setChoice(c.id)}
                      />
                      <span className="lv-quiz__key" aria-hidden="true">
                        {KEYS[i] ?? i + 1}
                      </span>
                      <span className="lv-quiz__text">{c.label}</span>
                      {selected && phase === 'done' && (
                        <LvIcon name="check" size={18} className="lv-quiz__mark" />
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="lv-quiz__free">
                <label htmlFor={textId} className="lv-vh">
                  Your answer
                </label>
                <textarea
                  id={textId}
                  ref={area}
                  rows={3}
                  value={text}
                  disabled={locked}
                  placeholder="Type your answer in your own words"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <span className="lv-quiz__hint" aria-hidden="true">
                  Ctrl or Cmd + Enter to submit
                </span>
              </div>
            )}

            {phase === 'error' && <ErrorBlock message={message} onRetry={onRetry} inline />}

            {showFeedback && (
              <div className="lv-quiz__feedback" data-verdict={verdict} role="status">
                <p className="lv-quiz__verdict">
                  <LvIcon name={verdict === 'incorrect' ? 'x' : 'check'} size={18} />
                  {verdict === 'correct'
                    ? 'Recorded: correct'
                    : verdict === 'incorrect'
                      ? 'Not quite'
                      : 'Answer recorded'}
                </p>
                {verdict === 'recorded' && !result?.explanation && (
                  <p className="lv-quiz__explain">
                    Your answer is in. Your squad keeps results private.
                  </p>
                )}
                {result?.explanation && <p className="lv-quiz__explain">{result.explanation}</p>}
              </div>
            )}

            <footer className="lv-quiz__foot">
              {phase === 'done' ? (
                <button
                  type="button"
                  className="lv-btn lv-btn--primary"
                  onClick={onNext ?? onClose}
                >
                  {onNext ? 'Next' : 'Done'}
                </button>
              ) : (
                <button
                  type="button"
                  className="lv-btn lv-btn--primary"
                  disabled={!canSubmit && phase !== 'submitting'}
                  data-loading={phase === 'submitting' || undefined}
                  aria-disabled={phase === 'submitting' || undefined}
                  onClick={submit}
                >
                  {phase === 'submitting' && <span className="lv-spin" aria-hidden="true" />}
                  {phase === 'submitting' ? 'Sending' : 'Submit answer'}
                </button>
              )}
            </footer>
          </>
        )}
        {!quiz && (
          <h2 id={titleId} className="lv-vh">
            Quiz question
          </h2>
        )}
      </div>
    </OverlayFrame>
  );
}

function ErrorBlock({
  message,
  onRetry,
  inline,
}: {
  message?: string;
  onRetry?: () => void;
  inline?: boolean;
}) {
  return (
    <div className="lv-quiz__error" role="alert" data-inline={inline || undefined}>
      <p>
        <LvIcon name="alert" size={18} />
        {message ?? 'The question did not load.'}
      </p>
      {onRetry && (
        <button type="button" className="lv-btn" onClick={onRetry}>
          <LvIcon name="refresh" size={16} />
          Try again
        </button>
      )}
    </div>
  );
}
