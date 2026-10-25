import { useState } from 'react';
import { LvIcon } from '../../overlays/kit/icons';
import { MIC_WORDS, type MicState } from './reducer';
import './live.css';

/**
 * Steer a running Live council: type, or hold the mic button (browser speech to text, nothing is recorded or sent as
 * audio). Only for the person who asked; the hub refuses everyone else.
 */
export function CouncilSayBar({
  mic,
  onSay,
  onTalkStart,
  onTalkStop,
}: {
  mic: MicState;
  onSay(text: string): Promise<boolean>;
  onTalkStart(): void;
  onTalkStop(): void;
}) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const ok = await onSay(t);
    setNote(
      ok
        ? 'Sent. The speaker stops and the chair answers.'
        : 'Could not send that. Only the person who asked can steer.',
    );
  };
  const disabled = mic === 'unavailable' || mic === 'permission_denied';
  return (
    <form
      className="cn-say"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="cn-sr" htmlFor="cn-say-input">
        Interrupt the council
      </label>
      <input
        id="cn-say-input"
        className="cn-say__input"
        value={text}
        maxLength={300}
        placeholder="Interrupt: type a question or a correction"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="lv-btn lv-btn--primary" disabled={!text.trim()}>
        Interrupt
      </button>
      <button
        type="button"
        className="lv-btn cn-say__talk"
        aria-pressed={mic === 'listening'}
        disabled={disabled}
        title={MIC_WORDS[mic]}
        onPointerDown={onTalkStart}
        onPointerUp={onTalkStop}
        onPointerLeave={() => mic === 'listening' && onTalkStop()}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && onTalkStart()}
        onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && onTalkStop()}
      >
        <LvIcon name="mic" size={16} />
        {mic === 'listening' ? 'Listening' : 'Hold to talk'}
      </button>
      <span className="cn-say__note" role="status">
        {note || MIC_WORDS[mic]}
      </span>
    </form>
  );
}
