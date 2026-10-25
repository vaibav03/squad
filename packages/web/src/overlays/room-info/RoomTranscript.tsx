import { useEffect, useRef } from 'react';
import type { RoomOutcome } from '@squad/core';
import type { RoomInfo, TranscriptEntry } from '@squad/village/rooms';
import { Icon } from '../../primitives/Icon';
import { Portrait } from '../../council/deliberation/Portrait';
import { resolveParticipant } from '../../council/deliberation/participants';
import { TURN_TYPE, type TurnType } from '../../council/deliberation/turn-types';
import { openBoard, useCanOpenBoard } from '../../council/board/bridge';
import { speakerName } from './names';
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

/** Portrait of whoever is speaking (cast bust or crest). The name is always printed beside it. */
export function SpeakerDot({ who }: { who: string }) {
  return (
    <span className="rr-dot" aria-hidden="true">
      <Portrait who={resolveParticipant(who, speakerName(who))} />
    </span>
  );
}

/** Room transcript kinds -> turn types (docs/design/DELIBERATION.md). Captions and notes carry no badge. */
const KIND_TURN: Partial<Record<TranscriptEntry['kind'], TurnType>> = {
  opinion: 'proposal',
  question: 'evidence',
  rank: 'ballot',
  verdict: 'decision',
};

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
  const canOpenBoard = useCanOpenBoard();

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, outcome]);

  return (
    <section
      className={['rr-strip', className].filter(Boolean).join(' ')}
      data-compact={compact ? 'true' : undefined}
    >
      <div className="rr-strip__bar">
        <p className="rr-strip__head" aria-hidden="true">
          <Icon name="message" size={14} />
          What they are saying
        </p>
        {canOpenBoard ? (
          <button type="button" className="rr-strip__board" onClick={() => openBoard()}>
            <Icon name="scale" size={14} />
            Open deliberation board
          </button>
        ) : null}
      </div>
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
          entries.map((e) => {
            const t = e.dissent ? 'challenge' : KIND_TURN[e.kind];
            const who = resolveParticipant(e.who, speakerName(e.who));
            return (
              <article
                key={e.id}
                className="rr-line rr-turn"
                data-kind={e.kind}
                data-dissent={e.dissent || undefined}
                data-authority={who.authority || undefined}
              >
                <SpeakerDot who={e.who} />
                <div className="rr-turn__main">
                  <p className="rr-turn__head">
                    <span className="rr-line__who">{speakerName(e.who)}</span>
                    {t ? (
                      <span className="rr-badge" data-type={t}>
                        <Icon name={TURN_TYPE[t].icon} size={12} />
                        {e.dissent ? 'Challenge' : TURN_TYPE[t].label}
                      </span>
                    ) : null}
                    {e.dissent ? <span className="rr-tag">disagrees</span> : null}
                  </p>
                  <p className="rr-line__text">{e.text}</p>
                </div>
              </article>
            );
          })
        )}
        {outcome && entries.length > 0 ? (
          <p className="rr-line rr-line--note">Outcome ready: {outcome.title}</p>
        ) : null}
      </div>
    </section>
  );
}
