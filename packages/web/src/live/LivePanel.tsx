import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { LIVE_TOPIC_MAX, LIVE_TOPIC_MIN, type LiveMode } from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { OverlayFrame } from '../overlays/kit/OverlayFrame';
import { LvIcon } from '../overlays/kit/icons';
import { usePrefersReducedMotion } from '../overlays/kit/hooks';
import { SourceViewerHost, hasSourceHost } from '../components/source-viewer';
import { LiveDiscussion } from './LiveDiscussion';
import { mockLiveTransport } from './fixtures';
import type { LiveTransport } from './live-client';
import { useLiveTransport } from './transport';
import { useLiveDiscussion } from './useLiveDiscussion';
import './live.css';

export const LIVE_SUGGESTIONS = [
  'Should I switch my major?',
  'How do I split ch5 and ch6 before Friday?',
  'Is my z-score proof right?',
] as const;

const SEEN_KEY = 'squad.live.mic-intro';
const seenIntro = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

export interface LivePanelProps {
  hub: HubCtx | null;
  open: boolean;
  onClose(): void;
  calm?: boolean;
  returnFocusTo?: HTMLElement | null;
  chatId?: string;
  /** Skip the entry form and start with this topic. */
  topic?: string;
  /** Open an existing discussion (card, replay). */
  id?: string;
  /** Read a finished discussion; "Replay with captions" plays it back. */
  readOnly?: boolean;
  transport?: LiveTransport;
}

function RoomRunner({
  p,
  topic,
  mode,
  reduced,
  transport,
}: {
  p: LivePanelProps;
  topic: string;
  mode: LiveMode;
  reduced: boolean;
  transport: LiveTransport;
}) {
  const [replay, setReplay] = useState<{ n: number; tr: LiveTransport } | null>(null);
  const [snapTopic, setSnapTopic] = useState(topic);
  const tr = replay?.tr ?? transport;
  const live = useLiveDiscussion({
    transport: tr,
    ...(p.id
      ? { id: p.id }
      : { start: { topic, ...(p.chatId ? { chatId: p.chatId } : {}), mode } }),
    readOnly: !!p.readOnly && !replay,
    mode: replay ? 'captions' : mode,
  });
  const t = live.state.snapshot?.topic ?? snapTopic;
  useEffect(() => {
    if (live.state.snapshot?.topic) setSnapTopic(live.state.snapshot.topic);
  }, [live.state.snapshot?.topic]);

  const onReplay = () => {
    const snap = live.state.snapshot;
    if (!snap) return;
    const rp = mockLiveTransport({ replay: snap, wordMs: 60, gapMs: 250 });
    setReplay({ n: (replay?.n ?? 0) + 1, tr: rp });
  };
  const leave = async () => {
    await live.leave();
    p.onClose();
  };
  return (
    <LiveDiscussion
      key={replay?.n ?? 0}
      ctl={replay ? { ...live, readOnly: false } : live}
      topic={t || topic}
      reduced={reduced}
      onLeave={() => void leave()}
      {...(live.state.status === 'ended' && live.state.snapshot ? { onReplay } : {})}
      demoMock={tr.mock}
    />
  );
}

/**
 * The Live Discussion panel. Entry (topic, suggestions, audio or captions, one-time mic note), then the room.
 * A wide dock over the canvas; Esc leaves.
 */
