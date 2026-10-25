import { useEffect, useRef } from 'react';
import type { RoomOutcome } from '@squad/core';
import type { RoomInfo, TranscriptEntry } from '@squad/village/rooms';
import { speakerName, speakerTone } from './names';
import './room-info.css';

export interface RoomTranscriptProps {
  entries: readonly TranscriptEntry[];
  /** When present the strip ends with a quiet "plan is ready" line. */
  outcome?: RoomOutcome;
  info?: RoomInfo;
  /** Shows a Run it button in the empty state. */
  onRun?: (phrase: string) => void;
  /** Smaller strip (used while the plan card is showing above it). */
  compact?: boolean;
  className?: string;
}

export function SpeakerDot({ who }: { who: string }) {
  return <span className="rr-dot" data-tone={speakerTone(who)} aria-hidden="true" />;
}

/** One line per thing said, whole (never typed out). New lines scroll into view unless the reader scrolled up. */
export function RoomTranscript({
  entries,
  outcome,
  info,
  onRun,
  compact,
  className,
}: RoomTranscriptProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const phrase = info?.how.phrase ?? null;

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, outcome]);

  return (
    <section
      className={['rr-strip', className].filter(Boolean).join(' ')}
      data-compact={compact ? 'true' : undefined}
    >
      <p className="rr-strip__head" aria-hidden="true">
        What they are saying
      </p>
      <div
        ref={ref}
        className="rr-strip__log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="What they are saying"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <div className="rr-strip__empty">
            <p>
              {phrase ? (
                <>
                  Nobody is talking yet. Say <q className="rr-phrase-inline">{phrase}</q> in chat or
                  press Run it.
                </>
              ) : (
                'Nobody is talking yet. They will start as soon as you walk in.'
              )}
            </p>
            {phrase && onRun ? (
              <button
                type="button"
                className="lv-btn lv-btn--primary rr-strip__run"
                onClick={() => onRun(phrase)}
              >
                Run it
              </button>
            ) : null}
          </div>
        ) : (
          entries.map((e) => (
            <p
              key={e.id}
              className="rr-line"
              data-kind={e.kind}
              data-dissent={e.dissent || undefined}
            >
              <SpeakerDot who={e.who} />
              <span className="rr-line__who">{speakerName(e.who)}</span>
              {e.dissent ? <span className="rr-tag">disagrees</span> : null}
              <span className="rr-line__text">{e.text}</span>
            </p>
          ))
        )}
        {outcome && entries.length > 0 ? (
          <p className="rr-line rr-line--note">Outcome ready: {outcome.title}</p>
        ) : null}
      </div>
    </section>
  );
}
