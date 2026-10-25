// The Demo/Fixture iMessage bridge: the whole loop (inbound -> same web group -> @cubbie -> mirrored outbound ->
// delivery states) with NO Sendblue credentials and NO external send. The transport is the scripted
// FakeIMessageTransport, so a "send" only lands in memory; delivery and read receipts are simulated a moment later.
// It is never on by default, never available in a production config, and never shown as live anywhere.
import { FakeIMessageTransport } from '@squad/bot';
import type { HubDeps } from '../types';

/** Receipt delays of the simulated phone (ms). */
export const DEMO_DELIVERED_MS = 250;
export const DEMO_READ_MS = 700;

export class DemoTransport extends FakeIMessageTransport {
  override async send(r: { to: string; text?: string; attachments?: readonly string[] }) {
    const res = await super.send(r);
    const guid = res?.guid;
    if (guid) {
      setTimeout(() => this.receipt(guid, 'delivered'), DEMO_DELIVERED_MS).unref?.();
      setTimeout(() => this.receipt(guid, 'read'), DEMO_READ_MS).unref?.();
    }
    return res;
  }
}

export interface DemoHandle {
  /** A text from the demo phone of this user, as if typed in the bound iMessage group. */
  emit(userId: string, text: string): Promise<boolean>;
}

/** A stable, obviously fake phone number for a user (never a real one): +1 555 01xx xxxx. */
export function demoPhoneFor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) % 10_000_000;
  return `+155501${String(h).padStart(7, '0').slice(-7)}`.slice(0, 12);
}

/** Make the user's demo phone resolve to their account (the same link the 1:1 code flow would create). */
export function ensureDemoLink(deps: HubDeps, userId: string): string | undefined {
  const phone = demoPhoneFor(userId);
  const hash = deps.accounts.hashContact('phone', phone);
  try {
    if (!deps.imessage.linkedUser(hash)) deps.imessage.link(hash, userId, 'demo phone');
    return phone;
  } catch {
    return undefined; // a roster student without a sign-up account cannot be linked to a phone
  }
}
