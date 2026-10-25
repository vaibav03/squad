import type { OverlayRequest } from '../adapter';

/** Typed events handed to the host's `onOverlay` (spec 09, 'Overlay panels'). */
export type OverlayEvent =
  | { type: 'openCall'; agent: string; callId: string }
  | { type: 'openQuiz'; quizId: string; chapter: string }
  | { type: 'openLedger'; taskId: string }
  | { type: 'openConfirm'; taskId: string; question: string }
  | { type: 'focusAgent'; agent: string }
  | { type: 'closeOverlay'; which?: 'call' | 'quiz' | 'ledger' | 'confirm' };
export type OverlayHandler = (e: OverlayEvent) => void;
export type OverlayKind = 'call' | 'quiz' | 'ledger' | 'confirm';

export interface OverlayBridgeOptions {
  onOverlay: OverlayHandler;
  pauseInput?: () => void;
  resumeInput?: () => void;
  focusCanvas?: () => void;
}

export interface OverlayBridge {
  /** Execute an adapter `openOverlay` request. */
  handle(req: OverlayRequest): void;
  /** Direct entry points for the notice board and Enter key. */
  openLedger(taskId: string): void;
  openFromAgent(agentId: string, callId?: string): void;
  /** The host reports that the overlay is gone (user closed it, or call ended). */
  closed(which?: OverlayKind): void;
  readonly open: OverlayKind | undefined;
  dispose(): void;
}

const kindOf = (e: OverlayEvent): OverlayKind | undefined =>
  e.type === 'openCall'
    ? 'call'
    : e.type === 'openQuiz'
      ? 'quiz'
      : e.type === 'openLedger'
        ? 'ledger'
        : e.type === 'openConfirm'
          ? 'confirm'
          : undefined;
const keyOf = (e: OverlayEvent): string =>
  e.type === 'openCall'
    ? `call:${e.callId}`
    : e.type === 'openQuiz'
      ? `quiz:${e.quizId}`
      : e.type === 'openLedger'
        ? `ledger:${e.taskId}`
        : e.type === 'openConfirm'
          ? `confirm:${e.taskId}`
          : e.type;

/**
 * One overlay at a time (quiz and call never stack). Requests that arrive while one is open queue
 * FIFO and open when the host reports closure. Identical requests are deduped. The bridge never
 * invents a request: it only relays adapter/user intents.
 */
export function createOverlayBridge(opts: OverlayBridgeOptions): OverlayBridge {
  let current: { kind: OverlayKind; key: string } | undefined;
  const queue: OverlayEvent[] = [];
  let disposed = false;

  const show = (e: OverlayEvent) => {
    const kind = kindOf(e)!;
    current = { kind, key: keyOf(e) };
    opts.pauseInput?.();
    opts.onOverlay(e);
  };
  const request = (e: OverlayEvent) => {
    if (disposed) return;
    const key = keyOf(e);
    if (current?.key === key || queue.some((q) => keyOf(q) === key)) return;
    if (current) queue.push(e);
    else show(e);
  };
  const dequeue = () => {
    const next = queue.shift();
    if (next) show(next);
    else {
      opts.resumeInput?.();
      opts.focusCanvas?.();
    }
  };

  return {
    handle(req) {
      if (disposed) return;
      switch (req.overlay) {
        case 'openCall':
          return request({ type: 'openCall', agent: req.agent, callId: req.callId });
        case 'openQuiz':
          return request({ type: 'openQuiz', quizId: req.quizId, chapter: req.chapter });
        case 'openLedger':
          return request({ type: 'openLedger', taskId: req.taskId });
        case 'openConfirm':
          return request({ type: 'openConfirm', taskId: req.taskId, question: req.question });
        case 'close': {
          // drop queued ones of that kind; if it is the open one, tell the host and move on
          for (let i = queue.length - 1; i >= 0; i--)
            if (kindOf(queue[i]!) === req.which) queue.splice(i, 1);
          if (current?.kind === req.which) {
            opts.onOverlay({ type: 'closeOverlay', which: req.which });
            current = undefined;
            dequeue();
          }
          return;
        }
      }
    },
    openLedger(taskId) {
      request({ type: 'openLedger', taskId });
    },
    openFromAgent(agentId, callId) {
      if (callId) request({ type: 'openCall', agent: agentId, callId });
      else if (!disposed) opts.onOverlay({ type: 'focusAgent', agent: agentId });
    },
    closed(which) {
      if (!current || (which && current.kind !== which)) return;
      current = undefined;
      dequeue();
    },
    get open() {
      return current?.kind;
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      current = undefined;
    },
  };
}
