import { ModeBadge } from '../board/ModeBadge';
import type { CouncilLiveState, LiveTurn } from './reducer';
import './live.css';

/**
 * Live captions under the stage: the speaker's name chip, the run's mode badge and the streaming words. Words only
 * (the output transcript); aria-live is polite and only the settled turn is announced, never every delta.
 */
export function CouncilCaptions({
  live,
  mode,
  fallback,
  calm,
}: {
  live: Pick<CouncilLiveState, 'speaker' | 'turns' | 'transcript'>;
  mode: string | undefined;
  /** Text to show when there is no live channel (the last public line, for runs on the streaming transport). */
  fallback?: { name: string; text: string } | undefined;
  calm?: boolean | undefined;
}) {
  const turn: LiveTurn | undefined = live.speaker
    ? live.turns.find((t) => t.turn === live.speaker!.turn)
    : live.turns.at(-1);
  const name = turn?.name ?? fallback?.name;
  const text = turn?.text || fallback?.text || '';
  const settled = [...live.turns].reverse().find((t) => t.state !== 'streaming');
  return (
    <section
      className="cn-captions"
      aria-label="Live captions"
      data-testid="council-captions"
      data-state={turn?.state ?? (text ? 'complete' : 'none')}
      data-calm={calm ? 'true' : undefined}
    >
      <div className="cn-captions__head">
        {name ? (
          <span className="cn-captions__chip" data-testid="caption-speaker">
            {name}
          </span>
        ) : null}
        <ModeBadge mode={mode} />
        {turn?.state === 'streaming' ? (
          <span className="cn-captions__tag">Speaking</span>
        ) : turn?.state === 'cut' ? (
          <span className="cn-captions__tag">Cut off</span>
        ) : null}
      </div>
      <p className="cn-captions__text" data-testid="caption-text">
        {text || 'Waiting for the first words.'}
      </p>
      <span className="cn-sr" role="status" aria-live="polite">
        {settled ? `${settled.name}: ${settled.text}` : ''}
      </span>
    </section>
  );
}
