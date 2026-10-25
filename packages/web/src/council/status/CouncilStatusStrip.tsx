import type { CouncilStatus } from '@squad/core';
import {
  AUDIO_WORDS,
  MIC_WORDS,
  TRANSCRIPT_WORDS,
  deriveStrip,
  type AudioState,
  type MicState,
  type StripRun,
  type TranscriptState,
} from './derive';
import './status-strip.css';

export interface CouncilStatusStripProps {
  /** From `useCouncilStatus`: null (loading or no hub) | 'unknown' (endpoint unreachable) | the hub's status. */
  status: CouncilStatus | null | 'unknown';
  run?: StripRun | undefined;
  mic?: MicState | undefined;
  audio?: AudioState | undefined;
  transcript?: TranscriptState | undefined;
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * Provider and live-state evidence for every council surface: provider, models actually used, transport, key state with
 * its fix, run mode, mic, audio output, transcript and A2A counters. Words AND glyphs. A demo run shows an unmissable
 * `DEMO: scripted, not Gemini` banner; `LIVE: Gemini` only when every participant really used the model.
 */
export function CouncilStatusStrip({
  status,
  run,
  mic,
  audio,
  transcript,
  variant = 'compact',
  className,
}: CouncilStatusStripProps) {
  const v = deriveStrip({ status, run, mic, audio, transcript });
  const m = MIC_WORDS[v.mic];
  const a = AUDIO_WORDS[v.audio];
  const t = TRANSCRIPT_WORDS[v.transcript];
  const keyBad = v.key.state !== 'ok';
  return (
    <section
      className={['cs-strip', className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-tier={v.badge.tier}
      aria-label="Council provider and live status"
    >
      {v.badge.tier !== 'none' ? (
        <p className="cs-banner" data-tier={v.badge.tier} role="status" data-testid="cs-banner">
          <Glyph name={v.badge.glyph} /> {v.badge.text}
        </p>
      ) : null}
      <ul className="cs-row">
        <li data-testid="cs-provider">
          <span className="cs-k">Provider</span> {v.provider}
        </li>
        <li data-testid="cs-transport">
          <span className="cs-k">Transport</span> {v.transport}
        </li>
        {v.mode ? (
          <li data-testid="cs-mode" data-tier={v.mode.tier}>
            <span className="cs-k">Mode</span> <Glyph name={v.mode.glyph} size={12} /> {v.mode.word}
          </li>
        ) : null}
        <li data-testid="cs-key" data-state={v.key.state}>
          <span className="cs-k">Key</span> <Glyph name={v.key.glyph} size={12} /> {v.key.word}
        </li>
        <li data-testid="cs-models">
          <span className="cs-k">Models</span>{' '}
          {v.models.length ? v.models.map((x) => `${x.who} ${x.model}`).join(', ') : v.modelsNote}
          {v.models.length && v.modelsNote ? ` (${v.modelsNote.toLowerCase()})` : ''}
        </li>
        <li data-testid="cs-mic" data-state={v.mic}>
          <Glyph name={m.glyph} size={12} /> {m.word}
        </li>
        <li data-testid="cs-audio" data-state={v.audio}>
          <Glyph name={a.glyph} size={12} /> {a.word}
        </li>
        <li data-testid="cs-transcript" data-state={v.transcript}>
          <Glyph name={t.glyph} size={12} /> {t.word}
        </li>
        {v.counters ? (
          <li data-testid="cs-a2a">
            <span className="cs-k">A2A</span> {v.counters.messages} messages,{' '}
            {v.counters.delegations} delegations, stage: {v.counters.stage}
          </li>
        ) : null}
      </ul>
      {v.fallback ? (
        <p className="cs-note" data-testid="cs-fallback">
          <Glyph name="alert" size={12} /> {v.fallback}
        </p>
      ) : null}
      {keyBad || variant === 'full' ? (
        <p className="cs-fix" data-testid="cs-fix" data-state={v.key.state}>
          <span className="cs-k">Fix</span> {v.key.fix}
        </p>
      ) : null}
    </section>
  );
}

import type { CouncilResult } from '@squad/core';
import type { HubCtx } from '../../pages/village/hub';
import { runFromResult } from './derive';
import { useCouncilStatus } from './useCouncilStatus';
import { Glyph } from '../deliberation/Glyph';

/** The strip for a council result card or panel run (loads the hub status itself; fixtures without a hub stay honest). */
export function ResultStatusStrip({
  result,
  hub,
  variant = 'compact',
  mic,
  audio,
  transcript,
}: {
  result?: CouncilResult | null;
  hub?: HubCtx | null;
  variant?: 'compact' | 'full';
  mic?: MicState;
  audio?: AudioState;
  transcript?: TranscriptState;
}) {
  const { status } = useCouncilStatus(hub);
  return (
    <CouncilStatusStrip
      status={hub ? status : null}
      run={result ? runFromResult(result) : undefined}
      variant={variant}
      mic={mic}
      audio={audio}
      transcript={transcript}
    />
  );
}
