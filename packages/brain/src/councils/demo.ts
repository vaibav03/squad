import type {
  CacheHandle,
  Llm,
  LlmCacheRequest,
  LlmJsonRequest,
  LlmRequest,
  LlmResult,
} from '@squad/core';
import { normalizeMessages, textOf } from '@squad/core';
import { normaliseText } from './pure';

/**
 * Deterministic stand-in for Gemini, used in demo mode (no GEMINI_API_KEY) and by the hub's council routes.
 * It is NOT a reasoner: members follow fixed stances (Teacher and Practitioner agree, Skeptic pushes back),
 * and grounded answers are extractive (a verbatim sentence from the course page that best matches the question),
 * so every citation still passes the real verification gate. Every result built on it is stamped `demo: true`.
 */
const OFF_TOPIC =
  /\b(weather|girlfriend|boyfriend|date me|recipe|lottery|movie|horoscope|bitcoin)\b/i;
const STOP = new Set(
  'a an the is are was were of to in on for and or but with what why how does do did this that it be as at by from which who when where can i my me you your should would could about'.split(
    ' ',
  ),
);

const words = (s: string): string[] =>
  normaliseText(s)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));

function sentencesOf(pageText: string): string[] {
  return pageText
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(' ').length >= 6);
}

interface PageBlock {
  file: string;
  page: number;
  text: string;
}
function parsePages(block: string): PageBlock[] {
  const out: PageBlock[] = [];
  const re = /\[([^\]\n]+?) p\.(\d+)\]\n([\s\S]*?)(?=\n\[[^\]\n]+? p\.\d+\]\n|$)/g;
  for (let m = re.exec(block); m; m = re.exec(block))
    out.push({ file: m[1]!, page: Number(m[2]), text: m[3]!.trim() });
  return out;
}

function bestSentences(question: string, pages: PageBlock[], n: number) {
  const qw = new Set(words(question));
  const scored: { s: string; p: PageBlock; score: number }[] = [];
  for (const p of pages)
    for (const s of sentencesOf(p.text)) {
      const score = words(s).filter((w) => qw.has(w)).length;
      if (score >= 2) scored.push({ s, p, score });
    }
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}

const questionOf = (messages: string): string =>
  /(?:Student question|Question from a student|Question):\s*\n?([\s\S]*?)(?:\n\n|$)/
    .exec(messages)?.[1]
    ?.trim() ?? messages.slice(0, 200);

interface Stance {
  answer: string;
  position: string;
}

function stanceFor(member: 'Skeptic' | 'Teacher' | 'Practitioner', q: string): Stance {
  const opts = /\b([A-E])\s+(?:or|vs\.?|versus)\s+([A-E])\b/i.exec(q);
  if (opts) {
    const a = opts[1]!.toUpperCase();
    const b = opts[2]!.toUpperCase();
    if (member === 'Skeptic')
      return {
        answer: b,
        position: `${b} survives the checks I would run. ${a} only works if an assumption holds that the question never states, so I would not bet on it.`,
      };
    if (member === 'Teacher')
      return {
        answer: a,
        position: `${a} follows directly from the definitions, so you can re-derive it instead of memorising it. ${b} looks plausible but rests on a shortcut.`,
      };
    return {
      answer: a,
      position: `${a} is the choice that holds up on a real problem. ${b} is the common trap: it costs more time and fails on the edge cases.`,
    };
  }
  if (/\b(proof|prove|lemma|theorem|right|correct|valid|wrong)\b/i.test(q)) {
    if (member === 'Skeptic')
      return {
        answer: 'Not yet',
        position:
          'I would not accept it yet. Check each step for an unstated assumption, especially the step that introduces a new quantity, and test the claim on a case where it should fail.',
      };
    if (member === 'Teacher')
      return {
        answer: 'Mostly yes',
        position:
          'The structure is sound: each step follows from the one before. Make the key step explicit and say which definition justifies it, and the argument is complete.',
      };
    return {
      answer: 'Mostly yes',
      position:
        'It works for the cases an exam would use. Run one concrete example through every line; if the numbers agree at each step, it is right.',
    };
  }
  if (member === 'Skeptic')
    return {
      answer: 'Check assumptions first',
      position:
        'Before choosing, write down what the problem assumes and what it asks for. Many wrong approaches come from solving a slightly different problem than the one stated.',
    };
  if (member === 'Teacher')
    return {
      answer: 'Start from the definition',
      position:
        'Start from the definition of the quantity involved and see what it forces. The approach that explains why the answer is true is the one that will still work on a variation.',
    };
  return {
    answer: 'Start from the definition',
    position:
      'Pick the simplest approach that fully answers the question, try it on a small example first, and only switch if it stalls. Time spent on a clean setup pays back.',
  };
}

