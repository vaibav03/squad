import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HALL_SLOT } from '@squad/village/rooms';
import type { RoomSnapshot } from '@squad/village/rooms';
import { LvIcon } from '../overlays/kit';
import { StatusChip } from '../primitives/StatusChip';
import { openAgentPanel, useCanInspect } from '../overlays/inspector';
import { useCanOpenBoard, openBoard } from '../council/board/bridge';
import { COUNCIL_OPEN_EVENT, COUNCIL_LIVE_EVENT } from '../council/hall-events';
import { HallAvatar } from './HallAvatar';
import {
  AVAILABILITY_LABEL,
  AVAILABILITY_NOTE,
  HALL_AGENTS,
  availabilityOf,
  hallAgent,
  type HallAgent,
} from './roster';
import { focusHallAgent, leaveHall, resetHallFocus, useHallFocus } from './store';
import './hall.css';

/** Seats on two arcs: Cubbie in the middle of the inner one. Positions are fractions of the stage box. */
const ANCHOR = 36;
/** Outer arc radius that fits the stage box (width and height), never absurdly small or large. */
export function arcRadius(w: number, h: number): number {
  return Math.max(120, Math.min(w / 2 - 36, h - ANCHOR - 56, 330));
}
export function seatLayout(
  agents: readonly HallAgent[],
  R2: number,
): { alias: string; x: number; y: number }[] {
  const n = agents.length;
  const inner = Math.min(9, Math.ceil(n * 0.42));
  const mid = agents.filter((a) => a.alias === 'cubbie');
  const others = agents.filter((a) => a.alias !== 'cubbie');
  const innerList = [
    ...others.slice(0, Math.floor((inner - 1) / 2)),
    ...mid,
    ...others.slice(Math.floor((inner - 1) / 2), inner - 1),
  ];
  const outerList = others.slice(inner - 1);
  const R1 = R2 * 0.7;
  const place = (list: readonly HallAgent[], R: number) =>
    list.map((a, i) => {
      const t = list.length === 1 ? 0.5 : i / (list.length - 1);
      const th = Math.PI * (0.1 + 0.8 * (1 - t)); // left to right over the top
      return { alias: a.alias, x: R * Math.cos(th), y: -R * Math.sin(th) };
    });
  return [...place(innerList, R1), ...place(outerList, R2)];
}

function Seat({
  agent,
  picked,
  locked,
  calm,
  style,
  onPick,
}: {
  agent: HallAgent;
  picked: boolean;
  locked: boolean;
  calm?: boolean;
  style?: React.CSSProperties;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="hall-seat"
      style={style}
      data-agent={agent.alias}
      data-picked={picked ? 'true' : undefined}
      data-locked={locked ? 'true' : undefined}
      aria-pressed={picked}
      aria-label={`${agent.name}, ${locked ? AVAILABILITY_LABEL.locked.toLowerCase() : 'available'}. Press to message ${agent.name}.`}
      onClick={onPick}
    >
      <HallAvatar who={agent.alias} {...(calm ? { calm: true } : {})} />
      <span className="hall-seat__tag" aria-hidden="true">
        {agent.name}
      </span>
    </button>
  );
}

export interface HallLayerProps {
  snap: RoomSnapshot;
  calm?: boolean;
}

/**
 * The Agent Hall: every agent seated on a tidy double arc, one card for the one you picked, and the council tools. The
 * conversation itself is the squad group chat, docked on the right by the chat dock (same thread, same transport).
 */
