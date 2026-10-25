import type { Db } from '@squad/core';
import { ChatMessageSchema, type ChatCard, type ChatMessage } from '@squad/core';

export const CHAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS hub_chat_messages(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, ts INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hub_chat_messages_chat ON hub_chat_messages(chat_id, seq);
CREATE TABLE IF NOT EXISTS hub_chat_files(
  token TEXT PRIMARY KEY, file TEXT NOT NULL, mime TEXT NOT NULL, name TEXT, bytes INTEGER NOT NULL,
  owner TEXT NOT NULL, chat_id TEXT, created_at INTEGER NOT NULL);
`;

export type NewMessage = Omit<ChatMessage, 'id' | 'seq'>;

export interface ChatStore {
  append(m: NewMessage): ChatMessage;
  get(id: string): ChatMessage | undefined;
  updateCard(id: string, card: ChatCard): ChatMessage | undefined;
  /** Oldest first. `before` is exclusive. */
  history(
    chatId: string,
    o: { before?: number; limit: number },
  ): { messages: ChatMessage[]; hasMore: boolean };
  /** Messages with seq > afterSeq in any of these chats, oldest first. */
  since(afterSeq: number, chatIds: string[]): ChatMessage[];
  last(chatId: string): ChatMessage | undefined;
  lastSeq(): number;
  /** Newest confirm-card message in this chat for this task. */
  findConfirm(chatId: string, taskId: string): ChatMessage | undefined;
  /** After a restart no confirm can still be pending (the bot drops them): mark those cards `timeout`. Returns how many. */
  expirePendingConfirms(): number;
  clear(): void;
}

const parse = (json: string): ChatMessage | undefined => {
  const r = ChatMessageSchema.safeParse(JSON.parse(json));
  return r.success ? r.data : undefined;
};

export function createChatStore(db: Db): ChatStore {
  db.exec(CHAT_SCHEMA);
  const ins = db.prepare('INSERT INTO hub_chat_messages(chat_id, ts, json) VALUES(?,?,?)');
  const setJson = db.prepare('UPDATE hub_chat_messages SET json=? WHERE seq=?');
  const row = db.prepare('SELECT json FROM hub_chat_messages WHERE seq=?');
  const hist = db.prepare(
    'SELECT json FROM hub_chat_messages WHERE chat_id=? AND seq<? ORDER BY seq DESC LIMIT ?',
  );
  const lastOf = db.prepare(
    'SELECT json FROM hub_chat_messages WHERE chat_id=? ORDER BY seq DESC LIMIT 1',
  );
  const byTask = db.prepare(
    'SELECT json FROM hub_chat_messages WHERE chat_id=? AND instr(json, ?) > 0 ORDER BY seq DESC LIMIT 5',
  );
  const seqOf = (id: string): number | undefined => {
    const m = /^m_(\d+)$/.exec(id);
    return m ? Number(m[1]) : undefined;
  };
  const rows = (r: unknown[]): ChatMessage[] =>
    (r as { json: string }[]).flatMap((x) => parse(x.json) ?? []);

  return {
    append(m) {
      const info = ins.run(m.chatId, m.ts, '{}');
      const seq = Number(info.lastInsertRowid);
      const full: ChatMessage = ChatMessageSchema.parse({ ...m, id: `m_${seq}`, seq });
      setJson.run(JSON.stringify(full), seq);
      return full;
    },
    get(id) {
      const seq = seqOf(id);
      const r = seq === undefined ? undefined : (row.get(seq) as { json: string } | undefined);
      return r ? parse(r.json) : undefined;
    },
    updateCard(id, card) {
      const cur = this.get(id);
      if (!cur) return undefined;
      const next: ChatMessage = { ...cur, card };
      setJson.run(JSON.stringify(next), cur.seq);
      return next;
    },
    history(chatId, o) {
      const before = o.before ?? Number.MAX_SAFE_INTEGER;
      const got = rows(hist.all(chatId, before, o.limit + 1));
      const hasMore = got.length > o.limit;
      return { messages: got.slice(0, o.limit).reverse(), hasMore };
    },
    since(afterSeq, chatIds) {
      if (chatIds.length === 0) return [];
      const q = db.prepare(
        `SELECT json FROM hub_chat_messages WHERE seq>? AND chat_id IN (${chatIds.map(() => '?').join(',')}) ORDER BY seq`,
      );
      return rows(q.all(afterSeq, ...chatIds));
    },
    last(chatId) {
      const r = lastOf.get(chatId) as { json: string } | undefined;
      return r ? parse(r.json) : undefined;
    },
    lastSeq() {
      const r = db.prepare('SELECT MAX(seq) AS s FROM hub_chat_messages').get() as {
        s: number | null;
      };
      return r.s ?? 0;
    },
    findConfirm(chatId, taskId) {
      // the taskId is matched as its JSON-encoded form, so it cannot widen the search
      return rows(byTask.all(chatId, `"taskId":${JSON.stringify(taskId)}`)).find(
        (m) => m.card?.type === 'confirm' && m.card.taskId === taskId,
      );
    },
    expirePendingConfirms() {
      const pending = db
        .prepare(`SELECT json FROM hub_chat_messages WHERE instr(json, '"status":"pending"') > 0`)
        .all() as { json: string }[];
      let n = 0;
      for (const r of pending) {
        const m = parse(r.json);
        if (m?.card?.type === 'confirm' && m.card.status === 'pending') {
          setJson.run(JSON.stringify({ ...m, card: { ...m.card, status: 'timeout' } }), m.seq);
          n++;
        }
      }
      return n;
    },
    clear() {
      db.exec('DELETE FROM hub_chat_messages; DELETE FROM hub_chat_files;');
    },
  };
}
