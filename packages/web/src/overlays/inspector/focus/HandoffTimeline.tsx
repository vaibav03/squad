import { useMemo, useState, type ReactNode } from 'react';
import {
  HANDOFF_STATUS_LABEL,
  groupByStage,
  handoffRows,
  type BoardRun,
  type HandoffRow,
} from '@squad/village/council';
import { relTime } from '@squad/village/inspector';
import { CitationChip } from '../../../components/source-viewer';
import { ModeBadge } from '../../../council/board/ModeBadge';
import { showsMode } from '../../../council/board/common';
import { LvIcon } from '../../kit';
import { FilterToggle, STATUS_ICON, absTime, clockTime } from './parts';
import { focusableParty } from './resolve';

export type TimelineFilter = 'selected' | 'all';

export interface TimelineAgent {
  id: string;
  name: string;
  /** True for ids that are this agent (aliases included). */
  is(id: string): boolean;
}

export interface HandoffTimelineProps {
  run: BoardRun | undefined;
  /** The focused agent. Without one only 'All communication' is offered. */
  agent?: TimelineAgent | undefined;
  /** 'selected' in the focused panel, 'all' on the board. */
  defaultFilter: TimelineFilter;
  timeStyle?: 'relative' | 'clock';
  /** Makes the sender and recipient names buttons that swap the focused agent. */
  onSelectAgent?: ((id: string) => void) | undefined;
  now?: number | undefined;
  /** Shown under the 'No messages involving <name> yet' heading. */
  emptyExtra?: ReactNode;
  heading?: string;
}

function Row({
  r,
  agent,
  now,
  timeStyle,
  onSelectAgent,
}: {
  r: HandoffRow;
  agent?: TimelineAgent | undefined;
  now: number;
  timeStyle: 'relative' | 'clock';
  onSelectAgent?: ((id: string) => void) | undefined;
}) {
  const party = (id: string, name: string) => {
    const mine = !!agent?.is(id);
    if (onSelectAgent && !mine && focusableParty(id))
      return (
        <button type="button" className="af-party af-party--btn" onClick={() => onSelectAgent(id)}>
          {name}
        </button>
      );
    return <span className={mine ? 'af-party af-party--me' : 'af-party'}>{name}</span>;
  };
  return (
    <li
      className="af-row"
      data-kind={r.kind}
      data-status={r.status}
      data-id={r.id}
      data-testid="af-row"
    >
      <div className="af-row__top">
        <span className="af-n">
          <span className="af-sr">Turn </span>#{r.n}
        </span>
        <span className="af-who" data-testid="af-who">
          {party(r.from, r.fromName)}
          <span className="af-arrow" aria-hidden="true">
            {' '}
            →{' '}
          </span>
          <span className="af-sr"> to </span>
          {party(r.to, r.toName)}
        </span>
        <time
          className="af-time"
          dateTime={r.ts > 0 ? new Date(r.ts).toISOString() : undefined}
          title={absTime(r.ts)}
        >
          {timeStyle === 'clock' ? clockTime(r.ts) : r.ts > 0 ? relTime(r.ts, now) : ''}
        </time>
      </div>
      <div className="af-row__chips">
        <span className="af-chip af-chip--kind" data-kind={r.kind}>
          <span className="af-sr">Purpose: </span>
          {r.purpose}
        </span>
        <span className="af-chip af-chip--status" data-status={r.status}>
          <LvIcon name={STATUS_ICON[r.status]} size={12} aria-hidden="true" />
          <span className="af-sr">Status: </span>
          {HANDOFF_STATUS_LABEL[r.status]}
          {r.statusNote ? <span className="af-note">, {r.statusNote}</span> : null}
        </span>
        {showsMode(r.mode) ? <ModeBadge mode={r.mode} compact /> : null}
      </div>
      {r.hidden ? (
        <p className="af-text af-dim">Details are private to the person who asked.</p>
      ) : r.summary ? (
        <p className="af-text">{r.summary}</p>
      ) : null}
      {r.citations.length > 0 ? (
        <div className="af-cites" aria-label="Sources">
          {r.citations.map((c, i) => (
            <CitationChip key={`${c.file}:${c.page}:${i}`} citation={{ file: c.file, page: c.page }} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Chronological handoff timeline: every A2A message of a run, oldest first (seq, then ts, then id), grouped by stage,
 * each row `Sender → Recipient` in display names with purpose, summary and status. 'Selected agent' | 'All
 * communication' are real buttons. Arrows elsewhere in the UI are supplemental; this list says it all in words.
 */
export function HandoffTimeline({
  run,
  agent,
  defaultFilter,
  timeStyle = 'relative',
  onSelectAgent,
  now = Date.now(),
  emptyExtra,
  heading = 'Handoff timeline',
}: HandoffTimelineProps) {
  const [pick, setPick] = useState<TimelineFilter>(defaultFilter);
  const filter: TimelineFilter = agent ? pick : 'all';
  const rows = useMemo(
    () =>
      run
        ? handoffRows(run.messages, {
            ...(filter === 'selected' && agent ? { agent: agent.is } : {}),
            runDone: run.stage === 'done',
          })
        : [],
    // run is mutated in place by the store: key on its size and stage
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, run?.messages.length, run?.stage, filter, agent?.id, run && statusKey(run)],
  );
  const total = run?.messages.length ?? 0;
  const groups = groupByStage(rows);
  return (
    <section className="af-timeline" aria-label={heading} data-filter={filter}>
      <div className="af-timeline__bar">
        <h3 className="af-h">{heading}</h3>
        {agent ? (
          <FilterToggle<TimelineFilter>
            label="Show"
            value={filter}
            onChange={setPick}
            options={[
              { id: 'selected', label: 'Selected agent' },
              { id: 'all', label: 'All communication' },
            ]}
          />
        ) : null}
      </div>
      <p className="af-count" role="status" aria-live="polite">
        {filter === 'selected' && agent
          ? `${rows.length} of ${total} ${total === 1 ? 'message' : 'messages'} involve ${agent.name}`
          : `${rows.length} ${rows.length === 1 ? 'message' : 'messages'}, oldest first`}
      </p>
      {rows.length === 0 ? (
        <div className="af-empty" data-testid="af-empty">
          <p className="af-empty__title">
            {filter === 'selected' && agent
              ? `No messages involving ${agent.name} yet`
              : 'No messages yet. They appear here as the agents talk.'}
          </p>
          {emptyExtra}
        </div>
      ) : (
        <div className="af-groups">
          {groups.map((g) => (
            <section key={`${g.stage}:${g.rows[0]!.n}`} className="af-group" aria-label={g.label}>
              <h4 className="af-group__h">
                {g.label}
                <span className="af-group__turns">
                  {g.rows.length === 1
                    ? `Turn ${g.rows[0]!.n}`
                    : `Turns ${g.rows[0]!.n} to ${g.rows[g.rows.length - 1]!.n}`}
                </span>
              </h4>
              <ol className="af-list" role="list" aria-label={`${g.label} messages, oldest first`}>
                {g.rows.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    agent={agent}
                    now={now}
                    timeStyle={timeStyle}
                    onSelectAgent={onSelectAgent}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** Statuses depend on later replies; this makes the memo notice a changed message in place. */
const statusKey = (run: BoardRun): string =>
  run.messages.map((m) => `${m.id}${m.status}${m.mode}`).join('|');
