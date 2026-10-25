import { useId, useState } from 'react';
import { copyText } from '../room-info/RoomInfoPanel';
import { LvIcon, OverlayFrame } from '../kit';
import { Level, Pips } from './Pips';
import {
  masteryPips,
  masteryWord,
  squadVisible,
  weakestChapters,
  weakestConcepts,
  type MasteryChapter,
  type MasteryData,
} from './model';
import { masteryReason, practisePhrase } from '@squad/village/rooms';
import './mastery.css';

export type DetailStatus = 'loading' | 'ready' | 'error' | 'offline';

export interface MasteryPanelProps {
  open: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  calm?: boolean;
  /** Your chapter houses, from the world. */
  chapters: readonly MasteryChapter[];
  /** Concept detail from the hub (own row plus squad average when allowed). */
  detail?: MasteryData;
  status: DetailStatus;
  /** Sends a chat phrase to the squad chat. Absent in replays: the button becomes Copy. */
  onPractise?: (phrase: string) => void;
  onRetry?: () => void;
}

/**
 * The in-world Mastery panel, docked like the room panel. Words plus pips and a one-line reason; squad averages only
 * with three or more people; nobody else's private values; no numeric grades.
 */
export function MasteryPanel(props: MasteryPanelProps) {
  const { open, onClose, returnFocusTo, calm, chapters, detail, status, onPractise, onRetry } =
    props;
  const titleId = useId();
  const showSquad = detail ? squadVisible(detail) : false;
  const started = chapters.some((c) => masteryPips(c.box) > 0);
  const weakCh = weakestChapters(chapters);
  const weakCo = detail ? weakestConcepts(detail.chapters) : [];
  const [copied, setCopied] = useState<string | null>(null);
  const practise = (phrase: string) => {
    if (onPractise) {
      onPractise(phrase);
      onClose();
    } else
      void copyText(phrase).then((ok) => {
        setCopied(ok ? phrase : null);
        setTimeout(() => setCopied(null), 1800);
      });
  };
  return (
    <OverlayFrame
      open={open}
      dock="mastery"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy={titleId}
      placement="dock"
      size="md"
      className="rr-panel lv-mpanel"
    >
      <span className="lv-grip" aria-hidden="true" />
      <button type="button" className="lv-btn lv-close" onClick={onClose} aria-label="Close">
        <LvIcon name="x" size={20} />
      </button>
      <div className="rr-panel__body">
        <header className="rr-panel__head">
          <h2 id={titleId} className="rr-panel__title">
            Mastery board
          </h2>
          <p className="rr-panel__tagline">
            How well each idea has stuck for you. A study map, not a grade.
          </p>
        </header>

        <ul className="lv-legend" aria-label="Legend">
          {([0, 1, 3, 5] as const).map((b) => (
            <li key={b}>
              <Pips box={b} />
              {masteryWord(b)}
            </li>
          ))}
        </ul>

        <section className="rr-sec" aria-labelledby={`${titleId}-ch`}>
          <h3 id={`${titleId}-ch`} className="rr-sec__h">
            Your chapters
          </h3>
          {chapters.length === 0 ? (
            <p className="rr-sec__p rr-dim">
              No chapters yet. Add your course PDFs in setup and your chapter houses show up here.
            </p>
          ) : (
            <ul className="lv-mrows">
              {chapters.map((c) => (
                <li key={c.slot} className="lv-mrow" data-testid="mastery-chapter">
                  <div className="lv-mrow__head">
                    <strong>{c.title}</strong>
                    <Level box={c.box} />
                  </div>
                  <p className="lv-mrow__why rr-dim">{masteryReason(c.box)}</p>
                </li>
              ))}
            </ul>
          )}
          {!started && chapters.length > 0 && (
            <p className="lv-mnote" role="note">
              <LvIcon name="info" size={16} /> Nothing started yet. Take a quiz here or over
              iMessage and the houses light up.
            </p>
          )}
        </section>

        {weakCh.length > 0 && (
          <section className="rr-sec" aria-labelledby={`${titleId}-weak`}>
            <h3 id={`${titleId}-weak`} className="rr-sec__h">
              Worth a look next
            </h3>
            <ul className="lv-mrows">
              {weakCh.map((c) => {
                const phrase = practisePhrase(c.n, c.title);
                return (
                  <li key={c.slot} className="lv-mrow lv-mrow--weak">
                    <div className="lv-mrow__head">
                      <span>
                        <strong>{c.title}</strong>{' '}
                        <span className="rr-dim">{masteryWord(c.box)}</span>
                      </span>
                      <button
                        type="button"
                        className="lv-btn lv-btn--primary rr-run"
                        onClick={() => practise(phrase)}
                        aria-label={`Practise this: ${c.title}`}
                      >
                        <LvIcon name={onPractise ? 'chevron' : 'file'} size={18} />
                        {onPractise
                          ? 'Practise this'
                          : copied === phrase
                            ? 'Copied'
                            : 'Copy phrase'}
                      </button>
                    </div>
                    <code className="rr-phrase" data-testid="practise-phrase">
                      {phrase}
                    </code>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="rr-sec" aria-labelledby={`${titleId}-co`}>
          <h3 id={`${titleId}-co`} className="rr-sec__h">
            {detail ? detail.courseTitle : 'Concepts'}
          </h3>
          {status === 'loading' && (
            <p className="rr-sec__p rr-dim" role="status">
              Loading your concepts...
            </p>
          )}
          {(status === 'error' || status === 'offline') && (
            <p className="rr-sec__p rr-dim" role="status">
              {status === 'offline' ? 'You are offline.' : 'The concept list did not load.'} Your
              progress is safe.{' '}
              {onRetry && (
                <button type="button" className="lv-btn" onClick={onRetry}>
                  Try again
                </button>
              )}
            </p>
          )}
          {status === 'ready' &&
            detail &&
            detail.chapters.every((c) => c.concepts.length === 0) && (
              <p className="rr-sec__p rr-dim">No concepts to show for this course yet.</p>
            )}
          {status === 'ready' && detail && !showSquad && (
            <p className="lv-mnote" role="note">
              <LvIcon name="users" size={16} /> Squad averages appear once three or more people have
              joined. With fewer, they could point to one person.
            </p>
          )}
          {status === 'ready' && detail && detail.chapters.some((c) => c.concepts.length > 0) && (
            <table className="lv-grid">
              <thead>
                <tr>
                  <th scope="col">Concept</th>
                  <th scope="col">You</th>
                  {showSquad && <th scope="col">Squad average</th>}
                </tr>
              </thead>
              <tbody>
                {detail.chapters.flatMap((c) =>
                  c.concepts.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">{x.label}</th>
                      <td>
                        <Pips box={x.box} label={`You: ${masteryWord(x.box)}`} />
                        <span className="lv-grid__word">{masteryWord(x.box)}</span>
                      </td>
                      {showSquad && (
                        <td>
                          {x.squadAvg !== undefined ? (
                            <>
                              <Pips
                                box={x.squadAvg}
                                label={`Squad average: ${masteryWord(x.squadAvg)}`}
                              />
                              <span className="lv-grid__word">{masteryWord(x.squadAvg)}</span>
                            </>
                          ) : (
                            <span className="lv-grid__word">Not enough data</span>
                          )}
                        </td>
                      )}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
          {weakCo.length > 0 && status === 'ready' && (
            <p className="rr-sec__p rr-dim lv-mweak">
              Weakest concepts:{' '}
              {weakCo.map((x) => `${x.label} (${masteryWord(x.box).toLowerCase()})`).join(', ')}.
            </p>
          )}
        </section>

        <section className="rr-sec rr-sec--privacy">
          <h3 className="rr-sec__h">
            <LvIcon name="lock" size={14} /> Privacy
          </h3>
          <p className="rr-sec__p rr-dim">
            This is your own map. Nobody else sees your answers, and nothing here compares you with
            anyone.
          </p>
        </section>
      </div>
    </OverlayFrame>
  );
}
