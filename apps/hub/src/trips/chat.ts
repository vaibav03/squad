// Chat -> trip actions. Runs in the hub BEFORE the bot router for every student message (web or iMessage via the bridge),
// returns true when it handled the text. It only acts on tight patterns, so ordinary chatter still reaches the bot.
import { parseConfirmReply } from '@squad/bot';
import { parseMentions, plannerIntent, plural } from '@squad/core';
import type { HubDeps, Viewer } from '../types';
import { monthOf, MONTHS, pickRange, voteHelp } from './logic';
import type { TripService } from './service';

/** Agents whose tag addresses trip planning (the shared alias table maps cubbie/cubbi/squad to `cubbie`). */
const TRIP_AGENTS = new Set(['cubbie', 'planner', 'council']);
/** True when the text tags Nook, the planner or the council, by the shared mention parser (typos, emails, quotes and code do not count). */
export function addressesTrip(text: string): boolean {
  return parseMentions(text).mentions.some((m) => TRIP_AGENTS.has(m.agent.id));
}
const CREATE = /\b(?:plan|organi[sz]e|start|set\s*up|book)\b[^.!?\n]*?\btrip\b([^\n]*)$/i;
const MONTH_WORDS = MONTHS.map((m) => m.slice(0, 3))
  .concat(MONTHS, ['sept'])
  .join('|');
const MONTH = new RegExp(`\\b(${MONTH_WORDS})\\b\\.?`, 'i');
const DEST_STOP =
  '(?=\\s+(?:in|during|around|for|on|from|next|this|under|with|over|sometime|please)\\b|[,.!?;]|$)';
