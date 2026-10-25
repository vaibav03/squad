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
  readonly sent: { to: string; text?: string; attachments?: readonly string[]; guid?: string }[] =
    [];
  /** Every message that reached "Apple's database" (delivered to the watcher or not), oldest emitted first. */
  readonly history: IMessageMessageLike[] = [];
  failSends = 0;
  watching = false;
  /** Report a guid for each send (a transport with receipts). Default on. */
  reportGuids = true;
  /** When false, `listMessages` is absent (a transport that cannot backfill). */
  canBackfill = true;
  private events: Parameters<IMessageSdkLike['startWatching']>[0] = {};
  private receiptCb: Parameters<NonNullable<IMessageSdkLike['watchReceipts']>>[0] | undefined;
  private watcherDropped = false;
  private n = 0;
  private outN = 0;
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
    const guid = this.reportGuids ? `out-${++this.outN}` : undefined;
    this.sent.push(guid ? { ...r, guid } : r);
    return guid ? { guid } : undefined;
  }

  // ---- scripted faults and scenarios ----
  /** The next `n` sends throw (Apple/AppleScript failure). */
  failNext(n: number) {
    this.failSends = n;
  }
  /** The watcher stops delivering; messages still land in `history` (they are in chat.db, we just did not see them). */
  dropWatcher() {
    this.watcherDropped = true;
  }
  /** The watcher is back. The hub is expected to backfill what it missed. */
  restoreWatcher() {
    this.watcherDropped = false;
  }
  /** Redeliver an already seen message (Apple/SDK replays). */
  async duplicate(guid: string, times = 1) {
    const m = this.history.find((x) => x.id === guid);
    if (!m) throw new Error(`no such message ${guid}`);
    for (let i = 0; i < times; i++) await this.events.onIncomingMessage?.({ ...m });
  }
  /** A delivery receipt for a send (`out-N`). */
  receipt(
    guid: string,
    state: 'sent' | 'delivered' | 'read' | 'failed' = 'delivered',
    reason?: string,
  ) {
    this.receiptCb?.({ guid, state, ...(reason ? { reason } : {}) });
  }
  watchReceipts(cb: Parameters<NonNullable<IMessageSdkLike['watchReceipts']>>[0]) {
    this.receiptCb = cb;
  }
  async listMessages(q: { chatId: string; since: Date; limit?: number }) {
    if (!this.canBackfill) throw new Error('listMessages unsupported');
    return this.history
      .filter((m) => m.chatId === q.chatId && m.createdAt.getTime() >= q.since.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, q.limit ?? 200);
  }
  /** What people said in a chat (incoming), in Apple's order: by message time, then arrival. */
  transcript(chatId: string): { ts: number; text: string; guid: string }[] {
    return this.history
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.chatId === chatId)
      .sort((a, b) => a.m.createdAt.getTime() - b.m.createdAt.getTime() || a.i - b.i)
      .map(({ m }) => ({ ts: m.createdAt.getTime(), text: m.text ?? '', guid: m.id }));
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
    this.history.push(raw);
    if (this.watcherDropped) return;
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
