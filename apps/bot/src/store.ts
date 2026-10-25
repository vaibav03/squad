import type { ChatId, Db, InboundMessage, OutboundMessage, StudentId } from '@squad/core';
import type { Decision, Roster } from './types';

export function seedRoster(db: Db, roster: Roster, transport: string, now = Date.now()): void {
  const st = db.prepare(
    `INSERT INTO students(id, name, handle, persona_id, voice_id, avatar_url, created_at) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, handle=excluded.handle`,
  );
  const taken = db.prepare('SELECT 1 FROM students WHERE handle = ? AND id <> ?');
  for (const s of roster.students) {
    // Account handles are masked contact hints ("r•••@example.com"), which two people can share; students.handle is
    // UNIQUE, so a clash keeps the hint readable and adds the id. Without this the hub crashed on restart.
    const handle = taken.get(s.handle, s.id) ? `${s.handle} (${s.id})` : s.handle;
    st.run(s.id, s.name, handle, s.personaId ?? null, s.voiceId ?? null, s.avatarUrl ?? null, now);
  }
  for (const c of roster.chats) {
    ensureChat(db, c.id, true, c.name, transport);
    for (const m of c.members) {
      db.prepare('INSERT OR IGNORE INTO chat_members(chat_id, student_id) VALUES(?,?)').run(
        c.id,
        m,
      );
    }
  }
}

/** Unknown senders are auto-created so a new number never crashes the bot. */
export function ensureStudent(db: Db, id: StudentId, now = Date.now()): void {
  db.prepare('INSERT OR IGNORE INTO students(id, name, handle, created_at) VALUES(?,?,?,?)').run(
    id,
    id,
    id,
    now,
  );
}

export function ensureChat(
  db: Db,
  id: ChatId,
  isGroup: boolean,
  name: string | null,
  transport: string,
): void {
  db.prepare(
    `INSERT INTO chats(id, is_group, name, transport, settings_json) VALUES(?,?,?,?,'{}')
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, isGroup ? 1 : 0, name, transport);
}

export function saveInbound(db: Db, m: InboundMessage, transport: string): number {
  ensureStudent(db, m.from, m.ts);
  ensureChat(db, m.chatId, m.isGroup, null, transport);
  if (m.isGroup) {
    db.prepare('INSERT OR IGNORE INTO chat_members(chat_id, student_id) VALUES(?,?)').run(
      m.chatId,
      m.from,
    );
  }
  const r = db
    .prepare(
      `INSERT INTO messages(chat_id, from_id, text, attachments_json, mentions_bot, ts) VALUES(?,?,?,?,?,?)`,
    )
    .run(m.chatId, m.from, m.text, JSON.stringify(m.attachments), m.mentionsBot ? 1 : 0, m.ts);
  return Number(r.lastInsertRowid);
}

export function saveOutbound(db: Db, o: OutboundMessage, ts: number): number {
  const r = db
    .prepare(
      `INSERT INTO messages(chat_id, from_id, text, attachments_json, mentions_bot, persona_id, ts) VALUES(?,?,?,?,0,?,?)`,
    )
    .run(
      o.chatId,
      'bot',
      o.text ?? '',
      JSON.stringify(o.attachments ?? []),
      o.personaId ?? null,
      ts,
    );
  return Number(r.lastInsertRowid);
}

export function setDecision(
  db: Db,
  messageId: number,
  d: Decision & { spoke?: boolean; error?: string },
): void {
  db.prepare('UPDATE messages SET decision_json=? WHERE id=?').run(JSON.stringify(d), messageId);
}

/** Last time an UNPROMPTED group message went out in this chat (survives restarts). */
export function lastUnpromptedAt(db: Db, chatId: ChatId): number | undefined {
  const r = db
    .prepare(
      `SELECT MAX(ts) AS t FROM messages WHERE chat_id=? AND from_id!='bot'
       AND json_extract(decision_json,'$.unprompted')=1 AND json_extract(decision_json,'$.spoke')=1`,
    )
    .get(chatId) as { t: number | null };
  return r.t ?? undefined;
}

export function decisions(db: Db, limit = 50) {
  return (
    db
      .prepare(
        'SELECT id, chat_id, from_id, text, decision_json, ts FROM messages WHERE decision_json IS NOT NULL ORDER BY id DESC LIMIT ?',
      )
      .all(limit) as {
      id: number;
      chat_id: string;
      from_id: string;
      text: string;
      decision_json: string;
      ts: number;
    }[]
  )
    .reverse()
    .map((r) => ({ ...r, decision: JSON.parse(r.decision_json) as Decision }));
}
