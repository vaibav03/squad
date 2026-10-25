import type { ContactChannel } from '@squad/core';
import type { Logger } from './log';

export interface CodeMessage {
  channel: ContactChannel;
  /** Normalized phone or email. Held in memory for the send only; never stored or logged. */
  to: string;
  /** Masked form, safe to log. */
  hint: string;
  code: string;
}

/** Delivers verification codes. No external SMS provider is required: console by default. */
export interface CodeSender {
  readonly name: string;
  send(msg: CodeMessage): Promise<void>;
  /** Optional strict delivery (no console fallback): true only when the transport accepted the message. */
  sendStrict?(msg: CodeMessage): Promise<boolean>;
}

/** Dev default: prints the code next to the masked contact on the hub console (stderr JSON line). */
export function createConsoleCodeSender(log: Logger): CodeSender {
  return {
    name: 'console',
    async send(m) {
      log.info('auth.code', { to: m.hint, channel: m.channel, code: m.code });
    },
  };
}

/** Collects codes in memory. For tests; `last(hint?)` returns the newest code sent. */
export function createMemoryCodeSender(): CodeSender & {
  sent: CodeMessage[];
  last(): CodeMessage | undefined;
} {
  const sent: CodeMessage[] = [];
  return {
    name: 'memory',
    sent,
    last: () => sent.at(-1),
    async send(m) {
      sent.push({ ...m });
    },
  };
}

/**
 * Sends the code as an iMessage through the bot transport: POST `{ to, text }` to `url` (the bot's send endpoint).
 * Email contacts and any transport failure fall back to the console sender, so sign-up never dead-ends in dev.
 */
export function createImessageCodeSender(opts: {
  url: string;
  log: Logger;
  fetch?: typeof fetch;
}): CodeSender {
  const fallback = createConsoleCodeSender(opts.log);
  const f = opts.fetch ?? fetch;
  return {
    name: 'imessage',
    async sendStrict(m) {
      if (m.channel !== 'phone') return false;
      try {
        const res = await f(opts.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            to: m.to,
            text: `Your Squad code is ${m.code}. It expires in 10 minutes.`,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        opts.log.info('auth.code.sent', { to: m.hint, via: 'imessage' });
        return true;
      } catch (e) {
        opts.log.warn('auth.code.imessage_failed', { to: m.hint, err: (e as Error).name });
        return false;
      }
    },
    async send(m) {
      if (m.channel !== 'phone') return fallback.send(m);
      try {
        const res = await f(opts.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            to: m.to,
            text: `Your Squad code is ${m.code}. It expires in 10 minutes.`,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        opts.log.info('auth.code.sent', { to: m.hint, via: 'imessage' });
      } catch (e) {
        opts.log.warn('auth.code.imessage_failed', { to: m.hint, err: (e as Error).name });
        return fallback.send(m);
      }
    },
  };
}
