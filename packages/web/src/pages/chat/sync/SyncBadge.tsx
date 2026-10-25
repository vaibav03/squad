import type { DeliveryState, SkippedAttachment, Transport } from '@squad/core';
import './sync.css';

export interface SyncBadgeProps {
  transport?: Transport;
  provider?: 'sendblue' | 'photon' | 'fixture';
  deliveryState?: DeliveryState;
  senderLabel?: string;
  skippedAttachments?: SkippedAttachment[];
  receivedLate?: boolean;
  onRetry?: () => void;
  compact?: boolean;
  /** the message head already says `via iMessage`: do not repeat the chip */
  hideVia?: boolean;
}

const SKIP_REASON: Record<SkippedAttachment['reason'], string> = {
  unsupported_type: 'this file type is not supported',
  too_large: 'file is too large',
  unavailable: 'file is unavailable',
};

/** Sync info for one chat message. Renders null when there is nothing to show. */
export function SyncBadge(p: SyncBadgeProps) {
  const ds = p.deliveryState;
  const skipped = p.skippedAttachments ?? [];
  const viaIm = p.transport === 'imessage';
  const showSender = !p.compact && viaIm && !!p.senderLabel;
  if (!(viaIm && (!p.hideVia || showSender)) && !ds && skipped.length === 0 && !p.receivedLate)
    return null;
  return (
    <div className="sqs" role="status" aria-label="iMessage sync">
      {viaIm && !p.hideVia && (
        <span className="sqs__chip">
          {p.provider === 'sendblue'
            ? 'via iMessage (Sendblue)'
            : p.provider === 'fixture'
              ? 'via iMessage (demo)'
              : 'via iMessage'}
        </span>
      )}
      {showSender && <span className="sqs__from">{p.senderLabel}</span>}
      {ds && (
        <span className={`sqs__state sqs__state--${ds.state}`} data-state={ds.state}>
          {ds.label}
          {ds.state === 'failed' && p.onRetry && (
            <button type="button" className="sqs__retry" onClick={p.onRetry}>
              Retry
            </button>
          )}
        </span>
      )}
      {skipped.map((a, i) => (
        <span key={i} className="sqs__skip">
          Attachment not shown: {SKIP_REASON[a.reason]}
        </span>
      ))}
      {p.receivedLate && <span className="sqs__late">arrived late</span>}
    </div>
  );
}
