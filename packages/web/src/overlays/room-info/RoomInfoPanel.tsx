import { useId, useRef, useState, type CSSProperties } from 'react';
import type { RoomInfo } from '@squad/village/rooms';
import { OverlayFrame, LvIcon } from '../kit';
import { SpeakerDot } from './RoomTranscript';
import { InspectableVoice } from '../inspector/InspectableVoice';
import { CastAvatar, CAST_STATE_LABEL, castName } from '../../components/cast-avatar';
import './room-info.css';

export interface RoomInfoPanelProps {
  info: RoomInfo;
  open: boolean;
  onClose: () => void;
  /** Runs the room's phrase. When absent there is no Run it button. */
  onRun?: (phrase: string) => void;
  returnFocusTo?: HTMLElement | null;
  calm?: boolean;
  /** Who is speaking right now in the live room ('chill', 'Grind', 'chair'...); that member's avatar plays its talking loop. */
  speaking?: string | null;
  /** Optional extra button under the room header (e.g. "Ask the council"). */
  extraAction?: { label: string; onClick: () => void };
}

/** Copy to the clipboard; falls back to a hidden textarea. Never throws. Resolves true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function RoomInfoPanel(props: RoomInfoPanelProps) {
  const { info, open, onClose, onRun, returnFocusTo, calm, extraAction, speaking } = props;
  const speakingId = speaking ? castName(speaking) : undefined;
  const titleId = useId();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phrase = info.how.phrase;

  const copy = async () => {
    if (!phrase) return;
    const ok = await copyText(phrase);
    setCopied(ok ? 'ok' : 'fail');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied('idle'), 1800);
  };

  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy={titleId}
      placement="dock"
      size="md"
      className="rr-panel"
    >
      <span className="lv-grip" aria-hidden="true" />
      <button type="button" className="lv-btn lv-close" onClick={onClose} aria-label="Close">
        <LvIcon name="x" size={20} />
      </button>
      <div className="rr-panel__body">
        <header className="rr-panel__head">
          <h2 id={titleId} className="rr-panel__title">
            {info.title}
          </h2>
          <p className="rr-panel__tagline">{info.tagline}</p>
          {extraAction ? (
            <button
              type="button"
              className="lv-btn lv-btn--primary rr-ask"
              onClick={extraAction.onClick}
            >
              <LvIcon name="users" size={18} />
              {extraAction.label}
            </button>
          ) : null}
        </header>

        <section className="rr-sec">
          <h3 className="rr-sec__h">What this room is for</h3>
          <p className="rr-sec__p">{info.purpose}</p>
        </section>

        <section className="rr-sec">
          <h3 className="rr-sec__h">Who is in here and what they do for you</h3>
          <ul className="rr-who">
            {info.who.map((w, i) => {
              const id = castName(w.name);
              const state = id && id === speakingId ? 'talk' : 'idle';
              return (
                <li
                  key={w.name}
                  className="rr-who__row"
                  data-cast={id}
                  data-calm={calm ? 'true' : undefined}
                  style={{ '--i': i } as CSSProperties}
                >
                  {id ? (
                    <InspectableVoice who={id} name={castName(w.name) ? w.name : id} slot={info.slot}>
                      <CastAvatar
                        name={id}
                        state={state}
                        size={2}
                        calm={calm}
                        className="rr-who__avatar"
                      />
                    </InspectableVoice>
                  ) : (
                    <SpeakerDot who={w.name} />
                  )}
                  <span>
                    <strong>{w.name}</strong>
                    {id ? (
                      <span className="rr-who__state">{CAST_STATE_LABEL[state]}</span>
                    ) : null}{' '}
                    <span className="rr-dim">{w.does}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rr-sec">
          <h3 className="rr-sec__h">How to use it</h3>
          {phrase ? (
            <div className="rr-how">
              <p className="rr-how__label">Say this in chat</p>
              <div className="rr-how__row">
                <code className="rr-phrase" data-testid="room-phrase">
                  {phrase}
                </code>
                <button type="button" className="lv-btn rr-copy" onClick={copy}>
                  <LvIcon name="file" size={18} />
                  {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy'}
                </button>
                {onRun ? (
                  <button
                    type="button"
                    className="lv-btn lv-btn--primary rr-run"
                    onClick={() => onRun(phrase)}
                  >
                    <LvIcon name="chevron" size={18} />
                    Run it
                  </button>
                ) : null}
              </div>
              <span className="lv-vh" role="status" aria-live="polite">
                {copied === 'ok' ? 'Copied to clipboard' : ''}
              </span>
            </div>
          ) : null}
          <ol className="rr-steps">
            {info.how.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>

        <section className="rr-sec">
          <h3 className="rr-sec__h">What you get at the end</h3>
          <p className="rr-sec__p">{info.outcome}</p>
        </section>

        <section className="rr-sec rr-sec--privacy">
          <h3 className="rr-sec__h">
            <LvIcon name="lock" size={14} /> Privacy
          </h3>
          <p className="rr-sec__p rr-dim">{info.privacy}</p>
        </section>
      </div>
    </OverlayFrame>
  );
}
