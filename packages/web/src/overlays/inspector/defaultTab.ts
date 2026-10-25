export type InspectorTab = 'doing' | 'thinking' | 'chat' | 'agents';

/**
 * Which tab the inspector opens on.
 * - A click on an agent INSIDE a room (the room's seat click passes `initialTab: 'chat'`) opens the Chat tab, the room
 *   conversation, whatever the agent is doing.
 * - A click on a village sprite, chip or avatar, including a name chip in the room info panel, keeps the names rule for council voices:
 *   Thinking when the agent is thinking now or has a thought on record, otherwise Chat.
 * - Anything else (null) leaves the tab as it is.
 */
export function defaultTab(
  initialTab: 'chat' | undefined,
  voice: { thinking: boolean; hasThought: boolean } | null,
): InspectorTab | null {
  if (initialTab) return initialTab;
  if (!voice) return null;
  return voice.thinking || voice.hasThought ? 'thinking' : 'chat';
}
