// A scripted stand-in for Apple's Messages (the imessage-kit SDK). Every iMessage test uses this: no real message is
// ever sent or read. `emit*` plays an incoming message; `sent` records what the bot handed to Apple.
import type {
  IMessageAttachmentLike,
  IMessageMessageLike,
  IMessageSdkLike,
} from '../transports/imessage';

export interface FakeIncoming {
  id?: string;
  chatId: string;
  sender: string | null;
  text: string | null;
  group?: boolean;
  fromMe?: boolean;
  kind?: string;
  reaction?: unknown;
  attachments?: IMessageAttachmentLike[];
  createdAt?: Date;
}

export class FakeIMessageTransport implements IMessageSdkLike {
  readonly sent: { to: string; text?: string; attachments?: readonly string[] }[] = [];
  failSends = 0;
  watching = false;
  private events: Parameters<IMessageSdkLike['startWatching']>[0] = {};
  private n = 0;
  constructor(public chats: { chatId: string; name: string | null; kind: string }[] = []) {}

  async startWatching(e: Parameters<IMessageSdkLike['startWatching']>[0]) {
    this.events = e;
    this.watching = true;
  }
  async stopWatching() {
    this.watching = false;
  }
  async close() {
    this.watching = false;
  }
  async listChats() {
    return this.chats;
  }
  async send(r: { to: string; text?: string; attachments?: readonly string[] }) {
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error('applescript failed');
    }
    this.sent.push(r);
  }

  /** Play an incoming message through whatever the watcher is. Resolves when the handler is done. */
  async emit(m: FakeIncoming): Promise<void> {
    const group = m.group ?? /;\+;/.test(m.chatId);
    const raw: IMessageMessageLike = {
      id: m.id ?? `guid-${++this.n}`,
      chatId: m.chatId,
      chatKind: group ? 'group' : 'dm',
      participant: m.sender,
      text: m.text,
      kind: m.kind ?? 'text',
      isFromMe: m.fromMe ?? false,
      createdAt: m.createdAt ?? new Date(1_700_000_000_000 + this.n * 1000),
      attachments: m.attachments ?? [],
      ...(m.reaction ? { reaction: m.reaction } : {}),
    };
    await this.events.onIncomingMessage?.(raw);
  }
  /** A message in a group chat. */
  group(chatId: string, sender: string, text: string, extra: Partial<FakeIncoming> = {}) {
    return this.emit({ chatId, sender, text, group: true, ...extra });
  }
  /** A 1:1 message from `sender`. */
  dm(sender: string, text: string, extra: Partial<FakeIncoming> = {}) {
    return this.emit({ chatId: `iMessage;-;${sender}`, sender, text, group: false, ...extra });
  }
  /** What was sent to this target (group guid or handle), in order. */
  textsTo(to: string): string[] {
    return this.sent.filter((s) => s.to === to).map((s) => s.text ?? '');
  }
}