const DEST_TO = new RegExp(`\\b(?:to|at)\\s+([A-Za-z][A-Za-z .'-]{1,40}?)${DEST_STOP}`, 'i');
const DEST_IN = new RegExp(`\\bin\\s+([A-Za-z][A-Za-z .'-]{1,40}?)${DEST_STOP}`, 'i');
const VOTE =
  /^\s*(?:@\w+[\s,:]*)?(?:i\s+|i'd\s+|we\s+)?(?:vote|pick|choose|go\s+with|rank)\s+(?:for\s+)?(?:option\s+|#)?(.+?)\s*[.!]*$/i;
const BARE_NUM = /^\s*(?:@\w+[\s,:]*)?(?:option\s+|#)?(\d+)\s*[.!]*$/i;
const CONFIRM = /^\s*(?:@\w+[\s,:]*)?(?:i\s+)?(?:confirm|i'?m\s+in|count\s+me\s+in)[.! ]*$/i;
const DECLINE =
  /^\s*(?:@\w+[\s,:]*)?(?:i\s+)?(?:can'?t\s+make\s+it|i'?m\s+out|not\s+for\s+me|decline)[.! ]*$/i;
const CANCEL = /\bcancel\b[^.!?\n]*\btrip\b/i;
const STATUS = /\b(?:trip\s+status|how'?s\s+the\s+trip|where\s+are\s+we\s+on\s+the\s+trip)\b/i;

export interface TripChatCtx {
  deps: HubDeps;
  svc: TripService;
  nameOf(id: string): string;
}

const usage = 'Tell me where: "@nook plan a trip to Cabo in March".';

export function parseCreate(
  text: string,
): { destination: string; month?: number } | 'no_destination' | null {
  const m = CREATE.exec(text);
  if (!m) return null;
  const rest = m[1] ?? '';
  const dest = DEST_TO.exec(rest)?.[1] ?? DEST_IN.exec(rest)?.[1];
  const monthWord = MONTH.exec(rest)?.[1];
  const month = monthWord ? monthOf(monthWord === 'sept' ? 'september' : monthWord) : undefined;
  const d = dest?.trim();
  if (!d || monthOf(d) || d.length < 2) return 'no_destination';
  return { destination: d.replace(/\s+/g, ' '), ...(month ? { month } : {}) };
}

/** `@planner ... trip ...` without a planning verb ("@planner trip to Cabo in March"): the trip flow with the same slots. */
export function parseLooseTrip(
  text: string,
): { destination: string; month?: number } | 'no_destination' | null {
  const pm = parseMentions(text);
  if (!pm.mentions.some((m) => m.agent.id === 'planner') || plannerIntent(pm.rest) !== 'trip')
    return null;
  const rest = pm.rest;
  const dest = DEST_TO.exec(rest)?.[1] ?? DEST_IN.exec(rest)?.[1];
  const monthWord = MONTH.exec(rest)?.[1];
  const month = monthWord ? monthOf(monthWord === 'sept' ? 'september' : monthWord) : undefined;
  const d = dest?.trim();
  if (!d || monthOf(d) || d.length < 2) return 'no_destination';
  return { destination: d.replace(/\s+/g, ' '), ...(month ? { month } : {}) };
}

export async function handleTripChat(
  ctx: TripChatCtx,
  v: Viewer,
  chatId: string,
  text: string,
): Promise<boolean> {
  const { deps, svc } = ctx;
  const isDm = chatId.startsWith('dm:');
  const reply = (t: string) =>
    void deps.chat.postBot({
      chatId,
      personaId: 'cubbie',
      personaName: 'Nook',
      text: t,
      citations: [],
      attachments: [],
    });
  const addressed = isDm || addressesTrip(text);
  const cur = svc.current(v);
  const active =
    cur && ['planning', 'voting', 'confirming'].includes(cur.status) && cur.organizer ? cur : null;

  // 1. create
  if (addressed) {
    const c = parseCreate(text) ?? parseLooseTrip(text);
    if (c) {
      if (c === 'no_destination') {
        reply(usage);
        return true;
      }
      const res = await svc.create(
        v,
        { destination: c.destination, ...(c.month ? { month: c.month } : {}) },
        'chat',
      );
      if (!res.ok) {
        reply(
          res.message +
            (res.code === 'trip_in_progress'
              ? ' Open the Trip page to vote, or ask the organizer to cancel it.'
              : ''),
        );
        return true;
      }
      if (isDm)
        reply(`Started the trip plan for ${c.destination}. I posted it to your squad chat.`);
      return true;
    }
    if (CANCEL.test(text) && active) {
      const r = svc.cancel(v, active.tripId);
      if (!r.ok) reply(r.message);
      return true;
    }
    if (STATUS.test(text) && cur) {
      reply(
        `${cur.title}: ${cur.status}. ${plural(cur.options.length, 'option')}. ${cur.constraints.note ?? ''}`.trim(),
      );
      return true;
    }
  }
  if (!active) return false;

  // 2. vote
  const vm = VOTE.exec(text) ?? (isDm || addressed ? BARE_NUM.exec(text) : null);
  if (vm && active.status === 'voting') {
    const live = active.options.filter((o) => !active.vetoed.some((x) => x.optionId === o.id));
    const rest = vm[1]!;
    let ranking: string[] | undefined;
    if (/^\d+(?:[\s,>]+\d+)*$/.test(rest.trim())) {
      const idx = rest.match(/\d+/g)!.map((d) => Number(d) - 1);
      if (!idx.every((i) => i >= 0 && i < live.length)) {
        // out of range: never counted
        reply(pickRange(live.length));
        return true;
      }
      ranking = idx.map((i) => live[i]!.id);
    } else {
      const p = parseConfirmReply(
        rest,
        live.map((o) => o.label),
      );
      if (p.kind === 'match') ranking = [live[p.index]!.id];
    }
    if (!ranking) return false;
    const r = svc.vote(v, active.tripId, { ranking, baseRev: active.rev });
    reply(
      r.ok
        ? isDm
          ? 'Got it, your vote is in. It stays secret.'
          : `Recorded ${ctx.nameOf(v.studentId)}'s vote. Heads up: a vote typed in the group is visible to everyone. DM me next time to keep it secret.`
        : r.message,
    );
    return true;
  }
  // 3. confirm / decline
  const cf = CONFIRM.test(text);
  const dc = DECLINE.test(text) && addressed;
  if (cf || dc) {
    if (active.status === 'voting') {
      reply(
        `Voting is still open. ${voteHelp(active.options.filter((o) => !active.vetoed.some((x) => x.optionId === o.id)).length)} Confirming comes after voting closes.`,
      );
      return true;
    }
    if (active.status !== 'confirming') return false;
    const r = svc.confirm(v, active.tripId, {
      yes: cf,
      ...(active.chosen ? { optionId: active.chosen.optionId } : {}),
    });
    if (!r.ok) reply(r.message);
    return true;
  }
  return false;
}