function memberName(system: string): 'Skeptic' | 'Teacher' | 'Practitioner' | undefined {
  if (system.includes('You are the Skeptic')) return 'Skeptic';
  if (system.includes('You are the Teacher')) return 'Teacher';
  if (system.includes('You are the Practitioner')) return 'Practitioner';
  return undefined;
}

export function createDemoCouncilLlm(): Llm {
  const caches = new Map<string, string>();
  const answer = async (req: LlmJsonRequest<unknown>): Promise<unknown> => {
    const system = req.system ?? (req.cache ? (caches.get(req.cache.id) ?? '') : '');
    const user = normalizeMessages(req.messages)
      .map((m) => textOf(m.content))
      .join('\n');

    if (system.includes('chapter expert')) {
      const q = /Student question:\s*([\s\S]*)$/.exec(user)?.[1] ?? user;
      const hits = bestSentences(q, parsePages(system), 2);
      return {
        answer: hits.map((h) => h.s).join(' '),
        claims: hits.map((h) => ({ text: h.s, file: h.p.file, page: h.p.page, quote: h.s })),
      };
    }
    if (system.includes(':triage]')) {
      return { study: !OFF_TOPIC.test(user), reason: '' };
    }
    if (system.includes(':chair]')) {
      const answers = [...user.matchAll(/^(\w+) \([^)]*\): [\s\S]*?\n\(answer: ([^)\n]*)\)/gm)].map(
        (m) => ({ name: m[1]!, answer: m[2]!.trim() }),
      );
      const tally = new Map<string, string[]>();
      for (const a of answers) {
        const k = normaliseText(a.answer);
        tally.set(k, [...(tally.get(k) ?? []), a.name]);
      }
      const best = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      const win = answers.find((a) => normaliseText(a.answer) === best?.[0]);
      const agreeing = best?.[1] ?? [];
      const rest = answers.filter((a) => !agreeing.includes(a.name));
      const grounded = /cited verified course pages/.test(user);
      return {
        verdict: `${win?.answer ?? 'No clear answer'}. ${
          rest.length === 0
            ? 'All members reached the same answer.'
            : `${agreeing.join(' and ')} reached it independently; ${rest.map((r) => r.name).join(' and ')} pushed back, and the verdict keeps that doubt visible.`
        }`,
        answer: win?.answer ?? '',
        agreeing,
        dissentWhy:
          rest.length > 0
            ? `Its caution is worth checking, but the other answers rest on the definitions and survive a concrete test.`
            : '',
        confidence: rest.length === 0 ? 'confident' : 'fairly_sure',
        next: grounded
          ? 'Open the cited pages, then try the problem yourself and compare.'
          : 'Test this on one small example yourself, then ask your TA if it still feels shaky.',
      };
    }
    const q = questionOf(user);
    if (/Rank the responses/.test(user)) {
      // Judges like their own kind of answer: deterministic, and it lets the majority outrank the Skeptic.
      const mine = memberName(system);
      const own = mine ? normaliseText(stanceFor(mine, q).answer) : '';
      const rows = [...user.matchAll(/^Response ([A-Z]):[\s\S]*?\n\(answer: ([^)\n]*)\)/gm)].map(
        (m) => ({ label: m[1]!, same: normaliseText(m[2]!) === own }),
      );
      return {
        order: rows
          .sort((a, b) => Number(b.same) - Number(a.same) || a.label.localeCompare(b.label))
          .map((r) => r.label),
      };
    }
    const who = memberName(system);
    if (who) {
      const st = stanceFor(who, q);
      const evidence = /COURSE MATERIALS[^\n]*\n([\s\S]*?)\n\nGrounding rules:/.exec(system)?.[1];
      const hits = evidence
        ? bestSentences(q, parsePages(evidence), who === 'Skeptic' ? 1 : 2)
        : [];
      return {
        answer: st.answer,
        position: st.position,
        claims: hits.map((h) => ({ text: h.s, file: h.p.file, page: h.p.page, quote: h.s })),
      };
    }
    throw new Error('demo llm: unsupported request');
  };

  return {
    async complete(_req: LlmRequest): Promise<LlmResult> {
      return { text: 'Demo mode: no model is connected.', toolCalls: [] };
    },
    async json<T>(req: LlmJsonRequest<T>): Promise<T> {
      return req.schema.parse(await answer(req as LlmJsonRequest<unknown>));
    },
    async createCache(req: LlmCacheRequest): Promise<CacheHandle> {
      const id = `demo-cache-${caches.size + 1}`;
      caches.set(id, req.system ?? '');
      return { id, provider: 'demo', model: req.model ?? 'main' };
    },
  };
}
