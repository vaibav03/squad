import type {
  Attachment,
  ChatCard,
  ChatCitation,
  ConfirmAnswer,
  InboundMessage,
  OutboundMessage,
  ProvenanceHint,
  StudentId,
} from '@squad/core';
import type { ChatId } from '@squad/core';
import { detectMention } from '../mention';
import { getPersona } from '../persona';
import type { Transport } from '../types';
import {
  extractCitations,
  parseCouncilCard,
  parseLiveCard,
  parseQuizCard,
  stripPersonaPrefix,
} from './web-format';

/** Structured citations first (they carry non-PDF sources), then the ones parsed from the text, without duplicates. */
function mergeCitations(structured: readonly ChatCitation[], parsed: readonly ChatCitation[]): ChatCitation[] {
  const out = [...structured];
  for (const c of parsed)
    if (!out.some((x) => x.file === c.file && x.page === c.page)) out.push(c);
  return out;
}

/** What the web host receives for every bot message (structured; the persona prefix is already removed). */
export interface WebOutbound {
  chatId: ChatId;
  personaId: string;
  personaName: string;
  emoji?: string;
  text: string;
  citations: ChatCitation[];
  /** Absolute local paths: the host copies them behind unguessable URLs. */
  attachments: Attachment[];
  card?: ChatCard;
  /** What the skill said about its own provenance when it has no citations (the hub's composer decides the rest). */
  provenance?: ProvenanceHint;
}

const citeKey = (c: ChatCitation) =>
  c.source ? `${c.source.kind}/${c.source.id}#${c.source.anchor ?? ''}` : `${c.file}#${c.page}`;
/** Marker citations first, then the structured ones a skill attached (verified sources), without duplicates. */
function mergeCitations(a: ChatCitation[], b: ChatCitation[] | undefined): ChatCitation[] {
  const seen = new Set<string>();
  return [...a, ...(b ?? [])].filter((c) => {
    const k = citeKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface WebTransportOptions {
  /** Every bot message, in send order. May be async; send resolves when it does. */
  onMessage(o: WebOutbound): void | Promise<void>;
  /** A pending confirm card finished (answer is the option string or 'timeout'). */
  onConfirmResolved?(student: StudentId, taskId: string, answer: ConfirmAnswer): void;
  now?: () => number;
}

export type WebInbound = Pick<InboundMessage, 'chatId' | 'from' | 'text'> & {
  attachments?: Attachment[];
};

/**
 * The third transport (next to iMessage and Discord): messages typed in the web app enter the SAME router, speaking
 * policy, confirm flow and skills. Group chats are `group:<squadId>`, DMs are `dm:<studentId>`.
 */
export class WebTransport implements Transport {
  readonly name = 'web';
  private onMsg?: (m: InboundMessage) => void | Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: WebTransportOptions) {
    this.now = opts.now ?? Date.now;
  }

  async start(onMsg: (m: InboundMessage) => void | Promise<void>): Promise<void> {
    this.onMsg = onMsg;
  }

  async stop(): Promise<void> {
    this.onMsg = undefined;
  }

  dmChatId(s: StudentId): ChatId {
    return `dm:${s}`;
  }

  async send(o: OutboundMessage): Promise<void> {
    const persona = getPersona(o.personaId);
    const raw = o.text ? stripPersonaPrefix(o.personaId, o.text) : '';
    const council = raw ? parseCouncilCard(raw) : undefined;
    const live = raw && !council ? parseLiveCard(raw) : undefined;
    const quiz = raw && !council && !live ? parseQuizCard(raw) : undefined;
    const { text, citations } = extractCitations(
      council ? council.text : live ? live.text : quiz ? quiz.text : raw,
    );
    await this.opts.onMessage({
      chatId: o.chatId,
      personaId: persona.id,
      personaName: persona.name,
      ...(persona.emoji ? { emoji: persona.emoji } : {}),
      text,
      citations: quiz ? [] : mergeCitations(citations, o.citations),
      ...(o.provenance ? { provenance: o.provenance } : {}),
      attachments: o.attachments ?? [],
      ...(council
        ? { card: council.card }
        : live
          ? { card: live.card }
          : quiz
            ? { card: quiz.card }
            : o.card
              ? { card: o.card }
              : {}),
    });
  }

  async confirmPrompt(
    student: StudentId,
    p: { taskId: string; question: string; options: string[] },
  ): Promise<void> {
    const persona = getPersona();
    await this.opts.onMessage({
      chatId: this.dmChatId(student),
      personaId: persona.id,
      personaName: persona.name,
      ...(persona.emoji ? { emoji: persona.emoji } : {}),
      text: p.question,
      citations: [],
      attachments: [],
      card: {
        type: 'confirm',
        taskId: p.taskId,
        question: p.question,
        options: p.options,
        status: 'pending',
      },
    });
  }

  confirmResolved(student: StudentId, taskId: string, answer: ConfirmAnswer): void {
    this.opts.onConfirmResolved?.(student, taskId, answer);
  }

  /** Deliver a message typed by a student. Resolves when the router has finished with it. */
  async inject(m: WebInbound): Promise<void> {
    if (!this.onMsg) throw new Error('web transport not started');
    const isGroup = !m.chatId.startsWith('dm:');
    await this.onMsg({
      chatId: m.chatId,
      isGroup,
      from: m.from,
      text: m.text,
      attachments: m.attachments ?? [],
      mentionsBot: detectMention(m.text, isGroup),
      ts: this.now(),
    });
  }
}
