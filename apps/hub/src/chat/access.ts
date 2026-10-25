// Who may see which chat. The ONE rule behind the stream, history, chat list and file routes.
import type { Viewer } from '../types';

export const groupChatId = (squadId: string): string => `group:${squadId}`;
export const dmChatId = (studentId: string): string => `dm:${studentId}`;

/** A group chat belongs to its squad; a DM belongs to exactly one student. Default deny. */
export function canAccessChat(
  viewer: Pick<Viewer, 'studentId' | 'squadId'>,
  chatId: string,
): boolean {
  if (chatId.startsWith('group:')) return chatId === groupChatId(viewer.squadId);
  if (chatId.startsWith('dm:')) return chatId === dmChatId(viewer.studentId);
  return false;
}

/** The chat ids a viewer may read. */
export function chatIdsOf(viewer: Pick<Viewer, 'studentId' | 'squadId'>): string[] {
  return [groupChatId(viewer.squadId), dmChatId(viewer.studentId)];
}
