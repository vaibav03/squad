import type { CouncilResult, CouncilRunTransport, CouncilStatus } from '@squad/core';
import { modeInfo } from '@squad/village/council';

/**
 * Pure view-model of the council status strip. Everything the strip says is decided here so every state is testable
 * without rendering. Words AND glyphs, never colour alone.
 */
export type MicState = 'idle' | 'listening' | 'permission_denied' | 'unavailable';
export type AudioState = 'playing' | 'muted' | 'unavailable';
export type TranscriptState = 'streaming' | 'complete' | 'none';
export type KeyView = 'ok' | 'credits_depleted' | 'no_key' | 'rate_limited' | 'unknown';

export interface StripRun {
  /** live | degraded:<reason> | demo[:<reason>] */
  mode: string;
  transport?: CouncilRunTransport | undefined;
  /** Per participant modes: LIVE needs every one to be live. */
  agents?: readonly { mode: string }[] | undefined;
  counters?: { messages: number; delegations: number; stage?: string | undefined } | undefined;
}

export interface StripInput {
  /** null = not loaded or no hub; 'unknown' = the endpoint is missing/unreachable. */
  status: CouncilStatus | null | 'unknown';
  run?: StripRun | undefined;
  mic?: MicState | undefined;
  audio?: AudioState | undefined;
  transcript?: TranscriptState | undefined;
}

export type BadgeTier = 'live' | 'degraded' | 'demo' | 'none';
export interface RunBadge {
  tier: BadgeTier;
  glyph: string;
  /** 'LIVE: Gemini' | 'DEGRADED: rate limited' | 'DEMO: scripted, not Gemini' | '' */
  text: string;
}

export const DEMO_BANNER = 'DEMO: scripted, not Gemini';
const words = (r: string): string => r.replace(/[_-]+/g, ' ').trim();

export function transportWords(kind: CouncilRunTransport['kind']): string {
  return kind === 'demo'
    ? 'Demo (scripted, not Gemini)'
    : kind === 'live-audio'
      ? 'Gemini Live (audio + transcript)'
      : 'Gemini streaming text';
}

/**
 * The run badge. LIVE only when the run mode is exactly `live`, the transport is not demo AND every participant that
 * is reported is live. One demo participant makes it DEMO, one degraded participant DEGRADED. Without a run, a hub
 * with no key still says DEMO (every run it starts is scripted).
 */
export function deriveRunBadge(
  run: StripRun | undefined,
  status: CouncilStatus | null | 'unknown' = null,
): RunBadge {
  const keyNo = status !== null && status !== 'unknown' && status.key.state === 'no_key';
  if (!run) {
    return keyNo
      ? { tier: 'demo', glyph: '◆', text: DEMO_BANNER }
      : { tier: 'none', glyph: '', text: '' };
  }
  const modes = [run.mode, ...(run.agents ?? []).map((a) => a.mode)];
  const demo =
    modes.some((m) => modeInfo(m).tier === 'demo') ||
    run.transport?.kind === 'demo' ||
    (keyNo && run.mode !== 'live');
  if (demo) return { tier: 'demo', glyph: '◆', text: DEMO_BANNER };
  const bad = modes.find((m) => modeInfo(m).tier === 'degraded');
  if (bad) {
    const why = modeInfo(bad).word.replace(/^Degraded:?\s*/, '');
    return { tier: 'degraded', glyph: '▲', text: why ? `DEGRADED: ${why}` : 'DEGRADED' };
  }
  return { tier: 'live', glyph: '●', text: 'LIVE: Gemini' };
}

export const KEY_WORDS: Record<KeyView, { glyph: string; word: string }> = {
  ok: { glyph: '✓', word: 'Key ok' },
  credits_depleted: { glyph: '▲', word: 'Credits depleted' },
  no_key: { glyph: '✕', word: 'No key' },
  rate_limited: { glyph: '▲', word: 'Rate limited' },
  unknown: { glyph: '?', word: 'Key state unknown' },
};
export const MIC_WORDS: Record<MicState, { glyph: string; word: string }> = {
  idle: { glyph: '○', word: 'Mic idle' },
  listening: { glyph: '●', word: 'Mic listening' },
  permission_denied: { glyph: '✕', word: 'Mic permission denied' },
  unavailable: { glyph: '–', word: 'Mic unavailable' },
};
export const AUDIO_WORDS: Record<AudioState, { glyph: string; word: string }> = {
  playing: { glyph: '♪', word: 'Audio playing' },
  muted: { glyph: '✕', word: 'Audio muted' },
  unavailable: { glyph: '–', word: 'Audio unavailable' },
};
export const TRANSCRIPT_WORDS: Record<TranscriptState, { glyph: string; word: string }> = {
  streaming: { glyph: '…', word: 'Transcript streaming' },
  complete: { glyph: '✓', word: 'Transcript complete' },
  none: { glyph: '–', word: 'No transcript' },
};

