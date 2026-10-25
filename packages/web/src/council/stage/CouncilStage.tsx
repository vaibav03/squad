import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KIND_LABEL, a2aPartyName, type BoardRun } from '@squad/village/council';
import { getRoomSession } from '@squad/village/rooms';
import type { CouncilResult } from '@squad/core';
import type { HubCtx } from '../../pages/village/hub';
import { LvIcon } from '../../overlays/kit/icons';
import { ModeBadge } from '../board/ModeBadge';
import { openBoard, useBoardStoreRef, useBoardVersion, useCanOpenBoard } from '../board/bridge';
import { getCouncil } from '../council-client';
import { CouncilCaptions } from '../live/CouncilCaptions';
import { CouncilSayBar } from '../live/CouncilSayBar';
import { useCouncilLive } from '../live/useCouncilLive';
import {
  COUNCIL_STARTED_EVENT,
  SLOT_OF,
  autoHallEnabled,
  openRoom,
  takePendingCouncilStart,
  type CouncilStartedDetail,
} from './room-opener';
import { SEAT_GLYPH, SEAT_WORDS, deriveSeats } from './seat-state';
import './stage.css';

const SPEAK_MS = 3500;
const SLOT_TITLE: Record<string, string> = {
  'council-hall': 'Council Hall',
  'round-table': 'Round Table',
};
const slotOfRun = (run: BoardRun): string | undefined => {
  const m = /^council:([a-z]+)/i.exec(run.councilId);
  return m ? (SLOT_OF as Record<string, string>)[m[1]!.toLowerCase()] : undefined;
};

function useEnteredSlot(): string | null {
  const [slot, setSlot] = useState<string | null>(
    () => getRoomSession()?.snapshot().entered ?? null,
  );
  useEffect(() => {
    let off: (() => void) | undefined;
    const attach = () => {
      off?.();
      const s = getRoomSession();
      if (!s) return;
      setSlot(s.snapshot().entered);
      off = s.subscribe((snap) => setSlot(snap.entered));
    };
    attach();
    window.addEventListener('squad:room-session', attach);
    return () => {
      window.removeEventListener('squad:room-session', attach);
      off?.();
    };
  }, []);
  return slot;
}

/** Info the board stream does not carry: the run's honest transport and whether it is over. */
function useRunInfo(hub: HubCtx | null, runId: string | undefined, version: number) {
  const [info, setInfo] = useState<CouncilResult | null>(null);
  const last = useRef('');
  useEffect(() => {
    if (!hub || !runId || !/^cn_[a-z0-9]{12}$/.test(runId)) return setInfo(null);
    const key = `${runId}:${version}`;
    if (last.current === key) return;
    // refetch only until the transport is known and once more when the run finishes
    if (info?.id === runId && info.transport && info.status !== 'running' && version > 0) return;
    last.current = key;
    let dead = false;
    getCouncil(hub, runId).then(
      (r) => !dead && setInfo(r),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [hub, runId, version, info]);
  return info?.id === runId ? info : null;
}

/**
 * The live stage of the Council Hall and the Round Table: seats with speaking / thinking / waiting / done states driven
 * by the A2A events, the message arrows by kind word, live captions with the speaker chip and the mode badge, the board
 * one click away. Opens the room when a council starts (unless `?autohall=0`), and always offers 'Open the council hall'.
 */
/** The room layer's dock rides above the stage: publish the stage height as `--room-strip-bottom` while it is mounted. */
function useDockOffset(): (el: HTMLElement | null) => void {
  const ro = useRef<ResizeObserver | null>(null);
  return useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    const root = document.documentElement;
    if (!el) return void root.style.removeProperty('--room-strip-bottom');
    const set = () =>
      root.style.setProperty('--room-strip-bottom', `${Math.ceil(el.offsetHeight) + 12}px`);
    set();
    if (typeof ResizeObserver !== 'undefined') {
      ro.current = new ResizeObserver(set);
      ro.current.observe(el);
    }
  }, []);
}

