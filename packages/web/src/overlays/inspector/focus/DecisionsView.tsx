import { type BoardRun } from '@squad/village/council';
import { confidenceWord, displayName } from '../../../council/board/common';
import { ModeBadge } from '../../../council/board/ModeBadge';
import { ReasoningCards } from './ReasoningCards';

/** Decisions of one agent: its reasoning-summary cards, plus the verdict, dissent and action items when it is the chair. */
export function DecisionsView({
  run,
  agentId,
  is,
  name,
  isChair,
}: {
  run: BoardRun;
  agentId: string | undefined;
  is: (id: string) => boolean;
  name: string;
  isChair: boolean;
}) {
  const v = run.verdict;
  return (
    <div className="ai-tabpanel af-decisions">
      <section aria-label="Reasoning summaries">
        <h3 className="ai-label">Reasoning summaries</h3>
        <ReasoningCards messages={run.messages} agent={is} question={run.question} name={name} />
      </section>
      {v && (isChair || !agentId) ? (
        <section aria-label="Council verdict" className="af-verdict" data-testid="af-verdict">
          <h3 className="ai-label">
            Verdict <ModeBadge mode={v.mode} compact />
          </h3>
          <p className="af-text">{v.answer ?? v.summary}</p>
          {v.confidence ? (
            <p className="af-dim">Confidence: {confidenceWord(v.confidence)}</p>
          ) : null}
          {v.dissents.length > 0 ? (
            <ul className="af-plain">
              {v.dissents.map((d) => (
                <li key={d.messageId ?? d.who}>
                  Dissent from {displayName(d.who)}: {d.why}
                </li>
              ))}
            </ul>
          ) : null}
          {v.actions.length > 0 ? (
            <>
              <h4 className="af-sub">Action items</h4>
              <ul className="af-plain">
                {v.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
