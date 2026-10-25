import type { ChatCitation, ChatContextRef, InboundMessage, Llm, OutboundMessage, Skill } from '@squad/core';
import type { ContextStore } from '../../context/store';
import type { ContextSource, ContextViewer } from '../../context/types';

export interface ContextAskOptions {
  viewerFor: (m: { from: string }) => ContextViewer | undefined;
  /** When a real model is answering the hub gives it here; otherwise the answer is the deterministic grounded one. */
  llm?: Llm;
  llmIsReal?: () => boolean;
  now?: () => number;
}

const CAL = new Set(['gcal_event', 'canvas_event']);
const stripBot = (t: string) =>
  t.replace(/@cubbie?\b/gi, '').replace(/^\s*(?:hey|hi)\s+cubbie?\b[\s,:;-]*/i, '').trim();

const day = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

function body(chunkText: string): string {
  return chunkText
    .split('\n')
    .filter((l) => l.trim() && !/^Course:/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(text: string, max = 280): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + '...';
}

function describe(src: ContextSource, ref: ChatContextRef, text: string, now: number): string {
  const where = [ref.courseName, ref.eventLabel, ref.location?.label].filter(Boolean).join(', ');
  const head = `${src.title}${where ? ` (${where})` : ''}`;
  const lines: string[] = [];
  if (src.dueAt !== null) {
    const d = Math.ceil((src.dueAt - now) / 86_400_000);
    lines.push(
      d < 0
        ? `${head} was due ${day(src.dueAt)}.`
        : `${head} is due ${day(src.dueAt)}, ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}.`,
    );
  } else lines.push(`${head}.`);
  const b = snippet(body(text));
  if (b) lines.push(`What it says: "${b}"`);
  if (src.dueAt !== null)
    lines.push('Focus: read the brief first, list what you must hand in, and block time before the due date.');
  else if (src.kind === 'canvas_file' || src.kind === 'gdrive_file' || src.kind === 'gdoc')
    lines.push('Focus: skim the headings first, then the parts above that name what is examined.');
  return lines.join('\n');
}

/**
 * "Ask Cubbie" handoff: a message carrying hub-verified context refs (structured, never parsed from the text) is
 * answered from exactly those sources, with one citation chip per source carrying title, course/event, location and
 * real-vs-fixture provenance. A private calendar event attached in a group is never described there: the group gets an
 * aggregate sentence and the owner gets the details in their DM.
 */
export function createContextAskSkill(store: ContextStore, opts: ContextAskOptions): Skill {
  const now = opts.now ?? (() => Date.now());
  return {
    name: 'context-ask',
    async match(m) {
      return m.mentionsBot && m.context?.length ? 0.99 : 0;
    },
    async handle(m: InboundMessage): Promise<OutboundMessage[]> {
      const viewer = opts.viewerFor(m);
      if (!viewer) return [];
      const group = m.isGroup;
      const question = stripBot(m.text);
      const publicParts: string[] = [];
      const privateParts: string[] = [];
      const publicCites: ChatCitation[] = [];
      const privateCites: ChatCitation[] = [];
      for (const ref of m.context ?? []) {
        // the read gate again: the ref came from the hub, but nothing is answered from a source the asker cannot read
        const src = store.readable(ref.sourceId, viewer);
        if (!src) {
          publicParts.push("I can't read that item any more (it was removed or is not shared with you).");
          continue;
        }
        const chunk = store.chunk(src.id, ref.location?.anchor) ?? store.chunks(src.id)[0];
        const text = chunk?.text ?? '';
        const fixture = src.provenance.endsWith(':fixture');
        const cite: ChatCitation = {
          file: src.title,
          page: 1,
          label: src.title,
          source: {
            kind: src.kind,
            id: src.id,
            ...(chunk ? { anchor: chunk.anchor } : {}),
            title: src.title,
            ...(src.url ? { url: src.url } : {}),
            provenance: fixture ? 'fixture' : 'real',
            ...(ref.courseName ? { courseName: ref.courseName } : {}),
            ...(ref.location?.label || ref.eventLabel
              ? { locationLabel: (ref.location?.label ?? ref.eventLabel) as string }
              : {}),
          },
          ...(body(text) ? { quote: snippet(body(text), 200) } : {}),
        };
        let say = describe(src, ref, text, now());
        if (opts.llm && opts.llmIsReal?.()) {
          try {
            const r = await opts.llm.complete({
              model: 'fast',
              maxTokens: 300,
              temperature: 0.2,
              system:
                'You are Cubbie, a study buddy. Answer ONLY from the SOURCE below. 2 to 4 short sentences, plain text, no markdown. If the source does not answer, say so. Never invent dates, scores or details.',
              messages: `SOURCE (${fixture ? 'simulated demo data' : 'imported from the student\'s own account'}): ${src.title}\n${text.slice(0, 2500)}\n\nStudent: ${question || 'What should I focus on?'}`,
            });
            if (r.text.trim()) say = `${r.text.trim()}\n\nSource: ${src.title}${ref.courseName ? `, ${ref.courseName}` : ''}${ref.location?.label ? `, ${ref.location.label}` : ''} (${fixture ? 'Fixture, simulated' : 'Real'}).`;
          } catch {
            // the grounded deterministic answer stands; nothing is invented
          }
        }
        if (CAL.has(src.kind) && group && src.sharedWith.length === 0) {
          privateParts.push(say);
          privateCites.push(cite);
        } else {
          publicParts.push(say);
          publicCites.push(cite);
        }
      }
      const out: OutboundMessage[] = [];
      if (publicParts.length || privateParts.length) {
        const aggregate = privateParts.length
          ? `${privateParts.length} private calendar item${privateParts.length === 1 ? '' : 's'} attached: I sent the details to ${'the person who attached it'} privately.`
          : '';
        out.push({
          chatId: m.chatId,
          text: [...publicParts, aggregate].filter(Boolean).join('\n\n'),
          ...(publicCites.length ? { citations: publicCites } : {}),
          ...(publicCites.length === 0 && privateParts.length
            ? { provenance: { kind: 'no_sources' as const, label: 'Private calendar item: details sent to its owner only' } }
            : {}),
        });
        if (privateParts.length)
          out.push({ chatId: `dm:${m.from}`, text: privateParts.join('\n\n'), citations: privateCites });
      }
      return out;
    },
  };
}
