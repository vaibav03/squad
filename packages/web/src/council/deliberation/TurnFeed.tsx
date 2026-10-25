import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { a2aPartyName, threadPath, type BoardRun } from '@squad/village/council';
import { CitationChip } from '../../components/source-viewer';
import { Icon } from '../../primitives/Icon';
import { StatusChip } from '../../primitives/StatusChip';
import { chipStatusOf } from './evidence';
import { PortraitButton } from './Portrait';
import { resolveParticipant, roleKey } from './participants';
import { TURN_TYPE, turnsOf, type Turn, type TurnType } from './turn-types';

export interface FeedFilter {
  /** Agent id, or '' for everyone. Matches turns sent or received. */
  agent: string;
  /** Turn type, or '' for all. */
  type: TurnType | '';
}
export const NO_FILTER: FeedFilter = { agent: '', type: '' };

export function filterTurns(turns: Turn[], f: FeedFilter): Turn[] {
  return turns.filter(
    (t) =>
      (!f.agent || t.m.from === f.agent || t.m.to === f.agent) && (!f.type || t.type === f.type),
  );
}

const time = (ts: number): string =>
  ts > 0
    ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : '';

function replyWords(t: Turn, run: BoardRun): string | null {
  const p = t.parent;
  if (!p) return null;
  if (p.from === 'room' || p.kind === 'status') return 'Replying to the question';
  const names = new Map(run.agents.map((a) => [a.id, a.name]));
  return `Replying to ${names.get(p.from) ?? a2aPartyName(p.from)}`;
}

