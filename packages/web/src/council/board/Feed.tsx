import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  KINDS,
  KIND_GLYPH,
  KIND_LABEL,
  a2aPartyName,
  depthOf,
  threadPath,
  type A2aKind,
  type A2aMessage,
  type BoardRun,
} from '@squad/village/council';
import { CitationChip } from '../../components/source-viewer';
import { ModeBadge } from './ModeBadge';
import { classes, displayName, showsMode } from './common';

export interface FeedFilter {
  /** Agent id, or '' for everyone. Matches messages sent or received. */
  agent: string;
  /** Kind, or '' for all kinds. */
  kind: A2aKind | '';
}

export const NO_FILTER: FeedFilter = { agent: '', kind: '' };

export function filterMessages(messages: A2aMessage[], f: FeedFilter): A2aMessage[] {
  return messages.filter(
    (m) => (!f.agent || m.from === f.agent || m.to === f.agent) && (!f.kind || m.kind === f.kind),
  );
}

const time = (ts: number): string =>
  ts > 0
    ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : '';

/** One feed row: 'Skeptic to Chair: Critique', the public summary, citations, time and (when not live) the mode. */
function Row({
  m,
  run,
  index,
  total,
  depth,
  tabbable,
  highlighted,
  onPath,
  onSelect,
  rowRef,
}: {
  m: A2aMessage;
  run: BoardRun;
  index: number;
  total: number;
  depth: number;
  tabbable: boolean;
  highlighted: boolean;
  onPath: boolean;
  onSelect(id: string): void;
  rowRef(el: HTMLElement | null): void;
}) {
  const private_ =
    m.redaction === 'asker_only' || (!m.summary && !m.answer && !m.stance && !m.order?.length);
  const text = m.summary ?? m.answer ?? m.stance;
  const parent = m.parentMessageId
    ? run.messages.find((x) => x.id === m.parentMessageId)
    : undefined;
  return (
    <article
      ref={rowRef}
      className={classes('cb-row', highlighted && 'is-hl', onPath && 'is-path')}
      data-kind={m.kind}
      data-id={m.id}
      data-depth={depth}
      tabIndex={tabbable ? 0 : -1}
      aria-posinset={index + 1}
      aria-setsize={total}
      aria-label={`${a2aPartyName(m.from)} to ${a2aPartyName(m.to)}: ${KIND_LABEL[m.kind]}`}
      style={{ paddingInlineStart: `calc(var(--space-3) + ${depth} * 16px)` }}
      onClick={() => onSelect(m.id)}
    >
      <header className="cb-row__head">
        <span className="cb-kind" data-kind={m.kind}>
          <span aria-hidden="true">{KIND_GLYPH[m.kind]}</span>
          <span>{KIND_LABEL[m.kind]}</span>
        </span>
        <span className="cb-row__who">
          <strong>{a2aPartyName(m.from)}</strong>
          <span aria-hidden="true" className="cb-row__arrow">
            {' '}
            →{' '}
          </span>
          <span className="cb-sr"> to </span>
          <strong>{a2aPartyName(m.to)}</strong>
        </span>
        {showsMode(m.mode) ? <ModeBadge mode={m.mode} compact /> : null}
        {m.partial ? <span className="cb-tag">Cut short</span> : null}
        <time
          className="cb-row__time"
          dateTime={m.ts > 0 ? new Date(m.ts).toISOString() : undefined}
        >
          {time(m.ts)}
        </time>
      </header>
      {parent ? (
        <p className="cb-row__reply">
          In reply to {a2aPartyName(parent.from)}: {KIND_LABEL[parent.kind]}
        </p>
      ) : null}
      {private_ ? (
        <p className="cb-row__text cb-dim">Details are private to the person who asked.</p>
      ) : text ? (
        <p className="cb-row__text">{text}</p>
      ) : null}
      {m.stance && m.summary ? (
        <p className="cb-row__stance">
          <span className="cb-card__stance-k">Position</span> {m.stance}
        </p>
      ) : null}
      {m.order && m.order.length > 0 ? (
        <p className="cb-row__stance">
          <span className="cb-card__stance-k">Ranked</span>{' '}
          {m.order.map(displayName).join(', then ')}
        </p>
      ) : null}
      {m.citations && m.citations.length > 0 ? (
        <div className="cb-row__cites">
          {m.citations.map((c, i) => (
            <CitationChip
              key={`${c.file}:${c.page}:${i}`}
              citation={{
                file: c.file,
                page: c.page,
                ...('quote' in c && typeof c.quote === 'string' ? { quote: c.quote } : {}),
              }}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export interface FeedProps {
  run: BoardRun;
  filter: FeedFilter;
  onFilter(f: FeedFilter): void;
  /** Message to scroll into view and flash (from the verdict's dissent link or a delegation card). */
  jumpTo?: { id: string; n: number } | undefined;
  selectedId?: string | null;
  onSelect(id: string): void;
}

/**
 * The live A2A feed. Newest at the bottom; sticks to the bottom until the reader scrolls up, then offers
 * 'Jump to latest' with a count. Rows form a keyboard list (Up/Down/Home/End move focus; Enter or click marks a
 * message and its parent chain). Filters by agent and kind; children of a delegation are indented.
 */
export function Feed({ run, filter, onFilter, jumpTo, selectedId, onSelect }: FeedProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [stick, setStick] = useState(true);
  const [seen, setSeen] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  // The run object is mutated in place by the store, so these are recomputed on every render (a few dozen rows).
  const visible = filterMessages(run.messages, filter);
  const path = new Set(selectedId ? threadPath(run, selectedId) : []);
  const [flash, setFlash] = useState<string | null>(null);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (stick) {
      toBottom();
      setSeen(visible.length);
    }
  }, [visible.length, stick, toBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStick(near);
    if (near) setSeen(visible.length);
  };

  // A dissent link or "See answer" button: reveal the row even through a filter, scroll to it, flash it. The jump
  // stays pending until its row is on screen, so a later filter change never replays it.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (jumpTo) pending.current = jumpTo.id;
  }, [jumpTo?.n]);
  useEffect(() => {
    const id = pending.current;
    if (!id) return;
    if (!visible.some((m) => m.id === id)) {
      if (filter.agent || filter.kind) onFilter(NO_FILTER);
      else pending.current = null;
      return;
    }
    const el = rows.current.get(id);
    if (!el) return;
    pending.current = null;
    setStick(false);
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    setFlash(id);
    setFocusIdx(visible.findIndex((m) => m.id === id));
  }, [jumpTo?.n, visible.length, filter.agent, filter.kind]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
    const active = (e.target as HTMLElement).closest<HTMLElement>('article.cb-row');
    if (!active) return;
    const i = visible.findIndex((m) => m.id === active.dataset.id);
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target !== active) return;
      e.preventDefault();
      onSelect(active.dataset.id!);
      return;
    }
    e.preventDefault();
    const next =
      e.key === 'ArrowDown'
        ? Math.min(visible.length - 1, i + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : visible.length - 1;
    setFocusIdx(next);
    rows.current.get(visible[next]!.id)?.focus();
  };

  const agents = run.agents;
  const unread = Math.max(0, visible.length - seen);
  const idx = Math.min(focusIdx, Math.max(0, visible.length - 1));
  return (
    <section className="cb-feed" aria-label="Message feed">
      <div className="cb-feed__bar">
        <h3 className="cb-pixel">Feed</h3>
        <label className="cb-field">
          <span className="cb-field__k">Agent</span>
          <select
            value={filter.agent}
            onChange={(e) => onFilter({ ...filter, agent: e.target.value })}
          >
            <option value="">Everyone</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cb-field">
          <span className="cb-field__k">Kind</span>
          <select
            value={filter.kind}
            onChange={(e) => onFilter({ ...filter, kind: e.target.value as A2aKind | '' })}
          >
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {filter.agent || filter.kind ? (
          <button type="button" className="cb-link" onClick={() => onFilter(NO_FILTER)}>
            Clear filters
          </button>
        ) : null}
      </div>
      <p className="cb-feed__count" role="status">
        {visible.length === run.messages.length
          ? `${visible.length} ${visible.length === 1 ? 'message' : 'messages'}`
          : `Showing ${visible.length} of ${run.messages.length} messages`}
      </p>
      <div
        className="cb-feed__scroll"
        ref={scroller}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        role="feed"
        aria-label="Messages, oldest first"
        aria-busy={run.stage !== 'done'}
      >
        {visible.length === 0 ? (
          <p className="cb-empty">
            {run.messages.length === 0
              ? 'No messages yet. They appear here as the agents talk.'
              : 'No messages match these filters.'}
          </p>
        ) : (
          visible.map((m, i) => (
            <Row
              key={m.id}
              m={m}
              run={run}
              index={i}
              total={visible.length}
              depth={depthOf(run, m.id)}
              tabbable={i === idx}
              highlighted={flash === m.id || selectedId === m.id}
              onPath={path.has(m.id) && selectedId !== m.id}
              onSelect={onSelect}
              rowRef={(el) => {
                if (el) rows.current.set(m.id, el);
                else rows.current.delete(m.id);
              }}
            />
          ))
        )}
      </div>
      {!stick && (
        <button
          type="button"
          className="cb-jump"
          onClick={() => {
            toBottom();
            setStick(true);
            setSeen(visible.length);
          }}
        >
          <span aria-hidden="true">↓</span>
          {unread > 0 ? ` Jump to latest (${unread} new)` : ' Jump to latest'}
        </button>
      )}
    </section>
  );
}
