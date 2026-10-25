// Shared contracts from docs/specs/00-OVERVIEW.md. Change only through a core PR.
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import type { Llm } from './llm/types';

export type StudentId = string; // stable id, e.g. "s_ana"
export type ChatId = string; // imessage-kit chat id (group or DM)
/** 'student:<id>' | 'expert:<chapter>' | 'council:<id>' | 'dean' | 'mediator' */
export type AgentId = string;

export type Db = Database;

export interface Student {
  id: StudentId;
  name: string;
  handle: string; // phone/email
  personaId?: string;
  voiceId?: string;
  avatarUrl?: string;
}

export interface Attachment {
  path: string;
  mime: string;
}

export interface InboundMessage {
  chatId: ChatId;
  isGroup: boolean;
  from: StudentId;
  text: string;
  attachments: Attachment[];
  mentionsBot: boolean;
  ts: number;
  replyTo?: string;
}

export interface OutboundMessage {
  chatId: ChatId;
  text?: string;
  attachments?: Attachment[];
  personaId?: string;
  /** Structured card for transports that render one (the web chat); others show `text` only. */
  card?: import('./chat').ChatCard;
}

/** `'timeout'` is part of the contract (treated as "no" by callers). */
export type ConfirmAnswer = (string & {}) | 'timeout';

export type AskConfirm = (
  student: StudentId,
  question: string,
  options: string[],
  taskId: string,
) => Promise<ConfirmAnswer>;

export interface Ctx {
  db: Db;
  llm: Llm;
  send(o: OutboundMessage): Promise<void>;
  dm(student: StudentId, text: string, attachments?: OutboundMessage['attachments']): Promise<void>;
  askConfirm: AskConfirm;
}

/** A feature handler; the router (02) picks one per message. `match` returns 0..1. */
export interface Skill {
  name: string;
  match(m: InboundMessage, ctx: Ctx): Promise<number>;
  handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]>;
}

export interface Persona {
  id: string;
  name: string;
  role: 'cubbie' | 'expert' | 'examiner' | 'dean' | 'council' | 'rival' | (string & {});
  systemPrompt: string;
  voiceId?: string;
  avatarUrl?: string;
  spriteSheet?: string; // pixel sprite sheet for the village
  portrait?: string; // Fluent 3D portrait for UI
  emoji?: string;
}

export const CitationSchema = z.strictObject({
  courseId: z.string(),
  chapter: z.string(),
  file: z.string(),
  page: z.number().optional(),
  quote: z.string().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** Mesh (04): every agent-to-agent message passes the privacy gate and lands in the ledger. */
export interface AgentMessage {
  from: StudentId;
  to: StudentId | 'mediator';
  taskId: string;
  kind: string;
  payload: unknown; // zod-validated per kind by mesh
}

/**
 * INTERNAL ledger row (holds the real withheld value, stays server-side).
 * Never emit this over events: the `ledger.entry` VillageEvent carries only `withheld: 'hidden'`.
 */
export interface LedgerEntry {
  taskId: string;
  student: StudentId;
  field: string;
  shared: string;
  withheld?: string;
  ts: number;
}
