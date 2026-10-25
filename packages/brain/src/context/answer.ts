import { z } from 'zod';
import type { Llm } from '@squad/core';
import { renderSourceAnswer, verifySourceClaims, type SourceClaim } from '../citations/sources';
import { NOT_IN_MATERIALS, type ExpertAnswer } from '../experts/types';
import { bestQuote } from './retrieve';
import type { ContextChunk, ContextSource } from './types';
import { sourceUri } from '@squad/core';

const Claims = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().max(600),
        source: z.string().max(400),
        quote: z.string().max(600),
      }),
    )
    .max(4),
});

const SYSTEM = `You answer a student's question using ONLY the context excerpts given. Each excerpt is labelled with a source URI like source://kind/id#anchor.
Return JSON {"claims":[{"text": one sentence, "source": the exact URI label of the excerpt it comes from, "quote": a short phrase copied VERBATIM from that excerpt}]}.
Rules: at most 4 claims; the quote must appear word for word in the cited excerpt; never invent a source URI; if the excerpts do not answer the question return {"claims":[]}.`;

/** Asks the model for claims over retrieved chunks, then keeps only those whose quote is verbatim in the cited chunk. */
export async function answerFromContext(
  llm: Llm,
  question: string,
  hits: { chunk: ContextChunk; source: ContextSource }[],
): Promise<ExpertAnswer> {
  if (hits.length === 0)
    return {
      text: NOT_IN_MATERIALS,
      citations: [],
      grounded: false,
      claims: [],
      chapters: [],
      struck: 0,
    };
  const label = (h: { chunk: ContextChunk; source: ContextSource }) =>
    sourceUri({ kind: h.source.kind, id: h.source.id, anchor: h.chunk.anchor });
  const block = hits.map((h) => `[${label(h)}] (${h.source.title})\n${h.chunk.text}`).join('\n\n');
  let claims: SourceClaim[] = [];
  try {
    const r = await llm.json({
      model: 'main',
      system: SYSTEM,
      messages: `Question: ${question}\n\nContext excerpts:\n${block}`,
      schema: Claims,
      temperature: 0,
    });
    claims = r.claims.map((c) => ({
      text: c.text,
      source: c.source.replace(/^\[|\]$/g, ''),
      quote: c.quote,
    }));
  } catch {
    // The model is unavailable (demo stand-in, outage): answer from retrieval alone. The top chunk's best sentence is
    // copied verbatim, so it passes the same verification as a model claim and the chat labels it Demo.
    const top = hits[0]!;
    const quote = bestQuote(top.chunk.text, question).slice(0, 300);
    claims = quote
      ? [{ text: `Closest match in your connected sources: "${quote}"`, source: label(top), quote }]
      : [];
  }
  const { verified, struck } = verifySourceClaims(
    claims,
    hits.map((h) => h.chunk),
  );
  const bySource = new Map(hits.map((h) => [h.source.id, h.source]));
  const ans = renderSourceAnswer(verified, (ref) => bySource.get(ref.id));
  return { ...ans, struck: struck.length };
}
