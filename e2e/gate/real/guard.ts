// Safety rails for the real-account smoke path (docs/qa/RELEASE-GATE.md "Smoke path"). Everything here is
// fail-closed: when in doubt the smoke script refuses to run. Variable NAMES are reported, VALUES never are.
import fs from 'node:fs';
import path from 'node:path';
import { KILL_FILE, REPO } from '../lib/config';
import { definedEnvNames } from '../lib/blockers';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export const MAX_OUTBOUND = Number(process.env.GATE_MAX_OUTBOUND ?? 10);

/** `touch .gate-kill` (repo root) or IMESSAGE_ENABLED=0 stops every send. Checked before each send and every 500 ms. */
export function killSwitchTripped(): string | undefined {
  if (fs.existsSync(KILL_FILE)) return 'kill file .gate-kill exists';
  if (process.env.IMESSAGE_ENABLED === '0') return 'IMESSAGE_ENABLED=0';
  return undefined;
}

const normHandle = (h: string) => h.replace(/[^0-9a-z@.+]/gi, '').toLowerCase();

/** The allowlist must be exactly one chat and the user's own handle(s); anything broader is refused. */
export function allowlistChecks(): Check[] {
  const chat = process.env.GATE_ALLOWED_CHAT ?? '';
  const own = process.env.GATE_OWN_HANDLE ?? '';
  const out: Check[] = [];
  out.push({
    name: 'exactly one allowlisted chat (GATE_ALLOWED_CHAT)',
    ok: !!chat && !chat.includes(','),
    detail: chat
      ? chat.includes(',')
        ? 'more than one chat given'
        : 'one chat guid set'
      : 'not set',
  });
  out.push({
    name: 'own handle set (GATE_OWN_HANDLE)',
    ok: !!own && normHandle(own).length >= 5,
    detail: own ? 'set' : 'not set',
  });
  out.push({
    name: 'IMESSAGE_ALLOW_ALL is not set',
    ok: process.env.IMESSAGE_ALLOW_ALL !== '1' && process.env.IMESSAGE_ALLOW_ALL !== 'true',
    detail: 'allow-all disables both lists and is never used by the gate',
  });
  return out;
}

export function ownAccountChecks(): Check[] {
  const names = definedEnvNames();
  const has = (n: string) => names.has(n);
  return [
    {
      name: 'own Google account declared (GATE_OWN_GOOGLE_EMAIL)',
      ok: has('GATE_OWN_GOOGLE_EMAIL'),
      detail: has('GATE_OWN_GOOGLE_EMAIL') ? 'set' : 'not set',
    },
    {
      name: 'own Canvas host declared (GATE_OWN_CANVAS_HOST)',
      ok: has('GATE_OWN_CANVAS_HOST'),
      detail: has('GATE_OWN_CANVAS_HOST') ? 'set' : 'not set',
    },
    {
      name: 'Google OAuth client configured in the hub env',
      ok: has('GOOGLE_OAUTH_CLIENT_ID') && has('GOOGLE_OAUTH_CLIENT_SECRET'),
      detail: 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (names only)',
    },
  ];
}

/** The Canvas feed host must be the user's own; a feed for any other host is refused before it is ever fetched. */
export function canvasHostIsOwn(feedUrl: string | undefined): boolean {
  const own = process.env.GATE_OWN_CANVAS_HOST;
  if (!feedUrl || !own) return false;
  try {
    return new URL(feedUrl).host.toLowerCase() === own.toLowerCase();
  } catch {
    return false;
  }
}

/** Count of would-be or real outbound messages in a run; the smoke script aborts when it exceeds MAX_OUTBOUND. */
export class OutboundCounter {
  private n = 0;
  note(k = 1): void {
    this.n += k;
    if (this.n > MAX_OUTBOUND)
      throw new Error(`outbound budget exceeded (${MAX_OUTBOUND}); aborting`);
  }
  get count() {
    return this.n;
  }
}

/** Writes would-be outbound text for the reviewer to read. Lives under .tmp-real (gitignored), never committed. */
export function writeOutboxForReview(lines: string[]): string {
  const file = path.join(REPO, 'e2e/gate/.tmp-real/outbox-review.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n---\n') + '\n');
  return path.relative(REPO, file);
}
