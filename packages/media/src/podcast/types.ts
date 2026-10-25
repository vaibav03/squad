import type { Citation, Llm, OutboundMessage, StudentId } from '@squad/core';
import type { TtsService } from '../tts/service';
import type { VoiceService } from '../voices/service';

export interface Passage {
  id: string;
  text: string;
  cite: Citation;
}

/** Supplied by brain (03) / spine (02). Counts are anonymized by the supplier and re-checked here. */
export interface PodcastMaterial {
  chapterTitle: string;
  passages: Passage[];
  /** Squad-level weak spots as anonymized counts. Used ONLY when squadSize >= MIN_GROUP_SIZE. */
  weakSpots?: { concept: string; count: number }[];
  /** The requesting student's own weak concepts (personal cut only). */
  personalWeakSpots?: string[];
  /** Opt-in inside-joke snippets with names already removed. */
  jokes?: string[];
  squadSize: number;
}

export interface MaterialRequest {
  courseId: string;
  chapter: string;
  audience: 'squad' | StudentId;
  chatId: string;
}

export type MaterialProvider = (req: MaterialRequest) => Promise<PodcastMaterial>;

export type Speaker = 'cubbie' | 'rival';

export interface ScriptTurn {
  speaker: Speaker;
  text: string;
  /** `fact` turns are checked against passages and dropped when unsupported; `banter` is exempt. */
  kind: 'fact' | 'banter';
  /** Passage ids backing a fact turn (filled by the fact-check pass). */
  evidence?: string[];
}

export interface PodcastDeps {
  llm: Llm;
  tts: Pick<TtsService, 'speakVoice' | 'dialogue'>;
  voices: Pick<VoiceService, 'resolve'>;
  material: MaterialProvider;
  /** Where scripts, chunks and episodes are cached. */
  outDir: string;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface PodcastRequest extends MaterialRequest {
  /** Override target length for tests. */
  targetWords?: { min: number; max: number };
}

export interface PodcastResult {
  message: OutboundMessage;
  /** Set for personal cuts: deliver with ctx.dm(student, ...) only, never to the group chat. */
  dm?: StudentId;
  path: string;
  durationMs: number;
  script: ScriptTurn[];
  dropped: number;
  citations: Citation[];
}
