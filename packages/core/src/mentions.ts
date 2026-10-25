// Typed @mentions: the alias registry and the pure parser shared by the bot router, the hub chat engine, the iMessage
// bridge and the web composer. Browser-safe (no node imports). Documented in docs/agent-aliases.md.

export type MentionKind = 'router' | 'persona' | 'skill' | 'council';

export interface AgentAlias {
  /** Stable id: `cubbie`, `tutor`, `quiz`, ... */
  id: string;
  kind: MentionKind;
  /** Display name (also the persona name for `persona`). */
  name: string;
  description: string;
  /** Lowercase aliases without the `@`; the first is canonical. */
  aliases: readonly string[];
  /** persona: the persona id that speaks. */
  personaId?: string;
  /** skill: the registered skill name that always runs. */
  skill?: string;
  /** skill/council: words put in front of the text so the skill's own trigger recognises it. */
  keyword?: string;
}

export const AGENT_ALIASES: readonly AgentAlias[] = [
  {
    id: 'cubbie',
    kind: 'router',
    name: 'Cubbie',
    description: 'Your study buddy. Picks the right skill for what you ask.',
    aliases: ['cubbie', 'cubbi', 'squad'],
  },
  {
    id: 'tutor',
    kind: 'persona',
    name: 'Tutor',
    description: 'Explains the idea simply, then checks you got it.',
    aliases: ['tutor', 'teacher'],
    personaId: 'tutor',
  },
  {
    id: 'skeptic',
    kind: 'persona',
    name: 'Skeptic',
    description: 'Pokes holes and asks what the evidence is.',
    aliases: ['skeptic'],
    personaId: 'skeptic',
  },
  {
    id: 'planner',
    kind: 'persona',
    name: 'Planner',
    description: 'Turns it into steps, order and dates.',
    aliases: ['planner'],
    personaId: 'planner',
  },
  {
    id: 'examiner',
    kind: 'persona',
    name: 'Examiner',
    description: 'Asks what a test would ask.',
    aliases: ['examiner'],
    personaId: 'examiner',
  },
  {
    id: 'chair',
    kind: 'persona',
    name: 'Chair',
    description: 'Keeps order, calls decisions and wraps up.',
    aliases: ['chair'],
    personaId: 'chair',
  },
  {
    id: 'council',
    kind: 'council',
    name: 'Council',
    description: 'Convenes the council: several experts answer and rank.',
    aliases: ['council'],
    skill: 'council',
    keyword: 'council',
  },
  {
    id: 'advisor',
    kind: 'persona',
    name: 'Advisor',
    description: 'Round Table: balances deadlines, weak areas and workload.',
    aliases: ['advisor'],
    personaId: 'advisor',
  },
  {
    id: 'chill',
    kind: 'persona',
    name: 'Chill',
    description: 'Round Table: protects rest and a sustainable pace.',
    aliases: ['chill'],
    personaId: 'chill',
  },
  {
    id: 'grind',
    kind: 'persona',
    name: 'Grind',
    description: 'Round Table: maximises study hours and coverage.',
    aliases: ['grind'],
    personaId: 'grind',
  },
  {
    id: 'chairman',
    kind: 'persona',
    name: 'Chairman',
    description: 'Round Table: weighs the others and states the decision.',
    aliases: ['chairman'],
    personaId: 'chairman',
  },
  {
    id: 'quiz',
    kind: 'skill',
    name: 'Quiz',
    description: 'Start a quiz on a chapter.',
    aliases: ['quiz'],
    skill: 'quiz',
    keyword: 'quiz me',
  },
  {
    id: 'feynman',
    kind: 'skill',
    name: 'Feynman',
    description: 'Explain it back in your own words and get graded.',
    aliases: ['feynman'],
    skill: 'feynman',
    keyword: 'feynman',
  },
  {
    id: 'stepdiff',
    kind: 'skill',
    name: 'StepDiff',
    description: 'Compare your worked steps with the reference solution.',
    aliases: ['stepdiff'],
    skill: 'stepDiff',
    keyword: 'step diff',
  },
  {
    id: 'podcast',
    kind: 'skill',
    name: 'Podcast',
    description: 'Make a short audio recap.',
    aliases: ['podcast'],
    skill: 'podcast',
    keyword: 'podcast',
  },
  {
    id: 'explainer',
    kind: 'skill',
    name: 'Explainer',
    description: 'Make a narrated visual explainer.',
    aliases: ['explainer'],
    skill: 'explainer',
    keyword: 'explainer',
  },
  {
    id: 'debate',
    kind: 'skill',
    name: 'Debate',
    description: 'Stage a pro/con debate on a question.',
    aliases: ['debate'],
    skill: 'debate',
    keyword: 'debate',
  },
  {
    id: 'oracle',
    kind: 'skill',
    name: 'Oracle',
    description: 'Exam oracle: what will likely be asked.',
    aliases: ['oracle'],
    skill: 'oracle',
    keyword: 'exam oracle',
  },
  {
    id: 'rubric',
    kind: 'skill',
    name: 'Rubric',
    description: 'Check your answer against a rubric.',
    aliases: ['rubric'],
    skill: 'rubric',
    keyword: 'rubric check',
  },
  {
    id: 'devilta',
    kind: 'skill',
    name: "Devil's TA",
    description: 'Find the mistake in your work.',
    aliases: ['devilta'],
    skill: 'devilTa',
    keyword: "devil's TA",
  },
  {
    id: 'studyplan',
    kind: 'skill',
    name: 'Study plan',
    description: 'Build or update your study plan.',
    aliases: ['studyplan', 'plan'],
    skill: 'studyPlan',
    keyword: 'study plan',
  },
  {
    id: 'live',
    kind: 'skill',
    name: 'Live discussion',
    description: 'Start a live agent discussion on a topic.',
    aliases: ['discuss', 'live'],
    skill: 'live',
    keyword: 'discuss:',
  },
];

