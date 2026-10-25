import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Llm } from '@squad/core';

/** Whitespace tidy that keeps the words verbatim so quotes still match the page. */
export function cleanPageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2') // end-of-line hyphenation
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Pages with fewer visible characters than this are treated as scanned/figure-only. */
export const SPARSE_PAGE_CHARS = 40;

export interface ExtractOptions {
  /** Gemini PDF/vision fallback for sparse pages (needs an Llm; failures keep the empty text). */
  llm?: Llm;
}

/** Per-page text with `unpdf`; sparse pages go through Gemini vision when an Llm is given. */
export async function extractPages(
  src: string | Uint8Array,
  opts: ExtractOptions = {},
): Promise<string[]> {
  const bytes = typeof src === 'string' ? new Uint8Array(await readFile(src)) : src;
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text.map(cleanPageText);
  if (opts.llm) {
    for (let i = 0; i < pages.length; i++) {
      if ((pages[i] ?? '').length >= SPARSE_PAGE_CHARS) continue;
      const v = await visionPageText(opts.llm, bytes, i + 1).catch(() => '');
      if (v) pages[i] = cleanPageText(v);
    }
  }
  return pages;
}

/**
 * Reads one page through the vision tier. The whole PDF goes in as an inline part and the prompt
 * names the page; a PDF page costs ~258 tokens, so this is only used for sparse pages.
 */
export async function visionPageText(llm: Llm, pdf: Uint8Array, page: number): Promise<string> {
  const res = await llm.complete({
    model: 'main',
    system:
      'Transcribe the requested PDF page verbatim as plain text. Include captions and labels in figures. Output only the transcription.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', mimeType: 'application/pdf', data: Buffer.from(pdf).toString('base64') },
          { type: 'text', text: `Transcribe page ${page} only.` },
        ],
      },
    ],
    temperature: 0,
  });
  return res.text;
}
