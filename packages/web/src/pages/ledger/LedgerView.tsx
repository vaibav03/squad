import { useMemo, useState, type KeyboardEvent } from 'react';
import { meetsMinGroupSize } from '@squad/core';
import { studentLabel } from '@squad/village/inspector';
import {
  Avatar,
  ConnectionBadge,
  LvIcon,
  Segmented,
  StateBlock,
  useMedia,
  type Connection,
} from '../../overlays/kit';
import { Notice, Page, Skeleton } from '../../primitives';
import { barWidth, rowsByStudent, summarize, type LedgerRow, type RosterMember } from './model';
import './ledger.css';

export type LedgerStatus = 'loading' | 'ready' | 'error' | 'offline';

export interface LedgerViewProps {
  status: LedgerStatus;
  connection: Connection;
  title: string;
  rows: LedgerRow[];
  roster: RosterMember[];
  /** The signed-in student's id; their rows are marked "You". */
  me: string;
  /** Demo projector: other students' shared text is blurred until clicked. Own rows never blur. */
  projector: boolean;
  onProjectorChange: (on: boolean) => void;
  /** Row ids that just arrived (live). Blocked ones get one gentle red wash. */
  freshIds?: ReadonlySet<string>;
  onRetry?: () => void;
}

export function LedgerView(props: LedgerViewProps) {
  const {
    status,
    connection,
    title,
    rows,
    roster,
    me,
    projector,
    onProjectorChange,
    freshIds,
    onRetry,
  } = props;
  const wide = useMedia('(min-width: 1024px)');
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const columns = useMemo(() => rowsByStudent(rows, roster), [rows, roster]);
  const sum = useMemo(() => summarize(rows), [rows]);
  const showCounts = meetsMinGroupSize(roster.length) && rows.length > 0;

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const nameOf = (id: string) => roster.find((m) => m.id === id)?.name ?? studentLabel(id);

  const renderRow = (r: LedgerRow, withAgent: boolean) => (
    <Row
      key={r.id}
      row={r}
      agentName={withAgent ? nameOf(r.student) : undefined}
      mine={r.student === me}
      blurred={projector && r.student !== me && r.shared !== undefined && !revealed.has(r.id)}
      onToggle={() => toggleReveal(r.id)}
      fresh={freshIds?.has(r.id) ?? false}
      projector={projector}
    />
  );

  return (
    <Page
      className="lv-ledger"
      eyebrow={rows.length > 0 ? `Task: ${title}` : 'Privacy'}
      title="Privacy ledger: what agents shared"
      lede="Everything your agents shared, and everything they kept back. Withheld details never leave their owner."
      next="Open a row to see which agent shared it and why. Switch to Demo projector before showing this on a screen."
      actions={
        <>
          <ConnectionBadge connection={connection} onRetry={onRetry} />
          <Segmented
            label="Viewing mode"
            value={projector ? 'projector' : 'me'}
            onChange={(v) => onProjectorChange(v === 'projector')}
            options={[
              { value: 'me', label: 'Me', hint: 'Your view' },
              {
                value: 'projector',
                label: 'Demo projector',
                hint: 'Blurs other people until you click',
              },
            ]}
          />
        </>
      }
    >
      {projector && (
        <Notice tone="info">
          Demo projector is on. Other students&rsquo; entries stay blurred until you select them.
        </Notice>
      )}

      {status === 'loading' && <LedgerSkeleton />}
      {status === 'error' && (
        <StateBlock
          kind="error"
          title="The board did not load"
          body="Squad did not answer. Nothing here is lost; try again in a moment."
          onRetry={onRetry}
        />
      )}
      {status === 'offline' && (
        <StateBlock
          kind="offline"
          title="You are offline"
          body="This board updates on its own as soon as your connection is back."
          onRetry={onRetry}
          retryLabel="Check again"
        />
      )}

      {status === 'ready' && rows.length === 0 && (
        <StateBlock
          kind="empty"
          art="board"
          title="Nothing shared yet"
          body="Agents will post here when they start talking."
        />
      )}

      {status === 'ready' && rows.length > 0 && (
        <>
          {showCounts && (
            <p className="lv-ledger__sum" aria-label="Summary">
              <span>
                <LvIcon name="check" size={16} /> {sum.shared} shared
              </span>
              <span>
                <LvIcon name="lock" size={16} /> {sum.withheld} kept private
              </span>
              {sum.blocked > 0 && (
                <span data-bad>
                  <LvIcon name="shield" size={16} /> {sum.blocked} blocked
                </span>
              )}
            </p>
          )}
          {wide ? (
            <div className="lv-ledger__cols" role="list" aria-label="Agents">
              {columns.map((c) => (
                <section
                  key={c.id}
                  className="lv-col"
                  role="listitem"
                  aria-label={`${c.name}'s agent`}
                  data-mine={c.id === me || undefined}
                >
                  <header className="lv-col__head">
                    <Avatar name={c.name} size={32} tone={c.id === me ? 'you' : 'other'} />
                    <h2 className="lv-col__name">{c.name}&rsquo;s agent</h2>
                    {c.id === me && <span className="lv-you">You</span>}
                  </header>
                  {c.rows.length === 0 ? (
                    <p className="lv-col__empty">Waiting to share</p>
                  ) : (
                    <ol className="lv-rows" aria-live="polite" aria-relevant="additions">
                      {c.rows.map((r) => renderRow(r, false))}
                    </ol>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <ol
              className="lv-rows lv-rows--feed"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Newest first"
            >
              {rows.map((r) => renderRow(r, true))}
            </ol>
          )}
        </>
      )}
    </Page>
  );
}

function Row({
  row,
  agentName,
  mine,
  blurred,
  onToggle,
  fresh,
  projector,
}: {
  row: LedgerRow;
  agentName?: string;
  mine: boolean;
  blurred: boolean;
  onToggle: () => void;
  fresh: boolean;
  projector: boolean;
}) {
  const kind = row.blocked ? 'blocked' : row.shared !== undefined ? 'shared' : 'withheld';
  const icon = kind === 'blocked' ? 'shield' : kind === 'withheld' ? 'lock' : 'check';
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };
  const label = blurred ? `Hidden while projecting: ${row.field}. Select to show.` : undefined;
  return (
    <li
      className="lv-row"
      data-kind={kind}
      data-mine={mine || undefined}
      data-fresh={fresh || undefined}
      data-blurred={blurred || undefined}
      data-big={projector || undefined}
      {...(blurred
        ? { role: 'button', tabIndex: 0, 'aria-label': label, onClick: onToggle, onKeyDown: key }
        : {})}
    >
      <span className="lv-row__icon" aria-hidden="true">
        <LvIcon name={icon} size={18} />
      </span>
      <div className="lv-row__body" aria-hidden={blurred || undefined}>
        <p className="lv-row__field">
          {agentName && <span className="lv-row__agent">{agentName}</span>}
          {row.field}
          {mine && agentName && <span className="lv-you lv-you--sm">You</span>}
        </p>
        {row.blocked ? <p className="lv-row__blocked">Blocked by privacy gate</p> : null}
        {!row.blocked && row.shared !== undefined && <p className="lv-row__shared">{row.shared}</p>}
        {row.withheld && !row.blocked && (
          <p className="lv-row__kept">
            <span
              className="lv-bar"
              style={{ width: `${barWidth(row.field)}%` }}
              role="img"
              aria-label="Withheld"
            />
            <span className="lv-row__keptlabel">{mine ? 'You kept this private' : 'Withheld'}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function LedgerSkeleton() {
  return (
    <div className="lv-ledger__skel" role="status" aria-busy="true">
      <span className="lv-vh">Loading the board</span>
      {[0, 1, 2].map((c) => (
        <div key={c} className="lv-col lv-col--skel">
          <Skeleton width="60%" height={24} />
          {[0, 1, 2].map((r) => (
            <Skeleton key={r} shape="block" height={64} />
          ))}
        </div>
      ))}
    </div>
  );
}
