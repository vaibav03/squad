// Pure helpers for the web transport: persona prefix stripping, citation markers, structured quiz cards.
import type { ChatCard, ChatCitation } from '@squad/core';
import { getPersona } from '../persona';

/** Remove the `"{emoji} {name}: "` prefix the router adds for text transports. The UI shows the persona itself. */
export function stripPersonaPrefix(personaId: string | undefined, text: string): string {
  const p = getPersona(personaId);
  const prefix = `${p.emoji ? `${p.emoji} ` : ''}${p.name}: `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

// `(ch6-the-normal-distribution.pdf p.4)` and `[ch6.pdf p.4]`: the file must have an extension so a plain
// "(see p.4)" is never mistaken for a citation.
const CITE = /[([]\s*([^()[\]\n]+?\.[A-Za-z]{2,4})\s+p\.\s*(\d+)\s*[)\]]/g;

/** `ch6-the-normal-distribution.pdf` -> `ch6.pdf`; other names unchanged. */
export function citationLabel(file: string, page: number): string {
  const short = /^(ch\d+)-.+\.pdf$/i.exec(file);
  return `${short ? `${short[1]!.toLowerCase()}.pdf` : file} p.${page}`;
}

/**
 * Normalises every citation marker to the canonical `[file p.N]` and lists the distinct citations in order of
 * first appearance. The text keeps the markers so it still reads correctly without the chips.
 */
export function extractCitations(text: string): { text: string; citations: ChatCitation[] } {
  const seen = new Set<string>();
  const citations: ChatCitation[] = [];
  const out = text.replace(CITE, (_m, file: string, page: string) => {
    const f = file.trim();
    const n = Number(page);
    const key = `${f}#${n}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ file: f, page: n, label: citationLabel(f, n) });
    }
    return `[${f} p.${n}]`;
  });
  return { text: out, citations };
}

const LETTERS = 'ABCDEF';

/** The quiz skill renders `Q1. question\nA) ...\nB) ...\nReply with a letter.`; turn it back into a card. */
export function parseQuizCard(text: string): { card: ChatCard; text: string } | undefined {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const head = /^Q(\d+)\.\s+(.+)$/.exec(lines[0] ?? '');
  const tail = lines[lines.length - 1] ?? '';
  if (!head || !/^Reply with (a letter|your answer)\.$/.test(tail)) return undefined;
  const choices: { id: string; text: string }[] = [];
  for (const l of lines.slice(1, -1)) {
    const c = /^([A-F])\)\s+(.+)$/.exec(l);
    if (!c || LETTERS.indexOf(c[1]!) !== choices.length) return undefined;
    choices.push({ id: c[1]!, text: c[2]! });
  }
  const input = /letter/.test(tail) ? 'choice' : 'free';
  if (input === 'choice' && choices.length < 2) return undefined;
  const index = Number(head[1]) - 1;
  return {
    text: `Question ${index + 1}`,
    card: {
      type: 'quiz',
      index,
      question: head[2]!,
      input,
      ...(choices.length ? { choices } : {}),
    },
  };
}

const COUNCIL_RUN = /\n?\(council run (cn_[a-z0-9]{12})\)\s*$/;

/**
 * The council skill ends its reply with `(council run cn_xxxxxxxxxxxx)`; the web client renders the structured result
 * (`GET /v1/council/:id`) instead. The text keeps the plain verdict so the message still reads without the card.
 */
export function parseCouncilCard(text: string): { card: ChatCard; text: string } | undefined {
  const m = COUNCIL_RUN.exec(text);
  if (!m) return undefined;
  return { text: text.slice(0, m.index).trimEnd(), card: { type: 'council', runId: m[1]! } };
}
