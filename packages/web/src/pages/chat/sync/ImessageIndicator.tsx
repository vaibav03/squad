import { useEffect, useState } from 'react';
import { imessageIndicator, type ImessageStatus } from '@squad/core';
import './sync.css';

export interface ImessageIndicatorProps {
  status: ImessageStatus | null;
  chatId: string;
  /** compact (the dock) drops the setup link text to a short word */
  compact?: boolean;
  now?: () => number;
}

const GLYPH: Record<string, string> = {
  web_only: 'o',
  not_connected: '!',
  dry_run: '~',
  connected: '+',
  fixture: '#',
  degraded: 'x',
};

/** Header chip: where this thread's messages go beyond the web. Words first, a dot second (never colour alone). */
export function ImessageIndicator({
  status,
  chatId,
  compact,
  now = Date.now,
}: ImessageIndicatorProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const kind = chatId.startsWith('dm:') ? 'dm' : 'group';
  const squadId = chatId.startsWith('group:') ? chatId.slice(6) : undefined;
  const ind = imessageIndicator(status, { kind, squadId }, now());
  return (
    <span
      className={`sqs-ind sqs-ind--${ind.state}`}
      data-testid="chat-imessage-indicator"
      data-state={ind.state}
      title={ind.detail}
      aria-label={`${ind.label}. ${ind.detail}`}
      role="status"
    >
      <span className="sqs-ind__dot" aria-hidden="true">
        {GLYPH[ind.state]}
      </span>
      <span className="sqs-ind__label">{ind.label}</span>
      {ind.setup ? (
        <a
          className="sqs-ind__setup"
          href="/squad/connections#imessage"
          data-testid="chat-imessage-setup"
        >
          {compact ? 'Setup' : 'Set up'}
        </a>
      ) : null}
    </span>
  );
}
