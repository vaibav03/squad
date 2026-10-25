// CANDIDATE FOR @squad/village-shared: Phaser-free and world-agnostic. Semantics copied from
// packages/village (ws/village-mesh) overlay-bridge: one overlay at a time, FIFO queue, dedupe.
import type { OverlayEvent } from '../api';

export type OverlayKind = 'call' | 'quiz' | 'ledger' | 'confirm';

export interface OverlayBridgeOptions {
  onOverlay: (e: OverlayEvent) => void;
  pauseInput?: () => void;
  resumeInput?: () => void;
  focusCanvas?: () => void;
}

export interface OverlayBridge {
  request(e: OverlayEvent): void;
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

const keyOf = (e: OverlayEvent): string => {
  switch (e.type) {
    case 'openCall':
      return `call:${e.callId}`;
    case 'openQuiz':
      return `quiz:${e.quizId}`;
    case 'openLedger':
      return `ledger:${e.taskId}`;
    case 'openConfirm':
      return `confirm:${e.taskId}`;
    case 'focusAgent':
      return `focus:${e.agent}`;
    case 'closeOverlay':
      return 'close';
  }
};

export function createOverlayBridge(opts: OverlayBridgeOptions): OverlayBridge {
  let current: { kind: OverlayKind; key: string } | undefined;
  const queue: OverlayEvent[] = [];
  let disposed = false;

  const show = (e: OverlayEvent, kind: OverlayKind) => {
    current = { kind, key: keyOf(e) };
    opts.pauseInput?.();
    opts.onOverlay(e);
  };
  const dequeue = () => {
    const next = queue.shift();
    const k = next && kindOf(next);
    if (next && k) show(next, k);
    else {
      opts.resumeInput?.();
      opts.focusCanvas?.();
    }
  };

  return {
    request(e) {
      if (disposed) return;
      const kind = kindOf(e);
      if (!kind) {
        // focusAgent / closeOverlay are not modal: relay straight through.
        opts.onOverlay(e);
        return;
      }
      const key = keyOf(e);
      if (current?.key === key || queue.some((q) => keyOf(q) === key)) return;
      if (current) queue.push(e);
      else show(e, kind);
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
