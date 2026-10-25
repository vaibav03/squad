import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

export interface ImageGen {
  /** Returns PNG bytes. */
  generate(prompt: string): Promise<Uint8Array>;
}

export const NO_TEXT_SUFFIX =
  'Absolutely no text, no labels, no letters, no numbers, no logos, no watermarks anywhere in the image.';

/** Prompt is built by code from the plan so "no text" is always present. */
export function illustrationPrompt(concept: string): string {
  return `A friendly, flat-colour editorial illustration that evokes: ${concept}. Warm palette, simple shapes, plenty of empty space, square composition. ${NO_TEXT_SUFFIX}`;
}

export class FakeImageGen implements ImageGen {
  readonly prompts: string[] = [];
  async generate(prompt: string): Promise<Uint8Array> {
    this.prompts.push(prompt);
    const h = createHash('sha256').update(prompt).digest();
    return sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: { r: h[0]!, g: h[1]!, b: h[2]! },
      },
    })
      .png()
      .toBuffer();
  }
}

/**
 * Gemini image model via models.generateContent with responseModalities ['IMAGE'] (supported by the
 * installed @google/genai 1.52). The current docs show the newer Interactions API
 * (`ai.interactions.create`, result `output_image.data`); the model id default
 * `gemini-nano-banana-2.1` comes from those docs and is overridable with GEMINI_IMAGE_MODEL.
 * Not verified against a live call in CI: run `SQUAD_LIVE=1 pnpm --filter @squad/media smoke:live`.
 */
export class GeminiImageGen implements ImageGen {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY });
    this.model = opts.model ?? process.env.GEMINI_IMAGE_MODEL ?? 'gemini-nano-banana-2.1';
  }
  async generate(prompt: string): Promise<Uint8Array> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { responseModalities: ['IMAGE'] },
    });
    for (const c of res.candidates ?? [])
      for (const p of c.content?.parts ?? [])
        if (p.inlineData?.data)
          return sharp(Buffer.from(p.inlineData.data, 'base64')).png().toBuffer();
    throw new Error('image model returned no image');
  }
}
