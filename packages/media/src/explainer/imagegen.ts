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
 * Gemini image model via models.generateContent with responseModalities ['IMAGE'], matching the
 * generateContent image-generation guide (ai.google.dev/gemini-api/docs/generate-content/image-generation;
 * image bytes in candidates[].content.parts[].inlineData.data). The Interactions API equivalent is
 * `ai.interactions.create` -> `output_image.data`. Default model `gemini-nano-banana-2.1` is listed
 * on the models page; overridable with GEMINI_IMAGE_MODEL.
 * Not verified against a live call in CI: run `SQUAD_LIVE=1 pnpm --filter @squad/media smoke:live`.
 */
export class GeminiImageGen implements ImageGen {
  private readonly ai: Pick<GoogleGenAI, 'models'>;
  private readonly model: string;
  constructor(
    opts: { apiKey?: string; model?: string; client?: Pick<GoogleGenAI, 'models'> } = {},
  ) {
    this.ai = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY });
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
