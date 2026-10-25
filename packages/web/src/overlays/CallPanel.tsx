import { useEffect, useId, useRef } from 'react';
import { OverlayFrame, LvIcon, usePrefersReducedMotion } from './kit';
import { Waveform } from './Waveform';
import { citationLabel, formatElapsed } from './call-state';
import type { CallPanelProps, CallCaption } from './types';
import './CallPanel.css';

const STATUS_LABEL = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  ended: 'Call ended',
  error: 'Connection lost',
} as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function CallPanel(props: CallPanelProps) {
  const {
    open,
    onClose,
    returnFocusTo,
    calm,
    agent,
    status,
    captions,
    speaking,
    level,
    muted,
    onMuteChange,
    handRaised,
    onHandRaiseChange,
    onLeave,
    onOpenCitation,
    elapsedMs,
    message,
    onRetry,
  } = props;
  const titleId = useId();
  const reduced = usePrefersReducedMotion(calm);
  const muteBtn = useRef<HTMLButtonElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const log = useRef<HTMLOListElement | null>(null);
  const stick = useRef(true);
  const ended = status === 'ended';
  const live = status === 'live';
  const glow = speaking === 'agent' ? Math.min(1, Math.max(0.25, level ?? 0.5)) : 0;

  // Keep the newest caption in view unless the reader scrolled up.
  useEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [captions.length, open]);

  const tone = !live
    ? 'idle'
    : speaking === 'you' && !muted
      ? 'you'
      : speaking === 'agent'
        ? 'agent'
        : 'idle';

  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy={titleId}
      placement="dock"
      size="sm"
      className="lv-call"
      initialFocus={() => (ended ? closeBtn.current : muteBtn.current)}
    >
      <span className="lv-grip" aria-hidden="true" />
      <button
        type="button"
        className="lv-btn lv-close"
        onClick={onClose}
        aria-label="Close call panel"
      >
        <LvIcon name="x" size={20} />
      </button>

      <header className="lv-call__head">
        <div className="lv-call__who">
          <h2 id={titleId} className="lv-call__name">
            {agent.name}
          </h2>
          <p className="lv-call__role">{agent.role}</p>
          <p className="lv-call__status" data-status={status}>
            <span className="lv-call__dot" aria-hidden="true" />
            <span>{STATUS_LABEL[status]}</span>
            {live && elapsedMs !== undefined && (
              <span className="lv-call__time">{formatElapsed(elapsedMs)}</span>
            )}
          </p>
        </div>
      </header>

      <div className="lv-call__stage" data-speaking={speaking === 'agent' || undefined}>
        <div className="lv-call__portrait" style={{ ['--lv-glow-o' as string]: glow }}>
          <span className="lv-call__ring" aria-hidden="true" />
          {agent.portrait ? (
            <img src={agent.portrait} alt="" />
          ) : (
            <span className="lv-call__tile" aria-hidden="true">
              {agent.emoji ?? initials(agent.name)}
            </span>
          )}
        </div>
        <Waveform
          level={live ? level : undefined}
          tone={muted && speaking !== 'agent' ? 'idle' : tone}
          reduced={reduced}
        />
      </div>

      {(status === 'reconnecting' || status === 'error') && (
        <div
          className="lv-call__notice"
          role={status === 'error' ? 'alert' : 'status'}
          data-status={status}
        >
          <LvIcon name={status === 'error' ? 'wifi-off' : 'refresh'} size={18} />
          <p>
            {message ?? (status === 'error' ? 'The call dropped.' : 'Trying to get the line back.')}
          </p>
          {status === 'error' && onRetry && (
            <button type="button" className="lv-btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      <section className="lv-call__captions" aria-label="Captions">
        {status === 'connecting' ? (
          <div className="lv-call__skeleton" role="status">
            <span className="lv-vh">Connecting to {agent.name}</span>
            <span className="lv-skel" style={{ width: '88%' }} />
            <span className="lv-skel" style={{ width: '64%' }} />
          </div>
        ) : captions.length === 0 ? (
          <p className="lv-call__empty">
            {ended ? 'No captions were recorded.' : 'Captions appear here as the call goes.'}
          </p>
        ) : (
          <ol
            ref={log}
            className="lv-call__log"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            tabIndex={0}
            aria-label="Call captions"
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {captions.map((c) => (
              <Caption key={c.id} c={c} agentName={agent.name} onOpenCitation={onOpenCitation} />
            ))}
          </ol>
        )}
      </section>

      <footer className="lv-call__controls">
        {ended ? (
          <button
            ref={closeBtn}
            type="button"
            className="lv-btn lv-btn--primary lv-call__wide"
            onClick={onClose}
          >
            Close
          </button>
        ) : (
          <>
            <button
              ref={muteBtn}
              type="button"
              className="lv-btn lv-call__ctl"
              aria-pressed={muted}
              onClick={() => onMuteChange(!muted)}
              disabled={status === 'connecting'}
            >
              <LvIcon name={muted ? 'mic-off' : 'mic'} size={20} />
              <span>{muted ? 'Muted' : 'Mute'}</span>
            </button>
            <button
              type="button"
              className="lv-btn lv-call__ctl"
              aria-pressed={handRaised}
              onClick={() => onHandRaiseChange(!handRaised)}
              disabled={status === 'connecting'}
            >
              <LvIcon name="hand" size={20} />
              <span>{handRaised ? 'Hand up' : 'Raise hand'}</span>
            </button>
            <button
              type="button"
              className="lv-btn lv-btn--danger lv-call__ctl lv-call__leave"
              onClick={onLeave}
            >
              <LvIcon name="phone-off" size={20} />
              <span>Leave</span>
            </button>
          </>
        )}
      </footer>
    </OverlayFrame>
  );
}

function Caption({
  c,
  agentName,
  onOpenCitation,
}: {
  c: CallCaption;
  agentName: string;
  onOpenCitation?: CallPanelProps['onOpenCitation'];
}) {
  const cite = c.cite;
  return (
    <li className="lv-cap" data-speaker={c.speaker}>
      <span className="lv-cap__who">{c.speaker === 'you' ? 'You' : agentName}</span>
      <p className="lv-cap__text">{c.text}</p>
      {cite &&
        (onOpenCitation ? (
          <button
            type="button"
            className="lv-cite"
            onClick={() => onOpenCitation(cite)}
            title={cite.file}
          >
            <LvIcon name="file" size={14} />
            {citationLabel(cite)}
          </button>
        ) : (
          <span className="lv-cite" title={cite.file}>
            <LvIcon name="file" size={14} />
            {citationLabel(cite)}
          </span>
        ))}
      {cite?.quote && <q className="lv-cap__quote">{cite.quote}</q>}
    </li>
  );
}
