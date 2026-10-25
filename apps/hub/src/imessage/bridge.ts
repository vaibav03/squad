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
} from '@squad/core';
import {
  detectMention,
  renderForIMessage,
  type GatewayInbound,
  type IMessageGateway,
} from '@squad/bot';
import type { HubDeps } from '../types';
import { activateSquad, announceMember } from '../routes/squads';
import { parseCommand } from './commands';
import { maskHandle, type ImessageStore } from './store';

export interface BridgeOptions {
  deps: HubDeps;
  gateway: IMessageGateway;
  store: ImessageStore;
  /** Base of the web links in messages. Default: the hub's HUB_WEB_URL. */
  webUrl?: string;
  now?: () => number;
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
  const log = deps.log;

  /** Raw handles live in memory only (never stored): where a nudge or reply to a student can be sent. */
  const handles = new Map<string, string>();
  const lastInbound = new Map<string, { via: string; ts: number }>();
  const quiz = new Map<string, { ids: string[]; at: number }>();
  const hinted = new Map<string, number>();
  let chain: Promise<unknown> = Promise.resolve();

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

  const userByHash = (hash: string): string | undefined => {
    const r = deps.db.prepare('SELECT id FROM acct_users WHERE contact_hash=?').get(hash) as
      { id: string } | undefined;
    return r?.id ?? store.linkedUser(hash);
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

  async function relay(m: GatewayInbound, userId: string, chatId: string, squadId: string) {
    const text = translateQuizReply(chatId, m.text);
    lastInbound.set(userId, { via: 'imessage', ts: now() });
    const res = await deps.chat.send(
      { studentId: userId, squadId, projector: false },
      { chatId: chatId as `group:${string}` | `dm:${string}`, text: text.slice(0, 4000) },
      { via: 'imessage' },
    );
    if (!res.ok) {
      log.warn('imessage: relay refused', { code: res.code });
      if (res.status === 429)
        say(m.isGroup ? m.chatGuid : m.sender, 'I am a little busy. Try again in a minute.');
    }
  }

  // ---------- inbound ----------
  async function dmInbound(m: GatewayInbound, id: Ident | undefined, userId: string | undefined) {
    if (!id) {
      say(
        m.sender,
        'I can only match a phone number or an Apple ID email. Sign up at ' + `${web}/welcome.`,
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
    await relay(m, userId, `dm:${userId}`, deps.directory.squadOf(userId) ?? '');
  }

  async function groupInbound(
    m: GatewayInbound,
    id: Ident | undefined,
    userId: string | undefined,
  ) {
    if (id) store.touchParticipant(m.chatGuid, id.hash, id.hint);
    const cmd = parseCommand(m.text);
    const binding = store.binding(m.chatGuid);
    const bound = binding && deps.directory.squad(binding.squadId) ? binding : undefined;
    if (binding && !bound) store.unbind(m.chatGuid); // the squad was disbanded

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
      return;
    }
    if (!isMember(bound.squadId, userId)) {
      if (mention && !hintCooldown(`nonmember:${m.chatGuid}:${userId}`))
        say(
          m.chatGuid,
          `${nameOf(userId)}, you are not in ${squadName(bound.squadId)} yet. Send: join <invite code>`,
        );
      return;
    }
    await relay(m, userId, `group:${bound.squadId}`, bound.squadId);
  }

  async function handleInbound(m: GatewayInbound) {
    try {
      // dedupe by message guid already happened in the gateway (persistent through `store.seen`)
      const id = ident(m.sender);
      const userId = id ? userByHash(id.hash) : undefined;
      if (m.isGroup) await groupInbound(m, id, userId);
      else await dmInbound(m, id, userId);
    } catch (e) {
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

  const send = (to: string, parts: string[], who: string) => {
    if (!parts.length) return;
    chain = chain
      .then(async () => {
        for (let i = 0; i < parts.length; i++)
          await gateway.send(to, i === 0 ? `${who}${parts[i]}` : parts[i]!);
      })
      .catch((e: Error) => log.error('imessage: mirror failed', { err: e.name }));
  };

  const offBot = deps.chat.onBotPost((msg) => {
    if (msg.sender.kind !== 'persona') return;
    const who = `${msg.sender.emoji ? `${msg.sender.emoji} ` : ''}${msg.sender.name}: `;
    if (msg.chatId.startsWith('group:')) {
      const sid = msg.chatId.slice(6);
      const targets = store.bindingsOf(sid);
      if (!targets.length) return;
      rememberQuiz(msg);
      const parts = render(msg, true);
      for (const b of targets) send(b.chatGuid, parts, who);
      return;
    }
    if (msg.chatId.startsWith('dm:')) {
      const uid = msg.chatId.slice(3);
      const handle = handles.get(uid);
      if (!handle) return; // never texted us since this process started: nothing to send to
      const li = lastInbound.get(uid);
      if (li && li.via !== 'imessage' && now() - li.ts < WEB_DM_QUIET_MS) return; // a web conversation
      rememberQuiz(msg);
      send(handle, render(msg, false), who);
    }
  });
  const offStudent = deps.chat.onStudentMessage((msg, via) => {
    if (msg.sender.kind === 'student') lastInbound.set(msg.sender.id, { via, ts: now() });
  });

  return {
    handleInbound,
    resolveUser,
    stop() {
      offBot();
      offStudent();
    },
    flush: () => chain.then(() => undefined),
  };
}
