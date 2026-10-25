import type { ChatCard, ChatMessage } from '@squad/core';

export interface PlanRevision {
  messageId: string;
  ts: number;
  text: string;
  rev?: number | undefined;
  status?: string | undefined;
}

type PlanCardT = Extract<ChatCard, { type: 'plan' | 'trip' }>;
const isPlanCard = (c: ChatCard | undefined): c is PlanCardT =>
  !!c && (c.type === 'plan' || c.type === 'trip');
export const planKey = (c: PlanCardT) =>
  c.type === 'trip' ? `trip:${c.tripId}` : `plan:${c.planId}`;

const REVS = new WeakMap<object, PlanRevision[]>();
/** Revision list (oldest first, includes the first post) of a collapsed plan card. */
export const revisionsOf = (c: ChatCard): PlanRevision[] => REVS.get(c) ?? [];

const firstLine = (t: string) =>
  t
    .split('\n')
    .slice(1)
    .join(' ')
    .replace(/\s*Open the plan in Squad:.*$/s, '')
    .trim() ||
  t.split('\n')[0] ||
  '';

/**
 * One card per plan, in place: the first message that carries a plan's card stays where it is and shows the newest
 * card state; later messages for the same plan leave the thread (their text becomes the revision list). Works for any
 * list of thread items, so the hub can keep posting a message per change for iMessage and Discord.
 */
export function collapsePlanCards<T extends { message: ChatMessage }>(items: readonly T[]): T[] {
  const last = new Map<string, PlanCardT>();
  const revs = new Map<string, PlanRevision[]>();
  const first = new Map<string, number>();
  items.forEach((it, i) => {
    const c = it.message.card;
    if (!isPlanCard(c)) return;
    const k = planKey(c);
    last.set(k, c);
    if (!first.has(k)) first.set(k, i);
    const list = revs.get(k) ?? [];
    list.push({
      messageId: it.message.id,
      ts: it.message.ts,
      text: firstLine(it.message.text),
      rev: c.rev,
      status: c.status,
    });
    revs.set(k, list);
  });
  if (first.size === 0) return items as T[];
  const out: T[] = [];
  items.forEach((it, i) => {
    const c = it.message.card;
    if (!isPlanCard(c)) return void out.push(it);
    const k = planKey(c);
    if (first.get(k) !== i) return;
    const card = { ...last.get(k)! };
    REVS.set(card, revs.get(k)!);
    out.push({ ...it, message: { ...it.message, card } });
  });
  return out;
}
