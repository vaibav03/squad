import { createContext, useContext } from 'react';

/** What a structured chat card may ask of the thread (provided by the thread, absent in tests/other hosts). */
export interface ChatCardActions {
  /** put text in the composer without sending */
  fill(text: string): void;
  /** open a verified source (page sheet or source viewer) */
  cite(c: { file: string; page: number; label: string }): void;
}
export const ChatCardActionsContext = createContext<ChatCardActions | null>(null);
export const useChatCardActions = () => useContext(ChatCardActionsContext);
