/**
 * Council voices: what each council member, chair, advisor or live-discussion persona has said and is
 * weighing, folded from public event text (`council.*`, `discussion.*`, optional `thought`/`work`) and from
 * results the web hands in (`noteVoice`). Pure: no Phaser, no clock of its own, no private data. Never a hidden
 * chain of thought; only text an event or a council result already carried.
 */

export type VoiceKind = 'opinion' | 'rank' | 'verdict' | 'turn' | 'yield' | 'thought';

export interface VoiceLine {
  readonly seq: number;
  readonly at: number;
  /** Normalised speaker key ('chill', 'skeptic', 'chair'). */
  readonly who: string;
  readonly group: string;
  readonly kind: VoiceKind;
  readonly text: string;
  readonly thought?: string;
  readonly dissent?: boolean;
  readonly to?: string;
  readonly thinking?: boolean;
  /** Dedupe key for lines handed in twice (e.g. a turn that arrives as an event and in the live reducer). */
  readonly key?: string;
}

export interface VoicePosition {
  readonly who: string;
  readonly name: string;
  readonly kind: VoiceKind;
  readonly text: string;
  readonly dissent: boolean;
}

export interface VoiceView {
  readonly who: string;
  readonly name: string;
  readonly role: string;
  readonly thinking: boolean;
  /** True when there is a thought, stance or opinion to read (the popup then opens on Thinking). */
  readonly hasThought: boolean;
  readonly thought: { readonly text: string; readonly source: 'shared' | 'stream' | 'none' };
  readonly history: readonly string[];
  /** Latest position per member of the same council (opinions, ranks, verdict, dissent). */
  readonly positions: readonly VoicePosition[];
  /** This member's own lines. */
  readonly said: readonly VoiceLine[];
  /** The whole room thread, oldest first. */
  readonly thread: readonly VoiceLine[];
}

const ALIAS: Record<string, string> = { chairman: 'chair', chairperson: 'chair' };

/** 'council:live-skeptic' -> 'skeptic', 'Chairman' -> 'chair', 'Solver_A' -> 'solver-a'. */
export function voiceKey(raw: string): string {
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/^(council|expert):/, '')
    .replace(/^live-/, '')
    .replace(/[\s_]+/g, '-');
  return ALIAS[k] ?? k;
}

