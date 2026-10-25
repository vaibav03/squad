import { useId, useRef } from 'react';
import { OverlayFrame, LvIcon } from './kit';
import type { ConfirmSheetProps } from './types';
import './ConfirmSheet.css';

const DEFAULT_OPTIONS = ['Yes', 'No'];

export function ConfirmSheet(props: ConfirmSheetProps) {
  const {
    open,
    onClose,
    returnFocusTo,
    calm,
    fixed,
    question,
    options = DEFAULT_OPTIONS,
    details,
    phase = 'idle',
    message,
    onChoose,
  } = props;
  const titleId = useId();
  const busy = phase === 'submitting';
  const done = phase === 'done';
  const chosen = useRef<number | null>(null);
  const firstBtn = useRef<HTMLButtonElement | null>(null);

  const choose = (opt: string, i: number) => {
    if (busy || done) return;
    chosen.current = i;
    onChoose(opt, i);
  };

  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      fixed={fixed}
      labelledBy={titleId}
      size="sm"
      initialFocus={() => firstBtn.current}
      className="lv-confirm"
    >
      <span className="lv-grip" aria-hidden="true" />
      <div className="lv-confirm__body">
        <p className="lv-eyebrow">Waiting for your yes</p>
        <h2 id={titleId} className="lv-confirm__q">
          {question}
        </h2>

        {details && details.length > 0 && (
          <dl className="lv-confirm__details">
            {details.map((d, i) => (
              <div
                key={`${d.label}-${i}`}
                className="lv-confirm__row"
                data-tone={d.tone ?? 'plain'}
              >
                <dt>
                  {d.tone === 'shared' && <LvIcon name="eye" size={16} />}
                  {d.tone === 'private' && <LvIcon name="lock" size={16} />}
                  <span>{d.label}</span>
                </dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {phase === 'error' && (
          <p className="lv-confirm__msg" role="alert">
            <LvIcon name="alert" size={16} />
            {message ?? 'That did not go through. Try again.'}
          </p>
        )}

        {done ? (
          <div className="lv-confirm__done" role="status">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="lv-confirm__tick"
            >
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Got it. Your answer is in.</span>
            <button type="button" className="lv-btn lv-btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <div
            className="lv-confirm__actions"
            data-count={options.length}
            aria-busy={busy || undefined}
          >
            {options.map((opt, i) => {
              const primary = i === 0;
              const loading = busy && chosen.current === i;
              return (
                <button
                  key={`${opt}-${i}`}
                  ref={i === 0 ? firstBtn : undefined}
                  type="button"
                  className={`lv-btn ${primary ? 'lv-btn--primary' : 'lv-btn--ghost'}`}
                  data-loading={loading || undefined}
                  disabled={busy && !loading}
                  aria-disabled={loading || undefined}
                  onClick={() => choose(opt, i)}
                >
                  {loading && <span className="lv-spin" aria-hidden="true" />}
                  {opt}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </OverlayFrame>
  );
}
