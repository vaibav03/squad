import { useSyncExternalStore } from 'react';
import type { CouncilResult } from '@squad/core';
import { voiceKey, type InspectorStore } from '@squad/village/inspector';

/**
 * The page that owns the Agent Inspector registers its store here, so any council agent shown anywhere
 * (council card, panel, Round Table help avatars, live discussion seats) can open the same docked popup.
 * Without a registered store (a page with no village) these helpers do nothing and `useCanInspect` is false,
 * so the affordance is simply not offered.
 */
let current: InspectorStore | null = null;
const subs = new Set<() => void>();

export function setInspectorStore(s: InspectorStore | null): void {
  if (current === s) return;
  current = s;
  subs.forEach((f) => f());
}
export const getInspectorStore = (): InspectorStore | null => current;

/** True when a village inspector is mounted on this page. */
export function useCanInspect(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => current !== null,
    () => false,
  );
}

export interface OpenVoiceOpts {
  /** Council agent id the voice belongs to (defaults to the room's council, else `council:<slot>`). */
  agent?: string;
  /** Room the voice sits in; '' when it is not tied to a room. */
  slot?: string;
}

const ROOM_AGENT: Record<string, string> = {
  'council-hall': 'council:quizkey',
  'round-table': 'council:planner',
  'debate-stage': 'council:debate',
};

/** Open the inspector on one council voice: Thinking if it is thinking or has a thought, else Chat. */
export function openVoice(who: string, o: OpenVoiceOpts = {}): boolean {
  if (!current) return false;
  const slot = o.slot ?? '';
  const agent = o.agent ?? ROOM_AGENT[slot] ?? 'council:council';
  current.select(agent, { slot, who: voiceKey(who) });
  return true;
}

/**
 * Hand a finished or growing council result to the inspector so each member's stance, answer, ranking and the
 * verdict can be read there. `upto` limits how many member answers are shown so far (the panel paces them).
 */
export function noteCouncilResult(
  result: CouncilResult,
  show: { members?: number; rankings?: boolean; verdict?: boolean } = {},
): void {
  const s = current;
  if (!s) return;
  const upto = show.members ?? result.members.length;
  const group = `run-${result.id}`;
  result.members.slice(0, upto).forEach((m, i) => {
    s.aliasVoice(`solver-${'abc'[i] ?? 'c'}`, m.id);
    const failed = m.status === 'failed' || !m.text.trim();
    s.setVoiceThinking(m.id, false);
    s.noteVoice({
      who: m.id,
      group,
      kind: 'opinion',
      text: failed ? `${m.name} did not answer this time.` : m.text,
      thought: `${m.stance}${m.answer ? ` Answer: ${m.answer}` : ''}`.slice(0, 240),
      key: `${group}:${m.id}:opinion`,
    });
  });
  for (const r of show.rankings === false ? [] : result.rankings)
    s.noteVoice({
      who: r.member,
      group,
      kind: 'rank',
      text: r.order.length ? `ranks ${r.order.join(', then ')}` : 'gave no ranking',
      key: `${group}:${r.member}:rank`,
    });
  const v = show.verdict === false ? undefined : result.verdict;
  if (v) {
    s.noteVoice({
      who: v.chair || 'chair',
      group,
      kind: 'verdict',
      text: v.text,
      thought: v.confidenceNote ? v.confidenceNote.slice(0, 240) : undefined,
      ...(v.dissent ? { dissent: true } : {}),
      key: `${group}:verdict`,
    });
    if (v.dissent)
      s.noteVoice({
        who: v.dissent.member,
        group,
        kind: 'opinion',
        text: `${v.dissent.view} ${v.dissent.why}`.trim(),
        dissent: true,
        key: `${group}:dissent`,
      });
  }
}

/** Mark who is still working on their answer (the panel's "is thinking" placeholders). */
export function setPendingVoices(ids: readonly string[], thinking: boolean): void {
  for (const id of ids) current?.setVoiceThinking(id, thinking);
}
