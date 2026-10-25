import type { RoomOutcome, VillageEvent } from '@squad/core';
import type { RoomSession, RoomSnapshot, TranscriptEntry, TranscriptKind } from './roomTypes';

/** 08-village-motion: bubbles stay at least 1.2 s per 20 characters, within 1.2..9 s. */
export function holdMsFor(text: string): number {
  const n = Math.ceil(text.trim().length / 20);
  return Math.min(9000, Math.max(1200, n * 1200));
}

const MAX_PER_ROOM = 200;
const MAX_TEXT = 600;

const cut = (s: string): string => (s.length <= MAX_TEXT ? s : `${s.slice(0, MAX_TEXT - 1)}.`);

interface Words {
  who: string;
  kind: TranscriptKind;
  text: string;
  dissent?: boolean;
}

/** The public words an event carries, or null when it carries none. Never reads withheld fields. */
export function wordsOf(e: VillageEvent): Words | null {
  switch (e.t) {
    case 'council.opinion': {
      const text = (e.text ?? '').trim();
      return text
        ? { who: e.member, kind: 'opinion', text, ...(e.dissent ? { dissent: true } : {}) }
        : null;
    }
    case 'council.rank': {
      const order = e.order ?? [];
      return order.length
        ? { who: e.member, kind: 'rank', text: `ranks ${order.join(', then ')}` }
        : null;
    }
    case 'council.verdict': {
      const text = (e.text ?? '').trim();
      return text
        ? {
            who: e.member,
            kind: 'verdict',
            text,
            ...(e.dissent || e.dissenter ? { dissent: true } : {}),
          }
        : null;
    }
    case 'call.caption': {
      const text = (e.text ?? '').trim();
      return text ? { who: e.agent, kind: 'caption', text } : null;
    }
    case 'quiz.question': {
      const text = (e.text ?? '').trim();
      return text ? { who: 'quiz', kind: 'question', text } : null;
    }
    case 'call.start':
      return { who: e.agent, kind: 'note', text: 'Call started' };
    case 'call.end':
      return { who: e.agent, kind: 'note', text: 'Call ended' };
    default:
      return null;
  }
}

/** Pure store of what was said in each room: feeds the transcript strip and the OUTCOME card. */
export function createRoomSession(
  opts: {
    run?: (slot: string, phrase: string) => void;
  } = {},
): RoomSession {
  let entered: string | null = null;
  let nextId = 1;
  const transcripts: Record<string, TranscriptEntry[]> = {};
  const outcomes: Record<string, RoomOutcome> = {};
  const subs = new Set<(s: RoomSnapshot) => void>();
  let snap: RoomSnapshot = { entered, transcripts: {}, outcomes: {} };

  const publish = (): void => {
    snap = {
      entered,
      transcripts: Object.fromEntries(Object.entries(transcripts).map(([k, v]) => [k, [...v]])),
      outcomes: { ...outcomes },
    };
    for (const fn of subs) fn(snap);
  };

  return {
    snapshot: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    enter(slot) {
      if (entered === slot) return;
      entered = slot;
      publish();
    },
    leave() {
      if (entered === null) return;
      entered = null;
      publish();
    },
    record(slot, e, now) {
      const w = wordsOf(e);
      let changed = false;
      if (e.t === 'council.verdict' && e.outcome) {
        outcomes[slot] = e.outcome;
        changed = true;
      }
      if (e.t === 'council.opinion' && transcripts[slot]?.some((t) => t.kind === 'verdict')) {
        // a new session in the same room: start a fresh transcript and drop the old outcome
        transcripts[slot] = [];
        delete outcomes[slot];
        changed = true;
      }
      if (w) {
        const text = cut(w.text);
        const list = (transcripts[slot] ??= []);
        list.push({
          id: nextId++,
          slot,
          who: w.who,
          kind: w.kind,
          text,
          at: now,
          holdMs: holdMsFor(text),
          ...(w.dissent ? { dissent: true } : {}),
        });
        if (list.length > MAX_PER_ROOM) list.splice(0, list.length - MAX_PER_ROOM);
        changed = true;
      }
      if (changed) publish();
    },
    ...(opts.run ? { run: opts.run } : {}),
  };
}
