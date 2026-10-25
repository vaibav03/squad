import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_PERSONAS, type LivePersonaId } from '@squad/core';
import { LvIcon } from '../overlays/kit/icons';
import { Controls, HeaderTools, type CaptionSize } from './Controls';
import { CaptionsBar, Room } from './Room';
import { TakeawaysPanel } from './TakeawaysPanel';
import { Transcript } from './Transcript';
import { EMPTY_TAKEAWAYS } from './fixtures';
import type { LiveController } from './useLiveDiscussion';

const SIZE_KEY = 'squad.live.caption-size';
const readSize = (): CaptionSize => {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return v === 'S' || v === 'L' ? v : 'M';
  } catch {
    return 'M';
  }
};

const statusWord: Record<string, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  wrapping_up: 'Wrapping up',
  ended: 'Ended',
  unavailable: 'Unavailable',
};
const endWord: Record<string, string> = {
  wrapped: 'The chair wrapped up.',
  user_left: 'You left the discussion.',
  max_turns: 'The table reached its turn limit.',
  max_time: 'The table reached its time limit.',
  budget: 'The table reached its model budget.',
  error: 'The discussion stopped because of an error.',
};

/** The room: header, pinned line, table, captions, controls, and the transcript + takeaways beside them. */
export function LiveDiscussion({
  ctl,
  topic,
  reduced,
  onLeave,
  onReplay,
  demoMock,
}: {
  ctl: LiveController;
  topic: string;
  reduced: boolean;
  onLeave(): void;
  /** Replay a finished discussion with captions. */
  onReplay?: () => void;
  /** The transport is the scripted one. */
  demoMock: boolean;
}) {
  const { state } = ctl;
  const personas = state.snapshot?.personas ?? LIVE_PERSONAS;
  const firstTs = state.turns[0]?.ts ?? 0;
  const snapStart = state.snapshot?.startedAt ?? 0;
  // elapsed time is measured from the real start; a missing or later clock falls back to the first turn
  const startedAt = snapStart > 0 && snapStart <= firstTs ? snapStart : firstTs;
  const [size, setSize] = useState<CaptionSize>(readSize);
  const [ask, setAsk] = useState<LivePersonaId | null>(null);
  const [tab, setTab] = useState<'transcript' | 'takeaways'>('transcript');
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const holding = useRef(false);

  const onSize = (s: CaptionSize) => {
    setSize(s);
    try {
      localStorage.setItem(SIZE_KEY, s);
    } catch {
      /* storage blocked */
    }
  };

  // Space to talk (hold), when focus is not in a field or on a button.
  useEffect(() => {
    const el = document;
    const typing = (t: EventTarget | null) => {
      const n = t as HTMLElement | null;
      return !!n && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(n.tagName) || n.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target) || ctl.readOnly) return;
      e.preventDefault();
      holding.current = true;
      ctl.talkStart();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !holding.current) return;
      holding.current = false;
      ctl.talkStop();
    };
    el.addEventListener('keydown', down);
    el.addEventListener('keyup', up);
    return () => {
      el.removeEventListener('keydown', down);
      el.removeEventListener('keyup', up);
    };
  }, [ctl]);

  // Any click in the room is a gesture: unlock the audio context.
  const unlock = () => {
    if (ctl.sound === 'locked' || ctl.sound === 'idle') ctl.enableSound();
  };

  // Pause animations when the tab is hidden.
  useEffect(() => {
    const on = () => root.current?.setAttribute('data-hidden', String(document.hidden));
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const jump = useCallback((id: string) => {
    setTab('transcript');
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  }, []);

  const status = state.status;
  const ended = status === 'ended';
  const tk = state.takeaways ?? EMPTY_TAKEAWAYS;
  const demo = state.demo || demoMock;
  const noAudio = state.audio === false && !demo && ctl.player.enabled && !ended;
  const unavailable = status === 'unavailable';

  return (
    <div
      ref={root}
      className="ld-root"
      data-size={size}
      data-reduced={reduced || undefined}
      data-tab={tab}
      onPointerDown={unlock}
    >
      <header className="ld-head">
        <div className="ld-head__tags">
          <span className="ld-status" data-status={status} role="status">
            <span className="ld-dot" aria-hidden="true" />
            {statusWord[status] ?? status}
          </span>
          <span className="ld-tag">AI-generated discussion</span>
          {demo && (
            <span className="ld-tag ld-tag--demo" title={state.note}>
              Demo mode: scripted discussion
            </span>
          )}
          {ctl.readOnly && <span className="ld-tag">Replay</span>}
          <HeaderTools size={size} onSize={onSize} onLeave={onLeave} />
        </div>
        <h2 className="ld-topic" id="ld-title">
          {topic}
        </h2>
        <p className="ld-where" aria-live="polite">
          <LvIcon name="pin" size={14} />
          <span className="ld-eyebrow">Where we are</span>
          {tk.whereWeAre}
        </p>
      </header>

      {(status === 'connecting' ||
        status === 'reconnecting' ||
        unavailable ||
        ctl.error ||
        noAudio ||
        state.note) && (
        <div className="ld-banners">
          {status === 'connecting' && !ctl.error && (
            <p className="ld-banner" role="status">
              <LvIcon name="clock" size={14} /> Connecting to the table...
            </p>
          )}
          {status === 'reconnecting' && (
            <p className="ld-banner ld-banner--warn" role="status">
              <LvIcon name="wifi-off" size={14} /> Reconnecting. The discussion picks up where it
              left off.
            </p>
          )}
          {(unavailable || ctl.error) && (
            <div className="ld-banner ld-banner--bad" role="alert">
              <LvIcon name="alert" size={14} />
              <span>
                {ctl.error ?? 'The discussion could not be reached.'}{' '}
                {unavailable &&
                  'The model may be busy or the hub may be offline. Fix: check the hub is running, then try again.'}
              </span>
              <button type="button" className="lv-btn" onClick={ctl.retry}>
                <LvIcon name="refresh" size={14} /> Try again
              </button>
            </div>
          )}
          {noAudio && (
            <p className="ld-banner" role="status">
              <LvIcon name="info" size={14} /> No audio output from the model this time. Captions
              are complete.
            </p>
          )}
        </div>
      )}

      <div className="ld-grid">
        <section className="ld-stage" aria-label="Discussion room">
          <Room
            state={state}
            personas={personas}
            player={ctl.player}
            selected={ask}
            onSelect={(id) => setAsk(ask === id ? null : id)}
            reduced={reduced}
            userTalking={ctl.talk === 'listening' || state.floor.speaker === 'user'}
          />
          {ask && (
            <p className="ld-stance" role="status">
              <b>{personas.find((p) => p.id === ask)?.name}</b>:{' '}
              {personas.find((p) => p.id === ask)?.stance} Your next message goes to them.
            </p>
          )}
          <CaptionsBar state={state} personas={personas} reduced={reduced} />
          {ended ? (
            <div className="ld-ended" role="status">
              <p>
                <LvIcon name="check" size={14} /> Ended. {endWord[state.endReason ?? 'wrapped']}
              </p>
              <div className="ld-row">
                {onReplay && (
                  <button type="button" className="lv-btn lv-btn--primary" onClick={onReplay}>
                    <LvIcon name="refresh" size={16} /> Replay with captions
                  </button>
                )}
                <button type="button" className="lv-btn" onClick={onLeave}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <Controls
              ctl={ctl}
              personas={personas}
              ask={ask}
              onAsk={setAsk}
              speaking={state.floor.speaker !== null && state.floor.speaker !== 'user'}
            />
          )}
        </section>

        <div className="ld-tabs" role="tablist" aria-label="Side panels">
          {(['transcript', 'takeaways'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`ld-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`ld-pane-${t}`}
              className="ld-tabs__btn"
              onClick={() => setTab(t)}
            >
              {t === 'transcript' ? 'Transcript' : 'Takeaways'}
            </button>
          ))}
        </div>
        <aside
          className="ld-pane ld-pane--tx"
          id="ld-pane-transcript"
          role="tabpanel"
          aria-labelledby="ld-tab-transcript"
          data-on={tab === 'transcript' || undefined}
        >
          <h3 className="ld-pane__title">Transcript</h3>
          <Transcript state={state} personas={personas} startedAt={startedAt} focusId={focus} />
        </aside>
        <aside
          className="ld-pane ld-pane--tk"
          id="ld-pane-takeaways"
          role="tabpanel"
          aria-labelledby="ld-tab-takeaways"
          data-on={tab === 'takeaways' || undefined}
        >
          <h3 className="ld-pane__title">Takeaways</h3>
          <TakeawaysPanel
            takeaways={tk}
            actions={ctl.actions}
            onRun={(n) => void ctl.run(n)}
            onJump={jump}
            reduced={reduced}
          />
        </aside>
      </div>
    </div>
  );
}
