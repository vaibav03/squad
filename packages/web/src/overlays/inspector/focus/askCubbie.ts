import { closeBoard } from '../../../council/board/bridge';
import { getInspectorStore } from '../bridge';

/** Window event the chat dock listens for: open the squad group chat composer. */
export const ASK_CUBBIE_EVENT = 'squad:ask-cubbie';

/**
 * Opens the group chat composer (the focused panel and the board step aside so the dock is not folded away).
 * Returns false when no chat dock is mounted to answer.
 */
export function askCubbie(): boolean {
  let handled = false;
  const mark = () => {
    handled = true;
  };
  window.addEventListener(`${ASK_CUBBIE_EVENT}:ack`, mark, { once: true });
  getInspectorStore()?.select(null);
  closeBoard();
  window.dispatchEvent(new CustomEvent(ASK_CUBBIE_EVENT));
  window.removeEventListener(`${ASK_CUBBIE_EVENT}:ack`, mark);
  return handled;
}
