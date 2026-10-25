// "Ask Cubbie" handoff between an imported-item UI (Connections, Home) and the chat composer.
// The item UI calls `queueAskCubbie` and navigates to the chat; the composer for that chat takes it on mount, asks the hub
// for a VERIFIED context ref, shows a removable chip and prefills (never sends) the prompt.
import type { ChatContextRef } from '@squad/core';

export const PENDING_CONTEXT_KEY = 'squad.pendingContext';

export interface PendingAsk {
  /** `group:<squad>` or `dm:<student>`; defaults to the DM with Cubbie when omitted. */
  chatId: string;
  sourceIds: { sourceId: string; anchor?: string }[];
  prefill?: string;
}

export function queueAskCubbie(p: PendingAsk): void {
  try {
    sessionStorage.setItem(PENDING_CONTEXT_KEY, JSON.stringify(p));
  } catch {
    // storage blocked: the composer simply opens without a chip
  }
}

/** Reads the queued ask when it is for this chat and clears it (a refresh never re-attaches it). */
export function takePendingAsk(chatId: string): PendingAsk | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CONTEXT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingAsk;
    if (!p || typeof p.chatId !== 'string' || !Array.isArray(p.sourceIds)) {
      sessionStorage.removeItem(PENDING_CONTEXT_KEY);
      return null;
    }
    if (p.chatId !== chatId) return null;
    sessionStorage.removeItem(PENDING_CONTEXT_KEY);
    return { ...p, sourceIds: p.sourceIds.slice(0, 3) };
  } catch {
    return null;
  }
}

export const defaultPrefill = (title: string): string => `@cubbie what should I focus on for ${title}?`;

export const provenanceBadge = (p: ChatContextRef['provenance']): string =>
  p === 'fixture' ? 'Fixture (simulated)' : 'Real';
