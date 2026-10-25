// The iMessage <-> hub chat bridge (docs/imessage.md).
//
// Inbound: a text from Apple (already safety-filtered by the gateway) is mapped to a Squad account by hashing the
// sender handle with the accounts salt, then goes through the SAME hub chat API (`ChatHub.send`) as a web message,
// so it is stored, streamed to the web chat and routed by the same router and speaking policy.
// Outbound: every bot message stored in the hub chat is mirrored to the bound group (group chats) or to the
// student's own 1:1 (DMs), rendered as plain text.
import {
  findLeak,
  normalizeEmail,
  normalizePhone,
  SENTINELS,
  type ChatMessage,
  type ContactChannel,
  type SkippedAttachment,
} from '@squad/core';
import {
  detectMention,
  renderForIMessage,
  splitMessage,
  type GatewayInbound,
  type IMessageGateway,
} from '@squad/bot';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HubDeps } from '../types';
import { activateSquad, announceMember } from '../routes/squads';
import { parseCommand, stripMention } from './commands';
import { maskHandle, type ImessageStore } from './store';
import { createImessageSync, BACKFILL_ANSWER_MAX_MS, type ImessageSync } from './sync';
import { DELIVERY_LABELS, absolutizeLinks } from '@squad/core';
import { isMirrorEcho, mirrorText, shouldMirrorStudent } from './sync-rules';

export interface BridgeOptions {
  deps: HubDeps;
  gateway: IMessageGateway;
  store: ImessageStore;
  /** Which provider carries the chat, stamped on inbound messages ("via iMessage (Sendblue)"). */
  provider?: 'sendblue' | 'photon' | 'fixture';
  /** Base of the web links in messages. Default: the hub's HUB_WEB_URL. */
  webUrl?: string;
  now?: () => number;
  /** false: no retry/backfill timers (tests drive `sync.drain()` and `sync.backfillAll()` themselves). */
  timers?: boolean;
  /** The transport is a scripted stand-in (tests, demo), not Apple's Messages: the status says so. */
  fixture?: boolean;
}

export interface IMessageBridge {
  /** Feed one safety-filtered inbound text. Never throws. */
  handleInbound(m: GatewayInbound): Promise<void>;
  /** Stop mirroring (unsubscribe from the hub chat). */
  stop(): void;
  /** Resolves when every queued outbound mirror has been handed to the gateway (tests). */
  flush(): Promise<void>;
  /** The handle is mapped to a Squad user id, or undefined. */
  resolveUser(handle: string): string | undefined;
  /** The sync engine: outbound queue, delivery state, backfill (docs/imessage.md section 8). */
  readonly sync: ImessageSync;
}

/** Per-message bookkeeping while one inbound message is handled. */
interface Handling {
  late: boolean;
  storedId?: string;
}

const PREFIX = '\u{1F43B} Cubbie: ';
const PRIVATE_FALLBACK = 'I kept that private. Ask me in a DM.';
const WEB_DM_QUIET_MS = 10 * 60_000;
const QUIZ_TTL_MS = 30 * 60_000;
const HINT_COOLDOWN_MS = 10 * 60_000;

interface Ident {
  channel: ContactChannel;
  normalized: string;
  hash: string;
  hint: string;
}

const squash = (t: string) =>
  t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

