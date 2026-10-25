// FakeIMessageTransport plus the scenario driver the gate needs (RELEASE-GATE section 6): duplicates, out-of-order
// arrival, an offline gap followed by backfill, delayed delivery, send failure then retry, receipts. No Apple, no
// real message is ever read or sent. Runs inside the gate hub process (lib/gate-hub.ts).
import fs from 'node:fs';
import {
  FakeIMessageTransport,
  type FakeIncoming,
} from '../../../../apps/bot/src/imessage/fake';

export interface Receipt {
  to: string;
  text: string;
  at: number;
  ok: boolean;
  error?: string;
}

export class ScenarioTransport extends FakeIMessageTransport {
  readonly receipts: Receipt[] = [];
  readonly log: (FakeIncoming & { id: string; seq: number })[] = [];
  private gap: (FakeIncoming & { id: string; seq: number })[] = [];
  private dropped = false;
  private delayMs = 0;
  private n = 0;
  private t0 = Date.parse('2026-10-26T12:00:00Z');

  constructor(private readonly chatDbFile?: string) {
    super();
  }

  /** The watcher dies: messages keep arriving in chat.db (the gap) but nothing reaches the hub. */
  dropWatcher(): void {
    this.dropped = true;
  }
  /** The watcher is back and backfills the gap, oldest rowid first. */
  async backfill(): Promise<number> {
    this.dropped = false;
    const queued = this.gap.splice(0).sort((a, b) => a.seq - b.seq);
    for (const m of queued) await super.emit(m);
    this.persistGap();
    return queued.length;
  }
  delay(ms: number): void {
    this.delayMs = ms;
  }
  /** The next n Apple sends fail (AppleScript error), then recover. */
  failNext(n: number): void {
    this.failSends = n;
  }
  /** Re-deliver a message GUID that was already delivered (Apple re-emits on watcher restart). */
  async duplicate(guid: string, times = 1): Promise<void> {
    const m = this.log.find((x) => x.id === guid);
    if (!m) throw new Error(`unknown guid ${guid}`);
    for (let i = 0; i < times; i++) await super.emit({ ...m });
  }
  /** Deliver these messages in reverse order of their timestamps (network-style reordering). */
  async outOfOrder(
    msgs: { chatId: string; sender: string; text: string }[],
  ): Promise<{ guid: string }[]> {
    const stamped = msgs.map((m) => this.stamp({ ...m, group: true }));
    for (const m of [...stamped].reverse()) await this.deliver(m);
    return stamped.map((m) => ({ guid: m.id }));
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
      await super.send(r);
      this.receipts.push({ to: r.to, text: r.text ?? '', at: Date.now(), ok: true });
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

  reset(): void {
    this.sent.length = 0;
    this.receipts.length = 0;
    this.failSends = 0;
    this.delayMs = 0;
    this.dropped = false;
    this.gap = [];
    this.persistGap();
  }

  gapSize(): number {
    return this.gap.length;
  }

  private stamp(m: FakeIncoming): FakeIncoming & { id: string; seq: number } {
    const seq = ++this.n;
    const stamped = {
      ...m,
      id: m.id ?? `GATE-GUID-${String(seq).padStart(4, '0')}`,
      createdAt: m.createdAt ?? new Date(this.t0 + seq * 1000),
      seq,
    };
    this.log.push(stamped);
    return stamped;
  }

  private async deliver(m: FakeIncoming & { id: string; seq: number }): Promise<void> {
    if (this.dropped) {
      this.gap.push(m);
      this.persistGap();
      return;
    }
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    await super.emit(m);
  }

  /** The simulated chat.db rows that arrived while the watcher was down (survives a hub restart). */
  private persistGap(): void {
    if (!this.chatDbFile) return;
    try {
      fs.writeFileSync(this.chatDbFile, JSON.stringify(this.gap));
    } catch {
      /* best effort */
    }
  }
}
