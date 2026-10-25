import { statusLine, type BoardRun } from '@squad/village/council';
import { PortraitButton } from '../deliberation/Portrait';
import { resolveParticipant } from '../deliberation/participants';

const oneLine = (t: string | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim();

/**
 * The one customer-facing result: what the council decided, one sentence on any disagreement, and one compact row
 * per member (portrait, name, one-line stance). Everything else (evidence, discussion, diagnostics) is a disclosure.
 */
export function ResultCard({ run }: { run: BoardRun; onSelectAgent?: (id: string) => void }) {
  const v = run.verdict;
  const headline = v ? oneLine(v.answer && v.answer !== v.summary ? v.answer : v.summary) : '';
  const dissent = v?.dissents[0];
  const more = v ? v.dissents.length - 1 : 0;
  const agents = [...run.agents]
    .filter((a) => a.role !== 'code')
    .sort((a, b) => Number(b.role === 'chair') - Number(a.role === 'chair') || a.lastSeq - b.lastSeq);
  return (
    <section className="cb-result" aria-labelledby="cb-result-h" data-testid="cb-result">
      <p className="cb-result__k">{v ? 'Council result' : 'In progress'}</p>
      <h3 id="cb-result-h" className="cb-result__headline" data-testid="cb-headline">
        {headline || statusLine(run)}
      </h3>
      {dissent ? (
        <p className="cb-result__split" data-testid="cb-disagreement">
          {dissent.who} disagreed: {oneLine(dissent.why)}
          {more > 0 ? ` (${more} more ${more === 1 ? 'member' : 'members'} also disagreed)` : ''}
        </p>
      ) : v ? (
        <p className="cb-result__split" data-testid="cb-disagreement">
          The council agreed.
        </p>
      ) : null}
      <ul className="cb-result__rows" aria-label="Where each member stands">
        {agents.map((a) => {
          const who = resolveParticipant(a.id, a.name);
          const line = oneLine(a.stance ?? a.answer ?? a.summary);
          return (
            <li key={a.id} className="cb-result__row" data-testid="cb-agent-row">
              <PortraitButton who={who} scale={1} runId={run.runId} />
              <span className="cb-result__who">{who.name}</span>
              <span className="cb-result__stance">
                {line || (a.status === 'done' ? 'Done' : 'Still thinking')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
