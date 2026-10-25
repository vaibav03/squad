import { timedFetch } from '../../lib/http';
import { useEffect, useState } from 'react';
import { ChatMessageSchema, type ChatMessage } from '@squad/core';
import { z } from 'zod';

export interface InspectorHub {
  hubUrl: string;
  token: string | null;
}
const Body = z.object({ messages: z.array(ChatMessageSchema) });

/**
 * The viewer's own private chat with their study agent, from the hub's existing history endpoint. The hub only
 * answers for the signed-in student's own `dm:` chat, so another student's chat can never be fetched here.
 * Polls gently while `enabled` (the Chat tab is open on the viewer's own agent).
 */
export function useDmHistory(
  hub: InspectorHub | null | undefined,
  studentId: string | undefined,
  enabled: boolean,
  everyMs = 6000,
): { messages: ChatMessage[]; state: 'idle' | 'loading' | 'ok' | 'error' } {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const hubUrl = hub?.hubUrl;
  const token = hub?.token;
  useEffect(() => {
    if (!enabled || !hubUrl || !token || !studentId) return;
    let dead = false;
    const load = async () => {
      try {
        const r = await timedFetch(
          `${hubUrl.replace(/\/+$/, '')}/v1/chat/history?chatId=${encodeURIComponent(`dm:${studentId}`)}&limit=30`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!r.ok) throw new Error('history');
        const body = Body.parse(await r.json());
        if (!dead) {
          setMessages(body.messages);
          setState('ok');
        }
      } catch {
        if (!dead) setState('error');
      }
    };
    setState((s) => (s === 'ok' ? s : 'loading'));
    void load();
    const id = setInterval(() => !document.hidden && void load(), everyMs);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [enabled, hubUrl, token, studentId, everyMs]);
  return { messages, state };
}
