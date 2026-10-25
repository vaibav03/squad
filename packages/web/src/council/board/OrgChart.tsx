import { useEffect, useRef, useState } from 'react';
import {
  KIND_GLYPH,
  KIND_LABEL,
  a2aPartyName,
  modeInfo,
  type BoardRun,
} from '@squad/village/council';
import type { CouncilBoardStore } from '@squad/village/council';
import { AgentCard } from './AgentCard';
import { ROLE_LABEL, STATUS_LABEL, classes } from './common';

const ACTIVE_MS = 4000;

export interface OrgChartProps {
  store: CouncilBoardStore;
  run: BoardRun;
  calm?: boolean;
  /** Agent whose messages the feed shows (also highlighted here). */
  selected: string;
  onSelect(agentId: string): void;
}

/**
 * Chair on top, specialists below, code checks to the side. An edge lights while a message crossed it in the last
 * few seconds or a delegation on it is still open (opacity and transform only; static in Calm). Direct exchanges
 * between specialists show as 'A to B: Kind' links under the chart.
 */
export function OrgChart({ store, run, calm, selected, onSelect }: OrgChartProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 600);
    return () => clearInterval(t);
  }, []);
  const links = store.links(ACTIVE_MS).filter((l) => l.runId === run.runId);
  const chair = run.agents.find((a) => a.role === 'chair');
  const specs = run.agents.filter((a) => a.role === 'specialist');
  const code = run.agents.filter((a) => a.role === 'code');
  const pending = new Set(run.delegations.filter((d) => d.status === 'pending').map((d) => d.to));
  const touched = (id: string) =>
    chair !== undefined &&
    links.some((l) => (l.from === chair.id && l.to === id) || (l.from === id && l.to === chair.id));
  const peer = links.filter((l) => l.from !== chair?.id && l.to !== chair?.id);
  const grid = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const nodes = [...(grid.current?.querySelectorAll<HTMLElement>('.cb-node') ?? [])];
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const chairNode = chair ? 0 : -1;
    let next = i;
    if (e.key === 'ArrowRight') next = Math.min(nodes.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'ArrowUp') next = chairNode >= 0 && i > 0 ? chairNode : i;
    else if (e.key === 'ArrowDown') next = i === chairNode ? Math.min(1, nodes.length - 1) : i;
    else if (e.key === 'Home') next = 0;
    else next = nodes.length - 1;
    nodes[next]?.focus();
  };

  const node = (a: (typeof run.agents)[number]) => {
    const press = () => onSelect(a.id);
    const label = [
      `${a.name}, ${ROLE_LABEL[a.role]}`,
      STATUS_LABEL[a.status],
      modeInfo(a.mode).word,
      a.summary ?? '',
    ]
      .filter(Boolean)
      .join('. ');
    return (
      <button
        type="button"
        className={classes('cb-node', selected === a.id && 'is-selected')}
        aria-label={`${label}. Press to open ${a.name}'s panel.`}
        onClick={press}
      >
        <AgentCard agent={a} {...(calm ? { calm: true } : {})} selected={selected === a.id} />
      </button>
    );
  };

  return (
    <section className="cb-chart" aria-label="Council org chart" onKeyDown={onKeyDown}>
      <h3 className="cb-pixel">Who is on the council</h3>
      <div ref={grid} className="cb-tree">
        {chair ? <div className="cb-tree__top">{node(chair)}</div> : null}
        {specs.length > 0 ? (
          <div
            className="cb-tree__row"
            style={{ gridTemplateColumns: `repeat(${specs.length}, minmax(0, 1fr))` }}
            data-calm={calm ? 'true' : undefined}
          >
            {specs.map((a) => {
              const on = pending.has(a.id) || touched(a.id);
              return (
                <div key={a.id} className="cb-tree__cell">
                  <span
                    className="cb-edge"
                    data-active={on ? 'true' : 'false'}
                    data-testid="cb-edge"
                    aria-hidden="true"
                  >
                    <span className="cb-edge__lit" />
                  </span>
                  {on ? (
                    <span className="cb-sr">
                      {chair ? `${chair.name} and ${a.name} are exchanging messages.` : ''}
                    </span>
                  ) : null}
                  {node(a)}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="cb-empty">Specialists appear here once the chair delegates.</p>
        )}
        {code.length > 0 ? (
          <div className="cb-tree__code" aria-label="Checks done in code">
            {code.map((a) => (
              <div key={a.id}>{node(a)}</div>
            ))}
          </div>
        ) : null}
      </div>
      {peer.length > 0 ? (
        <ul className="cb-peers" aria-label="Messages between specialists right now">
          {peer.slice(-3).map((l) => (
            <li key={l.messageId} className="cb-peer">
              <span aria-hidden="true">{KIND_GLYPH[l.kind]}</span> {a2aPartyName(l.from)}
              <span aria-hidden="true"> → </span>
              <span className="cb-sr"> to </span>
              {a2aPartyName(l.to)}: {KIND_LABEL[l.kind]}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