export const voiceName = (key: string): string =>
  key
    .split('-')
    .filter(Boolean)
    .map((w) => (w.length === 1 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ') || 'Someone';

const ROLE: Record<string, string> = {
  chair: 'Chair: weighs every answer and writes the verdict',
  chill: 'Council member: argues for the easy, steady path',
  grind: 'Council member: argues for the hard, thorough path',
  advisor: 'Advisor: ranks the answers and keeps the plan honest',
  skeptic: 'Skeptic: pokes holes in each answer',
  teacher: 'Teacher: explains each answer plainly',
  practitioner: 'Practitioner: asks what works in practice',
  tutor: 'Tutor: explains and checks you understood',
  planner: 'Planner: fits it into your week',
  examiner: 'Examiner: tests what you know',
};
export const voiceRole = (key: string): string =>
  ROLE[key] ?? 'Council member: argues a view, then the chair decides';

const isCouncilAgent = (a: unknown): a is string => typeof a === 'string' && a.startsWith('council:');

type Draft = Omit<VoiceLine, 'seq' | 'at'>;

const str = (v: unknown, max = 600): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Lines an event contributes, read defensively (works for core events and `discussion.*`). */
export function voiceDraftsFromEvent(raw: unknown): Draft[] {
  const e = raw as Record<string, unknown> | null;
  if (!e || typeof e !== 'object' || typeof e.t !== 'string') return [];
  const thought = str(e.thought, 240);
  const thinking = (e.work as { thinking?: unknown } | undefined)?.thinking === true;
  const base = { ...(thought ? { thought } : {}), ...(thinking ? { thinking: true } : {}) };
  switch (e.t) {
    case 'council.opinion':
    case 'council.rank':
    case 'council.verdict': {
      const member = str(e.member, 40);
      if (!member) return [];
      const group = voiceKey(str(e.councilId, 60) ?? 'council');
      const who = voiceKey(member);
      let text = str(e.text) ?? '';
      let kind: VoiceKind = 'opinion';
      if (e.t === 'council.rank') {
        kind = 'rank';
        const order = Array.isArray(e.order) ? e.order.filter((o) => typeof o === 'string') : [];
        text = order.length ? `ranks ${order.map((o) => voiceName(voiceKey(o))).join(', then ')}` : text;
      } else if (e.t === 'council.verdict') {
        kind = 'verdict';
        const d = str(e.dissenter, 40);
        if (!text) text = d ? `Verdict given. ${voiceName(voiceKey(d))} dissented.` : 'Verdict given.';
      }
      if (!text && !thought) return [];
      return [
        {
          who,
          group,
          kind,
          text: text || (thought as string),
          ...base,
          ...(e.dissent === true || str(e.dissenter) ? { dissent: true } : {}),
        },
      ];
    }
    case 'discussion.turn':
    case 'discussion.interrupted': {
      const who = voiceKey(str(e.member, 40) ?? (isCouncilAgent(e.agent) ? e.agent : 'someone'));
      const group = voiceKey(str(e.discussionId, 60) ?? 'discussion');
      const to = isCouncilAgent(e.to) ? voiceKey(e.to) : undefined;
      const text = str(e.text) ?? (e.t === 'discussion.interrupted' ? 'Yielded to you' : '');
      if (!text && !thought) return [];
      return [
        {
          who,
          group,
          kind: e.t === 'discussion.turn' ? 'turn' : 'yield',
          text: text || (thought as string),
          ...base,
          ...(to ? { to } : {}),
          ...(str(e.turnId, 24) ? { key: `${group}:${str(e.turnId, 24)}` } : {}),
        },
      ];
    }
    default:
      // any other event a council agent emits with a shared thought (e.g. agent.state with `thought`)
      if (isCouncilAgent(e.agent) && thought)
        return [{ who: voiceKey(e.agent), group: 'council', kind: 'thought', text: thought, ...base }];
      return [];
  }
}

const THINK_FRESH_MS = 20_000;

export interface VoiceBook {
  add(d: Draft, at: number): boolean;
  setThinking(who: string, on: boolean): boolean;
  thinking(who: string, now: number): boolean;
  /** Most recent line first lookup for `who`'s group, else the latest group overall. */
  view(who: string, now: number, council?: string): VoiceView;
  has(who: string): boolean;
  lines(): readonly VoiceLine[];
  /** A seat key with no words of its own reads as `to` (the Council Hall seats show the panel's members). */
  alias(seat: string, to: string): void;
}

export function createVoiceBook(cap = 300): VoiceBook {
  const lines: VoiceLine[] = [];
  const flags = new Map<string, boolean>();
  const aliases = new Map<string, string>();
  let seq = 0;
  const canon = (who: string): string => {
    const to = aliases.get(who);
    return to && !lines.some((l) => l.who === who) ? to : who;
  };

  const said = (who: string): VoiceLine[] =>
    lines.filter((l) => l.who === who || (who === 'chair' && l.kind === 'verdict'));

  const book: VoiceBook = {
    add(d, at) {
      if (d.key && lines.some((l) => l.key === d.key)) return false;
      // the same words reaching us twice (an event and the room transcript) are one line
      if (
        !d.key &&
        lines.some(
          (l) => l.who === d.who && l.kind === d.kind && l.text === d.text && Math.abs(l.at - at) < 5000,
        )
      )
        return false;
      lines.push({ ...d, seq: ++seq, at });
      if (lines.length > cap) lines.splice(0, lines.length - cap);
      if (d.thinking === undefined) flags.delete(d.who);
      return true;
    },
    setThinking(who, on) {
      if ((flags.get(who) ?? false) === on) return false;
      if (on) flags.set(who, true);
      else flags.delete(who);
      return true;
    },
    alias(seat, to) {
      if (seat !== to) aliases.set(seat, to);
    },
    thinking(rawWho, now) {
      const who = canon(rawWho);
      if (flags.get(who)) return true;
      const last = [...lines].reverse().find((l) => l.who === who);
      return !!last?.thinking && now - last.at < THINK_FRESH_MS;
    },
    has: (who) => lines.some((l) => l.who === canon(who)) || flags.has(canon(who)),
    lines: () => lines,
    view(rawWho, now, council) {
      const who = canon(rawWho);
      const own = who ? said(who) : [];
      const last = own.at(-1) ?? lines.at(-1);
      const group = last?.group;
      const inGroup = (l: VoiceLine) => !group || l.group === group;
      const councilLines = council
        ? lines.filter((l) => l.group === voiceKey(council) || voiceKey(council) === l.group)
        : [];
      const thread = (who ? lines.filter(inGroup) : councilLines.length ? councilLines : lines).slice();
      // thoughts: shared `thought` fields first, then the member's own public stance
      const shared = (who ? own : thread).filter((l) => l.thought);
      const stance = (who ? own : thread).filter((l) => l.text && l.kind !== 'thought');
      let thought: VoiceView['thought'];
      let history: string[];
      if (shared.length) {
        thought = { text: shared.at(-1)!.thought!, source: 'shared' };
        history = shared.slice(0, -1).map((l) => l.thought!);
      } else if (stance.length) {
        const s = stance.at(-1)!;
        thought = { text: s.text, source: 'stream' };
        history = stance.slice(0, -1).map((l) => l.text);
      } else {
        thought = { text: 'Working on it: no reasoning shared yet', source: 'none' };
        history = [];
      }
      const latest = new Map<string, VoiceLine>();
      for (const l of thread) if (l.kind !== 'thought') latest.set(l.who, l);
      const positions: VoicePosition[] = [...latest.values()].map((l) => ({
        who: l.who,
        name: voiceName(l.who),
        kind: l.kind,
        text: l.text,
        dissent: l.dissent === true,
      }));
      const thinking = who ? book.thinking(who, now) : [...latest.keys()].some((k) => book.thinking(k, now));
      return {
        who,
        name: voiceName(who),
        role: voiceRole(who),
        thinking,
        hasThought: thought.source !== 'none',
        thought,
        history: history.slice(-8),
        positions,
        said: own,
        thread,
      };
    },
  };
  return book;
}
