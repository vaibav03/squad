// FakeIMessageTransport plus the scenario driver the gate needs (RELEASE-GATE section 6): duplicates, out-of-order
// arrival, an offline gap followed by backfill, delayed delivery, send failure then retry, receipts. No Apple, no
// real message is ever read or sent. Runs inside the gate hub process (lib/gate-hub.ts).
//
// The base class (apps/bot/src/imessage/fake.ts, feature/imessage-sync) already models "chat.db": every emitted
// message lands in `history` whether or not the watcher saw it, and `listMessages` serves backfill from it. The
// scenario layer adds stable timestamps, a persisted chat.db copy (so a hub restart keeps the gap) and send receipts.
import fs from 'node:fs';
import { FakeIMessageTransport, type FakeIncoming } from '../../../../apps/bot/src/imessage/fake';

export interface Receipt {
  to: string;
  text: string;
  at: number;
  ok: boolean;
  error?: string;
}

interface StoredRow {
  id: string;
  chatId: string | null;
  chatKind: string;
  participant: string | null;
  text: string | null;
  kind: string;
  isFromMe: boolean;
  createdAt: string;
}

export class ScenarioTransport extends FakeIMessageTransport {
  readonly receipts: Receipt[] = [];
  private dropped = false;
  private delayMs = 0;
  private seqN = 0;
  private readonly t0 = Date.now() - 60_000;
  /** Rows that arrived while the watcher was down (what backfill must recover). */
  private gapIds = new Set<string>();

  constructor(private readonly chatDbFile?: string) {
    super();
    this.loadChatDb();
  }

  /** The watcher dies: messages keep arriving in chat.db (the gap) but nothing reaches the hub. */
  override dropWatcher(): void {
    this.dropped = true;
    super.dropWatcher();
  }

  /** The watcher is back. The caller then asks the hub to backfill (gate-hub: im.reconnect()). */
  override restoreWatcher(): void {
    this.dropped = false;
    super.restoreWatcher();
  }

  /** Ids of messages that sit in chat.db but were never delivered to the hub watcher. */
  gapSize(): number {
    return this.gapIds.size;
  }
  clearGap(): void {
    this.gapIds.clear();
  }

  delay(ms: number): void {
    this.delayMs = ms;
  }

  /** The id (GUID) of the last emitted message. */
  lastGuid(): string | undefined {
    return this.history[this.history.length - 1]?.id;
  }

  /** Deliver these messages in reverse order of their timestamps (network-style reordering). */
  async outOfOrder(
    msgs: { chatId: string; sender: string; text: string }[],
  ): Promise<{ guid: string }[]> {
    const stamped = msgs.map((m) => this.stamp({ ...m, group: true }));
    for (const m of [...stamped].reverse()) await this.deliver(m);
    return stamped.map((m) => ({ guid: m.id! }));
  }

  /** A group message with a stable GUID, timestamped by arrival order. */
  say(chatId: string, sender: string, text: string, extra: Partial<FakeIncoming> = {}) {
    return this.deliver(this.stamp({ chatId, sender, text, group: true, ...extra }));
  }

  override async emit(m: FakeIncoming): Promise<void> {
    await this.deliver(this.stamp(m));
  }

  override async send(r: { to: string; text?: string; attachments?: readonly string[] }) {
    try {
      const out = await super.send(r);
      this.receipts.push({ to: r.to, text: r.text ?? '', at: Date.now(), ok: true });
      return out;
    } catch (e) {
      this.receipts.push({
        to: r.to,
        text: r.text ?? '',
        at: Date.now(),
        ok: false,
        error: (e as Error).message,
      });
      throw e;
    }
  }

  /** Clears outbound state and faults. chat.db history is kept (it is Apple's, not ours). */
  reset(): void {
    this.sent.length = 0;
    this.receipts.length = 0;
    this.failSends = 0;
    this.delayMs = 0;
    this.dropped = false;
    super.restoreWatcher();
  }

  private stamp(m: FakeIncoming): FakeIncoming {
    const seq = ++this.seqN;
    return {
      ...m,
      id: m.id ?? `GATE-GUID-${Date.now().toString(36)}-${String(seq).padStart(4, '0')}`,
      createdAt: m.createdAt ?? new Date(this.t0 + seq * 1000),
    };
  }

  private async deliver(m: FakeIncoming): Promise<void> {
    if (this.dropped) this.gapIds.add(m.id!);
    else if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    await super.emit(m);
    this.persistChatDb();
  }

  /** chat.db survives a hub restart: the watcher is gone, the rows are not. */
  private persistChatDb(): void {
    if (!this.chatDbFile) return;
    try {
      const rows: StoredRow[] = this.history.map((h) => ({
        id: h.id,
        chatId: h.chatId,
        chatKind: h.chatKind ?? 'group',
        participant: h.participant ?? null,
        text: h.text ?? null,
        kind: h.kind ?? 'text',
        isFromMe: !!h.isFromMe,
        createdAt: h.createdAt.toISOString(),
      }));
      fs.writeFileSync(this.chatDbFile, JSON.stringify({ rows, gap: [...this.gapIds] }));
    } catch {
      /* best effort */
    }
  }

  private loadChatDb(): void {
    if (!this.chatDbFile) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.chatDbFile, 'utf8')) as {
        rows: StoredRow[];
        gap: string[];
      };
      for (const r of j.rows)
        this.history.push({
          id: r.id,
          chatId: r.chatId,
          chatKind: r.chatKind,
          participant: r.participant,
          text: r.text,
          kind: r.kind,
          isFromMe: r.isFromMe,
          createdAt: new Date(r.createdAt),
          attachments: [],
        } as (typeof this.history)[number]);
      this.gapIds = new Set(j.gap);
      this.seqN = this.history.length;
    } catch {
      /* first start */
    }
  }
}
