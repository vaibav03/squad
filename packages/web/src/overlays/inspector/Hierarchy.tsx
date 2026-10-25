import type { InspectorStore } from '@squad/village/inspector';
import {
  a2aPartyName,
  type BoardAgent,
  type BoardDelegation,
  type CouncilBoardStore,
} from '@squad/village/council';
import { LvIcon } from '../kit';
import { openBoard, useBoardVersion } from '../../council/board/bridge';
import { ModeBadge } from '../../council/board/ModeBadge';
import { EmptyHelp } from './focus/EmptyHelp';
import { LastRunLabel } from '../../council/last-run/components';
import { useLastRunsState } from '../../council/last-run/store';

const STATE_WORD = {
  pending: { icon: 'circle-dashed', word: 'Pending' },
  answered: { icon: 'circle-check', word: 'Answered' },
  failed: { icon: 'circle-x', word: 'Failed' },
} as const;

function Chip({ agent, inspector }: { agent: BoardAgent; inspector: InspectorStore }) {
  const name = a2aPartyName(agent.id);
  if (!inspector.has(agent.id)) return <span className="ai-party">{name}</span>;
  return (
    <button
      type="button"
      className="ai-party ai-party--btn"
      onClick={() => inspector.select(agent.id)}
    >
      {name}
    </button>
  );
}

function Delegations({
  title,
  items,
  dir,
}: {
  title: string;
  items: BoardDelegation[];
  dir: 'in' | 'out';
}) {
  return (
    <section aria-label={title}>
      <h3 className="ai-label">{title}</h3>
      {items.length === 0 ? (
        <p className="ai-empty">None.</p>
      ) : (
        <ul className="ai-thread">
          {items.map((d) => {
            const st = STATE_WORD[d.status];
            return (
              <li key={d.id} className="ai-msg" data-alert={d.status === 'failed' || undefined}>
                <p className="ai-msg__text">
                  {dir === 'in'
                    ? `${a2aPartyName(d.from)} asked this agent: ${d.summary}`
                    : `Asked ${a2aPartyName(d.to)}: ${d.summary}`}
                </p>
                <div className="ai-msg__meta">
                  <span className="ai-kind">
                    <LvIcon name={st.icon} size={12} />
                    {st.word}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Where the selected agent sits in a council: parent, children, who asked whom what, and its latest public status.
 * The room-level council agent (e.g. 'council:ask') shows the chair and specialists of its latest run instead.
 */
export function HierarchyTab({
  agentId,
  board,
  inspector,
}: {
  agentId: string;
  board: CouncilBoardStore | null;
  inspector: InspectorStore;
}) {
  useBoardVersion(board);
  const stored = useLastRunsState();
  const lastBoard = board?.run();
  // Honest empty state: say what the last council was, or that none ever ran, with a way to convene one.
  const empty = (
    <div data-testid="hierarchy-empty">
      <p className="ai-empty">
        {lastBoard || stored.runs.length
          ? 'This agent was not on the last council.'
          : 'Not part of a council run yet.'}
      </p>
      <p className="af-dim">
        Structure shows who reports to whom in a council: the Chair on top, specialists under it, and who asked whom.
        It fills in when this agent takes part in a council run.
      </p>
      <LastRunLabel runId={lastBoard?.runId ?? stored.runs[0]?.id} />
      <EmptyHelp isCouncil topic="this agent" />
    </div>
  );
  if (!board) return <div className="ai-tabpanel">{empty}</div>;
  const h = board.hierarchy(agentId);
  if (!h) {
    const runs = board.runs().filter((r) => r.councilId === agentId);
    const run = runs.length
      ? board.run()?.councilId === agentId
        ? board.run()!
        : runs.at(-1)!
      : undefined;
    if (!run) return <div className="ai-tabpanel">{empty}</div>;
    const chair = run.agents.filter((a) => a.role === 'chair');
    const rest = run.agents.filter((a) => a.role !== 'chair');
    return (
      <div className="ai-tabpanel" data-testid="hierarchy">
        <section aria-label="This council">
          <h3 className="ai-label">{run.councilName}</h3>
          <p>
            <ModeBadge mode={run.mode} />
          </p>
          <LastRunLabel runId={run.runId} />
          <dl className="ai-facts">
            <dt>Chair</dt>
            <dd className="ai-chips">
              {chair.length
                ? chair.map((a) => <Chip key={a.id} agent={a} inspector={inspector} />)
                : 'None yet'}
            </dd>
            <dt>Specialists</dt>
            <dd className="ai-chips">
              {rest.length
                ? rest.map((a) => <Chip key={a.id} agent={a} inspector={inspector} />)
                : 'None yet'}
            </dd>
          </dl>
        </section>
        <button
          type="button"
          className="ai-btn ai-open"
          onClick={() => openBoard({ runId: run.runId })}
        >
          Open council board
        </button>
      </div>
    );
  }
  return (
    <div className="ai-tabpanel" data-testid="hierarchy">
      <section aria-label="Position">
        <h3 className="ai-label">Position</h3>
        <p className="ai-headline">{h.position}</p>
        <p>
          <ModeBadge mode={h.agent.mode} />
        </p>
        <LastRunLabel runId={h.run.runId} />
        <dl className="ai-facts">
          <dt>Council</dt>
          <dd>{h.run.councilName}</dd>
          <dt>Reports to</dt>
          <dd>
            {h.parent ? <Chip agent={h.parent} inspector={inspector} /> : 'Nobody, top of the tree'}
          </dd>
          <dt>Works with</dt>
          <dd className="ai-chips">
            {h.children.length
              ? h.children.map((c) => <Chip key={c.id} agent={c} inspector={inspector} />)
              : 'Nobody below'}
          </dd>
        </dl>
      </section>
      <section aria-label="Latest status">
        <h3 className="ai-label">Latest status</h3>
        {h.agent.summary || h.agent.stance ? (
          <>
            {h.agent.summary && <p className="ai-msg__text">{h.agent.summary}</p>}
            {h.agent.stance && (
              <p className="ai-msg__meta">
                <span className="ai-kind">Stance</span> {h.agent.stance}
              </p>
            )}
          </>
        ) : (
          <p className="ai-empty">Nothing shared yet.</p>
        )}
      </section>
      <Delegations title="Delegations in" items={h.delegationsIn} dir="in" />
      <Delegations title="Delegations out" items={h.delegationsOut} dir="out" />
      <button
        type="button"
        className="ai-btn ai-open"
        onClick={() => openBoard({ agent: h.agent.id })}
      >
        Open council board
      </button>
    </div>
  );
}
