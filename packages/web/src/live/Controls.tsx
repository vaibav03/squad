import { useId, useState, type FormEvent } from 'react';
import { LIVE_SAY_MAX, type LivePersona, type LivePersonaId, type LiveSayBody } from '@squad/core';
import { LvIcon } from '../overlays/kit/icons';
import type { LiveController } from './useLiveDiscussion';

export type CaptionSize = 'S' | 'M' | 'L';

const QUICK: { kind: LiveSayBody['kind']; label: string; text: string }[] = [
  { kind: 'simpler', label: 'Explain simpler', text: 'Can you explain that more simply?' },
  { kind: 'lost', label: "I'm lost", text: "I'm lost. Can we go back and explain it again?" },
  { kind: 'disagree', label: 'Disagree', text: 'I disagree. Someone make the other case.' },
  { kind: 'summarize', label: 'Summarize so far', text: 'Can you summarize where we are so far?' },
];

export function Controls({
  ctl,
  personas,
  ask,
  onAsk,
  size,
  onSize,
  onLeave,
  speaking,
}: {
  ctl: LiveController;
  personas: readonly LivePersona[];
  ask: LivePersonaId | null;
  onAsk(id: LivePersonaId | null): void;
  size: CaptionSize;
  onSize(s: CaptionSize): void;
  onLeave(): void;
  /** Someone has the floor right now. */
  speaking: boolean;
}) {
  const [text, setText] = useState('');
  const inputId = useId();
  const askId = useId();
  const ended = ctl.state.status === 'ended' || ctl.state.status === 'unavailable' || ctl.readOnly;
  const off = ended;
  const audioOn = ctl.player.enabled;
  const muted = ctl.sound === 'muted';
  const listening = ctl.talk === 'listening';

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || off) return;
    setText('');
    void ctl.say(t, { ...(ask ? { to: ask } : {}) });
  };
  const quick = (q: (typeof QUICK)[number]) =>
    void ctl.say(q.text, { kind: q.kind, ...(ask ? { to: ask } : {}) });

  return (
    <div className="ld-controls" role="group" aria-label="Join the discussion">
      {ctl.sound === 'locked' && (
        <button
          type="button"
          className="lv-btn lv-btn--primary ld-unlock"
          onClick={ctl.enableSound}
        >
          <LvIcon name="sparkle" size={16} />
          Tap to enable sound
        </button>
      )}
      {!audioOn && !ctl.readOnly && (
        <p className="ld-note" role="status">
          <LvIcon name="info" size={14} />
          Captions only. Nothing will play out loud.
        </p>
      )}

      <div className="ld-controls__row">
        <button
          type="button"
          className="lv-btn ld-talk"
          data-listening={listening || undefined}
          aria-pressed={listening}
          disabled={off || ctl.talk === 'unsupported' || ctl.talk === 'denied'}
          onPointerDown={(e) => {
            e.preventDefault();
            ctl.talkStart();
          }}
          onPointerUp={ctl.talkStop}
          onPointerLeave={() => listening && ctl.talkStop()}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              if (!e.repeat) ctl.talkStart();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') ctl.talkStop();
          }}
        >
          <LvIcon
            name={ctl.talk === 'denied' || ctl.talk === 'unsupported' ? 'mic-off' : 'mic'}
            size={16}
          />
          {listening ? 'Listening...' : 'Hold to talk (Space)'}
          <span className="ld-meter" aria-hidden="true">
            <span
              style={{ transform: `scaleX(${listening ? Math.max(0.04, ctl.micLevel) : 0})` }}
            />
          </span>
        </button>
        <button
          type="button"
          className="lv-btn"
          disabled={off || !speaking}
          onClick={() => void ctl.say('Hold on, I want to jump in.')}
        >
          <LvIcon name="hand" size={16} />
          Interrupt
        </button>
        <button
          type="button"
          className="lv-btn"
          aria-pressed={muted}
          disabled={!audioOn}
          title={audioOn ? undefined : 'Captions only'}
          onClick={() => ctl.setMuted(!muted)}
        >
          <LvIcon name={muted ? 'eye-off' : 'eye'} size={16} />
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <div className="ld-seg" role="radiogroup" aria-label="Caption size">
          {(['S', 'M', 'L'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={size === s}
              aria-label={`Caption size ${s === 'S' ? 'small' : s === 'M' ? 'medium' : 'large'}`}
              className="ld-seg__btn"
              onClick={() => onSize(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button type="button" className="lv-btn lv-btn--danger" onClick={onLeave}>
          <LvIcon name="phone-off" size={16} />
          Leave
        </button>
      </div>

      {(ctl.talk === 'denied' || ctl.talk === 'unsupported') && (
        <p className="ld-note ld-note--warn" role="status">
          <LvIcon name="mic-off" size={14} />
          {ctl.talk === 'denied'
            ? 'Mic denied: use text instead. You can allow the mic in the browser address bar.'
            : 'This browser cannot turn speech into text: use text instead.'}
        </p>
      )}

      <form className="ld-controls__row ld-say" onSubmit={submit}>
        <label className="ld-ask" htmlFor={askId}>
          <span className="ld-eyebrow">Ask</span>
          <select
            id={askId}
            value={ask ?? ''}
            onChange={(e) => onAsk((e.target.value || null) as LivePersonaId | null)}
          >
            <option value="">Everyone</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.glyph} {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lv-vh" htmlFor={inputId}>
          Say something to the table
        </label>
        <input
          id={inputId}
          className="ld-input"
          type="text"
          value={text}
          maxLength={LIVE_SAY_MAX}
          disabled={off}
          placeholder={
            ask
              ? `Say something to ${personas.find((p) => p.id === ask)?.name}`
              : 'Say something to the table'
          }
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="lv-btn lv-btn--primary" disabled={off || !text.trim()}>
          <LvIcon name="plane" size={16} />
          Send
        </button>
      </form>

      <div className="ld-controls__row ld-quick" role="group" aria-label="Quick actions">
        {QUICK.map((q) => (
          <button
            key={q.kind}
            type="button"
            className="ld-chipbtn"
            disabled={off}
            onClick={() => quick(q)}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
