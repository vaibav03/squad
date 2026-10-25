// Plain-text fallbacks for everything the web chat renders as a card. iMessage cannot show cards, markdown or tables,
// so every bot message becomes short plain text plus (where it helps) a link to the web card.
import type { ChatAttachment, ChatCard, ChatCitation, CouncilResult } from '@squad/core';
import { COUNCIL_CONFIDENCE_WORDS } from '@squad/core';

export const MAX_PART = 900;
const MAX_PARTS = 5;

export interface RenderableMessage {
  text: string;
  card?: ChatCard | undefined;
  citations?: readonly ChatCitation[];
  attachments?: readonly Pick<ChatAttachment, 'kind' | 'name'>[];
}

export interface RenderOptions {
  /** Absolute link to this message (or card) on the web. */
  link?: string;
  /** Absolute link to the council card, when the message carries one. */
  councilLink?: string;
  /** The council run, when it is available (verdict, dissent, top citation). */
  council?: CouncilResult | undefined;
  maxLen?: number;
}

/** Markdown to plain text: no emphasis marks, headings, fences, link syntax or tables. */
export function stripMarkdown(input: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    let l = raw;
    if (!fenced) {
      if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')) continue; // table rule
      if (/^\s*\|.*\|\s*$/.test(l)) {
        l = l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
          .join(', ');
      }
      l = l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[*+]\s+/, '- ')
        .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1 $2')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 $2')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?=[^*\w]|$)/g, '$1$2')
        .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?=[^_\w]|$)/g, '$1$2')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
    }
    lines.push(l.trimEnd());
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const YES = /^(yes|yep|yeah|ok|okay|sure|confirm|go|do it|book|send|start|sounds good)\b/i;
const NO = /^(no|nope|cancel|not now|skip|stop|don'?t|never mind|later)\b/i;

/** `reply 1 to confirm, 2 to cancel` for a yes/no pair; otherwise one line per option. */
export function confirmText(question: string, options: readonly string[]): string {
  const list = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
  if (options.length === 2 && YES.test(options[0]!) && NO.test(options[1]!))
    return `${question}\n${list}\nReply 1 to confirm, 2 to cancel.`;
  if (options.length === 2)
    return `${question}\n${list}\nReply 1 for ${options[0]}, 2 for ${options[1]}.`;
  return `${question}\n${list}\nReply with a number from 1 to ${options.length}.`;
}

export function quizText(card: Extract<ChatCard, { type: 'quiz' }>): string {
  const head = `Question ${card.index + 1}: ${card.question}`;
  if (card.input === 'choice' && card.choices?.length)
    return `${head}\n${card.choices.map((c, i) => `${i + 1}) ${c.text}`).join('\n')}\nReply with a number (1 to ${card.choices.length}).`;
  return `${head}\nReply with your answer.`;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}...`;
};

/** Compact council summary: verdict, how sure, one dissent line, the top verified citation, and the link. */
export function councilText(
  r: CouncilResult | undefined,
  fallbackText: string,
  link: string | undefined,
): string {
  const v = r?.verdict;
  if (!r || !v) return [fallbackText, link && `Full card: ${link}`].filter(Boolean).join('\n');
  const out = [`Council verdict: ${clip(v.answer || v.text, 200)}`];
  out.push(`${COUNCIL_CONFIDENCE_WORDS[v.confidence]}. ${clip(v.confidenceNote, 120)}`);
  if (v.dissent) out.push(`Dissent: ${v.dissent.member} said ${clip(v.dissent.view, 140)}`);
  const cite = r.members.flatMap((m) => m.citations)[0];
  if (cite) out.push(`Source: [${cite.label}]`);
  if (link) out.push(`Full card: ${link}`);
  return out.join('\n');
}

const DEFAULT_TITLE = { audio: 'Audio', image: 'Picture', file: 'File' } as const;
const titleOf = (a: Pick<ChatAttachment, 'kind' | 'name'>) =>
  a.name ? a.name.replace(/\.[A-Za-z0-9]{2,4}$/, '') : DEFAULT_TITLE[a.kind];

/** Split at paragraph, then sentence, then word boundaries; every part is at most `max` characters. */
export function splitMessage(text: string, max = MAX_PART): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  };
  const add = (piece: string, sep: string) => {
    if (piece.length > max) {
      push();
      for (const w of piece.split(/\s+/)) {
        if (w.length > max) {
          push();
          for (let i = 0; i < w.length; i += max) parts.push(w.slice(i, i + max));
        } else if ((cur ? cur.length + 1 : 0) + w.length > max) {
          push();
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      return;
    }
    if (cur && cur.length + sep.length + piece.length > max) push();
    cur = cur ? `${cur}${sep}${piece}` : piece;
  };
  for (const para of t.split(/\n{2,}/)) {
    if (para.length <= max) add(para, '\n\n');
    else for (const s of para.split(/(?<=[.!?])\s+|\n/)) add(s, ' ');
  }
  push();
  return parts;
}

/** The whole iMessage rendering of one bot message: plain text parts, ready to send in order. */
export function renderForIMessage(msg: RenderableMessage, o: RenderOptions = {}): string[] {
  const max = o.maxLen ?? MAX_PART;
  const blocks: string[] = [];
  const body = stripMarkdown(msg.text);
  const card = msg.card;
  if (card?.type === 'confirm') {
    if (card.status === 'pending')
      blocks.push(confirmText(stripMarkdown(card.question), card.options));
    else if (body) blocks.push(body);
  } else if (card?.type === 'quiz') blocks.push(quizText(card));
  else if (card?.type === 'council')
    blocks.push(councilText(o.council, body, o.councilLink ?? o.link));
  else if (card?.type === 'live') {
    blocks.push(
      [
        body || `Live discussion${card.topic ? `: ${card.topic}` : ''}`,
        o.link && `Takeaways: ${o.link}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else if (body) blocks.push(body);

  if (msg.citations?.length && card?.type !== 'council' && card?.type !== 'quiz') {
    const missing = msg.citations.filter(
      (c) => !body.includes(`${c.file} p.${c.page}`) && !body.includes(c.label),
    );
    const labels = (missing.length ? missing : msg.citations).map((c) => `[${c.label}]`);
    if (missing.length) blocks.push(`Sources: ${labels.join(' ')}`);
  }
  for (const a of msg.attachments ?? [])
    blocks.push(`${titleOf(a)}${o.link ? `: ${o.link}` : ' (open it in the Squad app)'}`);

  const parts = splitMessage(blocks.join('\n\n'), max);
  if (parts.length <= MAX_PARTS) return parts;
  const kept = parts.slice(0, MAX_PARTS);
  kept[MAX_PARTS - 1] =
    `${kept[MAX_PARTS - 1]!.slice(0, Math.max(0, max - 60)).trimEnd()}...${o.link ? `\nRest: ${o.link}` : ''}`;
  return kept;
}
