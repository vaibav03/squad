/**
 * iMessage verification gate (spec 02). Proves Photon imessage-kit works on THIS Mac.
 *
 *   pnpm exec tsx scripts/verify-imessage.ts --dry-run --yes          # no permissions needed
 *   pnpm exec tsx scripts/verify-imessage.ts --group "Cubbie Test" --to +15551234567
 *
 * Checks: (1) the group is listed, (2) a group message's TEXT reaches us within 5 s (the macOS 27
 * attributedBody check), (3) a reply sends, (4) a DM round trip reads "1" (askConfirm proxy),
 * (5) an image and an .m4a send (warn-only). Exit 0 iff 1-4 pass. Never prints message contents
 * other than the verify marker texts. Real runs need the owner's spare Apple ID, Full Disk Access
 * and Messages automation: see apps/bot/README.md.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { accessSync, constants, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseConfirmReply } from '../apps/bot/src/confirm-parse';
import type { IMessageMessageLike, IMessageSdkLike } from '../apps/bot/src/transports/imessage';

export interface VerifyOptions {
  group: string;
  to?: string;
  attach?: string;
  timeoutSec: number;
  yes: boolean;
  dryRun: boolean;
  simulateFail?: 'text' | 'send' | 'attachment' | 'permission';
}

export interface VerifyDeps {
  sdk: IMessageSdkLike;
  prompt(q: string): Promise<string>;
  now(): number;
  sleep(ms: number): Promise<void>;
  out(line: string): void;
  platform: string;
  macVersion(): string;
  canReadChatDb(): { ok: boolean; error?: string };
  makeFixtures(): { png: string; m4a?: string; note?: string };
}

type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
export interface CheckResult {
  id: string;
  name: string;
  status: Status;
  detail: string;
}
export interface VerifyReport {
  results: CheckResult[];
  exitCode: number;
  recommendation: string;
}

const TEXT_BUDGET_MS = 5000;

export async function runVerification(
  opts: VerifyOptions,
  deps: VerifyDeps,
): Promise<VerifyReport> {
  const { out, sdk } = deps;
  const results: CheckResult[] = [];
  const rec = (id: string, name: string, status: Status, detail: string) => {
    results.push({ id, name, status, detail });
    out(`[${status}] ${id} ${name}: ${detail}`);
  };
  const finish = (): VerifyReport => {
    const must = results.filter((r) => ['1', '2', '3', '4'].includes(r.id) || r.id === '0');
    const ok = must.length >= 5 && must.every((r) => r.status === 'PASS');
    out('');
    out('Summary');
    for (const r of results) out(`  ${r.status.padEnd(4)}  ${r.id}  ${r.name}`);
    const recommendation = ok
      ? 'iMessage works on this Mac. Run the bot with TRANSPORT=imessage (pnpm --filter @squad/bot dev).'
      : 'iMessage did not pass. Fix the FAIL above, or switch now: TRANSPORT=discord (see apps/bot/DISCORD.md). Nothing else changes.';
    out(recommendation);
    return { results, exitCode: ok ? 0 : 1, recommendation };
  };

  // 0. preflight
  const mac = deps.platform === 'darwin' ? deps.macVersion() : 'n/a';
  if (deps.platform !== 'darwin') {
    rec('0', 'preflight', 'FAIL', `needs macOS (this is ${deps.platform})`);
    return finish();
  }
  const fda = deps.canReadChatDb();
  if (!fda.ok) {
    rec(
      '0',
      'preflight',
      'FAIL',
      `cannot read ~/Library/Messages/chat.db (${fda.error}). Grant Full Disk Access to THIS terminal app ` +
        '(System Settings > Privacy & Security > Full Disk Access), quit and reopen the terminal, rerun.',
    );
    return finish();
  }
  rec('0', 'preflight', 'PASS', `macOS ${mac}, node ${process.versions.node}, chat.db readable`);

  // single watcher: everything lands in a mailbox
  const inbox: { m: IMessageMessageLike; at: number }[] = [];
  let watchErr: string | undefined;
  await sdk.startWatching({
    onIncomingMessage: (m) => void inbox.push({ m, at: deps.now() }),
    onError: (e) => void (watchErr = e.message),
  });
  const waitFor = async (pred: (m: IMessageMessageLike) => boolean, ms: number, from = 0) => {
    const end = deps.now() + ms;
    for (;;) {
      const hit = inbox.slice(from).find((x) => pred(x.m));
      if (hit) return hit;
      if (deps.now() >= end) return undefined;
      await deps.sleep(100);
    }
  };

  try {
    // 1. group listed
    let groupId: string | undefined;
    try {
      const chats = await sdk.listChats({ kind: 'group' });
      const g = chats.find((c) => (c.name ?? '').toLowerCase() === opts.group.toLowerCase());
      groupId = g?.chatId;
      if (g)
        rec('1', 'group listed', 'PASS', `"${opts.group}" found among ${chats.length} group chats`);
      else
        rec(
          '1',
          'group listed',
          'FAIL',
          `"${opts.group}" not among ${chats.length} group chats. Create it on the iPhone with the bot Apple ID, send one message, retry (or pass --group).`,
        );
    } catch (e) {
      rec('1', 'group listed', 'FAIL', `listChats failed: ${(e as Error).message}`);
    }

    // 2. text arrives within 5 s
    out('');
    out(
      `ACTION: from your phone, send the text  verify 123  in the group "${opts.group}" now (waiting ${opts.timeoutSec}s).`,
    );
    const got = await waitFor(
      (m) => m.chatId === groupId || (!groupId && m.chatKind === 'group'),
      opts.timeoutSec * 1000,
    );
    if (!got) {
      rec(
        '2',
        'group text within 5s',
        'FAIL',
        `no group message seen in ${opts.timeoutSec}s${watchErr ? ` (watcher error: ${watchErr})` : ''}. Check Full Disk Access and that the bot Apple ID is in the group.`,
      );
    } else if (!got.m.text) {
      rec(
        '2',
        'group text within 5s',
        'FAIL',
        'message arrived but its text is empty. This is the macOS 26/27 attributedBody decoding problem: imessage-kit could not read the text. Use TRANSPORT=discord.',
      );
    } else {
      const latency = got.at - got.m.createdAt.getTime();
      const ok = latency <= TEXT_BUDGET_MS && latency > -60_000;
      rec(
        '2',
        'group text within 5s',
        ok ? 'PASS' : 'FAIL',
        `text decoded (${got.m.text.length} chars), delivered ${latency} ms after it was stored`,
      );
    }

    // 3. reply
    const target = groupId ?? got?.m.chatId ?? undefined;
    if (!target) rec('3', 'send reply', 'FAIL', 'no group chat id to send to');
    else {
      try {
        await sdk.send({ to: target, text: 'verify ok (spine check 3)' });
        const seen = opts.yes
          ? 'y'
          : await deps.prompt(
              'Did "verify ok (spine check 3)" appear on your phone in the group? [y/n] ',
            );
        rec(
          '3',
          'send reply',
          /^y/i.test(seen) ? 'PASS' : 'FAIL',
          /^y/i.test(seen)
            ? 'reply sent and seen'
            : 'send returned but the owner did not see it (no delivery receipt exists; check Automation permission for Messages)',
        );
      } catch (e) {
        rec('3', 'send reply', 'FAIL', `send failed: ${(e as Error).message}`);
      }
    }

    // 4. DM round trip
    if (!opts.to) rec('4', 'DM + read "1"', 'FAIL', 'pass --to <your phone or email> to test DMs');
    else {
      try {
        const from = inbox.length;
        await sdk.send({ to: opts.to, text: 'verify: reply 1 to this message (spine check 4)' });
        out(`ACTION: reply  1  to the DM you just received on ${opts.to}.`);
        const reply = await waitFor(
          (m) =>
            m.chatKind !== 'group' &&
            parseConfirmReply(m.text ?? '', ['Yes', 'No']).kind === 'match',
          opts.timeoutSec * 1000,
          from,
        );
        rec(
          '4',
          'DM + read "1"',
          reply ? 'PASS' : 'FAIL',
          reply ? 'DM sent and the reply "1" was read' : `no DM reply within ${opts.timeoutSec}s`,
        );
      } catch (e) {
        rec('4', 'DM + read "1"', 'FAIL', `DM failed: ${(e as Error).message}`);
      }
    }

    // 5. attachments (warn-only)
    try {
      const fx = deps.makeFixtures();
      const to = target ?? opts.to;
      if (!to) throw new Error('no destination');
      await sdk.send({ to, attachments: [opts.attach ?? fx.png] });
      if (fx.m4a) await sdk.send({ to, attachments: [fx.m4a] });
      const seen = opts.yes
        ? 'y'
        : await deps.prompt(`Did an image${fx.m4a ? ' and an audio clip' : ''} arrive? [y/n] `);
      rec(
        '5',
        'attachments',
        /^y/i.test(seen) && fx.m4a ? 'PASS' : 'WARN',
        /^y/i.test(seen)
          ? fx.m4a
            ? 'image and .m4a sent'
            : `image sent; ${fx.note ?? 'no .m4a made'}`
          : 'not seen by the owner (can be fixed later; checks 1-4 decide pass)',
      );
    } catch (e) {
      rec(
        '5',
        'attachments',
        'WARN',
        `attachment send failed: ${(e as Error).message} (not required to pass)`,
      );
    }
  } finally {
    await sdk.stopWatching().catch(() => undefined);
    await sdk.close().catch(() => undefined);
  }
  return finish();
}

// ---- real and dry-run wiring ---------------------------------------------------------------

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

export function realFixtures(): { png: string; m4a?: string; note?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'squad-verify-'));
  const png = join(dir, 'verify.png');
  writeFileSync(png, PNG_1X1);
  try {
    const aiff = join(dir, 'verify.aiff');
    const m4a = join(dir, 'verify.m4a');
    execFileSync('say', ['-o', aiff, 'Squad verification']);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a]);
    return { png, m4a };
  } catch (e) {
    return { png, note: `could not create an .m4a (${(e as Error).message.split('\n')[0]})` };
  }
}

/** A healthy-Mac simulation for --dry-run. `simulateFail` shows the failure paths. */
export function createDryRunSdk(
  fail?: VerifyOptions['simulateFail'],
  group = 'Cubbie Test',
): IMessageSdkLike {
  let events: Parameters<IMessageSdkLike['startWatching']>[0] = {};
  const base = (o: Partial<IMessageMessageLike>): IMessageMessageLike => ({
    id: String(Math.random()),
    chatId: 'iMessage;+;dryrun',
    chatKind: 'group',
    participant: '+15550000000',
    text: 'verify 123',
    kind: 'text',
    isFromMe: false,
    createdAt: new Date(),
    attachments: [],
    ...o,
  });
  return {
    async startWatching(e) {
      events = e;
      setTimeout(
        () =>
          void events.onIncomingMessage?.(base({ text: fail === 'text' ? null : 'verify 123' })),
        150,
      );
    },
    async stopWatching() {},
    async close() {},
    async listChats() {
      return [{ chatId: 'iMessage;+;dryrun', name: group, kind: 'group' }];
    },
    async send(r) {
      if (fail === 'send' && r.text) throw new Error('simulated AppleScript failure');
      if (fail === 'attachment' && r.attachments) throw new Error('simulated attachment failure');
      if (r.text?.includes('check 4')) {
        setTimeout(
          () =>
            void events.onIncomingMessage?.(
              base({ chatId: 'iMessage;-;dm', chatKind: 'dm', text: '1' }),
            ),
          100,
        );
      }
    },
  };
}

