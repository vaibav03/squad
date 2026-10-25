import type { BoardRun } from '@squad/village/council';
import { Icon } from '../../primitives/Icon';
import { buildBallot } from './ballot';
import { Portrait, PortraitButton } from './Portrait';

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Rankings as a ballot: rows are the options in council order, columns are the voters (portraits), each cell a numeric
 * rank badge. A cell outlined in rose is a vote that differs from the council order; the legend says so in words.
 */
export function BallotMatrix({ run }: { run: BoardRun }) {
  const b = buildBallot(run);
  if (!b) return null;
  return (
    <section className="dl-ballot" aria-labelledby="dl-ballot-h" data-testid="dl-ballot">
      <header className="dl-card__head">
        <h3 className="dl-h" id="dl-ballot-h">
          <Icon name="vote" size={14} />
          Ballot
        </h3>
        <p className="dl-card__sub">
          {b.voters.length} {b.voters.length === 1 ? 'voter' : 'voters'} ranked{' '}
          {b.candidates.length} options
        </p>
      </header>
      <div className="dl-ballot__scroll">
        <table className="dl-ballot__table">
          <caption className="dl-sr">
            Rankings. Rows are options in council order, columns are voters. Lower rank numbers are
            better.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="dl-ballot__corner">
                Option
              </th>
              {b.voters.map((v) => (
                <th scope="col" key={v.participant.key} className="dl-ballot__voter">
                  <PortraitButton
                    who={v.participant}
                    runId={run.runId}
                    label={`Open ${v.participant.name}’s panel`}
                  />
                  <span className="dl-ballot__vname">{v.participant.name}</span>
                </th>
              ))}
              <th scope="col" className="dl-ballot__order">
                Council order
              </th>
            </tr>
          </thead>
          <tbody>
            {b.candidates.map((c, ci) => (
              <tr key={c.key}>
                <th scope="row" className="dl-ballot__cand">
                  <Portrait who={c.participant} />
                  <span>{c.name}</span>
                </th>
                {b.cells[ci]!.map((cell, vi) => {
                  const voter = b.voters[vi]!.participant.name;
                  const label =
                    cell.state === 'self'
                      ? `${voter} does not rank themselves`
                      : cell.state === 'none'
                        ? `${voter} did not rank ${c.name}`
                        : `${voter} ranked ${c.name} ${ordinal(cell.rank!)}${cell.differs ? ', differs from the council order' : ''}`;
                  return (
                    <td
                      key={vi}
                      className="dl-ballot__cell"
                      data-state={cell.state}
                      data-differs={cell.differs || undefined}
                      aria-label={label}
                    >
                      {cell.state === 'ranked' ? (
                        <span className="dl-rank" data-rank={cell.rank}>
                          {cell.rank}
                        </span>
                      ) : (
                        <span className="dl-ballot__na">
                          {cell.state === 'self' ? 'Self' : 'None'}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="dl-ballot__order">
                  <span className="dl-rank dl-rank--place" data-rank={c.place}>
                    {c.place}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="dl-legend" aria-label="How to read the ballot">
        <li>
          <span className="dl-rank dl-legend__swatch">1</span> Rank number, 1 is best.
        </li>
        <li>
          <span className="dl-rank dl-legend__swatch" data-differs="true">
            2
          </span>{' '}
          Outlined: this voter ranked it differently from the council order
          {b.disagreements > 0
            ? ` (${b.disagreements} ${b.disagreements === 1 ? 'cell' : 'cells'})`
            : ' (none here)'}
          .
        </li>
        <li>
          <span className="dl-ballot__na">Self</span> Voters do not rank themselves.
        </li>
      </ul>
    </section>
  );
}
