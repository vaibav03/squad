import { useEffect, useRef, useState } from 'react';
import type { LiveCitation, LivePersona, LiveTurn } from '@squad/core';
import { openSource } from '../components/source-viewer';
import { LvIcon } from '../overlays/kit/icons';
import { mmss, personaOf } from './personas';
import { SpeakerChip } from './Room';
import type { LiveState } from './reducer';

export function CiteChip({ c }: { c: LiveCitation }) {
  return (
    <button
      type="button"
      className="ld-cite"
      aria-haspopup="dialog"
      aria-label={`Open source ${c.label}${c.quote ? ', verified quote' : ''}`}
      onClick={(e) =>
        openSource({
          file: c.file,
          page: c.page,
          ...(c.quote ? { quote: c.quote } : {}),
          returnFocusTo: e.currentTarget,
        })
      }
    >
      <LvIcon name="file" size={12} />
      {c.label}
    </button>
  );
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ld-link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* blocked: nothing to copy to */
        }
      }}
    >
      {done ? 'Copied' : 'Copy line'}
    </button>
  );
}

export function turnLine(t: LiveTurn, personas: readonly LivePersona[]) {
  return `${personaOf(personas, t.speaker).name}: ${t.text}`;
}

/** Full discussion, newest at the bottom, with citations, a "yielded" tag for cut turns and copy/jump actions. */
export function Transcript({
  state,
  personas,
  startedAt,
  focusId,
}: {
  state: LiveState;
  personas: readonly LivePersona[];
  startedAt: number;
  /** A takeaway asked to jump to this turn. */
  focusId: { id: string; n: number } | null;
}) {
  const end = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (pinned.current) end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [state.turns.length, state.open]);

  useEffect(() => {
    if (!focusId) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-turn="${focusId.id}"]`);
    if (!el) return;
    pinned.current = false;
    el.scrollIntoView?.({ block: 'center' });
    el.focus({ preventScroll: true });
    setHot(focusId.id);
    const t = setTimeout(() => setHot(null), 1600);
    return () => clearTimeout(t);
  }, [focusId]);

  const rows: {
    id: string;
    n: number;
    speaker: string;
    text: string;
    ts?: number;
    cites: LiveCitation[];
    yielded?: boolean;
    live?: boolean;
  }[] = [
    ...state.turns.map((t) => ({
      id: t.id,
      n: t.n,
      speaker: t.speaker,
      text: t.text,
      ts: t.ts,
      cites: t.citations,
      ...(t.interrupted ? { yielded: true } : {}),
    })),
    ...state.open.map((o) => ({
      id: o.turnId,
      n: 1e6,
      speaker: o.speaker,
      text: o.text,
      cites: [],
      live: true,
    })),
  ];

  return (
    <ol
      ref={list}
      className="ld-tx"
      aria-label="Transcript"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {rows.length === 0 && <li className="ld-dim">Nothing said yet.</li>}
      {rows.map((r) => {
        const who = personaOf(personas, r.speaker);
        return (
          <li
            key={r.id}
            className="ld-tx__turn"
            data-turn={r.id}
            data-hot={hot === r.id || undefined}
            data-live={r.live || undefined}
            data-yielded={r.yielded || undefined}
            tabIndex={-1}
          >
            <div className="ld-tx__head">
              <SpeakerChip glyph={who.glyph} name={who.name} tone={r.speaker} />
              {r.ts !== undefined && (
                <time className="ld-dim ld-small">{mmss(r.ts - startedAt)}</time>
              )}
              {r.yielded && <span className="ld-tag">yielded</span>}
              {r.live && <span className="ld-tag ld-tag--live">speaking</span>}
            </div>
            <p className="ld-tx__text">{r.text}</p>
            {r.cites.length > 0 && (
              <div className="ld-cites" role="group" aria-label="Verified sources">
                {r.cites.map((c) => (
                  <CiteChip key={`${c.file}:${c.page}`} c={c} />
                ))}
              </div>
            )}
            {!r.live && (
              <div className="ld-tx__acts">
                <CopyLine text={`${who.name}: ${r.text}`} />
              </div>
            )}
          </li>
        );
      })}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}
