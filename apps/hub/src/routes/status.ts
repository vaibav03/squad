import { Hono } from 'hono';
import type { HubApp, HubDeps, HubEnv } from '../types';
import { FIX_TEXT } from './admin';

export const DEMO_NOTICE = 'Demo mode: add GEMINI_API_KEY to .env for real answers';

const NOTICES: Record<string, string> = {
  no_key: DEMO_NOTICE,
  forced_fake: 'Demo mode: FORCE_FAKE_LLM=1, answers come from the scripted demo model',
  credits_depleted: 'Demo mode: Gemini credits depleted, add credits in AI Studio for real answers',
  invalid_key:
    'Demo mode: Gemini rejected the API key, answers come from the scripted demo model (rechecked every 10 minutes)',
  rate_limited:
    'Demo mode: Gemini is rate limiting, answers come from the scripted demo model until it recovers',
};

/**
 * GET /v1/status (public): whether answers are real or the demo stand-in, and why. Contains no secrets,
 * only provider names and a reason code. `llm: 'gemini'|'fake'`, `tts: 'elevenlabs'|'none'`.
 */
export function createStatusRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  r.get('/v1/status', (c) => {
    const rt = deps.runtime;
    const llm = rt?.llm() ?? { llm: 'fake' as const, reason: 'no_key' as const };
    const fake = llm.llm === 'fake';
    c.header('cache-control', 'no-store');
    return c.json({
      llm: fake ? 'fake' : 'gemini',
      tts: rt?.tts() ? 'elevenlabs' : 'none',
      demo: fake,
      ports: rt?.ports() ?? 'stub',
      ...(fake && llm.reason ? { reason: llm.reason } : {}),
      ...(fake && llm.since ? { since: llm.since } : {}),
      ...(fake && llm.lastProbeAt ? { lastProbeAt: llm.lastProbeAt } : {}),
      ...(fake && llm.nextProbeAt ? { nextProbeAt: llm.nextProbeAt } : {}),
      ...(fake ? { fix: FIX_TEXT[llm.reason ?? 'no_key'] } : {}),
      ...(fake ? { notice: NOTICES[llm.reason ?? 'no_key'] ?? DEMO_NOTICE } : {}),
    });
  });
  return r;
}