export const MAX_MENTION_FANOUT = 3;

const BY_ALIAS = new Map<string, AgentAlias>();
for (const a of AGENT_ALIASES) for (const n of a.aliases) BY_ALIAS.set(n, a);

/** Resolve an alias word (no `@`, any case) to its agent, or undefined. */
export function resolveAlias(word: string): AgentAlias | undefined {
  return BY_ALIAS.get(word.toLowerCase());
}

/** All alias words (canonical and extra), for autocomplete and help. */
export const ALL_ALIAS_WORDS: readonly string[] = [...BY_ALIAS.keys()];

/**
 * A token that is almost a known alias but is not one: a prefix of an alias (`@cub`, typed halfway) or an alias with
 * more letters (`@cubbies`, `@squadron`). These are never mentions and never "unknown tag" errors: they stay silent.
 */
export function isNearMiss(word: string): boolean {
  const w = word.toLowerCase();
  if (BY_ALIAS.has(w)) return false;
  for (const a of BY_ALIAS.keys()) {
    if (w.startsWith(a)) return true;
    if (w.length >= 2 && a.startsWith(w)) return true;
  }
  return false;
}

export interface ResolvedMention {
  agent: AgentAlias;
  /** The alias as typed, without `@`. */
  alias: string;
  start: number;
  end: number;
}
export interface UnknownMention {
  word: string;
  start: number;
  end: number;
}
export interface ParsedMentions {
  /** One entry per distinct agent, in order of first appearance. */
  mentions: ResolvedMention[];
  /** Unknown `@word`s (distinct, in order). Never includes near-misses. */
  unknownMention: UnknownMention[];
  /** Text with every real mention removed and whitespace tidied. */
  rest: string;
}