export function createIMessageBridge(o: BridgeOptions): IMessageBridge {
  const { deps, gateway, store } = o;
  const now = o.now ?? deps.now;
  const web = (o.webUrl ?? deps.config.webUrl).replace(/\/+$/, '');
  // links inside reply text: only when a public web URL is configured; otherwise the page name, no link
  const publicWeb = o.webUrl ?? deps.config.publicWebUrl;
  const log = deps.log;

  /** Raw handles live in memory only (never stored): where a nudge or reply to a student can be sent. */
  const handles = new Map<string, string>();
  const lastInbound = new Map<string, { via: string; ts: number }>();
  const quiz = new Map<string, { ids: string[]; at: number }>();
  const hinted = new Map<string, number>();
  let chain: Promise<unknown> = Promise.resolve();
  const sync = createImessageSync({
    deps,
    gateway,
    store,
    now,
    timers: o.timers ?? true,
    ...(o.fixture ? { fixture: true } : {}),
    resolveTo: (target) => (target.startsWith('dm:') ? handles.get(target.slice(3)) : target),
    dmChats: () =>
      [...handles.values()].flatMap((h) => {
        const i = ident(h);
        return i ? [{ threadKey: `dm:${i.hash}`, chatGuid: `iMessage;-;${h}` }] : [];
      }),
  });

  const ident = (handle: string): Ident | undefined => {
    const h = handle.trim();
    const channel: ContactChannel = h.includes('@') ? 'email' : 'phone';
    const normalized = channel === 'email' ? normalizeEmail(h) : normalizePhone(h);
    if (!normalized) return undefined;
    return {
      channel,
      normalized,
      hash: deps.accounts.hashContact(channel, normalized),
      hint: maskHandle(channel, normalized),
    };
  };

  // demo handle -> roster student links (the roster student s_ana has no acct_users row, so imsg_links' FK cannot hold it)
  deps.db.exec(
    'CREATE TABLE IF NOT EXISTS imsg_demo_links(handle_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, linked_at INTEGER NOT NULL)',
  );
  const userByHash = (hash: string): string | undefined => {
    const r = deps.db.prepare('SELECT id FROM acct_users WHERE contact_hash=?').get(hash) as
      { id: string } | undefined;
    if (r?.id) return r.id;
    const l = store.linkedUser(hash);
    if (l) return l;
    if (!deps.config.demoCode) return undefined; // demo links only count while demo mode is on
    return (
      deps.db.prepare('SELECT user_id FROM imsg_demo_links WHERE handle_hash=?').get(hash) as
        { user_id: string } | undefined
    )?.user_id;
  };
  const resolveUser = (handle: string): string | undefined => {
    const id = ident(handle);
    return id ? userByHash(id.hash) : undefined;
  };

  const say = (to: string, text: string) =>
    void (chain = chain.then(() => gateway.send(to, `${PREFIX}${text}`)).catch(() => undefined));
  const nameOf = (id: string) => deps.directory.student(id)?.name ?? 'someone';
  const squadName = (sid: string) => deps.directory.squad(sid)?.name ?? 'your squad';
  const isMember = (sid: string, uid: string) =>
    deps.directory.squad(sid)?.members.includes(uid) ?? false;
  const hintCooldown = (key: string): boolean => {
    const t = now();
    if (t - (hinted.get(key) ?? -Infinity) < HINT_COOLDOWN_MS) return true;
    hinted.set(key, t);
    return false;
  };
  const hintWords = (hint: string) =>
    hint.startsWith('•') ? `a number ending ${hint.slice(-4)}` : hint;

  // ---------- quiz numbered replies ----------
  const quizKey = (chatId: string) => chatId;
  function translateQuizReply(chatId: string, text: string): string {
    const q = quiz.get(quizKey(chatId));
    if (!q) return text;
    if (now() - q.at > QUIZ_TTL_MS) {
      quiz.delete(quizKey(chatId));
      return text;
    }
    const m = /^\s*#?(\d)[.)]?\s*$/.exec(text);
    const id = m ? q.ids[Number(m[1]) - 1] : undefined;
    return id ?? text;
  }

  // ---------- who is linked ----------
  function summary(chatGuid: string, squadId: string): string {
    const parts = store.participants(chatGuid);
    const linked: string[] = [];
    const seenUsers = new Set<string>();
    const unlinked: string[] = [];
    for (const p of parts) {
      const uid = userByHash(p.handleHash);
      if (uid && isMember(squadId, uid)) {
        if (!seenUsers.has(uid)) linked.push(nameOf(uid));
        seenUsers.add(uid);
      } else unlinked.push(hintWords(p.hint));
    }
    const missing = (deps.directory.squad(squadId)?.members ?? [])
      .filter((m) => !seenUsers.has(m))
      .map(nameOf);
    const lines = [`This chat is linked to ${squadName(squadId)}.`];
    lines.push(
      linked.length
        ? `Linked here: ${linked.join(', ')}.`
        : 'I have not matched anyone in this chat to a Squad account yet.',
    );
    if (unlinked.length)
      lines.push(
        `Still need to sign up or link: ${unlinked.join(', ')}. Text me directly for a code, or sign up at ${web}/welcome.`,
      );
    if (missing.length)
      lines.push(
        `Squad members I have not heard from in this chat yet: ${missing.slice(0, 8).join(', ')}. Say hi so I can match you.`,
      );
    lines.push('Say @cubbie plus your question and I will answer here and in the web chat.');
    return lines.join('\n');
  }

  // ---------- demo join (HUB_ALLOW_DEMO=1 and a 6-digit HUB_DEMO_CODE only; config.demoCode is unset otherwise) ----------
  const DEMO_SQUAD = 'sq_demo';
  const DEMO_USER = 's_ana';
  const isDemoJoin = (text: string): boolean => {
    const code = deps.config.demoCode;
    if (!code || !/^\d{6}$/.test(code)) return false;
    const m = /^join\s+(\d{6})\s*$/i.exec(stripMention(text.trim()).text.trim());
    return !!m && m[1] === code;
  };

  // ---------- join / leave ----------
  function joinFlow(
    userId: string,
    code: string | null,
  ): { ok: true; squadId: string } | { ok: false; message: string } {
    if (!code)
      return {
        ok: false,
        message: 'That code does not look right. Ask the squad owner for an invite code.',
      };
    const pre = deps.squads.preview(code);
    if (!pre.ok) return { ok: false, message: pre.message ?? 'That invite code does not work.' };
    const res = deps.squads.join(userId, code);
    if (res.ok) {
      activateSquad(deps, userId, res.squadId);
      announceMember(deps, userId);
      return { ok: true, squadId: res.squadId };
    }
    if (res.code === 'already_member' && typeof res.extra?.squadId === 'string')
      return { ok: true, squadId: res.extra.squadId };
    return { ok: false, message: res.message ?? 'That invite code does not work.' };
  }

  async function relay(
    m: GatewayInbound,
    userId: string,
    chatId: string,
    squadId: string,
    h: Handling,
  ) {
    const text = translateQuizReply(chatId, m.text);
    lastInbound.set(userId, { via: 'imessage', ts: now() });
    const isGroup = chatId.startsWith('group:');
    const stale = h.late && now() - m.ts > BACKFILL_ANSWER_MAX_MS;
    const origin = (skipped: SkippedAttachment[]) => ({
      ts: m.ts,
      transport: 'imessage' as const,
      ...(o.provider ? { provider: o.provider } : {}),
      externalId: m.guid,
      senderLabel: nameOf(userId),
      ...(h.late ? { receivedLate: true } : {}),
      ...(skipped.length ? { skippedAttachments: skipped } : {}),
    });
    // an old message found by backfill is kept in the thread but not answered
    if (isGroup && stale) {
      const a = sync.intakeAttachments(m.attachments, (b, mime, name) =>
        saveAdopted(b, mime, name, chatId),
      );
      const posted = deps.chat.postExternal({
        chatId,
        sender: { kind: 'student', id: userId, name: nameOf(userId) },
        text: text.slice(0, 4000),
        origin: origin(a.skipped),
        attachments: a.attachments,
      });
      if (posted) h.storedId = posted.id;
      return;
    }
    const a = sync.intakeAttachments(m.attachments, (b, mime, name) =>
      deps.chat.files.saveUpload(userId, b, mime, name),
    );
    if (!text.trim() && !a.attachments.length) {
      // only files we cannot show: keep an honest placeholder in the group; a DM gets a plain answer
      if (isGroup) {
        const posted = deps.chat.postExternal({
          chatId,
          sender: { kind: 'student', id: userId, name: nameOf(userId) },
          text: '',
          origin: origin(a.skipped),
        });
        if (posted) h.storedId = posted.id;
      } else if (a.skipped.length) say(m.sender, 'I cannot open that kind of file here.');
      return;
    }
    const res = await deps.chat.send(
      {
        studentId: userId,
        squadId,
        projector: false,
      },
      {
        chatId: chatId as `group:${string}` | `dm:${string}`,
        text: text.slice(0, 4000),
        ...(a.attachments.length ? { attachments: a.attachments.map((x) => ({ id: x.id })) } : {}),
      },
      { via: 'imessage', origin: origin(a.skipped) },
    );
    if (res.ok) h.storedId = res.message.id;
    if (!res.ok) {
      log.warn('imessage: relay refused', { code: res.code });
      if (res.status === 429)
        say(m.isGroup ? m.chatGuid : m.sender, 'I am a little busy. Try again in a minute.');
    }
  }

  /** Files from people with no Squad account yet are adopted (not owned by a student). */
  function saveAdopted(bytes: Uint8Array, mime: string, name: string | undefined, chatId: string) {
    const dir = mkdtempSync(join(tmpdir(), 'imsg-'));
    const p = join(dir, 'f');
    try {
      writeFileSync(p, bytes);
      return deps.chat.files.adopt(p, mime, chatId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---------- inbound ----------
  async function dmInbound(
    m: GatewayInbound,
    id: Ident | undefined,
    userId: string | undefined,
    h: Handling,
  ) {
    if (!id) {
      say(
        m.sender,
        'I can only match a phone number or an Apple ID email. Sign up at ' + `${web}/welcome.`,
      );
      return;
    }
    if (!userId && isDemoJoin(m.text)) {
      // demo only (config.demoCode unset otherwise): this allowlisted handle acts as the demo student
      deps.db
        .prepare(
          'INSERT INTO imsg_demo_links(handle_hash,user_id,linked_at) VALUES(?,?,?) ON CONFLICT(handle_hash) DO UPDATE SET user_id=excluded.user_id',
        )
        .run(id.hash, DEMO_USER, now());
      handles.set(DEMO_USER, m.sender);
      say(
        m.sender,
        'This number is now linked to the Squad demo student (sample data, not a real account). Try: @cubbie what is due from Canvas this week and what Google files should I study?',
      );
      return;
    }
    if (!userId) {
      const code = store.linkCodeFor(id.hash, id.hint);
      if (!hintCooldown(`first:${id.hash}`))
        say(
          m.sender,
          `Hi, I am Cubbie, the Squad study bot. I do not know this number yet.\n1. Sign up or sign in at ${web}/welcome\n2. Enter this code to connect this number: ${code} (valid 30 minutes)\nIf you sign up with this exact number, I will recognise it on my own.`,
        );
      return;
    }
    handles.set(userId, m.sender);
    const cmd = parseCommand(m.text);
    if (cmd?.kind === 'join') {
      const r = joinFlow(userId, cmd.code);
      say(
        m.sender,
        r.ok ? `You are in ${squadName(r.squadId)}. Ask me anything in this chat.` : r.message,
      );
      return;
    }
    await relay(m, userId, `dm:${userId}`, deps.directory.squadOf(userId) ?? '', h);
  }

  async function groupInbound(
    m: GatewayInbound,
    id: Ident | undefined,
    userId: string | undefined,
    h: Handling,
  ) {
    if (id) store.touchParticipant(m.chatGuid, id.hash, id.hint);
    const cmd = parseCommand(m.text);
    const binding = store.binding(m.chatGuid);
    const bound = binding && deps.directory.squad(binding.squadId) ? binding : undefined;
    if (binding && !bound) store.unbind(m.chatGuid); // the squad was disbanded

    if (id && isDemoJoin(m.text)) {
      if (bound) {
        say(
          m.chatGuid,
          bound.squadId === DEMO_SQUAD
            ? 'This chat is already linked to the demo squad.'
            : `This chat is already linked to ${squadName(bound.squadId)}.`,
        );
        return;
      }
      if (!isMember(DEMO_SQUAD, DEMO_USER)) {
        say(m.chatGuid, 'The demo squad is not available.');
        return;
      }
      // demo only: this handle acts as the demo student, so @cubbie sees the same (Demo) context as the web
      if (!userId)
        deps.db
          .prepare(
            'INSERT INTO imsg_demo_links(handle_hash,user_id,linked_at) VALUES(?,?,?) ON CONFLICT(handle_hash) DO UPDATE SET user_id=excluded.user_id',
          )
          .run(id.hash, DEMO_USER, now());
      store.bind(m.chatGuid, DEMO_SQUAD, userId ?? DEMO_USER);
      store.setSyncSettings(DEMO_SQUAD, { mirror: 'full' });
      log.info('imessage: chat bound (demo)', { squadId: DEMO_SQUAD });
      say(
        m.chatGuid,
        `${summary(m.chatGuid, DEMO_SQUAD)}\nDemo mode: answers use the sample demo data.`,
      );
      return;
    }

    if (cmd?.kind === 'join') {
      if (!userId) {
        say(
          m.chatGuid,
          `I do not know that number yet. Text me directly (a 1:1 message) and I will send a code to connect it to your Squad account, then send the join code again.`,
        );
        return;
      }
      if (bound) {
        say(
          m.chatGuid,
          `This chat is already linked to ${squadName(bound.squadId)}. The squad owner can say @cubbie leave squad to unlink it first.`,
        );
        return;
      }
      const r = joinFlow(userId, cmd.code);
      if (!r.ok) {
        say(m.chatGuid, r.message);
        return;
      }
      store.bind(m.chatGuid, r.squadId, userId);
      log.info('imessage: chat bound', { squadId: r.squadId });
      say(m.chatGuid, summary(m.chatGuid, r.squadId));
      return;
    }
    if (cmd?.kind === 'leave') {
      if (!bound) return void say(m.chatGuid, 'This chat is not linked to a squad.');
      if (!userId || deps.squads.roleOf(bound.squadId, userId) !== 'owner')
        return void say(m.chatGuid, 'Only the squad owner can unlink this chat.');
      store.unbind(m.chatGuid);
      log.info('imessage: chat unbound', { squadId: bound.squadId });
      say(m.chatGuid, `Unlinked. This chat is no longer connected to ${squadName(bound.squadId)}.`);
      return;
    }
    if (cmd?.kind === 'who') {
      say(
        m.chatGuid,
        bound
          ? summary(m.chatGuid, bound.squadId)
          : 'This chat is not linked to a squad yet. Send: join <invite code>',
      );
      return;
    }

    const mention = detectMention(m.text, true);
    if (!bound) {
      if (mention && !hintCooldown(`unbound:${m.chatGuid}`))
        say(
          m.chatGuid,
          'I am not linked to a squad in this chat yet. Get an invite code on the Squad app, then send: join <invite code>',
        );
      return;
    }
    if (!userId) {
      if (mention && !hintCooldown(`unknown:${m.chatGuid}:${id?.hash ?? m.sender}`))
        say(
          m.chatGuid,
          `I cannot match that number to a Squad account yet. Text me directly for a code, or sign up at ${web}/welcome.`,
        );
      if (!mention || o.provider === 'sendblue') postUnlinked(m, id, bound.squadId, h);
      return;
    }
    if (!isMember(bound.squadId, userId)) {
      if (mention && !hintCooldown(`nonmember:${m.chatGuid}:${userId}`))
        say(
          m.chatGuid,
          `${nameOf(userId)}, you are not in ${squadName(bound.squadId)} yet. Send: join <invite code>`,
        );
      if (!mention || o.provider === 'sendblue') postUnlinked(m, id, bound.squadId, h);
      return;
    }
    handles.set(userId, m.sender); // lets a private reply (the unknown-tag help DM) reach this person's own 1:1
    await relay(m, userId, `group:${bound.squadId}`, bound.squadId, h);
  }

  /**
   * A group message from someone who is not a linked squad member and does not address the bot: shown in the web
   * thread as read-only context under a masked handle label (never the raw number), not routed to the bot.
   */
  function postUnlinked(m: GatewayInbound, id: Ident | undefined, squadId: string, h: Handling) {
    const canonical = o.provider === 'sendblue'; // Sendblue: every accepted group message is kept on the web
    if (!canonical && !store.syncSettings(squadId).showUnlinked) return;
    const label = canonical
      ? id?.channel === 'phone'
        ? `iMessage \u2022\u2022\u2022\u2022${id.normalized.slice(-4)}`
        : 'iMessage guest'
      : (id?.hint ?? 'Someone');
    const chatId = `group:${squadId}`;
    const a = sync.intakeAttachments(m.attachments, (b, mime, name) =>
      saveAdopted(b, mime, name, chatId),
    );
    if (!m.text.trim() && !a.attachments.length && !a.skipped.length) return;
    const posted = deps.chat.postExternal({
      chatId,
      sender: { kind: 'system', name: label },
      text: m.text.slice(0, 4000),
      origin: {
        ts: m.ts,
        transport: 'imessage',
        ...(o.provider ? { provider: o.provider } : {}),
        externalId: m.guid,
        senderLabel: label,
        ...(h.late ? { receivedLate: true } : {}),
        ...(a.skipped.length ? { skippedAttachments: a.skipped } : {}),
      },
      attachments: a.attachments,
    });
    if (posted) h.storedId = posted.id;
  }

  async function handleInbound(m: GatewayInbound) {
    const id = ident(m.sender);
    const threadKey = m.isGroup ? m.chatGuid : `dm:${id?.hash ?? 'unknown'}`;
    // identity map: one claim per Apple guid. Redeliveries, backfill overlap and races all stop here.
    if (store.claimInbound(m.guid, threadKey, id?.hash ?? null, m.ts) === 'duplicate') {
      sync.stats.duplicates++;
      return;
    }
    try {
      if (isMirrorEcho(m.text)) {
        // our own "(via Squad)" mirror coming back: never re-posted (web -> iMessage -> web loop protection)
        sync.stats.echoes++;
        store.finishInbound(m.guid, 'handled');
        return;
      }
      const cur = store.cursor(threadKey);
      const h: Handling = { late: !!m.late || (!!cur && m.ts < cur.lastTs) };
      if (h.late) sync.stats.late++;
      const userId = id ? userByHash(id.hash) : undefined;
      if (m.isGroup) await groupInbound(m, id, userId, h);
      else await dmInbound(m, id, userId, h);
      store.finishInbound(m.guid, h.storedId ? 'stored' : 'handled', h.storedId);
      store.advanceCursor(threadKey, m.ts, m.guid);
    } catch (e) {
      store.releaseInbound(m.guid); // a redelivery or the next backfill may try again
      log.error('imessage: inbound failed', { err: (e as Error).name });
    }
  }

  // ---------- outbound mirror ----------
  const linkOf = (msg: ChatMessage) => `${web}/squad?m=${msg.id}`;
  const leaks = (text: string, secrets: readonly string[]) =>
    !!findLeak(text, secrets) ||
    secrets.some((x) => squash(x).length >= 6 && squash(text).includes(squash(x)));

  function render(msg: ChatMessage, group: boolean): string[] {
    const council = msg.card?.type === 'council' ? deps.council?.get(msg.card.runId) : undefined;
    const councilLink =
      msg.card?.type === 'council' ? `${web}/squad?council=${msg.card.runId}` : undefined;
    let parts = renderForIMessage(msg, {
      link: linkOf(msg),
      ...(councilLink ? { councilLink } : {}),
      council,
    });
    // plain text with absolute links only (a relative /squad/... path is useless on a phone)
    parts = parts.map((p) => absolutizeLinks(p, publicWeb));
    if (group) {
      const secrets = [...SENTINELS, ...deps.ledger.privateValues()];
      if (parts.some((p) => leaks(p, secrets))) {
        log.warn('imessage: group mirror withheld by leak guard');
        parts = [PRIVATE_FALLBACK];
      }
    }
    return parts;
  }

  function rememberQuiz(msg: ChatMessage) {
    if (msg.card?.type === 'quiz' && msg.card.choices?.length)
      quiz.set(quizKey(msg.chatId), { ids: msg.card.choices.map((c) => c.id), at: now() });
    else if (msg.card?.type !== 'confirm') quiz.delete(quizKey(msg.chatId));
  }

  /** Queue one hub message for one target. The queue sends it, retries it and reports its state. */
  const send = (messageId: string, target: string, parts: string[], who: string) => {
    if (!parts.length) return;
    const texts = parts.flatMap((p, i) => splitMessage(i === 0 ? `${who}${p}` : p, 900));
    sync.queue(
      messageId,
      target,
      texts.map((text) => ({ text })),
    );
    kick();
  };
  const kick = () => void (chain = chain.then(() => sync.drain()).catch(() => undefined));

  const offBot = deps.chat.onBotPost((msg) => {
    if (msg.sender.kind !== 'persona') return;
    const who = `${msg.sender.emoji ? `${msg.sender.emoji} ` : ''}${msg.sender.name}: `;
    if (msg.chatId.startsWith('group:')) {
      const sid = msg.chatId.slice(6);
      const targets = store.bindingsOf(sid);
      if (!targets.length) return;
      rememberQuiz(msg);
      const parts = render(msg, true);
      for (const b of targets) send(msg.id, b.chatGuid, parts, who);
      return;
    }
    if (msg.chatId.startsWith('dm:')) {
      const uid = msg.chatId.slice(3);
      const handle = handles.get(uid);
      if (!handle) return; // never texted us since this process started: nothing to send to
      const li = lastInbound.get(uid);
      if (li && li.via !== 'imessage' && now() - li.ts < WEB_DM_QUIET_MS) return; // a web conversation
      rememberQuiz(msg);
      send(msg.id, `dm:${uid}`, render(msg, false), who);
    }
  });

  /**
   * Web squad chat -> bound iMessage groups, for STUDENT messages (docs/imessage.md section 8.4). Default: only the
   * messages that @mention an agent; per-squad `full` copies everything; `bot_only` copies nothing. A DM never
   * crosses; an iMessage-origin message never goes back.
   */
  function mirrorStudent(msg: ChatMessage, via: string) {
    if (msg.sender.kind !== 'student' || !msg.chatId.startsWith('group:')) return;
    const sid = msg.chatId.slice(6);
    const targets = store.bindingsOf(sid);
    if (!targets.length || via === 'imessage') return;
    const settings = store.syncSettings(sid);
    const webOnly = (label: string) =>
      void deps.chat.annotate(msg.id, {
        transport: 'web',
        deliveryState: { state: 'web_only', label, updatedAt: now() },
      });
    if (
      !shouldMirrorStudent({
        mode: settings.mirror,
        chatId: msg.chatId,
        via,
        mentionsAgent: !!detectMention(msg.text, true),
      })
    )
      return webOnly(DELIVERY_LABELS.web_only);
    const secrets = [...SENTINELS, ...deps.ledger.privateValues()];
    if (leaks(msg.text, secrets)) {
      sync.stats.withheld++;
      return webOnly('Kept on the web: it contains private info');
    }
    const senderId = msg.sender.id;
    const files = msg.attachments.flatMap((a) => {
      const f = deps.chat.files.open(a.id, { studentId: senderId, squadId: sid });
      return f ? [f.path] : [];
    });
    const parts = [
      ...(msg.text ? [{ text: mirrorText(msg.sender.name, msg.text) }] : []),
      ...files.map((p, i) => ({
        text: !msg.text && i === 0 ? mirrorText(msg.sender.name, '') : null,
        attachments: [p],
      })),
    ];
    if (!parts.length) return;
    for (const b of targets) sync.queue(msg.id, b.chatGuid, parts);
    kick();
  }
  const offStudent = deps.chat.onStudentMessage((msg, via) => {
    if (msg.sender.kind === 'student') lastInbound.set(msg.sender.id, { via, ts: now() });
    try {
      mirrorStudent(msg, via);
    } catch (e) {
      log.error('imessage: student mirror failed', { err: (e as Error).name });
    }
  });
  sync.start();

  return {
    handleInbound,
    resolveUser,
    sync,
    stop() {
      offBot();
      offStudent();
      sync.stop();
    },
    flush: async () => {
      await chain;
      await sync.drain();
    },
  };
}
