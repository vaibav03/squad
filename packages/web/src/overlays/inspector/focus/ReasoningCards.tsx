import {
  REASONING_FOOTER,
  reasoningCards,
  type A2aMessage,
  type ReasoningCard,
} from '@squad/village/council';
import { CitationChip } from '../../../components/source-viewer';
import { ModeBadge } from '../../../council/board/ModeBadge';
import { showsMode } from '../../../council/board/common';
import { KIND_LABEL } from '@squad/village/council';
import { absTime } from './parts';

export function ReasoningCardView({ c }: { c: ReasoningCard }) {
  return (
    <article className="af-card" data-testid="af-reasoning" aria-label={`Reasoning summary, ${KIND_LABEL[c.kind]}`}>
      <header className="af-card__head">
        <h4 className="af-card__title">Reasoning summary</h4>
        <span className="af-chip af-chip--kind" data-kind={c.kind}>
          {KIND_LABEL[c.kind]}
        </span>
        {c.scripted ? (
          <span className="af-chip af-chip--script" data-testid="af-scripted">
            Scripted example
          </span>
        ) : showsMode(c.mode) ? (
          <ModeBadge mode={c.mode} compact />
        ) : null}
        {c.ts > 0 ? (
          <time className="af-time" dateTime={new Date(c.ts).toISOString()} title={absTime(c.ts)} />
        ) : null}
      </header>
      <dl className="af-fields">
        <dt>Goal</dt>
        <dd>{c.goal}</dd>
        <dt>Evidence</dt>
        <dd>
          {c.evidence.length === 0 ? (
            <span className="af-dim">No sources cited.</span>
          ) : (
            <span className="af-cites">
              {c.evidence.map((e, i) => (
                <CitationChip key={`${e.file}:${e.page}:${i}`} citation={{ file: e.file, page: e.page }} />
              ))}
            </span>
          )}
        </dd>
        <dt>Decision</dt>
        <dd>
          {c.decision.stance ? <strong className="af-stance">{c.decision.stance}. </strong> : null}
          {c.decision.text}
        </dd>
        <dt>Next step</dt>
        <dd>{c.next}</dd>
      </dl>
      <p className="af-card__foot">{REASONING_FOOTER}</p>
    </article>
  );
}

/** Public reasoning summary cards of one agent. Built only from the public envelope fields (see `reasoningCards`). */
export function ReasoningCards({
  messages,
  agent,
  question,
  name,
}: {
  messages: readonly A2aMessage[];
  agent: (id: string) => boolean;
  question?: string | undefined;
  name: string;
}) {
  const cards = reasoningCards(messages, { agent, question });
  if (cards.length === 0)
    return (
      <p className="af-empty__title" data-testid="af-no-decisions">
        {name} has not made a public decision yet.
      </p>
    );
  return (
    <div className="af-cards">
      {cards.map((c) => (
        <ReasoningCardView key={c.id} c={c} />
      ))}
    </div>
  );
}