export function CouncilStage({ hub, calm }: { hub: HubCtx | null; calm?: boolean }) {
  const dockRef = useDockOffset();
  const board = useBoardStoreRef();
  const version = useBoardVersion(board);
  const canBoard = useCanOpenBoard();
  const entered = useEnteredSlot();
  const run = board?.run();
  const slot = run ? slotOfRun(run) : undefined;
  const running = !!run && run.stage !== 'done';
  const info = useRunInfo(hub, run?.runId, run?.stage === 'done' ? 1 : 0);
  const live = useCouncilLive(hub, run?.runId ?? null, {
    active: !!run && running && info?.transport?.kind === 'live-audio',
  });
  const [mine, setMine] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<CouncilStartedDetail | null>(null);

  // who just spoke (non-live runs speak by message)
  const [recent, setRecent] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!run) return;
    const fresh = run.messages.filter((m) => !seen.current.has(m.id));
    for (const m of fresh) {
      seen.current.add(m.id);
      if (!m.summary || m.to.startsWith('tool:') || m.from.startsWith('code:')) continue;
      setRecent((s) => new Set(s).add(m.from));
      const from = m.from;
      setTimeout(
        () => setRecent((s) => (s.has(from) ? new Set([...s].filter((x) => x !== from)) : s)),
        SPEAK_MS,
      );
    }
  }, [run, version]);

  // auto-open: a council started here (panel, board, chat) or earlier on another page
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const handle = useCallback((d: CouncilStartedDetail) => {
    setMine((s) => new Set(s).add(d.id));
    setPending(d);
    if (autoHallEnabled()) void openRoom(SLOT_OF[d.councilKey], !!calmRef.current);
  }, []);
  useEffect(() => {
    const p = takePendingCouncilStart();
    if (p) handle(p);
    const on = (e: Event) => handle((e as CustomEvent<CouncilStartedDetail>).detail);
    window.addEventListener(COUNCIL_STARTED_EVENT, on);
    return () => window.removeEventListener(COUNCIL_STARTED_EVENT, on);
  }, [handle]);

  const seats = useMemo(
    () =>
      run
        ? deriveSeats(run, {
            liveSpeaker: live.speaker?.agent ?? null,
            recentSpeakers: recent,
            finished: run.stage === 'done',
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, version, live.speaker, recent],
  );
  const arrows = useMemo(
    () =>
      (run?.messages ?? [])
        .filter((m) => !m.to.startsWith('tool:') && m.to !== 'room' && !m.from.startsWith('code:'))
        .slice(-3),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, version],
  );

  const wantsHall = !!run && !!slot && (pending !== null || running);
  if (!run || !slot || (!wantsHall && entered !== slot)) return null;
  if (entered !== slot) {
    return (
      <button
        type="button"
        className="lv-btn cn-open-hall"
        data-testid="open-council-hall"
        onClick={() => void openRoom(slot, !!calm)}
      >
        <LvIcon name="users" size={16} />
        Open the {slot === 'council-hall' ? 'council hall' : 'round table'}
      </button>
    );
  }

  const demo =
    (info?.transport?.kind ?? (run.mode.startsWith('demo') ? 'demo' : '')) === 'demo' ||
    run.mode.startsWith('demo');
  const last = [...run.messages].reverse().find((m) => !!m.summary && !m.to.startsWith('tool:'));
  const speakerName = (id: string) => a2aPartyName(id);
  return (
    <section
      ref={dockRef}
      className="cn-stage"
      aria-label={`${SLOT_TITLE[slot]} live stage`}
      data-testid="council-stage"
      data-mode={run.mode}
      data-calm={calm ? 'true' : undefined}
    >
      {demo && (
        <p className="cn-stage__demo" role="note" data-testid="demo-banner">
          Demo: scripted, not Gemini
        </p>
      )}
      <div className="cn-stage__head">
        <span>{SLOT_TITLE[slot]}</span>
        <ModeBadge mode={run.mode} />
        <span className="cn-stage__transport" data-testid="stage-transport">
          {info?.transport?.label ?? (demo ? 'Demo (scripted, not Gemini)' : 'Gemini')}
        </span>
        <span className="cn-stage__spacer" />
        {live.connected && (
          <button
            type="button"
            className="lv-btn lv-btn--ghost"
            aria-pressed={live.soundOn}
            onClick={() => live.setSound(!live.soundOn)}
          >
            {live.soundOn ? 'Sound on' : 'Sound off'}
          </button>
        )}
        {canBoard && (
          <button
            type="button"
            className="lv-btn"
            data-testid="stage-board"
            onClick={() => openBoard({ runId: run.runId })}
          >
            <LvIcon name="split" size={16} />
            Council board
          </button>
        )}
      </div>
      <ul className="cn-seats" aria-label="Who is at the table">
        {seats.map((s) => (
          <li
            key={s.id}
            className="cn-seat"
            data-testid="council-seat"
            data-seat-state={s.state}
            data-seat-name={s.name}
          >
            <span aria-hidden="true">{SEAT_GLYPH[s.state]}</span>
            <span>{s.name}</span>
            {s.state === 'thinking' && (
              <span className="cn-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
            {s.state === 'speaking' && <span className="cn-mouth" aria-hidden="true" />}
            <span className="cn-seat__word">{SEAT_WORDS[s.state]}</span>
          </li>
        ))}
      </ul>
      <ul className="cn-arrows" aria-label="Messages between members">
        {arrows.map((m) => (
          <li key={m.id} className="cn-arrow" data-testid="council-arrow">
            {speakerName(m.from)} → {speakerName(m.to)}: {KIND_LABEL[m.kind]}
          </li>
        ))}
      </ul>
      <CouncilCaptions
        live={live}
        mode={run.mode}
        calm={calm}
        fallback={last ? { name: speakerName(last.from), text: last.summary ?? '' } : undefined}
      />
      {live.connected && running && mine.has(run.runId) && (
        <CouncilSayBar
          mic={live.mic}
          onSay={live.say}
          onTalkStart={live.talkStart}
          onTalkStop={live.talkStop}
        />
      )}
    </section>
  );
}
