import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Llm } from '@squad/core';
import type { Step } from './align';
import { STEPDIFF_PROMPT_VERSION } from './align';

const StepsSchema = z.object({
  legible: z.boolean(),
  steps: z.array(z.object({ text: z.string(), latex: z.string().optional() })).default([]),
});

const LABEL = /^\s*(?:step\s*)?\(?\d+[).:]\s*/i;
/** A leading problem statement or title ("Solve: 2x + 6 = 14") is the question, not a step. */
const HEADING =
  /^\s*(?:solve|problem|question|given|find|prove|show|evaluate|simplify|q\d*)\b[^=]*[:.]/i;

/** Drops the "1)" labels and a leading title line so two photos align on the real steps. */
export function cleanSteps(raw: readonly Step[]): Step[] {
  const out = raw
    .map((s) => ({ ...s, text: s.text.replace(LABEL, '').trim() }))
    .filter((s) => s.text);
  if (out.length > 1 && HEADING.test(out[0]!.text)) out.shift();
  return out;
}

export type ExtractResult = { legible: true; steps: Step[] } | { legible: false; steps: [] };

/** Photo -> ordered steps through the vision role (image part on the `main` tier). */
export async function extractSteps(
  llm: Llm,
  image: { path: string; mime: string },
): Promise<ExtractResult> {
  const data = (await readFile(image.path)).toString('base64');
  const r = await llm.json({
    model: 'main',
    system: `You transcribe handwritten work into ordered steps, exactly as written. Do not solve, correct or comment. Return only the numbered working lines: leave out the problem statement or title at the top and leave out the step numbers themselves. If the photo is unreadable set legible=false. [prompt ${STEPDIFF_PROMPT_VERSION}]`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe each written step in order. Return {"legible": boolean, "steps": [{"text", "latex" optional}]}.',
          },
          { type: 'image', mimeType: image.mime, data },
        ],
      },
    ],
    schema: StepsSchema,
    temperature: 0,
  });
  const steps = cleanSteps(
    r.steps.map((s) => ({ text: s.text.trim(), ...(s.latex ? { latex: s.latex } : {}) })),
  );
  return r.legible && steps.length > 0 ? { legible: true, steps } : { legible: false, steps: [] };
}

/** Typed fallback: one step per line. */
export function stepsFromText(text: string): Step[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:step\s*)?\d+[).:]\s*/i, '').trim())
    .filter(Boolean)
    .map((t) => ({ text: t }));
}
