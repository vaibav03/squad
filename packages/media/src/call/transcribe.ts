import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODELS } from '@squad/core/node';
import type { BudgetGuard } from '../tts/budget';

export interface Transcriber {
  transcribe(audio: Uint8Array, mime: string): Promise<string>;
}

export const MAX_INLINE_AUDIO_BYTES = 20 * 1024 * 1024 - 64 * 1024; // docs: 20 MB request cap incl. prompt

export class FakeTranscriber implements Transcriber {
  readonly calls: { bytes: number; mime: string }[] = [];
  constructor(private readonly text = 'what is a limit') {}
  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    this.calls.push({ bytes: audio.length, mime });
    return this.text;
  }
}

/**
 * Gemini audio understanding via models.generateContent with inlineData (supported by the
 * installed @google/genai 1.52). The current docs lead with the newer Interactions API; both accept
 * the same inline audio, so switching is a one-function change here. Mic audio is never written to
 * disk: only the transcript is returned.
 */
export class GeminiTranscriber implements Transcriber {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  constructor(
    opts: {
      apiKey?: string;
      model?: string;
      budget?: BudgetGuard;
      client?: Pick<GoogleGenAI, 'models'>;
    } = {},
    private readonly budget = opts.budget,
  ) {
    this.ai =
      (opts.client as GoogleGenAI | undefined) ??
      new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY });
    this.model = opts.model ?? process.env.GEMINI_MODEL_FAST ?? DEFAULT_GEMINI_MODELS.fast;
  }
  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    if (audio.length === 0) return '';
    if (audio.length > MAX_INLINE_AUDIO_BYTES)
      throw new Error('audio too large for inline transcription');
    this.budget?.charge('gemini.calls', 1);
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Transcribe this speech verbatim. Output only the transcript, nothing else.' },
            {
              inlineData: {
                mimeType: mime.split(';')[0] ?? mime,
                data: Buffer.from(audio).toString('base64'),
              },
            },
          ],
        },
      ],
    });
    return (res.text ?? '').trim();
  }
}
