import { useEffect } from 'react';

/** Window event: put text in the group chat composer (opens the chat dock when it is closed). `detail: { text }`. */
export const CHAT_PREFILL_EVENT = 'squad:chat-prefill';

export function requestChatPrefill(text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHAT_PREFILL_EVENT, { detail: { text } }));
}

/** Subscribe to prefill requests; `onText` receives the draft text. */
export function useChatPrefill(onText: (text: string) => void): void {
  useEffect(() => {
    const on = (e: Event) => {
      const text = (e as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text === 'string') onText(text);
    };
    window.addEventListener(CHAT_PREFILL_EVENT, on);
    return () => window.removeEventListener(CHAT_PREFILL_EVENT, on);
  }, [onText]);
}
