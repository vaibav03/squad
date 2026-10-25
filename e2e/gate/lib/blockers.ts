// External blockers: things code cannot fix. Each maps to a runbook paragraph in docs/qa/RELEASE-GATE.md.
// Presence checks read variable NAMES only; values are never printed, logged, copied or put in the report.
import fs from 'node:fs';
import path from 'node:path';
import { HUB, REPO } from './config';
import type { Blocker } from './types';

/** Names defined (non-empty) in the process env or in .env. */
export function definedEnvNames(): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) if (v) out.add(k);
  try {
    for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^\s"'#]+)/.exec(l);
      if (m) out.add(m[1]!);
    }
  } catch {
    /* no .env */
  }
  return out;
}

export const RUNBOOKS: Record<string, { code: string; reason: string; anchor: string }> = {
  google_client: {
    code: 'no_google_client',
    reason: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set: the Google OAuth client and consent screen are not registered.',
    anchor: '#google-oauth-client-and-consent-screen',
  },
  google_account: {
    code: 'no_own_google_account',
    reason: 'GATE_OWN_GOOGLE_EMAIL is not set: real runs only ever use the user\'s own Google account.',
    anchor: '#google-oauth-client-and-consent-screen',
  },
  canvas_feed: {
    code: 'no_canvas_feed',
    reason: 'GATE_CANVAS_FEED_URL / GATE_OWN_CANVAS_HOST are not set: no Canvas calendar feed of the user\'s own to read.',
    anchor: '#canvas-institution-token-or-feed',
  },
  canvas_token: {
    code: 'token_disabled_or_missing',
    reason: 'No Canvas personal access token (many institutions disable student tokens).',
    anchor: '#canvas-institution-token-or-feed',
  },
  apple: {
    code: 'apple_unverified',
    reason: 'imessage-kit on this macOS has no recorded passing allowlisted run (Full Disk Access, Automation, Messages signed in).',
    anchor: '#apple-behaviour-and-permissions',
  },
  second_person: {
    code: 'needs_second_person',
    reason: 'A real multi-participant group needs other consenting people; Apple has no API to create groups.',
    anchor: '#real-multi-person-imessage-group',
  },
  llm: {
    code: 'llm_credits',
    reason: 'GET /v1/status says the model is the demo stand-in (no key, rejected key, or depleted Gemini credits).',
    anchor: '#gemini-credits-live-and-elevenlabs-plan',
  },
  elevenlabs: {
    code: 'elevenlabs_plan',
    reason: 'ElevenLabs reports paid_plan_required (or no key): voice is unavailable on this plan.',
    anchor: '#gemini-credits-live-and-elevenlabs-plan',
  },
};

async function hubStatus(): Promise<{ llm?: string; tts?: string; ttsReason?: string } | undefined> {
  try {
    return (await (await fetch(`${HUB}/v1/status`)).json()) as { llm?: string; tts?: string; ttsReason?: string };
  } catch {
    return undefined;
  }
}

/** Returns a Blocker when the external prerequisite `key` is missing, otherwise undefined. */
export async function blockerFor(key: string): Promise<Blocker | undefined> {
  const names = definedEnvNames();
  const b = (k: keyof typeof RUNBOOKS): Blocker => ({
    code: RUNBOOKS[k]!.code,
    reason: RUNBOOKS[k]!.reason,
    runbook: RUNBOOKS[k]!.anchor,
  });
  switch (key) {
    case 'google_client':
      return names.has('GOOGLE_CLIENT_ID') && names.has('GOOGLE_CLIENT_SECRET') ? undefined : b('google_client');
    case 'google_account':
      return names.has('GATE_OWN_GOOGLE_EMAIL') ? undefined : b('google_account');
    case 'canvas_feed':
      return names.has('GATE_CANVAS_FEED_URL') && names.has('GATE_OWN_CANVAS_HOST') ? undefined : b('canvas_feed');
    case 'canvas_token':
      return names.has('GATE_CANVAS_TOKEN') ? undefined : b('canvas_token');
    case 'apple':
      return names.has('GATE_APPLE_VERIFIED') && names.has('IMESSAGE_ALLOWED_CHATS') ? undefined : b('apple');
    case 'second_person':
      return process.env.GATE_REAL_GROUP_HAS_OTHERS === '1' ? undefined : b('second_person');
    case 'llm': {
      const s = await hubStatus();
      return s?.llm === 'gemini' ? undefined : b('llm');
    }
    case 'elevenlabs': {
      const s = await hubStatus();
      return s?.tts === 'elevenlabs' ? undefined : b('elevenlabs');
    }
    default:
      return undefined;
  }
}

/** Every external blocker evaluated now, for the report's honest list. */
export async function allBlockers(): Promise<(Blocker & { key: string; blocked: boolean })[]> {
  const out: (Blocker & { key: string; blocked: boolean })[] = [];
  for (const key of Object.keys(RUNBOOKS)) {
    const bl = await blockerFor(key);
    const r = RUNBOOKS[key]!;
    out.push({ key, blocked: !!bl, code: r.code, reason: r.reason, runbook: r.anchor });
  }
  return out;
}