export interface StripView {
  provider: string;
  badge: RunBadge;
  transport: string;
  /** `tier model` pairs actually used (or configured, when there is no run). Empty for a scripted run. */
  models: { who: string; model: string }[];
  modelsNote: string;
  key: { state: KeyView; glyph: string; word: string; fix: string };
  mode: { glyph: string; word: string; tier: string } | null;
  mic: MicState;
  audio: AudioState;
  transcript: TranscriptState;
  counters: { messages: number; delegations: number; stage: string } | null;
  /** The transport the run asked for fell back (Live -> streaming), in plain words. */
  fallback: string | null;
}

export const STAGE_WORDS: Record<string, string> = {
  question: 'Question',
  delegation: 'Delegation',
  opinions: 'Opinions',
  critiques: 'Critiques and ranks',
  dissent: 'Dissent',
  verdict: 'Verdict',
  actions: 'Action items',
  done: 'Done',
};

export function deriveStrip(i: StripInput): StripView {
  const st = i.status !== null && i.status !== 'unknown' ? i.status : null;
  const badge = deriveRunBadge(i.run, i.status);
  const kind = i.run?.transport?.kind;
  const demoRun = badge.tier === 'demo';
  const keyState: KeyView = st ? st.key.state : 'unknown';
  const key = {
    state: keyState,
    ...KEY_WORDS[keyState],
    fix: st ? st.key.fix : 'The hub did not report its key state.',
  };

  let transport: string;
  // a scripted run never reads as Gemini, whatever transport label it carried
  if (demoRun) transport = transportWords('demo');
  else if (i.run?.transport) transport = i.run.transport.label || transportWords(i.run.transport.kind);
  else if (i.run) transport = 'Transport not reported';
  else if (st) transport = st.defaultTransport === 'live' ? st.transports.live.label : st.transports.stream.label;
  else transport = 'Transport unknown';

  let models: { who: string; model: string }[] = [];
  let modelsNote = '';
  if (demoRun) modelsNote = 'No model used (scripted)';
  else if (i.run?.transport?.models?.length) models = [...i.run.transport.models];
  else if (st) {
    models = [
      { who: 'chair', model: st.models.chair },
      { who: 'main', model: st.models.main },
      { who: 'fast', model: st.models.fast },
    ];
    if (st.models.live && (kind === 'live-audio' || (!i.run && st.defaultTransport === 'live')))
      models.push({ who: 'live', model: st.models.live });
    if (!i.run) modelsNote = 'Configured';
  } else modelsNote = 'Models not reported';

  const live = kind === 'live-audio' && !demoRun;
  const mic: MicState = i.mic ?? (live ? 'idle' : 'unavailable');
  const audio: AudioState = i.audio ?? (live ? 'muted' : 'unavailable');
  const transcript: TranscriptState =
    i.transcript ?? (live ? (i.run?.counters?.stage === 'done' ? 'complete' : 'streaming') : 'none');

  const info = i.run ? modeInfo(i.run.mode) : null;
  const rt = i.run?.transport;
  const fallback =
    rt?.requested === 'live' && rt.kind !== 'live-audio' && rt.why
      ? `Live was requested but not used: ${words(rt.why)}`
      : null;
  return {
    provider: 'Google Gemini',
    badge,
    transport,
    models,
    modelsNote,
    key,
    mode: info ? { glyph: info.glyph, word: info.word, tier: info.tier } : null,
    mic,
    audio,
    transcript,
    counters: i.run?.counters
      ? {
          messages: i.run.counters.messages,
          delegations: i.run.counters.delegations,
          stage: STAGE_WORDS[i.run.counters.stage ?? ''] ?? i.run.counters.stage ?? 'Not started',
        }
      : st
        ? { messages: st.a2a.messages, delegations: st.a2a.delegations, stage: STAGE_WORDS[st.a2a.lastStage ?? ''] ?? 'No run yet' }
        : null,
    fallback,
  };
}

/** Strip input from a council result card (`mode`, `transport`, `agents`, `stage`, envelope count). */
export function runFromResult(r: CouncilResult): StripRun {
  const msgs = (r.messages ?? []) as { kind?: string; to?: string }[];
  return {
    mode: r.mode ?? (r.demo ? 'demo' : 'live'),
    transport: r.transport,
    agents: r.agents,
    counters: {
      messages: msgs.filter((m) => !(m.to ?? '').startsWith('tool:')).length,
      delegations: msgs.filter((m) => m.kind === 'delegate').length,
      stage: r.stage,
    },
  };
}