function TurnCard({
  t,
  run,
  total,
  tabbable,
  highlighted,
  onPath,
  onSelect,
  rowRef,
}: {
  t: Turn;
  run: BoardRun;
  total: number;
  tabbable: boolean;
  highlighted: boolean;
  onPath: boolean;
  onSelect(id: string): void;
  rowRef(el: HTMLElement | null): void;
}) {
  const { m } = t;
  const names = new Map(run.agents.map((a) => [a.id, a.name]));
  const speaker = resolveParticipant(m.from, names.get(m.from));
  const to = m.to === 'room' ? 'the room' : (names.get(m.to) ?? a2aPartyName(m.to));
  const private_ = m.redaction === 'asker_only' || (!m.summary && !m.answer && !m.stance);
  const text = m.summary ?? m.answer ?? m.stance;
  const reply = replyWords(t, run);
  const info = TURN_TYPE[t.type];
  const odd = chipStatusOf(m.mode) !== chipStatusOf(run.mode);
  return (
    <article
      ref={rowRef}
      className="dl-turn"
      data-type={t.type}
      data-id={m.id}
      data-kind={m.kind}
      data-speaker={roleKey(m.from)}
      data-hl={highlighted || undefined}
      data-path={onPath || undefined}
      data-authority={speaker.authority || undefined}
      tabIndex={tabbable ? 0 : -1}
      aria-posinset={t.n}
      aria-setsize={total}
      aria-label={`Turn ${t.n}. ${speaker.name} to ${to}: ${info.label}`}
      onClick={() => onSelect(m.id)}
    >
      <PortraitButton who={speaker} runId={run.runId} />
      <div className="dl-turn__main">
        <header className="dl-turn__head">
          <span className="dl-turn__who">
            <strong>{speaker.name}</strong>
            <span className="dl-turn__to">
              <Icon name="arrow-right" size={12} />
              <span className="dl-sr">to </span>
              {to}
            </span>
          </span>
          <span className="dl-badge" data-type={t.type} data-testid="dl-turn-badge">
            <Icon name={info.icon} size={12} />
            {info.label}
          </span>
          {odd ? <StatusChip status={chipStatusOf(m.mode)} /> : null}
          {m.partial ? <span className="dl-tag">Cut short</span> : null}
        </header>
        <p className="dl-turn__sub">
          <span className="dl-turn__meta">
            <span>Turn {t.n}</span>
            {m.ts > 0 ? <time dateTime={new Date(m.ts).toISOString()}>{time(m.ts)}</time> : null}
          </span>
          {reply ? (
            <span className="dl-turn__reply" data-testid="dl-reply-to">
              <Icon name="reply" size={12} />
              {reply}
            </span>
          ) : null}
        </p>
        {private_ ? (
          <p className="dl-turn__text dl-dim">Details are private to the person who asked.</p>
        ) : text ? (
          <p className="dl-turn__text">{text}</p>
        ) : null}
        {m.stance && m.summary ? (
          <p className="dl-turn__stance">
            <span className="dl-k">Position</span> {m.stance}
          </p>
        ) : null}
        {m.citations && m.citations.length > 0 ? (
          <div className="dl-turn__cites" aria-label="Sources">
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
      </div>
    </article>
  );
}

export interface TurnFeedProps {
  run: BoardRun;
  filter: FeedFilter;
  onFilter(f: FeedFilter): void;
  /** Turn to scroll into view and flash (from a dissent link or a delegation card). */
  jumpTo?: { id: string; n: number } | undefined;
  selectedId?: string | null;
  onSelect(id: string): void;
}

/**
 * The spoken turns, oldest first. Rankings and the verdict are not turns (ballot matrix, decision card). The list sticks
 * to the bottom until the reader scrolls up, then offers 'Jump to latest'. Cards form a keyboard list: Up/Down/Home/End
 * move focus, Enter marks a turn and the chain of turns it replies to.
 */
export function TurnFeed({ run, filter, onFilter, jumpTo, selectedId, onSelect }: TurnFeedProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [stick, setStick] = useState(true);
  const [seen, setSeen] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const all = turnsOf(run); // the run is mutated in place by the store: recompute each render (a few dozen cards)
  const visible = filterTurns(all, filter);
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

  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (jumpTo) pending.current = jumpTo.id;
  }, [jumpTo?.n]);
  useEffect(() => {
    const id = pending.current;
    if (!id) return;
    if (!visible.some((t) => t.m.id === id)) {
      if (filter.agent || filter.type) onFilter(NO_FILTER);
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
    setFocusIdx(visible.findIndex((t) => t.m.id === id));
  }, [jumpTo?.n, visible.length, filter.agent, filter.type]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
    const active = (e.target as HTMLElement).closest<HTMLElement>('article.dl-turn');
    if (!active || (e.target as HTMLElement).closest('button, a')) return;
    const i = visible.findIndex((t) => t.m.id === active.dataset.id);
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
    rows.current.get(visible[next]!.m.id)?.focus();
  };

  const unread = Math.max(0, visible.length - seen);
  const idx = Math.min(focusIdx, Math.max(0, visible.length - 1));
  const types = [...new Set(all.map((t) => t.type))];
  return (
    <section className="dl-feed" aria-label="What they are saying" data-testid="dl-feed">
      <div className="dl-feed__bar">
        <h3 className="dl-h">
          <Icon name="message" size={14} />
          Discussion
        </h3>
        <label className="dl-field">
          <span className="dl-k">Speaker</span>
          <select
            value={filter.agent}
            onChange={(e) => onFilter({ ...filter, agent: e.target.value })}
          >
            <option value="">Everyone</option>
            {run.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dl-field">
          <span className="dl-k">Type</span>
          <select
            value={filter.type}
            onChange={(e) => onFilter({ ...filter, type: e.target.value as TurnType | '' })}
          >
            <option value="">All types</option>
            {types.map((k) => (
              <option key={k} value={k}>
                {TURN_TYPE[k].label}
              </option>
            ))}
          </select>
        </label>
        {filter.agent || filter.type ? (
          <button type="button" className="dl-link" onClick={() => onFilter(NO_FILTER)}>
            Clear filters
          </button>
        ) : null}
        <p className="dl-feed__count" role="status">
          {visible.length === all.length
            ? `${all.length} ${all.length === 1 ? 'turn' : 'turns'}`
            : `Showing ${visible.length} of ${all.length} turns`}
        </p>
      </div>
      <div
        className="dl-feed__scroll"
        ref={scroller}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        role="feed"
        aria-label="Turns, oldest first"
        aria-busy={run.stage !== 'done'}
      >
        {visible.length === 0 ? (
          <p className="dl-empty">
            {all.length === 0
              ? 'No one has spoken yet. Turns appear here as the agents talk.'
              : 'No turns match these filters.'}
          </p>
        ) : (
          visible.map((t, i) => (
            <TurnCard
              key={t.m.id}
              t={t}
              run={run}
              total={visible.length}
              tabbable={i === idx}
              highlighted={flash === t.m.id || selectedId === t.m.id}
              onPath={path.has(t.m.id) && selectedId !== t.m.id}
              onSelect={onSelect}
              rowRef={(el) => {
                if (el) rows.current.set(t.m.id, el);
                else rows.current.delete(t.m.id);
              }}
            />
          ))
        )}
      </div>
      {!stick && (
        <button
          type="button"
          className="dl-jump"
          onClick={() => {
            toBottom();
            setStick(true);
            setSeen(visible.length);
          }}
        >
          <Icon name="arrow-down" size={14} />
          {unread > 0 ? `Jump to latest (${unread} new)` : 'Jump to latest'}
        </button>
      )}
    </section>
  );
}