function parseArgs(argv: string[]): VerifyOptions {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sf = argv
    .find((a) => a.startsWith('--simulate-fail='))
    ?.split('=')[1] as VerifyOptions['simulateFail'];
  return {
    group: get('--group') ?? 'Cubbie Test',
    to: get('--to') ?? (argv.includes('--dry-run') ? '+15550000000' : undefined),
    attach: get('--attach'),
    timeoutSec: Number(get('--timeout') ?? 120),
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    simulateFail: sf,
  };
}

/** The package is installed under apps/bot, so resolve it from there (this script lives at the repo root). */
function loadRealSdk(): IMessageSdkLike {
  const req = createRequire(fileURLToPath(new URL('../apps/bot/package.json', import.meta.url)));
  const mod = req('@photon-ai/imessage-kit') as { IMessageSDK: new () => IMessageSdkLike };
  return new mod.IMessageSDK();
}

export async function cli(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const dry = opts.dryRun;
  const macVersion = () => {
    try {
      return execFileSync('sw_vers', ['-productVersion']).toString().trim();
    } catch {
      return 'unknown';
    }
  };
  if (dry) console.log('DRY RUN: simulated sdk, nothing is sent and no permissions are needed.');
  const sdk: IMessageSdkLike = dry ? createDryRunSdk(opts.simulateFail, opts.group) : loadRealSdk();
  const report = await runVerification(opts, {
    sdk,
    prompt: (q) => rl.question(q),
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    out: (l) => console.log(l),
    platform: dry && opts.simulateFail !== 'permission' ? 'darwin' : process.platform,
    macVersion,
    canReadChatDb: () => {
      if (dry)
        return opts.simulateFail === 'permission'
          ? { ok: false, error: 'EPERM (simulated)' }
          : { ok: true };
      try {
        accessSync(join(homedir(), 'Library/Messages/chat.db'), constants.R_OK);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as NodeJS.ErrnoException).code ?? (e as Error).message };
      }
    },
    makeFixtures: realFixtures,
  });
  rl.close();
  return report.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().then((c) => process.exit(c));
}
