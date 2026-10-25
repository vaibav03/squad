import { ConnectionBadge, LvIcon, StateBlock, type Connection } from '../../overlays/kit';
import { Page, Skeleton } from '../../primitives';
import {
  chapterBox,
  LEVEL_LABEL,
  levelOf,
  nextUp,
  squadVisible,
  type Chapter,
  type MasteryData,
} from './model';
import './mastery.css';

export type MasteryStatus = 'loading' | 'ready' | 'error' | 'offline';

export interface MasteryViewProps {
  status: MasteryStatus;
  connection: Connection;
  data?: MasteryData;
  onRetry?: () => void;
}

export function MasteryView({ status, connection, data, onRetry }: MasteryViewProps) {
  const chapters = data?.chapters ?? [];
  const started = chapters.some((c) => c.concepts.some((x) => x.box > 0));
  const showSquad = data ? squadVisible(data) : false;
  const next = nextUp(chapters);
  return (
    <Page
      className="lv-mastery"
      eyebrow="Mastery"
      title={data?.courseTitle ?? 'Mastery'}
      actions={<ConnectionBadge connection={connection} />}
    >
      <p className="lv-lede">
        How well each idea has stuck for you. This is a study map, not a grade.
      </p>
      {status === 'loading' && (
        <div className="lv-mastery__skel" role="status" aria-busy="true">
          <span className="lv-vh">Loading your mastery map</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="block" height={160} />
          ))}
        </div>
      )}
      {status === 'error' && (
        <StateBlock
          kind="error"
          title="Your map did not load"
          body="The hub did not answer. Your progress is safe; try again."
          onRetry={onRetry}
        />
      )}
      {status === 'offline' && (
        <StateBlock
          kind="offline"
          title="You are offline"
          body="Your map updates when your connection is back."
          onRetry={onRetry}
          retryLabel="Check again"
        />
      )}
      {status === 'ready' && chapters.length === 0 && (
        <StateBlock
          kind="empty"
          art="books"
          title="No course yet"
          body="Add your course PDFs in setup and your chapters show up here."
        />
      )}
      {status === 'ready' && chapters.length > 0 && (
        <>
          <Legend />
          {!started && (
            <p className="lv-mastery__hint" role="note">
              <LvIcon name="info" size={16} /> Nothing started yet. Take a quiz in the village or
              over iMessage and this fills in.
            </p>
          )}
          {started && next.length > 0 && (
            <section className="lv-next" aria-labelledby="next-h">
              <h2 id="next-h" className="lv-sec__title">
                Worth a look next
              </h2>
              <ul>
                {next.map((c) => (
                  <li key={c.id}>
                    <LvIcon name="chevron" size={16} />
                    {c.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!showSquad && (
            <p className="lv-mastery__hint" role="note">
              <LvIcon name="users" size={16} /> Squad averages appear once three or more people have
              joined. With fewer, they could point to one person.
            </p>
          )}
          <div className="lv-chapters">
            {chapters.map((c) => (
              <ChapterCard key={c.id} c={c} showSquad={showSquad} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

function Legend() {
  return (
    <ul className="lv-legend" aria-label="Legend">
      {([0, 1, 3, 4] as const).map((b) => (
        <li key={b}>
          <Pips box={b} />
          {LEVEL_LABEL[levelOf(b)]}
        </li>
      ))}
    </ul>
  );
}

function Pips({ box, label }: { box: number; label?: string }) {
  const r = Math.round(box);
  return (
    <span
      className="lv-mp"
      data-level={levelOf(r)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} data-on={i <= r || undefined} />
      ))}
    </span>
  );
}

function ChapterCard({ c, showSquad }: { c: Chapter; showSquad: boolean }) {
  const lvl = levelOf(Math.round(chapterBox(c)));
  return (
    <section className="lv-chap" aria-labelledby={`h-${c.id}`}>
      <header className="lv-chap__head">
        <h2 id={`h-${c.id}`} className="lv-chap__title">
          {c.title}
        </h2>
        <span className="lv-chap__lvl" data-level={lvl}>
          {LEVEL_LABEL[lvl]}
        </span>
      </header>
      <table className="lv-grid">
        <thead>
          <tr>
            <th scope="col">Concept</th>
            <th scope="col">You</th>
            {showSquad && <th scope="col">Squad average</th>}
          </tr>
        </thead>
        <tbody>
          {c.concepts.map((x) => (
            <tr key={x.id}>
              <th scope="row">{x.label}</th>
              <td>
                <Pips box={x.box} label={`You: ${LEVEL_LABEL[levelOf(x.box)]}`} />
                <span className="lv-grid__word">{LEVEL_LABEL[levelOf(x.box)]}</span>
              </td>
              {showSquad && (
                <td>
                  {x.squadAvg !== undefined ? (
                    <Pips
                      box={x.squadAvg}
                      label={`Squad average: ${LEVEL_LABEL[levelOf(Math.round(x.squadAvg))]}`}
                    />
                  ) : (
                    <span className="lv-grid__word">Not enough data</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
