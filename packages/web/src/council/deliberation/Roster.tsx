import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CouncilStatus } from '@squad/core';
import type { CouncilBoardStore, BoardRun, BoardAgent, A2aStatus } from '@squad/village/council';
import { KIND_LABEL, a2aPartyName } from '@squad/village/council';
import { Icon } from '../../primitives/Icon';
import { StatusChip, type ChipStatus } from '../../primitives/StatusChip';
import type { CastState } from '../../components/cast-avatar/busts';
import { chipStatusOf } from './evidence';
import { PortraitButton } from './Portrait';
import { resolveParticipant } from './participants';

const ACTIVE_MS = 4000;
const GUTTER = 30;

const STATE_CHIP: Record<A2aStatus, ChipStatus> = {
  queued: 'pending',
  working: 'working',
  done: 'done',
  failed: 'error',
  skipped: 'idle',
  partial: 'degraded',
};
const STATE_WORD: Record<A2aStatus, string> = {
  queued: 'Waiting',
  working: 'Speaking',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  partial: 'Cut short',
};

function providerLine(a: BoardAgent, status: CouncilStatus | null | 'unknown'): string {
  const mode = chipStatusOf(a.mode);
  if (a.role === 'code') return 'Checked in code, no model';
  if (mode === 'fixture') return 'Scripted fixture, no model';
  if (!status || status === 'unknown') return 'Provider not reported';
  return `${status.provider}, ${a.role === 'chair' ? status.models.chair : status.models.main}`;
}

interface Geo {
  w: number;
  h: number;
  /** agent id -> centre y of its portrait, relative to the roster */
  y: Map<string, number>;
}

/**
 * Who is on the council, as rows of portrait cards (name, role, provider, live/degraded/fixture word, state word).
 * A2A handoffs are drawn as restrained arrows in the left gutter between the portraits; a new handoff draws in with
 * stroke-dashoffset in 200 ms ease-out and lights the receiving card. Static in Calm and reduced motion.
 */
export function Roster({
  store,
  run,
  calm,
  councilStatus = null,
  selected,
}: {
  store: CouncilBoardStore;
  run: BoardRun;
  calm?: boolean | undefined;
  councilStatus?: CouncilStatus | null | 'unknown';
  selected?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 600);
    return () => clearInterval(t);
  }, []);
  const box = useRef<HTMLUListElement | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<Geo | null>(null);

  const measure = () => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const y = new Map<string, number>();
    rows.current.forEach((row, id) => {
      const p = row.querySelector('.dl-portrait');
      const pr = (p ?? row).getBoundingClientRect();
      y.set(id, pr.top - r.top + pr.height / 2);
    });
    setGeo((g) =>
      g && g.w === r.width && g.h === r.height && [...y].every(([k, v]) => g.y.get(k) === v)
        ? g
        : { w: r.width, h: r.height, y },
    );
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const agents = [...run.agents].sort(
    (a, b) => Number(b.role === 'chair') - Number(a.role === 'chair') || a.lastSeq - b.lastSeq,
  );
  const links = store.links(ACTIVE_MS).filter((l) => l.runId === run.runId);
  const chair = agents.find((a) => a.role === 'chair');
  const peer = links.slice(-3);
  const lit = new Set(links.flatMap((l) => [l.from, l.to]));

  const paths = geo
    ? links
        .filter((l) => geo.y.has(l.from) && geo.y.has(l.to) && l.from !== l.to)
        .map((l) => {
          const y1 = geo.y.get(l.from)!;
          const y2 = geo.y.get(l.to)!;
          const bulge = Math.min(GUTTER - 6, 10 + Math.abs(y2 - y1) / 14);
          const x = GUTTER;
          const d = `M ${x - 3} ${y1} C ${x - bulge - 3} ${y1}, ${x - bulge - 3} ${y2}, ${x - 3} ${y2}`;
          return { id: l.messageId, d, authority: l.from === chair?.id || l.to === chair?.id };
        })
    : [];
  const railTop = chair && geo?.y.get(chair.id);
  const lastY = geo && agents.length ? geo.y.get(agents[agents.length - 1]!.id) : undefined;

  return (
    <section
      className="dl-roster"
      aria-label="Who is on the council"
      data-testid="dl-roster"
      data-calm={calm ? 'true' : undefined}
    >
      <h3 className="dl-h">
        <Icon name="users" size={14} />
        Council
      </h3>
      {agents.length === 0 ? (
        <p className="dl-empty">Members appear here once the Chair delegates.</p>
      ) : (
        <ul className="dl-roster__list" ref={box}>
          {geo ? (
            <svg
              className="dl-lines"
              width={geo.w}
              height={geo.h}
              viewBox={`0 0 ${geo.w} ${geo.h}`}
              aria-hidden="true"
              focusable="false"
              data-testid="dl-lines"
            >
              <defs>
                {(['dl-arrow', 'dl-arrow-amber'] as const).map((id) => (
                  <marker
                    key={id}
                    id={id}
                    className={id}
                    viewBox="0 0 8 8"
                    refX="6"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path
                      d="M1 1 L6 4 L1 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </marker>
                ))}
              </defs>
              {railTop !== undefined && lastY !== undefined && lastY > railTop ? (
                <line className="dl-rail" x1={GUTTER - 3} y1={railTop} x2={GUTTER - 3} y2={lastY} />
              ) : null}
              {paths.map((p) => (
                <path
                  key={p.id}
                  className="dl-handoff"
                  d={p.d}
                  pathLength={1}
                  data-authority={p.authority || undefined}
                  markerEnd={p.authority ? 'url(#dl-arrow-amber)' : 'url(#dl-arrow)'}
                  data-testid="dl-handoff"
                />
              ))}
            </svg>
          ) : null}
          {agents.map((a) => {
            const who = resolveParticipant(a.id, a.name);
            const state: CastState =
              a.status === 'working' ? 'talk' : a.status === 'queued' ? 'think' : 'idle';
            return (
              <li
                key={a.id}
                ref={(el) => {
                  if (el) rows.current.set(a.id, el);
                  else rows.current.delete(a.id);
                }}
                className="dl-member"
                data-authority={who.authority || undefined}
                data-status={a.status}
                data-lit={lit.has(a.id) || undefined}
                data-selected={selected === a.id || undefined}
                data-testid="dl-member"
              >
                <PortraitButton
                  who={who}
                  scale={1}
                  state={state}
                  {...(calm ? { calm: true } : {})}
                  runId={run.runId}
                />
                <div className="dl-member__text">
                  <p className="dl-member__name">
                    <strong>{who.name}</strong>
                    <span className="dl-member__role">{who.role}</span>
                  </p>
                  <p className="dl-member__chips">
                    <StatusChip status={chipStatusOf(a.mode)} />
                    <StatusChip status={STATE_CHIP[a.status]} label={STATE_WORD[a.status]} />
                  </p>
                  <p className="dl-member__provider">{providerLine(a, councilStatus)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {peer.length > 0 ? (
        <ul className="dl-peers" aria-label="Handoffs right now">
          {peer.map((l) => (
            <li key={l.messageId}>
              <Icon name="arrow-right" size={12} />
              {a2aPartyName(l.from)}
              <span className="dl-sr"> to </span>
              <Icon name="chevron-right" size={10} />
              {a2aPartyName(l.to)}: {KIND_LABEL[l.kind]}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
