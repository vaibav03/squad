import { PROVENANCE_MODE_LABELS, type ChatMessage } from '@squad/core';
import './provenance.css';

export const LEGACY_PROVENANCE = 'Provenance not recorded';

/**
 * The footer row of every bot reply: how many verified sources, which mode answered (Live / Degraded / Demo) and the
 * channel it travelled over. A reply that is not grounded says so in words (docs/provenance.md).
 */
export function ProvenanceRow({ message }: { message: ChatMessage }) {
  const p = message.provenance;
  if (!p)
    return (
      <div
        className="sqp"
        data-testid="chat-provenance"
        data-kind="unrecorded"
        role="note"
        aria-label="Provenance"
      >
        <span className="sqp__label is-plain" data-testid="chat-provenance-label">
          {LEGACY_PROVENANCE}
        </span>
      </div>
    );
  const via = p.via ?? message.transport ?? 'web';
  const grounded = p.kind === 'grounded';
  return (
    <div
      className={`sqp sqp--${p.kind}`}
      data-testid="chat-provenance"
      data-kind={p.kind}
      data-mode={p.mode}
      role="note"
      aria-label="Provenance"
    >
      <span
        className={`sqp__label${grounded ? '' : ' is-warn'}`}
        data-testid="chat-provenance-label"
      >
        {p.label}
      </span>
      <span className={`sqp__mode sqp__mode--${p.mode}`} data-testid="chat-provenance-mode">
        {PROVENANCE_MODE_LABELS[p.mode]}
      </span>
      <span className="sqp__via" data-testid="chat-provenance-via">
        {via === 'imessage' ? 'via iMessage' : 'via web'}
      </span>
    </div>
  );
}