export function HallLayer({ snap, calm }: HallLayerProps) {
  const focus = useHallFocus();
  const canBoard = useCanOpenBoard();
  const canInspect = useCanInspect();
  const box = useRef<HTMLDivElement | null>(null);
  const [dim, setDim] = useState({ w: 800, h: 420 });
  const w = dim.w;
  const row = w < 640;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setDim({ w: el.clientWidth || 800, h: el.clientHeight || 420 });
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Where the viewer came from (a HUD chip, a former room's door, ?room=): aim the hall at that agent once per ask.
  const ask = snap.focus;
  useEffect(() => {
    if (!ask) return;
    const a = hallAgent(ask.alias);
    focusHallAgent(a?.alias ?? null, ask.seed ?? (a ? `@${a.alias} ` : null));
  }, [ask?.n]);
  useEffect(() => () => resetHallFocus(), []);

  const picked = hallAgent(focus.alias);
  const R2 = arcRadius(dim.w, dim.h);
  const layout = useMemo(() => seatLayout(HALL_AGENTS, R2), [R2]);
  const pos = new Map(layout.map((p) => [p.alias, p]));
  const avail = picked ? availabilityOf(picked, snap.used) : null;

  return (
    <section
      className="hall sq-scene"
      aria-label="Agent Hall"
      data-testid="agent-hall"
      data-room={HALL_SLOT}
    >
      <header className="hall__head">
        <div>
          <h2 className="hall__title">Agent Hall</h2>
          <p className="hall__sub">
            Everyone you can ask, in one place. Pick a seat or type @ and a name.
          </p>
        </div>
        <button
          type="button"
          className="lv-btn hall__leave"
          aria-label="Leave the Agent Hall"
          onClick={leaveHall}
        >
          <LvIcon name="x" size={16} />
          Leave
        </button>
      </header>

      <div
        ref={box}
        className={`hall__stage${row ? ' is-row' : ''}`}
        role="group"
        aria-label="Agents in the hall"
      >
        {HALL_AGENTS.map((a) => {
          const p = pos.get(a.alias);
          const locked = availabilityOf(a, snap.used) === 'locked';
          return (
            <Seat
              key={a.alias}
              agent={a}
              picked={picked?.alias === a.alias}
              locked={locked}
              {...(calm ? { calm: true } : {})}
              {...(!row && p
                ? {
                    style: {
                      left: `calc(50% + ${p.x.toFixed(1)}px)`,
                      top: `calc(100% - ${ANCHOR}px + ${p.y.toFixed(1)}px)`,
                    },
                  }
                : {})}
              onPick={() => focusHallAgent(a.alias, `@${a.alias} `)}
            />
          );
        })}

        <div className="hall__council" role="group" aria-label="Council">
          <span className="hall__council-label">Council</span>
          <button
            type="button"
            className="lv-btn"
            aria-haspopup="dialog"
            onClick={() => window.dispatchEvent(new Event(COUNCIL_OPEN_EVENT))}
          >
            <LvIcon name="users" size={16} />
            Ask the council
          </button>
          <button
            type="button"
            className="lv-btn"
            aria-haspopup="dialog"
            onClick={() => window.dispatchEvent(new Event(COUNCIL_LIVE_EVENT))}
          >
            <LvIcon name="sparkle" size={16} />
            Start a discussion
          </button>
          {canBoard ? (
            <button
              type="button"
              className="lv-btn"
              aria-haspopup="dialog"
              onClick={() => openBoard({})}
            >
              <LvIcon name="split" size={16} />
              Council board
            </button>
          ) : null}
        </div>
        <div className="hall__card" data-testid="hall-card" aria-live="polite">
          {picked && avail ? (
            <>
              <div className="hall__card-top">
                <HallAvatar who={picked.alias} size={2} {...(calm ? { calm: true } : {})} />
                <div className="hall__card-id">
                  <strong className="hall__card-name">{picked.name}</strong>
                  <StatusChip
                    status={avail === 'available' ? 'ok' : 'idle'}
                    label={AVAILABILITY_LABEL[avail]}
                    detail={AVAILABILITY_NOTE[avail]}
                  />
                </div>
              </div>
              <p className="hall__card-blurb">{picked.blurb}</p>
              <div className="hall__card-actions">
                {canInspect ? (
                  <button
                    type="button"
                    className="lv-btn"
                    onClick={() => openAgentPanel(picked.panelId, { slot: HALL_SLOT })}
                  >
                    <LvIcon name="users" size={16} />
                    Open {picked.name}&rsquo;s panel
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="hall__card-hint">
              Pick a seat to aim your message, or just type in the chat.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
