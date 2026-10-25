import { classifyGeminiError } from '@squad/core';
import type { Fatal } from './budget';

export const FIX = {
  credits_depleted:
    'Gemini prepay credits are depleted (HTTP 402 RESOURCE_EXHAUSTED). Top up at https://ai.studio/projects (open the project, Billing, add prepay credits). Wait about a minute for it to apply, then rerun `SQUAD_LIVE=1 pnpm live:verify`.',
  auth: 'Gemini rejected GEMINI_API_KEY (HTTP 401/403). Create a key at https://aistudio.google.com/apikey for a project with billing, put it in .env as GEMINI_API_KEY=..., make sure it is not restricted to other APIs, then rerun.',
  rate_limited:
    'Gemini rate-limited the run (HTTP 429 after retries). Wait the retryDelay shown (usually under a minute), rerun, or lower the load with LIVE_ONLY=<ids> / LIVE_MAX_CALLS. If it persists, request a higher quota in AI Studio.',
  el_payment:
    'ElevenLabs refused the request as payment/plan limited (HTTP 402). Check the plan and character quota at https://elevenlabs.io/app/subscription (voice design and text-to-dialogue need a paid plan).',
  el_auth:
    'ElevenLabs rejected ELEVENLABS_API_KEY (HTTP 401). Create a key at https://elevenlabs.io/app/settings/api-keys with permissions text_to_speech, voices_read (and voice design if LIVE_ELEVENLABS=1), put it in .env, rerun.',
  el_rate_limited:
    'ElevenLabs returned HTTP 429 (concurrency or rate limit). Wait a minute and rerun; the harness issues one request at a time.',
} as const;

/** Turns an error thrown by the Gemini SDK (or already an LlmError) into a Fatal, or undefined when it is a plain failure. */
export function fatalFromGemini(err: unknown): Fatal | undefined {
  const e = classifyGeminiError(err);
  const message = e.message.slice(0, 300);
  switch (e.kind) {
    case 'credits_depleted':
      return {
        kind: 'credits_depleted',
        provider: 'gemini',
        status: e.status ?? 402,
        message,
        fix: FIX.credits_depleted,
      };
    case 'auth':
      return { kind: 'auth', provider: 'gemini', status: e.status ?? 401, message, fix: FIX.auth };
    default:
      return undefined;
  }
}

export function fatalFromEleven(status: number, detail: string): Fatal | undefined {
  const message = `elevenlabs HTTP ${status}: ${detail.slice(0, 200)}`;
  if (status === 401 || status === 403)
    return { kind: 'el_auth', provider: 'elevenlabs', status, message, fix: FIX.el_auth };
  if (status === 402)
    return { kind: 'el_payment', provider: 'elevenlabs', status, message, fix: FIX.el_payment };
  if (status === 429)
    return {
      kind: 'el_rate_limited',
      provider: 'elevenlabs',
      status,
      message,
      fix: FIX.el_rate_limited,
    };
  return undefined;
}
