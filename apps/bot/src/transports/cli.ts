import type { ChatId, InboundMessage, OutboundMessage, StudentId } from '@squad/core';
import { detectMention } from '../mention';
import type { Roster, Transport } from '../types';

export type SentRecord = OutboundMessage & { at: number };

/** In-process transport for the fake-chat REPL and scripted sessions. */
export class CliTransport implements Transport {
  readonly name = 'cli';
  readonly sent: SentRecord[] = [];
  private listeners: ((o: SentRecord) => void)[] = [];
  private onMsg?: (m: InboundMessage) => void | Promise<void>;
  constructor(
    readonly roster: Roster,
    private readonly now: () => number = Date.now,
  ) {}
  async start(onMsg: (m: InboundMessage) => void | Promise<void>) {
    this.onMsg = onMsg;
  }
  async stop() {
    this.onMsg = undefined;
  }
  dmChatId(s: StudentId): ChatId {
    return `dm:${s}`;
  }
  onSend(fn: (o: SentRecord) => void) {
    this.listeners.push(fn);
  }
  async send(o: OutboundMessage) {
    const rec = { ...o, at: this.now() };
    this.sent.push(rec);
    for (const l of this.listeners) l(rec);
  }
  /** Deliver a message as a student. `chatId` is `group:<name>` or `dm:<student>`. */
  async inject(
    from: StudentId,
    chatId: ChatId,
    text: string,
    attachments: InboundMessage['attachments'] = [],
  ): Promise<void> {
    if (!this.onMsg) throw new Error('CLI transport not started');
    const isGroup = !chatId.startsWith('dm:');
    await this.onMsg({
      chatId,
      isGroup,
      from,
      text,
      attachments,
      mentionsBot: detectMention(text, isGroup),
      ts: this.now(),
    });
  }
}