export function LivePanel(p: LivePanelProps) {
  const { open, onClose, calm, returnFocusTo } = p;
  const reduced = usePrefersReducedMotion(calm);
  const transport = useLiveTransport(p.hub, p.transport);
  const titleId = useId();
  const inputId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  // citation chips open the source viewer; the village and chat pages have no host of their own
  const [ownHost] = useState(() => !hasSourceHost());
  const [draft, setDraft] = useState('');
  const [started, setStarted] = useState<{ topic: string; mode: LiveMode } | null>(null);
  const [mode, setMode] = useState<LiveMode>('audio');
  const [intro, setIntro] = useState(() => !seenIntro());
  const direct = !!p.id || !!p.topic;
  const ctxTopic = p.topic ?? '';

  useEffect(() => {
    if (!open) {
      setStarted(null);
      setDraft('');
    }
  }, [open]);

  const trimmed = draft.trim();
  const can = trimmed.length >= LIVE_TOPIC_MIN && trimmed.length <= LIVE_TOPIC_MAX;
  const begin = (e?: FormEvent) => {
    e?.preventDefault();
    if (!can) return;
    if (mode === 'audio' && intro) {
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* storage blocked */
      }
      setIntro(false);
    }
    setStarted({ topic: trimmed, mode });
  };
  const room = useMemo(
    () =>
      p.id
        ? { topic: p.topic ?? '', mode: 'captions' as LiveMode }
        : p.topic
          ? { topic: p.topic, mode }
          : started,
    [p.id, p.topic, mode, started],
  );

  return (
    <>
      <OverlayFrame
        open={open}
        onClose={() => {
          // leaving mid-discussion is handled by Room's own cleanup (stop is sent by the Leave button; Esc just closes)
          onClose();
        }}
        returnFocusTo={returnFocusTo}
        calm={calm}
        labelledBy={room ? 'ld-title' : titleId}
        placement="dock"
        fixed
        size="lg"
        dismissOnScrim={false}
        className={room || direct ? 'ld-panel ld-panel--room' : 'ld-panel'}
        initialFocus={() => area.current}
      >
        <button
          type="button"
          className="lv-btn lv-close"
          onClick={onClose}
          aria-label="Close the discussion"
        >
          <LvIcon name="x" size={20} />
        </button>
        {room || direct ? (
          <RoomRunner
            p={p}
            topic={room?.topic ?? ctxTopic}
            mode={room?.mode ?? 'captions'}
            reduced={reduced}
            transport={transport}
          />
        ) : (
          <div className="ld-entry">
            <span className="ld-door">
              <span className="ld-door__lamp" aria-hidden="true" />
              <span className="ld-pixel">Council Chamber</span>
            </span>
            <h2 id={titleId} className="ld-entry__title">
              Start a discussion
            </h2>
            <p className="ld-lede">
              Five study agents talk it through out loud or in captions. You can interrupt, ask one
              directly, and leave with takeaways.
            </p>
            <form onSubmit={begin} className="ld-entry__form">
              <label htmlFor={inputId} className="ld-eyebrow">
                What should they discuss?
              </label>
              <textarea
                id={inputId}
                ref={area}
                rows={3}
                value={draft}
                maxLength={LIVE_TOPIC_MAX}
                placeholder="Should I switch my major?"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) begin(e);
                }}
              />
              <div className="ld-chips" role="group" aria-label="Suggested topics">
                {LIVE_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="ld-chipbtn" onClick={() => setDraft(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <fieldset className="ld-modes">
                <legend className="ld-eyebrow">How do you want to join?</legend>
                <label className="ld-mode">
                  <input
                    type="radio"
                    name="ld-mode"
                    checked={mode === 'audio'}
                    onChange={() => setMode('audio')}
                  />
                  <span>
                    <b>Audio</b> and captions
                  </span>
                </label>
                <label className="ld-mode">
                  <input
                    type="radio"
                    name="ld-mode"
                    checked={mode === 'captions'}
                    onChange={() => setMode('captions')}
                  />
                  <span>
                    <b>Captions only</b>, no sound
                  </span>
                </label>
              </fieldset>
              {mode === 'audio' && intro && (
                <div className="ld-intro" role="note">
                  <LvIcon name="mic" size={16} />
                  <p>
                    If you talk, your voice is turned into text in your browser, and only that text
                    is sent. Audio is not recorded or kept. Nothing is heard unless you hold the
                    talk button.
                  </p>
                  <button type="button" className="lv-btn" onClick={() => setMode('captions')}>
                    Use text instead
                  </button>
                </div>
              )}
              <div className="ld-row">
                <button type="submit" className="lv-btn lv-btn--primary" disabled={!can}>
                  Start the discussion
                </button>
              </div>
              <p className="ld-fine">
                AI-generated. It can be wrong. Answers that cite your course show the page they came
                from.
              </p>
            </form>
          </div>
        )}
      </OverlayFrame>
      {ownHost && open && <SourceViewerHost />}
    </>
  );
}
