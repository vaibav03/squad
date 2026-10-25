import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSummary } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { TypingIndicator } from './parts';
import { waitingTriggers, waitPhase, type ThreadItem } from './model';
import type { ChatController } from './useChat';

/**
 * ONE placeholder per trigger message while the answer has not arrived: "thinking", then (8 s) elapsed time and "taking
 * longer than usual" with Retry, then (or on a failed retry) a single "Could not get an answer" row with Retry. Retry
 * re-sends the SAME clientId, so it can never create a second prompt. Never stacked, never repeated fallback blocks.
 */
export function AnswerWait({
  chat,
  ctl,
  items,
  reduced,
  typing,
}: {
  chat: ChatSummary;
  ctl: ChatController;
  items: readonly ThreadItem[];
  reduced: boolean;
  typing: { personaId: string; name: string }[];
}) {
  const [now, setNow] = useState(() => Date.now());
  const restarted = useRef(new Map<string, number>());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const isDm = chat.kind === 'dm';
  const waiting = useMemo(
    () => waitingTriggers(items, ctl.me, isDm, now, (id, ts) => restarted.current.get(id) ?? ts),
    [items, ctl.me, isDm, now],
  );
  useEffect(() => {
    if (!waiting.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting.length]);

  if (!waiting.length) return <TypingIndicator names={typing} reduced={reduced} />;
  const retry = async (id: string) => {
    const it = items.find((i) => i.message.id === id);
    if (!it) return;
    setBusy((b) => ({ ...b, [id]: true }));
    setFailed(({ [id]: _x, ...rest }) => (void _x, rest));
    restarted.current.set(id, Date.now());
    setNow(Date.now());
    const ok = await ctl.retryAnswer(chat.id, it.message);
    setBusy(({ [id]: _y, ...rest }) => (void _y, rest));
    if (!ok)
      setFailed((f) => ({
        ...f,
        [id]: ctl.online ? 'the connection to Cubbie did not respond' : 'you are offline',
      }));
  };
  return (
    <>
      {waiting.map((w) => {
        const elapsed = now - w.since;
        const reason = failed[w.id];
        const phase = waitPhase(elapsed, !!reason);
        const secs = Math.floor(elapsed / 1000);
        return (
          <div
            key={w.id}
            className={`sqc-wait is-${phase}`}
            data-testid="chat-wait"
            data-trigger={w.id}
            data-phase={phase}
            role="status"
          >
            {phase === 'failed' ? (
              <>
                <Icon name="alert" size={14} />
                <span data-testid="chat-wait-text">
                  Could not get an answer: {reason ?? 'no reply came back'}
                </span>
              </>
            ) : phase === 'slow' ? (
              <span data-testid="chat-wait-text">
                Cubbie is thinking… {secs}s. This is taking longer than usual
              </span>
            ) : (
              <span data-testid="chat-wait-text">Cubbie is thinking…</span>
            )}
            {phase !== 'thinking' ? (
              <button
                type="button"
                className="sqc-link"
                data-testid="chat-wait-retry"
                disabled={busy[w.id]}
                onClick={() => void retry(w.id)}
              >
                Retry
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
