import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LivePersona, LivePersonaId } from '@squad/core';
import type { LivePlayer } from './audio';
import { completedSentences, personaOf, portraitFor, seatSlots } from './personas';
import type { LiveState } from './reducer';
import { currentCaption } from './reducer';

/** Level bars: scaleY driven by the real audio level at display rate when audio flows, else a frame-stepped loop. */
export function LevelBars({ player, active }: { player: LivePlayer | null; active: boolean }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (!active || !player?.enabled) return;
    let raf = 0;
    const tick = () => {
      const l = player.level();
      refs.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleY(${0.2 + Math.min(1, l * (0.7 + i * 0.15)) * 0.8})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, player]);
  const real = !!player?.enabled && player.state === 'ready';
  return (
    <span className="ld-bars" data-active={active || undefined} data-real={real || undefined} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} ref={(el) => void (refs.current[i] = el)} style={{ ['--i' as string]: i }} />
      ))}
    </span>
  );
}

export function ThinkingDots() {
  return (
    <span className="ld-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function SpeakerChip({
  glyph,
  name,
  tone,
}: {
  glyph: string;
  name: string;
  tone?: string;
}) {
  return (
    <span className="ld-chip" data-who={tone}>
      <span className="ld-chip__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="ld-chip__name">{name}</span>
    </span>
  );
}

export interface RoomProps {
  state: LiveState;
  personas: readonly LivePersona[];
  player: LivePlayer | null;
  selected: LivePersonaId | null;
  onSelect(id: LivePersonaId): void;
  reduced: boolean;
  userTalking: boolean;
}

/** Round table: personas seated, a ring under the speaker, thinking dots for the next, a glance toward the addressee. */
export function Room({ state, personas, player, selected, onSelect, reduced, userTalking }: RoomProps) {
  const slots = seatSlots(personas.length);
  const pos = (id: string) => {
    const i = personas.findIndex((p) => p.id === id);
    return i < 0 ? null : slots[i]!;
  };
  const speaker = state.floor.speaker;
  const thinking = state.floor.thinking;
  const to = state.floor.to;
  const a = speaker && speaker !== 'user' ? pos(speaker) : null;
  const b = to ? pos(to) : null;
  const roving = useRef<HTMLDivElement>(null);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const seats = Array.from(roving.current?.querySelectorAll<HTMLButtonElement>('button.ld-seat') ?? []);
    const i = seats.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    seats[(i + d + seats.length) % seats.length]?.focus();
  };

  return (
    <div
      ref={roving}
      className="ld-room"
      role="group"
      aria-label="The table"
      data-reduced={reduced || undefined}
      onKeyDown={onKey}
    >
      <div className="ld-table" aria-hidden="true" />
      {a && b && (
        <svg className="ld-glance" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {personas.map((p, i) => {
        const [x, y] = slots[i]!;
        const speaking = speaker === p.id;
        const next = thinking === p.id && !speaking;
        const addressed = to === p.id && !!speaker && speaker !== 'user';
        const img = portraitFor(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className="ld-seat"
            data-who={p.id}
            data-speaking={speaking || undefined}
            data-next={next || undefined}
            data-addressed={addressed || undefined}
            data-selected={selected === p.id || undefined}
            aria-pressed={selected === p.id}
            aria-label={`${p.name}. ${p.stance}${speaking ? ' Has the floor.' : ''}${next ? ' Is thinking.' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onSelect(p.id)}
          >
            <span className="ld-ring" aria-hidden="true" />
            {img ? (
              <img className="ld-portrait" src={img} alt="" width={64} height={64} />
            ) : (
              <span className="ld-portrait ld-portrait--blank" aria-hidden="true" />
            )}
            <SpeakerChip glyph={p.glyph} name={p.name} tone={p.id} />
            <span className="ld-seat__state">
              {speaking ? (
                <>
                  <LevelBars player={player} active />
                  <span className="ld-state-word">Speaking</span>
                </>
              ) : next ? (
                <>
                  <ThinkingDots />
                  <span className="ld-state-word">Thinking</span>
                </>
              ) : addressed ? (
                <span className="ld-state-word">Addressed</span>
              ) : null}
            </span>
          </button>
        );
      })}
      {userTalking && (
        <span className="ld-you" role="status">
          <span className="ld-chip__glyph" aria-hidden="true">
            Y
          </span>
          You have the floor
        </span>
      )}
    </div>
  );
}

/** Words fade up one by one (80 ms each); Calm shows one finished sentence at a time. */
export function CaptionsBar({
  state,
  personas,
  reduced,
}: {
  state: LiveState;
  personas: readonly LivePersona[];
  reduced: boolean;
}) {
  const cur = currentCaption(state);
  const prev = state.turns.length
    ? state.turns[state.turns.length - (cur?.live ? 1 : 2)]
    : undefined;
  if (!cur)
    return (
      <div className="ld-caps" data-empty="true">
        <p className="ld-caps__line">Captions appear here as the table talks.</p>
      </div>
    );
  const who = personaOf(personas, cur.speaker);
  const text = reduced && cur.live ? completedSentences(cur.text) : cur.text;
  const words = text.split(/\s+/).filter(Boolean);
  const pw = prev ? personaOf(personas, prev.speaker) : null;
  const last = state.turns[state.turns.length - 1];
  return (
    <div className="ld-caps" data-live={cur.live || undefined} data-reduced={reduced || undefined}>
      {prev && pw && (
        <p className="ld-caps__prev" aria-hidden="true">
          <b>{pw.name}:</b> {prev.text.length > 140 ? `${prev.text.slice(0, 140)}...` : prev.text}
        </p>
      )}
      <div className="ld-caps__row">
        <SpeakerChip glyph={who.glyph} name={who.name} tone={cur.speaker} />
        <p className="ld-caps__line" key={state.turns.length + state.open.length} aria-hidden="true">
          {words.map((w, i) => (
            <span className="ld-w" key={i}>
              {w}{' '}
            </span>
          ))}
          {!cur.live && last?.interrupted && <span className="ld-yield">yielded</span>}
        </p>
      </div>
    </div>
  );
}
