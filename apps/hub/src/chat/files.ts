// Chat files: uploads (images for Step Diff) and bot attachments (podcast audio, explainer PNG). Every file is
// COPIED into the hub's data dir under a random 128-bit token, so names are unguessable and the bot's temp files
// can disappear. Access is checked per viewer (uploader before the message is sent, then the chat's audience).
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@squad/core';
import type { ChatAttachment } from '@squad/core';
import { canAccessChat } from './access';
import { CHAT_SCHEMA } from './store';

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
};
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const kindOf = (mime: string): ChatAttachment['kind'] =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'file';

export interface ResolvedFile {
  path: string;
  mime: string;
  name?: string;
}
export interface ChatFiles {
  /** A viewer's upload, readable only by them until a message in a chat claims it. */
  saveUpload(owner: string, bytes: Uint8Array, mime: string, name?: string): ChatAttachment;
  /** A file the bot produced, posted into `chatId`. Copies it. */
  adopt(localPath: string, mime: string, chatId: string): ChatAttachment | undefined;
  /** Attach pending uploads of `owner` to a chat message; returns their local paths for the bot. */
  claim(
    owner: string,
    ids: string[],
    chatId: string,
  ): { attachments: ChatAttachment[]; paths: { path: string; mime: string }[] } | undefined;
  /** The file if the viewer may read it, else undefined (no oracle: unknown and forbidden look the same). */
  open(token: string, viewer: { studentId: string; squadId: string }): ResolvedFile | undefined;
}

export function createChatFiles(db: Db, dir: string, now: () => number = Date.now): ChatFiles {
  db.exec(CHAT_SCHEMA);
  mkdirSync(dir, { recursive: true });
  const put = db.prepare(
    'INSERT INTO hub_chat_files(token, file, mime, name, bytes, owner, chat_id, created_at) VALUES(?,?,?,?,?,?,?,?)',
  );
  const get = db.prepare(
    'SELECT token, file, mime, name, bytes, owner, chat_id FROM hub_chat_files WHERE token=?',
  );
  const setChat = db.prepare(
    'UPDATE hub_chat_files SET chat_id=? WHERE token=? AND owner=? AND chat_id IS NULL',
  );
  type Row = {
    token: string;
    file: string;
    mime: string;
    name: string | null;
    bytes: number;
    owner: string;
    chat_id: string | null;
  };
  const att = (r: Row): ChatAttachment => ({
    id: r.token,
    kind: kindOf(r.mime),
    mime: r.mime,
    ...(r.name ? { name: r.name } : {}),
    bytes: r.bytes,
    url: `/v1/chat/files/${r.token}`,
  });
  const token = () => randomBytes(16).toString('hex');
  const safeName = (n?: string) => (n ? n.replace(/[^\w .-]/g, '_').slice(0, 80) : undefined);

  return {
    saveUpload(owner, bytes, mime, name) {
      const t = token();
      const file = `${t}${EXT[mime] ?? '.bin'}`;
      writeFileSync(join(dir, file), bytes);
      put.run(t, file, mime, safeName(name) ?? null, bytes.byteLength, owner, null, now());
      return att({
        token: t,
        file,
        mime,
        name: safeName(name) ?? null,
        bytes: bytes.byteLength,
        owner,
        chat_id: null,
      });
    },
    adopt(localPath, mime, chatId) {
      if (!existsSync(localPath)) return undefined;
      const size = statSync(localPath).size;
      const t = token();
      const file = `${t}${EXT[mime] ?? '.bin'}`;
      copyFileSync(localPath, join(dir, file));
      put.run(t, file, mime, null, size, 'bot', chatId, now());
      return att({ token: t, file, mime, name: null, bytes: size, owner: 'bot', chat_id: chatId });
    },
    claim(owner, ids, chatId) {
      const attachments: ChatAttachment[] = [];
      const paths: { path: string; mime: string }[] = [];
      for (const id of ids) {
        const r = get.get(id) as Row | undefined;
        if (!r || r.owner !== owner || r.chat_id !== null) return undefined;
        attachments.push(att(r));
        paths.push({ path: join(dir, r.file), mime: r.mime });
      }
      for (const id of ids) setChat.run(chatId, id, owner);
      return { attachments, paths };
    },
    open(tokenId, viewer) {
      if (!/^[0-9a-f]{32}$/.test(tokenId)) return undefined;
      const r = get.get(tokenId) as Row | undefined;
      if (!r) return undefined;
      const allowed =
        r.chat_id === null ? r.owner === viewer.studentId : canAccessChat(viewer, r.chat_id);
      if (!allowed) return undefined;
      const path = join(dir, r.file);
      return existsSync(path)
        ? { path, mime: r.mime, ...(r.name ? { name: r.name } : {}) }
        : undefined;
    },
  };
}
