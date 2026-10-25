import { openBoard, getBoardStore } from '../../council/board/bridge';
import { getInspectorStore } from './bridge';

export interface OpenAgentPanelOpts {
  /** Room the agent sits in, when the click came from inside one. */
  slot?: string;
  /** Speaker key of the clicked seat. */
  who?: string;
}

/**
 * The one entry point for "focus this agent": portraits, names and chips anywhere (the deliberation surface, council
 * cards, feeds) call it. Opens the focused panel on Conversation, or swaps its content when it is already open.
 * Without a village inspector it falls back to the Council board's panel. Returns false when neither exists.
 */
export function openAgentPanel(agentId: string, opts: OpenAgentPanelOpts = {}): boolean {
  const s = getInspectorStore();
  if (s) {
    if (opts.slot !== undefined || opts.who)
      s.select(agentId, { slot: opts.slot ?? '', who: opts.who ?? '' });
    else s.select(agentId);
    return true;
  }
  if (getBoardStore()) {
    openBoard({ agent: agentId });
    return true;
  }
  return false;
}
