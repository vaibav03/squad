import { useState } from 'react';
import type { LiveTakeaways } from '@squad/core';
import { LvIcon } from '../overlays/kit/icons';
import type { ActionName, ActionState } from './useLiveDiscussion';
import { CiteChip } from './Transcript';

export function groundingLine(t: LiveTakeaways): string {
  const n = t.sources.length;
  return t.grounding === 'course'
    ? `Grounded in your course material: ${n} verified ${n === 1 ? 'source' : 'sources'}. The rest is opinion.`
    : 'Opinion, said plainly: no course source was used.';
}

function Jump({ id, onJump }: { id: string | undefined; onJump(id: string): void }) {
  if (!id) return null;
  return (
    <button type="button" className="ld-link" onClick={() => onJump(id)}>
      Jump to turn
    </button>
  );
}

const RISE = (i: number) => ({ ['--i' as string]: i });

function Section({
  title,
  glyph,
  count,
  children,
}: {
  title: string;
  glyph: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="ld-tk__sec" aria-label={title}>
      <h4 className="ld-h4">
        <span className="ld-chip__glyph" aria-hidden="true">
          {glyph}
        </span>
        {title}
        <span className="ld-count" aria-label={`${count} items`}>
          {count}
        </span>
      </h4>
      {count === 0 ? <p className="ld-dim ld-small">Nothing yet.</p> : children}
    </section>
  );
}

const ACTIONS: { name: ActionName; label: string; done: (r: { count?: number }) => string }[] = [
  { name: 'post', label: 'Post to squad chat', done: () => 'Posted to the squad chat.' },
  {
    name: 'quiz',
    label: 'Make 5 quiz questions',
    done: (r) => `Made ${r.count ?? 5} quiz questions.`,
  },
  {
    name: 'plan',
    label: 'Add next steps to study plan',
    done: (r) => `Added ${r.count ?? 'your'} next steps to the plan.`,
  },
];

/** Builds live beside the transcript. Items slide up with a 40 ms stagger; every item links back to its turn. */
export function TakeawaysPanel({
  takeaways,
  actions,
  onRun,
  onJump,
  reduced,
}: {
  takeaways: LiveTakeaways;
  actions: Record<ActionName, ActionState>;
  onRun(n: ActionName): void;
  onJump(turnId: string): void;
  reduced: boolean;
}) {
  const [split, setSplit] = useState<string | null>(null);
  const t = takeaways;
  const empty = !t.decisions.length && !t.disagreements.length && !t.nextSteps.length && !t.sources.length && !t.quiz.length;
  return (
    <div className="ld-tk" data-reduced={reduced || undefined}>
      <Section title="Decisions" glyph="D" count={t.decisions.length}>
        <ul className="ld-tk__list">
          {t.decisions.map((d, i) => (
            <li key={d.id} className="ld-rise" style={RISE(i)}>
              <p>{d.text}</p>
              <Jump id={d.turnId} onJump={onJump} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Open disagreements" glyph="!" count={t.disagreements.length}>
        <ul className="ld-tk__list">
          {t.disagreements.map((d, i) => (
            <li key={d.id} className="ld-rise ld-dis" style={RISE(i)}>
              <p>
                <b>{d.topic}</b>
              </p>
              {split === d.id ? (
                <div className="ld-split" role="group" aria-label={`Stances on ${d.topic}`}>
                  {d.stances.map((s) => (
                    <div key={s.who} className="ld-split__col">
                      <span className="ld-chip__name">{s.who}</span>
                      <p>{s.view}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="ld-stances">
                  {d.stances.map((s) => (
                    <li key={s.who}>
                      <b>{s.who}:</b> {s.view}
                    </li>
                  ))}
                </ul>
              )}
              <p className="ld-dim ld-small">Why: {d.why}</p>
              <div className="ld-row">
                <button
                  type="button"
                  className="ld-link"
                  aria-expanded={split === d.id}
                  onClick={() => setSplit(split === d.id ? null : d.id)}
                >
                  {split === d.id ? 'Back to list' : 'Compare side by side'}
                </button>
                <Jump id={d.turnId} onJump={onJump} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Next steps" glyph="N" count={t.nextSteps.length}>
        <ul className="ld-tk__list">
          {t.nextSteps.map((n, i) => (
            <li key={n.id} className="ld-rise" style={RISE(i)}>
              <p>{n.text}</p>
              {(n.owner || n.due) && (
                <p className="ld-dim ld-small">
                  {n.owner ? `Owner: ${n.owner}` : ''}
                  {n.owner && n.due ? ' · ' : ''}
                  {n.due ? `Due: ${n.due}` : ''}
                </p>
              )}
              <Jump id={n.turnId} onJump={onJump} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Sources" glyph="S" count={t.sources.length}>
        <ul className="ld-tk__list">
          {t.sources.map((s, i) => (
            <li key={`${s.file}:${s.page}`} className="ld-rise" style={RISE(i)}>
              <CiteChip c={s} />
              <Jump id={s.turnId} onJump={onJump} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What I'd quiz you on" glyph="Q" count={t.quiz.length}>
        <ul className="ld-tk__list">
          {t.quiz.map((q, i) => (
            <li key={q.id} className="ld-rise" style={RISE(i)}>
              <p>{q.question}</p>
              <Jump id={q.turnId} onJump={onJump} />
            </li>
          ))}
        </ul>
      </Section>

      <p className="ld-ground">
        <LvIcon name={t.grounding === 'course' ? 'shield' : 'info'} size={14} />
        {groundingLine(t)}
      </p>

      <div className="ld-tk__acts" role="group" aria-label="Takeaway actions">
        {ACTIONS.map((a) => {
          const st = actions[a.name];
          return (
            <div key={a.name} className="ld-act">
              <button
                type="button"
                className="lv-btn"
                disabled={st.s === 'busy' || empty}
                aria-busy={st.s === 'busy' || undefined}
                onClick={() => onRun(a.name)}
              >
                {st.s === 'busy' ? 'Working...' : a.label}
              </button>
              <p className="ld-small" role="status" data-kind={st.s}>
                {st.s === 'done' ? (
                  <>
                    <LvIcon name="check" size={12} /> {a.done(st.result)}
                  </>
                ) : st.s === 'error' ? (
                  <>
                    <LvIcon name="alert" size={12} /> {st.msg}
                  </>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