/** Spans that can never contain a mention: code, links, URLs, quotes, block quotes. */
function ignoredSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const add = (re: RegExp) => {
    for (const m of text.matchAll(re)) spans.push([m.index!, m.index! + m[0].length]);
  };
  add(/```[\s\S]*?```/g);
  add(/`[^`\n]*`/g);
  add(/\[[^\]\n]*\]\([^)\n]*\)/g);
  add(/\b(?:https?:\/\/|www\.)\S+/gi);
  add(/"[^"\n]*"/g);
  add(/“[^”\n]*”/g);
  add(/^[ \t]*>.*$/gm);
  return spans;
}

const TOKEN = /@([\p{L}][\p{L}\p{N}_]*)/gu;

/**
 * Pure mention parser. A mention is `@word` that
 * - starts the text or follows a character that is not a letter, digit, `_`, `@`, `/`, `+`, `%`, `\` (so `me@host` is not),
 * - is not followed by a letter, digit, `_`, or by `.`/`-`/`@`/`/` and then a word character (so `@cubbi.com` and `@cubbie-bot` are not),
 * - is not inside code, a link, a URL, a "quote" or a `>` block quote.
 * Matching is case-insensitive. Punctuation after the word (`,` `:` `?` `!` `.`) is fine.
 */
export function parseMentions(text: string): ParsedMentions {
  const out: ParsedMentions = { mentions: [], unknownMention: [], rest: '' };
  if (typeof text !== 'string' || text.length === 0) return out;
  const spans = ignoredSpans(text);
  const inIgnored = (i: number) => spans.some(([a, b]) => i >= a && i < b);
  const seenAgents = new Set<string>();
  const seenUnknown = new Set<string>();
  const cut: [number, number][] = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    const end = start + m[0].length;
    const word = m[1]!;
    if (inIgnored(start)) continue;
    const prev = start > 0 ? text[start - 1]! : '';
    if (prev && /[\p{L}\p{N}_@/+%\\]/u.test(prev)) continue;
    const next = text.slice(end, end + 2);
    if (/^[.\-@/][\p{L}\p{N}_]/u.test(next)) continue;
    const agent = resolveAlias(word);
    if (agent) {
      cut.push([start, end]);
      if (!seenAgents.has(agent.id)) {
        seenAgents.add(agent.id);
        out.mentions.push({ agent, alias: word.toLowerCase(), start, end });
      }
    } else if (!isNearMiss(word)) {
      const k = word.toLowerCase();
      if (!seenUnknown.has(k)) {
        seenUnknown.add(k);
        out.unknownMention.push({ word, start, end });
      }
    }
  }
  let rest = '';
  let at = 0;
  for (const [a, b] of cut) {
    rest += text.slice(at, a);
    at = b;
  }
  rest += text.slice(at);
  out.rest = rest
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/^[\s,:;\-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

/** Autocomplete: entries whose alias starts with `prefix` (no `@`), Cubbie first, then table order. */
export function suggestAliases(prefix: string, limit = 8): { alias: string; agent: AgentAlias }[] {
  const p = prefix.toLowerCase();
  const hits: { alias: string; agent: AgentAlias }[] = [];
  for (const a of AGENT_ALIASES)
    for (const n of a.aliases) if (n.startsWith(p)) hits.push({ alias: n, agent: a });
  return hits.slice(0, limit);
}

/** The short help text listing what can be tagged (plain text, public). */
export function mentionHelpText(unknown?: string): string {
  const lead = unknown ? `I don't know @${unknown.slice(0, 24)}. ` : '';
  const personas = AGENT_ALIASES.filter((a) => a.kind === 'persona' || a.kind === 'council')
    .map((a) => `@${a.aliases[0]}`)
    .join(' ');
  const skills = AGENT_ALIASES.filter((a) => a.kind === 'skill')
    .map((a) => `@${a.aliases[0]}`)
    .join(' ');
  return `${lead}You can tag: @cubbie (picks the right helper), ${personas}. Shortcuts: ${skills}.`;
}

/** Plain-text reply to a bare mention. */
export const BARE_MENTION_REPLY = 'What do you need? Ask me a question, or say "quiz me", "make a plan" or "explain <topic>".';
export const MENTION_DM_NOTICE = 'Sent you a DM';
